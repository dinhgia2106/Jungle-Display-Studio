let settings;
let deviceState;
let currentContentType = 'dashboard';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

const PRESETS = {
  '960x480': { width: 960, height: 480, name: 'Jungle 5.5-inch Display' },
  '800x480': { width: 800, height: 480, name: 'Jungle Landscape Display' },
  '480x480': { width: 480, height: 480, name: 'Jungle Square Display' },
  '480x800': { width: 480, height: 800, name: 'Jungle Portrait Display' },
  '1920x480': { width: 1920, height: 480, name: 'Jungle Ultra-wide Display' }
};

const I18N = {
  en: {
    'nav.overview': 'Overview', 'nav.content': 'Content', 'nav.tasks': 'Tasks', 'nav.display': 'Display', 'nav.settings': 'Settings',
    'app.subtitle': 'JUNGLE USB DISPLAY', 'hero.line1': 'Your display,', 'hero.line2': 'your layout.',
    'status.disconnected': 'Not connected', 'status.connecting': 'Connecting', 'status.streaming': 'Streaming · {port}', 'status.error': 'Action required',
    'action.connect': 'Connect display', 'action.connecting': 'Connecting…', 'action.disconnect': 'Disconnect', 'action.preview': 'Preview',
    'action.chooseFile': 'Choose file', 'action.saveContent': 'Save content', 'action.addTask': 'Add task', 'action.scan': 'Scan', 'action.saveDisplay': 'Save display', 'action.saveSettings': 'Save settings',
    'stats.stream': 'STREAM', 'stats.noFrame': 'No frame yet', 'stats.frame': '{size} KB / frame', 'stats.threads': '{count} threads',
    'content.eyebrow': 'MEDIA & DASHBOARD', 'content.title': 'Display content', 'content.mode': 'Mode', 'content.source': 'Media source',
    'mode.dashboard': 'System dashboard', 'mode.tasks': 'Task list', 'mode.video': 'Local video', 'mode.youtube': 'YouTube video',
    'help.dashboard': 'Clock, CPU, RAM, uptime and active tasks.', 'help.tasks': 'A large, focused list of unfinished tasks.',
    'help.video': 'Loop a local video. MP4 and WebM work best.', 'help.youtube': 'Play a muted, looping YouTube video.',
    'source.youtube': 'Paste a YouTube URL', 'source.video': 'Choose a local video file',
    'tasks.title': 'Tasks', 'tasks.placeholder': 'Add a task…', 'tasks.remaining': '{count} remaining', 'tasks.empty': 'No tasks yet',
    'display.eyebrow': 'DEVICE & CANVAS', 'display.title': 'Display configuration', 'display.port': 'USB device', 'display.auto': 'Auto detect',
    'display.preset': 'Resolution preset', 'display.custom': 'Custom', 'display.name': 'Display name', 'display.width': 'Width', 'display.height': 'Height',
    'display.rotation': 'Rotation', 'display.frameLimit': 'JPEG limit (KB)', 'display.brightness': 'Brightness',
    'display.help': 'Choose a preset or enter the exact native resolution printed by your display. Custom sizes are supported.',
    'settings.eyebrow': 'STARTUP & CONNECTION', 'settings.title': 'Application settings',
    'settings.launchAtLogin': 'Launch at Windows startup', 'settings.launchAtLoginHelp': 'Start Jungle Display Studio after you sign in.',
    'settings.autoConnect': 'Auto-connect display', 'settings.autoConnectHelp': 'Connect to the last selected USB display when the app starts.',
    'settings.autoReconnect': 'Auto-reconnect', 'settings.autoReconnectHelp': 'Reconnect automatically if an active display connection is lost.',
    'settings.reconnectDelay': 'Reconnect delay (seconds)', 'settings.openPreview': 'Open preview on launch',
    'settings.openPreviewHelp': 'Open a scaled preview window when the app starts.',
    'device.disconnected': 'Connect a compatible Jungle USB display when you are ready.', 'device.connecting': 'Opening the Jungle display…',
    'device.streaming': 'Content is being sent to the display.', 'device.notFound': 'No compatible Jungle USB Serial display was found.',
    'device.busy': 'The COM port is in use. Close the vendor display app and try again.', 'device.error': 'Display communication error.',
    'toast.found': 'Found {port}', 'toast.notFound': 'No compatible display found', 'toast.scanError': 'Scan failed: {error}',
    'toast.sourceRequired': 'Choose a file or enter a video URL.', 'toast.contentSaved': 'Display content saved', 'toast.displaySaved': 'Display configuration saved', 'toast.settingsSaved': 'Application settings saved'
  },
  vi: {
    'nav.overview': 'Tổng quan', 'nav.content': 'Nội dung', 'nav.tasks': 'Công việc', 'nav.display': 'Màn hình', 'nav.settings': 'Cài đặt',
    'app.subtitle': 'MÀN HÌNH USB JUNGLE', 'hero.line1': 'Màn hình của bạn,', 'hero.line2': 'bố cục của bạn.',
    'status.disconnected': 'Chưa kết nối', 'status.connecting': 'Đang kết nối', 'status.streaming': 'Đang phát · {port}', 'status.error': 'Cần xử lý',
    'action.connect': 'Kết nối màn hình', 'action.connecting': 'Đang kết nối…', 'action.disconnect': 'Ngắt kết nối', 'action.preview': 'Xem trước',
    'action.chooseFile': 'Chọn file', 'action.saveContent': 'Lưu nội dung', 'action.addTask': 'Thêm việc', 'action.scan': 'Quét', 'action.saveDisplay': 'Lưu màn hình', 'action.saveSettings': 'Lưu cài đặt',
    'stats.stream': 'LUỒNG TRUYỀN', 'stats.noFrame': 'Chưa có frame', 'stats.frame': '{size} KB / frame', 'stats.threads': '{count} luồng',
    'content.eyebrow': 'MEDIA & DASHBOARD', 'content.title': 'Nội dung hiển thị', 'content.mode': 'Chế độ', 'content.source': 'Nguồn media',
    'mode.dashboard': 'Dashboard hệ thống', 'mode.tasks': 'Danh sách công việc', 'mode.video': 'Video cục bộ', 'mode.youtube': 'Video YouTube',
    'help.dashboard': 'Đồng hồ, CPU, RAM, uptime và các công việc đang làm.', 'help.tasks': 'Danh sách công việc chưa hoàn thành với chữ lớn.',
    'help.video': 'Phát lặp video cục bộ. MP4 và WebM hoạt động tốt nhất.', 'help.youtube': 'Phát video YouTube tắt tiếng và lặp lại.',
    'source.youtube': 'Dán link YouTube', 'source.video': 'Chọn file video cục bộ',
    'tasks.title': 'Công việc', 'tasks.placeholder': 'Thêm một việc…', 'tasks.remaining': 'Còn {count} việc', 'tasks.empty': 'Chưa có công việc',
    'display.eyebrow': 'THIẾT BỊ & KHUNG HÌNH', 'display.title': 'Cấu hình màn hình', 'display.port': 'Thiết bị USB', 'display.auto': 'Tự động phát hiện',
    'display.preset': 'Preset độ phân giải', 'display.custom': 'Tùy chỉnh', 'display.name': 'Tên màn hình', 'display.width': 'Chiều rộng', 'display.height': 'Chiều cao',
    'display.rotation': 'Xoay', 'display.frameLimit': 'Giới hạn JPEG (KB)', 'display.brightness': 'Độ sáng',
    'display.help': 'Chọn preset hoặc nhập đúng độ phân giải gốc của màn hình. Có thể dùng kích thước tùy chỉnh.',
    'settings.eyebrow': 'KHỞI ĐỘNG & KẾT NỐI', 'settings.title': 'Cài đặt ứng dụng',
    'settings.launchAtLogin': 'Chạy cùng Windows', 'settings.launchAtLoginHelp': 'Mở Jungle Display Studio sau khi bạn đăng nhập.',
    'settings.autoConnect': 'Tự động kết nối màn hình', 'settings.autoConnectHelp': 'Kết nối thiết bị USB đã chọn khi ứng dụng khởi động.',
    'settings.autoReconnect': 'Tự động kết nối lại', 'settings.autoReconnectHelp': 'Tự kết nối lại khi màn hình đang hoạt động bị mất kết nối.',
    'settings.reconnectDelay': 'Thời gian chờ kết nối lại (giây)', 'settings.openPreview': 'Mở xem trước khi khởi động',
    'settings.openPreviewHelp': 'Mở cửa sổ xem trước đã thu nhỏ khi ứng dụng khởi động.',
    'device.disconnected': 'Kết nối màn hình USB Jungle tương thích khi bạn sẵn sàng.', 'device.connecting': 'Đang mở màn hình Jungle…',
    'device.streaming': 'Nội dung đang được gửi tới màn hình.', 'device.notFound': 'Không tìm thấy màn hình USB Serial Jungle tương thích.',
    'device.busy': 'Cổng COM đang được sử dụng. Hãy thoát phần mềm màn hình hãng rồi thử lại.', 'device.error': 'Lỗi giao tiếp với màn hình.',
    'toast.found': 'Đã tìm thấy {port}', 'toast.notFound': 'Không tìm thấy màn hình tương thích', 'toast.scanError': 'Quét thất bại: {error}',
    'toast.sourceRequired': 'Hãy chọn file hoặc nhập link video.', 'toast.contentSaved': 'Đã lưu nội dung', 'toast.displaySaved': 'Đã lưu cấu hình màn hình', 'toast.settingsSaved': 'Đã lưu cài đặt ứng dụng'
  }
};

function t(key, values = {}) {
  const language = settings?.language === 'vi' ? 'vi' : 'en';
  let text = I18N[language][key] || I18N.en[key] || key;
  Object.entries(values).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, value); });
  return text;
}

function applyLanguage() {
  document.documentElement.lang = settings.language;
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  contentHelp();
  renderTodos();
  if (deviceState) renderDeviceState(deviceState);
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2400);
}

function updateClock() {
  $('#clock').textContent = new Intl.DateTimeFormat(settings?.language === 'vi' ? 'vi-VN' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}

function showPanel(id) {
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === id));
  $$('.nav').forEach((button) => button.classList.toggle('active', button.dataset.panel === id));
}

async function renderSystem() {
  const stats = await window.jungle.getSystem();
  $('#cpu-stat').textContent = `${stats.cpuPercent}%`;
  $('#cpu-name').textContent = `${t('stats.threads', { count: stats.cores })} · ${stats.cpu}`;
  $('#ram-stat').textContent = `${stats.memoryPercent}%`;
  $('#ram-detail').textContent = `${stats.memoryUsedGb} / ${stats.memoryTotalGb} GB`;
}

function renderDeviceState(state) {
  deviceState = state;
  const active = state.status === 'streaming';
  const pending = state.status === 'connecting';
  const pill = $('#status-pill');
  pill.className = `status-pill ${state.status}`;
  $('span', pill).textContent = active ? t('status.streaming', { port: state.portPath || '' }) : pending ? t('status.connecting') : state.status === 'error' ? t('status.error') : t('status.disconnected');
  $('#status-message').textContent = `${t(state.messageKey || 'device.error')}${state.message ? ` ${state.message}` : ''}`;
  $('#connect-main').disabled = active || pending;
  $('#connect-main').textContent = pending ? t('action.connecting') : t('action.connect');
  $('#disconnect-main').disabled = !active;
  $('#hero-profile').textContent = `${settings.displayProfile.width} × ${settings.displayProfile.height}`;
  $('#stream-stat').textContent = `${state.fps || 0} FPS`;
  $('#frame-detail').textContent = state.frameBytes ? t('stats.frame', { size: (state.frameBytes / 1024).toFixed(1) }) : t('stats.noFrame');
}

async function scanDevices(showMessage = false) {
  const select = $('#port-select');
  const current = settings.portPath || 'auto';
  select.innerHTML = `<option value="auto">${t('display.auto')}</option>`;
  try {
    const devices = await window.jungle.scanDevices();
    devices.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.path;
      option.textContent = `${device.label} · ${device.vendorId}:${device.productId}`;
      select.append(option);
    });
    select.value = [...select.options].some((option) => option.value === current) ? current : 'auto';
    if (showMessage) toast(devices.length ? t('toast.found', { port: devices[0].path }) : t('toast.notFound'));
  } catch (error) {
    if (showMessage) toast(t('toast.scanError', { error: error.message }));
  }
}

function contentHelp() {
  if (!settings) return;
  const type = $('#content-type').value;
  const hideSource = type === 'dashboard' || type === 'tasks';
  $('#source-label').hidden = hideSource;
  $('#source-label').style.display = hideSource ? 'none' : 'grid';
  $('#pick-file').hidden = type !== 'video';
  $('#content-source').placeholder = type === 'youtube' ? t('source.youtube') : t('source.video');
  $('#content-help').textContent = t(`help.${type}`);
}

function fillSettings() {
  settings.mediaSources = { video: '', youtube: '', ...(settings.mediaSources || {}) };
  currentContentType = settings.displayContent.type;
  if ((currentContentType === 'video' || currentContentType === 'youtube') && settings.displayContent.source) settings.mediaSources[currentContentType] = settings.displayContent.source;
  $('#language').value = settings.language;
  $('#content-type').value = currentContentType;
  $('#content-source').value = settings.mediaSources[currentContentType] || '';
  $('#port-select').value = settings.portPath || 'auto';
  $('#display-preset').value = settings.displayProfile.preset in PRESETS ? settings.displayProfile.preset : 'custom';
  $('#display-name').value = settings.displayProfile.name;
  $('#display-width').value = settings.displayProfile.width;
  $('#display-height').value = settings.displayProfile.height;
  $('#rotation').value = String(settings.displayProfile.rotation);
  $('#frame-limit').value = Math.round(settings.maxFrameBytes / 1000);
  $('#brightness').value = settings.brightness;
  $('#brightness-value').textContent = `${settings.brightness}%`;
  $('#hero-profile').textContent = `${settings.displayProfile.width} × ${settings.displayProfile.height}`;
  settings.startup = { launchAtLogin: false, autoConnect: false, autoReconnect: true, reconnectDelay: 5, openPreview: false, ...(settings.startup || {}) };
  $('#launch-at-login').checked = settings.startup.launchAtLogin;
  $('#auto-connect').checked = settings.startup.autoConnect;
  $('#auto-reconnect').checked = settings.startup.autoReconnect;
  $('#reconnect-delay').value = settings.startup.reconnectDelay;
  $('#open-preview').checked = settings.startup.openPreview;
  updateReconnectControls();
  contentHelp();
}

function switchContentType() {
  if (currentContentType === 'video' || currentContentType === 'youtube') settings.mediaSources[currentContentType] = $('#content-source').value.trim();
  currentContentType = $('#content-type').value;
  $('#content-source').value = settings.mediaSources[currentContentType] || '';
  contentHelp();
}

function renderTodos() {
  if (!settings) return;
  const remaining = settings.todos.filter((task) => !task.done).length;
  $('#task-count').textContent = t('tasks.remaining', { count: remaining });
  $('#task-list').innerHTML = settings.todos.map((task) => `
    <div class="task ${task.done ? 'done' : ''}" data-id="${escapeHtml(task.id)}">
      <input type="checkbox" ${task.done ? 'checked' : ''} aria-label="Done" />
      <span>${escapeHtml(task.title)}</span><button type="button" title="Delete">×</button>
    </div>`).join('') || `<div class="empty">${t('tasks.empty')}</div>`;
}

async function saveSettings(message) {
  settings = await window.jungle.saveSettings(settings);
  if (message) toast(message);
}

async function persistContent(message) {
  const type = $('#content-type').value;
  const source = type === 'video' || type === 'youtube' ? $('#content-source').value.trim() : '';
  if ((type === 'video' || type === 'youtube') && !source) { toast(t('toast.sourceRequired')); return false; }
  if (type === 'video' || type === 'youtube') settings.mediaSources[type] = source;
  settings.displayContent = { type, source };
  currentContentType = type;
  await saveSettings(message);
  return true;
}

function updateReconnectControls() {
  $('#reconnect-delay').disabled = !$('#auto-reconnect').checked;
}
async function connect() {
  const state = await window.jungle.connectDevice($('#port-select').value || 'auto');
  renderDeviceState(state);
  if (state.status === 'error') toast($('#status-message').textContent);
}

async function init() {
  settings = await window.jungle.getSettings();
  deviceState = await window.jungle.getDeviceState();
  fillSettings(); applyLanguage(); renderTodos(); renderDeviceState(deviceState);
  await scanDevices(); updateClock(); renderSystem();
  setInterval(updateClock, 1000); setInterval(renderSystem, 1500);

  $$('.nav').forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  $('#language').addEventListener('change', async () => { settings.language = $('#language').value; await saveSettings(); applyLanguage(); });
  $('#connect-main').addEventListener('click', connect);
  $('#disconnect-main').addEventListener('click', async () => renderDeviceState(await window.jungle.disconnectDevice()));
  $('#preview-main').addEventListener('click', () => window.jungle.openPreview());
  $('#preview-content').addEventListener('click', async () => { if (await persistContent()) window.jungle.openPreview(); });
  $('#scan-device').addEventListener('click', () => scanDevices(true));
  $('#content-type').addEventListener('change', switchContentType);
  $('#pick-file').addEventListener('click', async () => {
    const file = await window.jungle.pickVideo();
    if (file) { $('#content-source').value = file; settings.mediaSources.video = file; }
  });
  $('#save-content').addEventListener('click', () => persistContent(t('toast.contentSaved')));

  $('#display-preset').addEventListener('change', () => {
    const preset = PRESETS[$('#display-preset').value];
    if (!preset) return;
    $('#display-width').value = preset.width;
    $('#display-height').value = preset.height;
    $('#display-name').value = preset.name;
  });
  ['#display-width', '#display-height'].forEach((selector) => $(selector).addEventListener('input', () => { $('#display-preset').value = 'custom'; }));
  $('#brightness').addEventListener('input', () => { $('#brightness-value').textContent = `${$('#brightness').value}%`; });
  $('#save-display').addEventListener('click', async () => {
    settings.portPath = $('#port-select').value || 'auto';
    settings.brightness = Number($('#brightness').value);
    settings.maxFrameBytes = Number($('#frame-limit').value) * 1000;
    settings.displayProfile = {
      preset: $('#display-preset').value,
      name: $('#display-name').value.trim() || 'Jungle Display',
      width: Number($('#display-width').value),
      height: Number($('#display-height').value),
      rotation: Number($('#rotation').value)
    };
    await saveSettings(t('toast.displaySaved'));
  });

  $('#auto-reconnect').addEventListener('change', updateReconnectControls);
  $('#save-settings').addEventListener('click', async () => {
    settings.startup = {
      launchAtLogin: $('#launch-at-login').checked,
      autoConnect: $('#auto-connect').checked,
      autoReconnect: $('#auto-reconnect').checked,
      reconnectDelay: Number($('#reconnect-delay').value),
      openPreview: $('#open-preview').checked
    };
    await saveSettings(t('toast.settingsSaved'));
  });
  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#task-input'); const title = input.value.trim();
    if (!title) return;
    settings.todos.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, done: false });
    input.value = ''; await saveSettings(); renderTodos();
  });
  $('#task-list').addEventListener('change', async (event) => {
    if (event.target.type !== 'checkbox') return;
    const task = settings.todos.find((item) => item.id === event.target.closest('.task').dataset.id);
    if (task) task.done = event.target.checked;
    await saveSettings(); renderTodos();
  });
  $('#task-list').addEventListener('click', async (event) => {
    if (event.target.tagName !== 'BUTTON') return;
    const id = event.target.closest('.task').dataset.id;
    settings.todos = settings.todos.filter((task) => task.id !== id);
    await saveSettings(); renderTodos();
  });

  window.jungle.onSettings((next) => { settings = next; fillSettings(); applyLanguage(); renderTodos(); });
  window.jungle.onDevice(renderDeviceState);
}

document.addEventListener('DOMContentLoaded', init);