const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { JungleDisplayDriver } = require('./jungle-display');
const { DEFAULT_PROFILE: defaultProfile, clamp, sanitizeProfile, fitPreview } = require('./display-profile');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const execFileAsync = promisify(execFile);
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_VALUE_NAME = 'JungleDisplayStudio';
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let controlWindow;
let streamWindow;
let previewWindow;
let driver;
let quitting = false;
let previousCpu = null;
let cachedCpuPercent = 0;
let reconnectTimer = null;
let manualDisconnect = false;
let hadConnection = false;

const defaults = {
  language: 'en',
  portPath: 'auto',
  brightness: 100,
  maxFrameBytes: 50000,
  startup: { launchAtLogin: false, autoConnect: false, autoReconnect: true, reconnectDelay: 5, openPreview: false },
  displayProfile: defaultProfile,
  displayContent: { type: 'dashboard', source: '' },
  mediaSources: { video: '', youtube: '' },
  todos: []
};

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }

function migrateLegacySettings() {
  const destination = settingsFile();
  if (fs.existsSync(destination)) return;
  for (const folderName of ['jungle-command-center']) {
    const source = path.join(app.getPath('appData'), folderName, 'settings.json');
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return;
  }
}

function getSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    const legacyProfile = saved.displayProfile || {
      ...defaultProfile,
      rotation: Number(saved.rotation) === 0 ? 0 : defaultProfile.rotation
    };
    const displayContent = { ...defaults.displayContent, ...(saved.displayContent || saved.caseContent) };
    const mediaSources = { ...defaults.mediaSources, ...saved.mediaSources };
    if ((displayContent.type === 'video' || displayContent.type === 'youtube') && displayContent.source) mediaSources[displayContent.type] = displayContent.source;
    return {
      ...defaults,
      ...saved,
      language: saved.language === 'vi' ? 'vi' : 'en',
      displayProfile: sanitizeProfile(legacyProfile),
      startup: { ...defaults.startup, ...saved.startup },
      displayContent,
      mediaSources,
      todos: Array.isArray(saved.todos) ? saved.todos : []
    };
  } catch {
    return structuredClone(defaults);
  }
}

function saveSettings(value) {
  const safe = {
    ...defaults,
    ...value,
    language: value.language === 'vi' ? 'vi' : 'en',
    brightness: clamp(value.brightness, 0, 100, 100),
    maxFrameBytes: clamp(value.maxFrameBytes, 10000, 250000, 50000),
    displayProfile: sanitizeProfile(value.displayProfile),
    startup: {
      launchAtLogin: Boolean(value.startup?.launchAtLogin),
      autoConnect: Boolean(value.startup?.autoConnect),
      autoReconnect: value.startup?.autoReconnect !== false,
      reconnectDelay: clamp(value.startup?.reconnectDelay, 2, 60, 5),
      openPreview: Boolean(value.startup?.openPreview)
    },
    mediaSources: { ...defaults.mediaSources, ...value.mediaSources },
    todos: Array.isArray(value.todos) ? value.todos : []
  };
  delete safe.caseContent;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(safe, null, 2));
  return safe;
}

function broadcast(channel, value) {
  for (const win of [controlWindow, streamWindow, previewWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  }
}

function broadcastSettings() { broadcast('settings:updated', getSettings()); }

function cpuPercent() {
  const current = os.cpus().map((cpu) => cpu.times);
  if (!previousCpu) { previousCpu = current; return 0; }
  let idle = 0;
  let total = 0;
  current.forEach((times, index) => {
    const old = previousCpu[index] || times;
    const currentTotal = Object.values(times).reduce((sum, value) => sum + value, 0);
    const oldTotal = Object.values(old).reduce((sum, value) => sum + value, 0);
    idle += times.idle - old.idle;
    total += currentTotal - oldTotal;
  });
  previousCpu = current;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 - idle * 100 / total))) : 0;
}

function systemStats() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    host: os.hostname(), cpu: cpus[0]?.model || 'CPU', cores: cpus.length,
    cpuPercent: cachedCpuPercent,
    memoryPercent: Math.round(((total - free) / total) * 100),
    memoryUsedGb: ((total - free) / 1024 ** 3).toFixed(1),
    memoryTotalGb: (total / 1024 ** 3).toFixed(1),
    uptime: Math.floor(os.uptime())
  };
}

function resizeRenderers(profile) {
  if (streamWindow && !streamWindow.isDestroyed()) streamWindow.setContentSize(profile.width, profile.height);
  if (previewWindow && !previewWindow.isDestroyed()) {
    const size = fitPreview(profile);
    previewWindow.setContentSize(size.width, size.height);
  }
}

function quoteWindowsArgument(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

async function applyStartupSettings(settings) {
  if (process.platform !== 'win32') return;

  // Remove Electron's development login entry, which does not quote project paths containing spaces.
  app.setLoginItemSettings({ openAtLogin: false });
  await execFileAsync('reg.exe', ['DELETE', WINDOWS_RUN_KEY, '/v', STARTUP_VALUE_NAME, '/f']).catch(() => {});
  if (!settings.startup.launchAtLogin) return;

  const commandParts = app.isPackaged
    ? [process.execPath, '--autostart']
    : [process.execPath, app.getAppPath(), '--autostart'];
  const command = commandParts.map(quoteWindowsArgument).join(' ');
  await execFileAsync('reg.exe', [
    'ADD', WINDOWS_RUN_KEY, '/v', STARTUP_VALUE_NAME,
    '/t', 'REG_SZ', '/d', command, '/f'
  ]);
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  clearReconnectTimer();
  const settings = getSettings();
  if (quitting || manualDisconnect || !hadConnection || !settings.startup.autoReconnect) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (driver?.isConnected || quitting || manualDisconnect) return;
    const latest = getSettings();
    await driver.connect(latest.portPath, latest.brightness);
  }, settings.startup.reconnectDelay * 1000);
}

function handleDriverState(state) {
  broadcast('device:updated', state);
  if (state.status === 'streaming') {
    hadConnection = true;
    clearReconnectTimer();
  } else if (state.status === 'error' || state.status === 'disconnected') {
    scheduleReconnect();
  }
}

async function runStartupActions() {
  const settings = getSettings();
  await applyStartupSettings(settings);
  if (settings.startup.openPreview) openPreviewWindow();
  if (settings.startup.autoConnect) {
    manualDisconnect = false;
    hadConnection = settings.startup.autoReconnect;
    await driver.connect(settings.portPath, settings.brightness);
  }
}
function rendererPreferences() {
  return { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false };
}

function createStreamWindow() {
  const profile = getSettings().displayProfile;
  streamWindow = new BrowserWindow({
    width: profile.width, height: profile.height, useContentSize: true, show: false,
    backgroundColor: '#070b12', webPreferences: rendererPreferences()
  });
  streamWindow.setMenuBarVisibility(false);
  streamWindow.webContents.once('did-finish-load', runStartupActions);
  streamWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'));
  streamWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); streamWindow.hide(); }
  });
}

function openPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) { previewWindow.show(); previewWindow.focus(); return; }
  const size = fitPreview(getSettings().displayProfile);
  previewWindow = new BrowserWindow({
    width: size.width, height: size.height, useContentSize: true,
    minWidth: 320, minHeight: 240, backgroundColor: '#070b12',
    title: 'Jungle Display Preview', webPreferences: rendererPreferences()
  });
  previewWindow.setMenuBarVisibility(false);
  previewWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'), { query: { preview: '1' } });
  previewWindow.on('closed', () => { previewWindow = null; });
}

async function captureFrame() {
  if (!streamWindow || streamWindow.isDestroyed()) throw new Error('The display renderer is not ready.');
  const settings = getSettings();
  const { width, height } = settings.displayProfile;
  let image = await streamWindow.webContents.capturePage();
  image = image.resize({ width, height, quality: 'good' });
  let jpeg = image.toJPEG(82);
  for (let quality = 76; jpeg.length > settings.maxFrameBytes && quality >= 4; quality -= 8) jpeg = image.toJPEG(quality);
  return jpeg;
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1180, height: 790, minWidth: 920, minHeight: 650,
    backgroundColor: '#0b1018', webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  controlWindow.on('closed', () => { if (!quitting) app.quit(); });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', async (_, next) => {
    const previous = getSettings();
    const saved = saveSettings(next);
    resizeRenderers(saved.displayProfile);
    await applyStartupSettings(saved);
    if (!saved.startup.autoReconnect) clearReconnectTimer();
    broadcastSettings();
    if (driver?.isConnected && previous.brightness !== saved.brightness) await driver.setBrightness(saved.brightness);
    return saved;
  });
  ipcMain.handle('system:get', () => systemStats());
  ipcMain.handle('media:pick', async () => {
    const result = await dialog.showOpenDialog(controlWindow, {
      properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('device:scan', () => driver.scan());
  ipcMain.handle('device:state', () => driver.state);
  ipcMain.handle('device:connect', async (_, requestedPath) => {
    manualDisconnect = false;
    const settings = getSettings();
    return driver.connect(requestedPath || settings.portPath, settings.brightness);
  });
  ipcMain.handle('device:disconnect', async () => {
    manualDisconnect = true;
    hadConnection = false;
    clearReconnectTimer();
    return driver.disconnect();
  });
  ipcMain.handle('preview:open', () => { openPreviewWindow(); return true; });
}

app.whenReady().then(() => {
  migrateLegacySettings();
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://localhost/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  driver = new JungleDisplayDriver({ captureFrame, onState: handleDriverState });
  createStreamWindow();
  createControlWindow();
  registerIpc();
  cpuPercent();
  setInterval(() => { cachedCpuPercent = cpuPercent(); }, 1000);
});


app.on('second-instance', () => {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
});
app.on('before-quit', async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  clearReconnectTimer();
  try { await driver?.disconnect(); } catch { /* exiting */ }
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });