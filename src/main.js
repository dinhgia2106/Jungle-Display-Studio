const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { JungleDisplayDriver } = require('./jungle-display');
const { fitPreview } = require('./display-profile');
const { normalizeWorkspace, activeDisplay } = require('./workspace');

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
let settingsCache;
let quitting = false;
let previousCpu = null;
let cachedCpuPercent = 0;
let cachedGpu = { available: false, name: 'GPU unavailable', percent: null, memoryUsedMb: null, memoryTotalMb: null, temperature: null };
let reconnectTimer = null;
let manualDisconnect = false;
let hadConnection = false;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

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
  if (settingsCache) return settingsCache;
  try {
    settingsCache = normalizeWorkspace(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    settingsCache = normalizeWorkspace({});
  }
  return settingsCache;
}

function saveSettings(value) {
  settingsCache = normalizeWorkspace(value);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2));
  return settingsCache;
}

function broadcast(channel, value) {
  for (const win of [controlWindow, streamWindow, previewWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  }
}

function broadcastSettings() {
  broadcast('settings:updated', getSettings());
}

function cpuPercent() {
  const current = os.cpus().map((cpu) => cpu.times);
  if (!previousCpu) {
    previousCpu = current;
    return 0;
  }
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

async function initializeGpu() {
  try {
    const info = await app.getGPUInfo('basic');
    const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
    const selected = devices.find((item) => item.active) || devices[0];
    if (!selected) return;
    const names = devices.map((item) => item.deviceString || item.driverVendor || '').filter(Boolean);
    cachedGpu = {
      ...cachedGpu,
      available: true,
      name: names.join(' / ') || selected.deviceString || selected.driverVendor || 'Graphics adapter'
    };
    await sampleGpu();
    setInterval(sampleGpu, 3000);
  } catch {
    cachedGpu = { ...cachedGpu, available: false };
  }
}

async function sampleGpu() {
  if (!cachedGpu.available || process.platform !== 'win32') return;
  const looksNvidia = /nvidia/i.test(cachedGpu.name);
  if (looksNvidia) {
    try {
      const result = await execFileAsync('nvidia-smi.exe', [
        '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits'
      ], { timeout: 2500, windowsHide: true });
      const values = String(result.stdout || '').split(String.fromCharCode(10))[0].split(',').map((value) => value.trim());
      cachedGpu = {
        available: true,
        name: values[0] || cachedGpu.name,
        percent: Math.max(0, Math.min(100, Math.round(Number(values[1]) || 0))),
        memoryUsedMb: Number(values[2]) || null,
        memoryTotalMb: Number(values[3]) || null,
        temperature: Number(values[4]) || null
      };
      return;
    } catch {
      // Continue with the Windows performance counter fallback.
    }
  }
  try {
    const command = "$values=(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples.CookedValue; [Math]::Round(($values | Measure-Object -Sum).Sum,0)";
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: 2500,
      windowsHide: true
    });
    const percent = Number(String(result.stdout || '').trim());
    cachedGpu = { ...cachedGpu, percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null };
  } catch {
    cachedGpu = { ...cachedGpu, percent: null };
  }
}

function systemStats() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    host: os.hostname(),
    cpu: cpus[0]?.model || 'CPU',
    cores: cpus.length,
    cpuPercent: cachedCpuPercent,
    memoryPercent: Math.round(((total - free) / total) * 100),
    memoryUsedGb: ((total - free) / 1024 ** 3).toFixed(1),
    memoryTotalGb: (total / 1024 ** 3).toFixed(1),
    uptime: Math.floor(os.uptime()),
    gpu: { ...cachedGpu }
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
  return '"' + String(value).replaceAll('"', '\"') + '"';
}

async function applyStartupSettings(settings) {
  if (process.platform !== 'win32') return;
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
    const display = activeDisplay(latest);
    await driver.connect(display.portPath, display.brightness);
  }, settings.startup.reconnectDelay * 1000);
}

function handleDriverState(state) {
  const displayId = getSettings().activeDisplayId;
  broadcast('device:updated', { ...state, displayId });
  if (state.status === 'streaming') {
    hadConnection = true;
    clearReconnectTimer();
  } else if (state.status === 'error' || state.status === 'disconnected') {
    scheduleReconnect();
  }
}

async function runStartupActions() {
  const settings = getSettings();
  const display = activeDisplay(settings);
  await applyStartupSettings(settings);
  if (settings.startup.openPreview) openPreviewWindow();
  if (settings.startup.autoConnect) {
    manualDisconnect = false;
    hadConnection = settings.startup.autoReconnect;
    await driver.connect(display.portPath, display.brightness);
  }
}

function rendererPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false
  };
}

function createStreamWindow() {
  const profile = activeDisplay(getSettings()).profile;
  streamWindow = new BrowserWindow({
    width: profile.width,
    height: profile.height,
    useContentSize: true,
    show: false,
    backgroundColor: '#071019',
    webPreferences: rendererPreferences()
  });
  streamWindow.setMenuBarVisibility(false);
  streamWindow.webContents.once('did-finish-load', runStartupActions);
  streamWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'));
  streamWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      streamWindow.hide();
    }
  });
}

function openPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.show();
    previewWindow.focus();
    return;
  }
  const size = fitPreview(activeDisplay(getSettings()).profile);
  previewWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    useContentSize: true,
    minWidth: 320,
    minHeight: 240,
    backgroundColor: '#071019',
    title: 'Jungle Display Preview',
    webPreferences: rendererPreferences()
  });
  previewWindow.setMenuBarVisibility(false);
  previewWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'), { query: { preview: '1' } });
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}

async function captureFrame() {
  if (!streamWindow || streamWindow.isDestroyed()) throw new Error('The display renderer is not ready.');
  const display = activeDisplay(getSettings());
  const width = display.profile.width;
  const height = display.profile.height;
  let image = await streamWindow.webContents.capturePage();
  image = image.resize({ width, height, quality: 'good' });
  let jpeg = image.toJPEG(82);
  for (let quality = 76; jpeg.length > display.maxFrameBytes && quality >= 4; quality -= 8) {
    jpeg = image.toJPEG(quality);
  }
  return jpeg;
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1018',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--smoke-test')) {
    controlWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        const control = await controlWindow.webContents.executeJavaScript("({ title: document.title, deviceCards: document.querySelectorAll('.device-card').length, paletteItems: document.querySelectorAll('[data-add]').length, canvasElements: document.querySelectorAll('.canvas-element').length, translationDecoded: window.JUNGLE_I18N.vi['nav.overview'].includes(String.fromCodePoint(7893)) })");
        const display = await streamWindow.webContents.executeJavaScript("({ widgets: document.querySelectorAll('.widget').length, gpuWidgets: document.querySelectorAll('.widget.gpu').length })");
        console.log('SMOKE_TEST ' + JSON.stringify({ control, display }));
      } catch (error) {
        console.error('SMOKE_TEST_FAILED', error);
        process.exitCode = 1;
      } finally {
        app.quit();
      }
    }, 1600));
  }
  controlWindow.on('closed', () => {
    if (!quitting) app.quit();
  });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', async (_, next) => {
    const previous = getSettings();
    const previousDisplay = activeDisplay(previous);
    const saved = saveSettings(next);
    const nextDisplay = activeDisplay(saved);
    const displayChanged = previous.activeDisplayId !== saved.activeDisplayId;

    if (displayChanged && driver?.isConnected) {
      manualDisconnect = true;
      hadConnection = false;
      clearReconnectTimer();
      await driver.disconnect();
    }

    resizeRenderers(nextDisplay.profile);
    await applyStartupSettings(saved);
    if (!saved.startup.autoReconnect) clearReconnectTimer();
    broadcastSettings();

    if (!displayChanged && driver?.isConnected && previousDisplay.brightness !== nextDisplay.brightness) {
      await driver.setBrightness(nextDisplay.brightness);
    }
    return saved;
  });

  ipcMain.handle('system:get', () => systemStats());
  ipcMain.handle('media:pick', async (_, kind) => {
    const filters = kind === 'image'
      ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
      : [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'] }];
    const result = await dialog.showOpenDialog(controlWindow, { properties: ['openFile'], filters });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('device:scan', () => driver.scan());
  ipcMain.handle('device:state', () => ({ ...driver.state, displayId: getSettings().activeDisplayId }));
  ipcMain.handle('device:connect', async (_, target = {}) => {
    if (target.displayId && target.displayId !== getSettings().activeDisplayId) {
      const next = { ...getSettings(), activeDisplayId: target.displayId };
      saveSettings(next);
      resizeRenderers(activeDisplay(next).profile);
      broadcastSettings();
    }
    manualDisconnect = false;
    const display = activeDisplay(getSettings());
    return driver.connect(target.path || display.portPath, display.brightness);
  });
  ipcMain.handle('device:disconnect', async () => {
    manualDisconnect = true;
    hadConnection = false;
    clearReconnectTimer();
    return driver.disconnect();
  });
  ipcMain.handle('preview:open', () => {
    openPreviewWindow();
    return true;
  });
}

app.whenReady().then(async () => {
  migrateLegacySettings();
  getSettings();
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://localhost/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  driver = new JungleDisplayDriver({ captureFrame, onState: handleDriverState });
  registerIpc();
  createStreamWindow();
  createControlWindow();
  cpuPercent();
  setInterval(() => {
    cachedCpuPercent = cpuPercent();
  }, 1000);
  initializeGpu();
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
  try {
    await driver?.disconnect();
  } catch {
    // Exit even if the serial port has already disappeared.
  }
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});