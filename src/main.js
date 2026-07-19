const { app, BrowserWindow, dialog, ipcMain, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { JungleDisplayDriver } = require('./jungle-display');
const { fitPreview } = require('./display-profile');
const { normalizeWorkspace, activeDisplay } = require('./workspace');
const { sampleTemperature } = require('./hardware-temperature');
const { AgentMonitor } = require('./agent-monitor');

const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
const smokeTestUserData = IS_SMOKE_TEST
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'jungle-display-smoke-'))
  : null;
if (smokeTestUserData) app.setPath('userData', smokeTestUserData);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const execFileAsync = promisify(execFile);
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_VALUE_NAME = 'JungleDisplayStudio';
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let controlWindow;
let streamWindow;
let streamWindowReady;
let previewWindow;
let tray;
let driver;
let agentMonitor;
let settingsCache;
let quitting = false;
let previousCpu = null;
let cachedCpuPercent = 0;
let cachedCpuTemperature = null;
let cachedGpu = { available: false, name: 'GPU unavailable', percent: null, memoryUsedMb: null, memoryTotalMb: null, temperature: null };
let samplingTemperatures = false;
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

function broadcastSettings(excludedWebContents = null) {
  const value = getSettings();
  for (const win of [controlWindow, streamWindow, previewWindow]) {
    if (win && !win.isDestroyed() && win.webContents.id !== excludedWebContents?.id) {
      win.webContents.send('settings:updated', value);
    }
  }
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

async function sampleTemperatures() {
  if (samplingTemperatures) return;
  samplingTemperatures = true;
  try {
    cachedCpuTemperature = await sampleTemperature('cpu', execFileAsync);
    if (!/nvidia/i.test(cachedGpu.name)) {
      cachedGpu = { ...cachedGpu, temperature: await sampleTemperature('gpu', execFileAsync) };
    }
  } finally {
    samplingTemperatures = false;
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
    cpuTemperature: cachedCpuTemperature,
    memoryPercent: Math.round(((total - free) / total) * 100),
    memoryUsedGb: ((total - free) / 1024 ** 3).toFixed(1),
    memoryTotalGb: (total / 1024 ** 3).toFixed(1),
    // Windows Fast Startup can preserve os.uptime() across shutdowns. The app
    // starts fresh for each user session, so this better matches visible uptime.
    uptime: Math.floor(process.uptime()),
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

function shouldStartHidden(settings = getSettings()) {
  return process.argv.includes('--hidden') || (process.argv.includes('--autostart') && settings.startup.startHidden);
}

async function applyStartupSettings(settings) {
  if (process.platform !== 'win32' || IS_SMOKE_TEST) return;
  app.setLoginItemSettings({ openAtLogin: false });
  await execFileAsync('reg.exe', ['DELETE', WINDOWS_RUN_KEY, '/v', STARTUP_VALUE_NAME, '/f']).catch(() => {});
  if (!settings.startup.launchAtLogin) return;

  const startupArgs = ['--autostart'];
  if (settings.startup.startHidden) startupArgs.push('--hidden');
  const commandParts = app.isPackaged
    ? [process.execPath, ...startupArgs]
    : [process.execPath, app.getAppPath(), ...startupArgs];
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
    if (!getSettings().startup.autoReconnect && !IS_SMOKE_TEST) releaseStreamWindow();
  }
}

async function runStartupActions() {
  const settings = getSettings();
  const display = activeDisplay(settings);
  await applyStartupSettings(settings);
  if (settings.startup.openPreview && !shouldStartHidden(settings)) openPreviewWindow();
  if (settings.startup.autoConnect) {
    manualDisconnect = false;
    hadConnection = settings.startup.autoReconnect;
    await ensureStreamWindow();
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
  if (streamWindow && !streamWindow.isDestroyed()) return streamWindowReady;
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
  streamWindowReady = new Promise((resolve, reject) => {
    streamWindow.webContents.once('did-finish-load', resolve);
    streamWindow.webContents.once('did-fail-load', (_, code, description) => {
      reject(new Error(`Display renderer failed to load (${code}): ${description}`));
    });
  });
  streamWindow.loadFile(path.join(__dirname, 'renderer', 'display.html'));
  streamWindow.on('closed', () => {
    streamWindow = null;
    streamWindowReady = null;
  });
  return streamWindowReady;
}

async function ensureStreamWindow() {
  await createStreamWindow();
  return streamWindow;
}

function releaseStreamWindow() {
  if (!streamWindow || streamWindow.isDestroyed()) return;
  streamWindow.destroy();
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

function showControlWindow() {
  if (!controlWindow || controlWindow.isDestroyed()) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const vietnamese = getSettings().language === 'vi';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: vietnamese ? '\u004d\u1edf Jungle Display Studio' : 'Open Jungle Display Studio', click: showControlWindow },
    { label: vietnamese ? 'Xem tr\u01b0\u1edbc' : 'Preview', click: openPreviewWindow },
    { type: 'separator' },
    { label: vietnamese ? 'Tho\u00e1t h\u1eb3n' : 'Quit', click: () => app.quit() }
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return;
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Jungle Display Studio');
  updateTrayMenu();
  tray.on('click', showControlWindow);
  tray.on('double-click', showControlWindow);
}

function encodeJpegWithinLimit(image, maxFrameBytes) {
  let jpeg = image.toJPEG(82);
  if (jpeg.length <= maxFrameBytes) return jpeg;
  let low = 4;
  let high = 76;
  let best = image.toJPEG(low);
  if (best.length > maxFrameBytes) return best;
  while (low <= high) {
    const quality = Math.floor((low + high) / 2);
    const candidate = image.toJPEG(quality);
    if (candidate.length <= maxFrameBytes) {
      best = candidate;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  return best;
}

async function captureFrame() {
  if (!streamWindow || streamWindow.isDestroyed()) throw new Error('The display renderer is not ready.');
  const display = activeDisplay(getSettings());
  const width = display.profile.width;
  const height = display.profile.height;
  let image = await streamWindow.webContents.capturePage();
  image = image.resize({ width, height, quality: 'good' });
  return encodeJpegWithinLimit(image, display.maxFrameBytes);
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: !shouldStartHidden(),
    backgroundColor: '#0b1018',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (IS_SMOKE_TEST) {
    controlWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      try {
        const control = await controlWindow.webContents.executeJavaScript(`(async () => {
          const press = (id, shiftKey = false) => {
            const node = document.querySelector('[data-element-id="' + CSS.escape(id) + '"]');
            node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey, clientX: 10, clientY: 10 }));
            document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          };
          document.querySelector('.nav[data-panel="canvas"]').click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          press('cpu');
          const hardwareOptionsVisible = !document.getElementById('prop-hardware-content').hidden;
          const cpuHeightWithBoth = parseFloat(document.querySelector('[data-element-id="cpu"]').style.height);
          const temperatureToggle = document.getElementById('prop-show-temperature');
          temperatureToggle.click();
          const cpuHeightWithoutTemperature = parseFloat(document.querySelector('[data-element-id="cpu"]').style.height);
          const temperatureToggleShrinks = cpuHeightWithoutTemperature < cpuHeightWithBoth;
          temperatureToggle.click();
          const temperatureToggleRestores = parseFloat(document.querySelector('[data-element-id="cpu"]').style.height) === cpuHeightWithBoth;
          const inspectorFiltered = document.getElementById('prop-items-row').hidden
            && document.getElementById('prop-text-row').hidden
            && getComputedStyle(document.getElementById('prop-items-row')).display === 'none';
          const outlineControlVisible = !document.getElementById('prop-stroke-row').hidden;
          const outlineColorInput = document.getElementById('prop-stroke-color');
          outlineColorInput.value = '#ff0066';
          outlineColorInput.dispatchEvent(new Event('input', { bubbles: true }));
          const outlineWidthInput = document.getElementById('prop-stroke-width');
          outlineWidthInput.value = 3;
          outlineWidthInput.dispatchEvent(new Event('input', { bubbles: true }));
          const cpuOutlineStyle = document.querySelector('[data-element-id="cpu"]').style;
          const textOutlineApplied = cpuOutlineStyle.webkitTextStrokeWidth === '3px'
            && cpuOutlineStyle.webkitTextStrokeColor !== '';
          const labelStyleControlVisible = !document.getElementById('prop-label-style').hidden;
          const labelColorInput = document.getElementById('prop-label-color');
          labelColorInput.value = '#00ffaa';
          labelColorInput.dispatchEvent(new Event('input', { bubbles: true }));
          const labelFontInput = document.getElementById('prop-label-font-size');
          labelFontInput.value = 21;
          labelFontInput.dispatchEvent(new Event('input', { bubbles: true }));
          const labelStrokeColorInput = document.getElementById('prop-label-stroke-color');
          labelStrokeColorInput.value = '#0033ff';
          labelStrokeColorInput.dispatchEvent(new Event('input', { bubbles: true }));
          const labelStrokeWidthInput = document.getElementById('prop-label-stroke-width');
          labelStrokeWidthInput.value = 2;
          labelStrokeWidthInput.dispatchEvent(new Event('input', { bubbles: true }));
          const cpuLabelStyle = document.querySelector('[data-element-id="cpu"] .element-label').style;
          const independentLabelStyle = cpuLabelStyle.fontSize === '21px'
            && cpuLabelStyle.webkitTextStrokeWidth === '2px'
            && cpuOutlineStyle.webkitTextStrokeWidth === '3px'
            && cpuLabelStyle.color !== cpuOutlineStyle.color;
          document.getElementById('copy-content-style').click();
          const stylePasteEnabled = !document.getElementById('paste-content-style').disabled && !document.getElementById('paste-label-style').disabled;
          press('ram');
          document.getElementById('paste-label-style').click();
          const ramLabelStyle = document.querySelector('[data-element-id="ram"] .element-label').style;
          const crossStylePaste = ramLabelStyle.color === cpuOutlineStyle.color
            && ramLabelStyle.fontSize === cpuOutlineStyle.fontSize
            && ramLabelStyle.webkitTextStrokeColor === cpuOutlineStyle.webkitTextStrokeColor
            && ramLabelStyle.webkitTextStrokeWidth === cpuOutlineStyle.webkitTextStrokeWidth;
          press('cpu');
          if (!document.getElementById('prop-background-transparent').checked) document.getElementById('prop-background-transparent').click();
          const transparentBackground = document.querySelector('[data-element-id="cpu"]').style.backgroundColor === 'transparent';
          press('ram', true);
          press('gpu', true);
          document.querySelector('[data-arrange="space-x"]').click();
          const arranged = ['cpu', 'ram', 'gpu'].map((id) => {
            const node = document.querySelector('[data-element-id="' + id + '"]');
            return { x: parseFloat(node.style.left), width: parseFloat(node.style.width) };
          }).sort((a, b) => a.x - b.x);
          const multiSelected = document.querySelectorAll('.canvas-element.selected').length;
          const firstGap = arranged[1].x - arranged[0].x - arranged[0].width;
          const secondGap = arranged[2].x - arranged[1].x - arranged[1].width;
          document.querySelector('[data-add="youtube"]').click();
          const youtubeSource = document.getElementById('prop-source');
          youtubeSource.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
          youtubeSource.dispatchEvent(new Event('change', { bubbles: true }));
          const youtubeFrame = document.querySelector('.canvas-element.youtube.selected iframe');
          const youtubeWatchdog = Boolean(youtubeFrame?.__jungleWatched)
            && Boolean(youtubeFrame?.__jungleRetryTimer || youtubeFrame?.dataset.youtubeLoaded === '1')
            && new URL(youtubeFrame.src).searchParams.get('enablejsapi') === '1';
          youtubeFrame.dispatchEvent(new Event('load'));
          const youtubeStopsRetryAfterLoad = youtubeFrame.dataset.youtubeLoaded === '1' && !youtubeFrame.__jungleRetryTimer;
          window.dispatchEvent(new MessageEvent('message', {
            origin: 'https://www.youtube-nocookie.com',
            source: youtubeFrame.contentWindow,
            data: JSON.stringify({ event: 'onReady' })
          }));
          const youtubeRemainsStableAfterReady = youtubeFrame.dataset.youtubeLoaded === '1' && !youtubeFrame.__jungleRetryTimer;
          document.querySelector('[data-add="video"]').click();
          const sourceInput = document.getElementById('prop-source');
          sourceInput.value = 'data:video/mp4;base64,AAAA';
          sourceInput.dispatchEvent(new Event('change', { bubbles: true }));
          const videoBox = document.querySelector('.canvas-element.video.selected');
          const videoId = videoBox.dataset.elementId;
          const videoNode = videoBox.querySelector('video');
          press('cpu');
          const sameAfterSelection = document.querySelector('[data-element-id="' + CSS.escape(videoId) + '"] video') === videoNode;
          const dragBox = document.querySelector('[data-element-id="' + CSS.escape(videoId) + '"]');
          dragBox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
          document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 24, clientY: 18 }));
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 750));
          document.getElementById('media-fill-canvas').click();
          const fullCanvasVideoBox = document.querySelector('[data-element-id="' + CSS.escape(videoId) + '"]');
          const fullCanvasCrop = fullCanvasVideoBox.querySelector('video') === videoNode
            && parseFloat(fullCanvasVideoBox.style.left) === 0
            && parseFloat(fullCanvasVideoBox.style.top) === 0
            && parseFloat(fullCanvasVideoBox.style.width) === 960
            && parseFloat(fullCanvasVideoBox.style.height) === 480
            && fullCanvasVideoBox.querySelector('video').style.objectFit === 'cover';
          const zoomInput = document.getElementById('prop-media-scale');
          zoomInput.value = 250;
          zoomInput.dispatchEvent(new Event('input', { bubbles: true }));
          const currentVideoNode = document.querySelector('[data-element-id="' + CSS.escape(videoId) + '"] video');
          const videoNodePreserved = sameAfterSelection && currentVideoNode === videoNode;
          const mediaZoomApplied = currentVideoNode.style.transform === 'scale(2.5)';
          const outlineInspectorFiltered = document.getElementById('prop-content-style').hidden && document.getElementById('prop-label-style').hidden;
          const taskBox = document.querySelector('.canvas-element.tasks');
          const taskText = taskBox.querySelector('li');
          const taskTextScale = Math.round(parseFloat(getComputedStyle(taskText).fontSize) / parseFloat(taskBox.style.fontSize) * 100) / 100;
          const uptimeBox = document.querySelector('.canvas-element.uptime');
          const elementLabelScale = Math.round(parseFloat(getComputedStyle(uptimeBox.querySelector('.element-label')).fontSize) / parseFloat(uptimeBox.style.fontSize) * 100) / 100;
          const gpuBox = document.querySelector('.canvas-element.gpu');
          const standardLabelScale = Math.round(parseFloat(getComputedStyle(gpuBox.querySelector('.element-label')).fontSize) / parseFloat(gpuBox.style.fontSize) * 100) / 100;
          const taskListRestored = getComputedStyle(taskBox.querySelector('ol')).flexGrow === '0' && getComputedStyle(taskText, '::before').content === 'none';
          const taskLabel = taskBox.querySelector('.element-label');
          const taskTextStyle = getComputedStyle(taskText);
          const taskLayoutSignature = [taskLabel.offsetLeft, taskLabel.offsetTop, taskText.offsetLeft, taskText.offsetTop, taskText.offsetWidth, taskText.offsetHeight, taskTextStyle.fontSize, taskTextStyle.lineHeight, taskTextStyle.padding].join('|');
          const hardwareNarrowValuesFit = ['cpu', 'ram', 'gpu'].every((type) => {
            const box = document.querySelector('.canvas-element.' + type);
            const original = box.style.width;
            box.style.width = '48px';
            const fits = [...box.querySelectorAll('.element-value')].every((value) => value.scrollWidth <= value.clientWidth + 1 && getComputedStyle(value).textOverflow === 'clip');
            box.style.width = original;
            return fits;
          });
          agentSnapshot = {
            providers: { codex: { available: true, connected: true }, claude: { available: true, connected: true } },
            tasks: [...Array.from({ length: 8 }, (_, index) => ({ provider: 'codex', status: index ? 'completed' : 'running', title: 'Codex recent task ' + (index + 1) + ' with a deliberately long title that must fit without moving pages' })), ...Array.from({ length: 8 }, (_, index) => ({ provider: 'claude', status: index ? 'completed' : 'running', title: 'Claude recent task ' + (index + 1) + ' with a deliberately long title that must fit without moving pages' }))]
          };
          document.querySelector('[data-add="codex"]').click();
          document.querySelector('[data-add="claude"]').click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const agentBoxes = [...document.querySelectorAll('.canvas-element.codex, .canvas-element.claude')];
          const agentWidgetsSeparated = agentBoxes.length === 2 && agentBoxes.every((box) => box.querySelector('.agent-quota'));
          const codexResizeBox = agentBoxes.find((box) => box.classList.contains('codex'));
          const codexResizeElement = activeDisplay().canvas.elements.find((element) => element.id === codexResizeBox.dataset.elementId);
          const codexResizeBefore = { width: codexResizeElement.width, height: codexResizeElement.height, fontSize: codexResizeElement.fontSize, labelFontSize: codexResizeElement.labelFontSize, radius: codexResizeElement.radius, textStrokeWidth: codexResizeElement.textStrokeWidth, labelStrokeWidth: codexResizeElement.labelStrokeWidth };
          codexResizeBox.querySelector('.resize-handle').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }));
          document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, clientY: 200 }));
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          const agentHorizontalResizeOnly = codexResizeElement.width > codexResizeBefore.width
            && codexResizeElement.height === codexResizeBefore.height
            && codexResizeElement.fontSize === codexResizeBefore.fontSize
            && codexResizeElement.labelFontSize === codexResizeBefore.labelFontSize
            && codexResizeElement.radius === codexResizeBefore.radius
            && codexResizeElement.textStrokeWidth === codexResizeBefore.textStrokeWidth
            && codexResizeElement.labelStrokeWidth === codexResizeBefore.labelStrokeWidth;
          const agentQuotaPinned = agentBoxes.every((box) => {
            const quota = box.querySelector('.agent-quota');
            return quota?.nextElementSibling?.matches('ol') && getComputedStyle(quota).flexShrink === '0';
          });
          const codexListText = document.querySelector('.canvas-element.codex .list-text');
          codexListText?.classList.add('is-overflowing');
          const codexMarqueeDisabled = Boolean(codexListText) && getComputedStyle(codexListText).animationName === 'none';
          const agentTasksStatic = agentBoxes.every((box) => box.querySelectorAll('.agent-row').length === 8 && (!box.dataset.nextListAt || box.dataset.nextListAt === '0'));
          const agentVisibleBefore = agentBoxes.map((box) => box.querySelectorAll('.agent-row:not([hidden])').length);
          const agentFontBefore = agentBoxes.map((box) => getComputedStyle(box.querySelector('.agent-row .list-text')).fontSize);
          const agentHeights = agentBoxes.map((box) => box.style.height);
          agentBoxes.forEach((box) => { box.style.height = '120px'; scheduleAgentTaskLayout(box); });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const agentVisibleAfter = agentBoxes.map((box) => box.querySelectorAll('.agent-row:not([hidden])').length);
          const agentFontAfter = agentBoxes.map((box) => getComputedStyle(box.querySelector('.agent-row .list-text')).fontSize);
          const agentTasksResponsive = agentBoxes.every((_, index) => agentVisibleAfter[index] < agentVisibleBefore[index] && agentFontAfter[index] === agentFontBefore[index]);
          agentBoxes.forEach((box, index) => { box.style.height = agentHeights[index]; scheduleAgentTaskLayout(box); });
          return {
            title: document.title,
            deviceCards: document.querySelectorAll('.device-card').length,
            paletteItems: document.querySelectorAll('[data-add]').length,
            canvasElements: document.querySelectorAll('.canvas-element').length,
            translationDecoded: window.JUNGLE_I18N.vi['nav.overview'].includes(String.fromCodePoint(7893)),
            hardwareOptionsVisible,
            temperatureToggleShrinks,
            temperatureToggleRestores,
            inspectorFiltered,
            outlineControlVisible,
            outlineInspectorFiltered,
            textOutlineApplied,
            labelStyleControlVisible,
            independentLabelStyle,
            stylePasteEnabled,
            crossStylePaste,
            transparentBackground,
            multiSelected,
            equalHorizontalGaps: Math.abs(firstGap - secondGap) <= 1,
            youtubeWatchdog,
            youtubeStopsRetryAfterLoad,
            youtubeRemainsStableAfterReady,
            videoNodePreserved,
            fullCanvasCrop,
            mediaZoomApplied,
            taskTextScale,
            elementLabelScale,
            standardLabelScale,
            taskListRestored,
            taskLayoutSignature,
            agentWidgetsSeparated,
            agentHorizontalResizeOnly,
            agentQuotaPinned,
            codexMarqueeDisabled,
            hardwareNarrowValuesFit,
            agentTasksStatic,
            agentTasksResponsive
          };
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await streamWindow.webContents.executeJavaScript("agentSnapshot = { providers: { codex: { available: true, connected: true }, claude: { available: true, connected: true } }, tasks: [...Array.from({ length: 8 }, (_, index) => ({ provider: 'codex', status: index ? 'completed' : 'running', title: 'Codex recent task ' + (index + 1) + ' with a deliberately long title that must fit without moving pages' })), ...Array.from({ length: 8 }, (_, index) => ({ provider: 'claude', status: index ? 'completed' : 'running', title: 'Claude recent task ' + (index + 1) + ' with a deliberately long title that must fit without moving pages' }))] }; renderLayout();");
        await new Promise((resolve) => setTimeout(resolve, 100));
        const streamVideoReady = await streamWindow.webContents.executeJavaScript("window.__smokeVideoNode = document.querySelector('.widget.video video'); Boolean(window.__smokeVideoNode)");
        await controlWindow.webContents.executeJavaScript("(() => { const input = document.getElementById('prop-opacity'); input.value = 99; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const display = await streamWindow.webContents.executeJavaScript("({ widgets: document.querySelectorAll('.widget').length, gpuWidgets: document.querySelectorAll('.widget.gpu').length, youtubeWatchdog: (() => { const frame = document.querySelector('.widget.youtube iframe'); return Boolean(frame?.__jungleWatched) && Boolean(frame?.__jungleRetryTimer || frame?.dataset.youtubeLoaded === '1') && new URL(frame.src).searchParams.get('enablejsapi') === '1'; })(), videoReady: " + streamVideoReady + ", videoNodePreserved: window.__smokeVideoNode === document.querySelector('.widget.video video'), fullCanvasCrop: parseFloat(document.querySelector('.widget.video').style.left) === 0 && parseFloat(document.querySelector('.widget.video').style.top) === 0 && parseFloat(document.querySelector('.widget.video').style.width) === 960 && parseFloat(document.querySelector('.widget.video').style.height) === 480 && document.querySelector('.widget.video video').style.objectFit === 'cover', mediaZoomApplied: document.querySelector('.widget.video video').style.transform === 'scale(2.5)', taskTextScale: Math.round(parseFloat(getComputedStyle(document.querySelector('.widget.tasks li')).fontSize) / parseFloat(document.querySelector('.widget.tasks').style.fontSize) * 100) / 100, elementLabelScale: Math.round(parseFloat(getComputedStyle(document.querySelector('.widget.uptime .widget-label')).fontSize) / parseFloat(document.querySelector('.widget.uptime').style.fontSize) * 100) / 100, standardLabelScale: Math.round(parseFloat(getComputedStyle(document.querySelector('.widget.gpu .widget-label')).fontSize) / parseFloat(document.querySelector('.widget.gpu').style.fontSize) * 100) / 100, crossStylePaste: document.querySelector('.widget.ram .widget-label').style.color === document.querySelector('.widget.cpu').style.color && document.querySelector('.widget.ram .widget-label').style.fontSize === document.querySelector('.widget.cpu').style.fontSize && document.querySelector('.widget.ram .widget-label').style.webkitTextStrokeColor === document.querySelector('.widget.cpu').style.webkitTextStrokeColor && document.querySelector('.widget.ram .widget-label').style.webkitTextStrokeWidth === document.querySelector('.widget.cpu').style.webkitTextStrokeWidth, independentLabelStyle: document.querySelector('.widget.cpu .widget-label').style.fontSize === '21px' && document.querySelector('.widget.cpu .widget-label').style.webkitTextStrokeWidth === '2px' && document.querySelector('.widget.cpu').style.webkitTextStrokeWidth === '3px' && document.querySelector('.widget.cpu .widget-label').style.color !== document.querySelector('.widget.cpu').style.color, taskListRestored: getComputedStyle(document.querySelector('.widget.tasks ol')).flexGrow === '0' && getComputedStyle(document.querySelector('.widget.tasks li'), '::before').content === 'none', taskLayoutSignature: (() => { const box = document.querySelector('.widget.tasks'); const label = box.querySelector('.widget-label'); const item = box.querySelector('li'); const style = getComputedStyle(item); return [label.offsetLeft, label.offsetTop, item.offsetLeft, item.offsetTop, item.offsetWidth, item.offsetHeight, style.fontSize, style.lineHeight, style.padding].join('|'); })(), textOutlineApplied: document.querySelector('.widget.cpu').style.webkitTextStrokeWidth === '3px' && document.querySelector('.widget.cpu').style.webkitTextStrokeColor !== '', agentWidgetsSeparated: document.querySelectorAll('.widget.codex').length === 1 && document.querySelectorAll('.widget.claude').length === 1, agentQuotaPinned: [...document.querySelectorAll('.widget.codex, .widget.claude')].every((box) => { const quota = box.querySelector('.agent-quota'); return quota?.nextElementSibling?.matches('ol') && getComputedStyle(quota).flexShrink === '0'; }) })");
        const displayHardwareNarrowValuesFit = await streamWindow.webContents.executeJavaScript("['cpu', 'ram', 'gpu'].every((type) => { const box = document.querySelector('.widget.' + type); const original = box.style.width; box.style.width = '48px'; const fits = [...box.querySelectorAll('.widget-value')].every((value) => value.scrollWidth <= value.clientWidth + 1 && getComputedStyle(value).textOverflow === 'clip'); box.style.width = original; return fits; })");
        const displayAgentTasksResponsive = await streamWindow.webContents.executeJavaScript("(async () => { const boxes = [...document.querySelectorAll('.widget.codex, .widget.claude')]; const before = boxes.map((box) => box.querySelectorAll('.agent-row:not([hidden])').length); const fonts = boxes.map((box) => getComputedStyle(box.querySelector('.agent-row .list-text')).fontSize); const heights = boxes.map((box) => box.style.height); boxes.forEach((box) => { box.style.height = '120px'; scheduleAgentTaskLayout(box); }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); const after = boxes.map((box) => box.querySelectorAll('.agent-row:not([hidden])').length); const result = boxes.every((box, index) => box.querySelectorAll('.agent-row').length === 8 && (!box.dataset.nextListAt || box.dataset.nextListAt === '0') && after[index] < before[index] && getComputedStyle(box.querySelector('.agent-row .list-text')).fontSize === fonts[index]); boxes.forEach((box, index) => { box.style.height = heights[index]; scheduleAgentTaskLayout(box); }); return result; })()");
        const taskLayoutParity = control.taskLayoutSignature === display.taskLayoutSignature;
        if (!taskLayoutParity) throw new Error('Editor/output task layout mismatch: ' + control.taskLayoutSignature + ' !== ' + display.taskLayoutSignature);
        if (!control.hardwareOptionsVisible || !control.temperatureToggleShrinks || !control.temperatureToggleRestores) {
          throw new Error('Hardware content visibility controls did not resize the CPU element correctly.');
        }
        if (!control.youtubeStopsRetryAfterLoad || !control.youtubeRemainsStableAfterReady) {
          throw new Error('YouTube watchdog reloaded a stable player.');
        }
        if (!control.agentWidgetsSeparated || !control.agentQuotaPinned || !display.agentWidgetsSeparated || !display.agentQuotaPinned) {
          throw new Error('Codex/Claude widgets are not separated or quota is not pinned.');
        }
        if (!control.agentHorizontalResizeOnly) throw new Error('Horizontal agent resize still scales typography or height.');
        if (!control.codexMarqueeDisabled) throw new Error('Codex task text marquee is still enabled.');
        if (!control.hardwareNarrowValuesFit || !displayHardwareNarrowValuesFit) throw new Error('CPU/RAM/GPU values still truncate in a narrow box.');
        if (!control.agentTasksStatic || !control.agentTasksResponsive || !displayAgentTasksResponsive) throw new Error('Agent task count does not respond to height while preserving font size.');
        controlWindow.close();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const backgroundAfterClose = !controlWindow.isDestroyed() && !controlWindow.isVisible() && Boolean(tray && !tray.isDestroyed());
        showControlWindow();
        if (!backgroundAfterClose) throw new Error('Closing the control window did not keep the tray process alive.');
        console.log('SMOKE_TEST ' + JSON.stringify({ control, display, taskLayoutParity, backgroundAfterClose }));
      } catch (error) {
        console.error('SMOKE_TEST_FAILED', error);
        process.exitCode = 1;
      } finally {
        app.quit();
      }
    }, 1600));
  }
  controlWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      controlWindow.hide();
    }
  });
  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', async (event, next) => {
    const previous = getSettings();
    const previousDisplay = activeDisplay(previous);
    const saved = saveSettings(next);
    updateTrayMenu();
    const nextDisplay = activeDisplay(saved);
    const displayChanged = previous.activeDisplayId !== saved.activeDisplayId;

    if (displayChanged && driver?.isConnected) {
      manualDisconnect = true;
      hadConnection = false;
      clearReconnectTimer();
      await driver.disconnect();
      releaseStreamWindow();
    }

    resizeRenderers(nextDisplay.profile);
    await applyStartupSettings(saved);
    if (!saved.startup.autoReconnect) clearReconnectTimer();
    broadcastSettings(event.sender);

    if (!displayChanged && driver?.isConnected && previousDisplay.brightness !== nextDisplay.brightness) {
      await driver.setBrightness(nextDisplay.brightness);
    }
    return saved;
  });

  ipcMain.handle('system:get', () => systemStats());
  ipcMain.handle('agents:get', () => agentMonitor?.snapshot);
  ipcMain.handle('agents:refresh', () => agentMonitor?.refresh());
  ipcMain.handle('agents:configure-claude', () => agentMonitor?.configureClaudeBridge());
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
    await ensureStreamWindow();
    return driver.connect(target.path || display.portPath, display.brightness);
  });
  ipcMain.handle('device:disconnect', async () => {
    manualDisconnect = true;
    hadConnection = false;
    clearReconnectTimer();
    const state = await driver.disconnect();
    releaseStreamWindow();
    return state;
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
  agentMonitor = new AgentMonitor({
    userDataPath: app.getPath('userData'),
    disabled: IS_SMOKE_TEST,
    onUpdate: (snapshot) => broadcast('agents:updated', snapshot)
  });
  registerIpc();
  createControlWindow();
  createTray();
  cpuPercent();
  setInterval(() => {
    cachedCpuPercent = cpuPercent();
  }, 1000);
  initializeGpu();
  sampleTemperatures();
  setInterval(sampleTemperatures, 5000);
  agentMonitor.start().catch(() => {});
  if (IS_SMOKE_TEST) await ensureStreamWindow();
  await runStartupActions();
});

app.on('second-instance', () => {
  showControlWindow();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  clearReconnectTimer();
  agentMonitor?.stop();
  try {
    await driver?.disconnect();
  } catch {
    // Exit even if the serial port has already disappeared.
  }
  app.quit();
});

app.on('window-all-closed', () => {
  // Keep the background renderer, serial connection and tray alive.
});

app.on('quit', () => {
  if (!smokeTestUserData) return;
  try {
    fs.rmSync(smokeTestUserData, { recursive: true, force: true });
  } catch {
    // A failed cleanup only leaves an isolated temporary test profile behind.
  }
});
