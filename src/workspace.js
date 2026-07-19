const { DEFAULT_PROFILE, clamp, sanitizeProfile } = require('./display-profile');

const ELEMENT_TYPES = new Set([
  'text', 'clock', 'date', 'cpu', 'ram', 'gpu', 'uptime',
  'tasks', 'calendar', 'codex', 'claude', 'video', 'youtube', 'image', 'shape'
]);

function color(value, fallback) {
  const text = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function elementBackground(value, fallback) {
  return String(value || '').toLowerCase() === 'transparent'
    ? 'transparent'
    : color(value, fallback);
}

function number(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeId(value, fallback) {
  const id = String(value || '').replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 120);
  return id || fallback;
}

function isoDate(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? text : '';
}

function monthDay(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(2000, Number(match[1]) - 1, Number(match[2]));
  return date.getMonth() === Number(match[1]) - 1 && date.getDate() === Number(match[2]) ? text : '';
}

function sanitizeCalendarEvent(value, index) {
  const repeat = ['daily', 'weekly', 'monthly', 'yearly'].includes(value?.repeat) ? value.repeat : 'none';
  const sourceDate = isoDate(value?.date);
  const annualDate = monthDay(value?.monthDay || (repeat === 'yearly' ? sourceDate.slice(5) : ''));
  const date = repeat === 'yearly' && annualDate ? '' : sourceDate;
  const repeatUntil = isoDate(value?.repeatUntil);
  return {
    id: safeId(value?.id, 'event-' + index),
    title: String(value?.title || '').slice(0, 120),
    date,
    monthDay: annualDate,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value?.time || '')) ? String(value.time) : '',
    repeat,
    repeatUntil: repeat !== 'none' && (repeat === 'yearly' || repeatUntil >= date) ? repeatUntil : ''
  };
}

function defaultElements(profile = DEFAULT_PROFILE) {
  const safe = sanitizeProfile(profile);
  const sx = safe.width / 960;
  const sy = safe.height / 480;
  const box = (id, type, x, y, width, height, extra = {}) => ({
    id, type,
    x: Math.round(x * sx), y: Math.round(y * sy),
    width: Math.round(width * sx), height: Math.round(height * sy),
    color: '#effaf5', background: '#102832', fontSize: Math.max(12, Math.round(28 * Math.min(sx, sy))),
    textStrokeColor: '#000000', textStrokeWidth: 0,
    opacity: 1, radius: Math.max(4, Math.round(12 * Math.min(sx, sy))), fit: 'cover', mediaScale: 1, z: 1,
    title: '', text: '', source: '', maxItems: 4, showUsage: true, showTemperature: true, ...extra
  });
  return [
    box('clock', 'clock', 20, 18, 220, 112, { background: '#0b1d26', fontSize: 54, title: 'TIME' }),
    box('cpu', 'cpu', 255, 18, 150, 112, { title: 'CPU', color: '#62edab', fontSize: 38 }),
    box('ram', 'ram', 420, 18, 150, 112, { title: 'RAM', color: '#62edab', fontSize: 38 }),
    box('gpu', 'gpu', 585, 18, 150, 112, { title: 'GPU', color: '#62edab', fontSize: 38 }),
    box('uptime', 'uptime', 750, 18, 190, 112, { title: 'UPTIME', color: '#62edab', fontSize: 32 }),
    box('tasks', 'tasks', 20, 148, 920, 312, { title: 'TASKS', background: '#071b18', fontSize: 26, maxItems: 4 })
  ];
}

function defaultCanvas(profile = DEFAULT_PROFILE) {
  return {
    background: '#071019',
    backgroundImage: '',
    elements: defaultElements(profile)
  };
}

function elementDefaults(type, index) {
  const labels = { cpu: 'CPU', ram: 'RAM', gpu: 'GPU', uptime: 'UPTIME', tasks: 'TASKS', calendar: 'CALENDAR', codex: 'CODEX', claude: 'CLAUDE CODE', clock: 'TIME', date: 'DATE' };
  return {
    id: 'element-' + index,
    type,
    x: 20,
    y: 20,
    width: ['video', 'youtube', 'image', 'tasks', 'calendar', 'codex', 'claude'].includes(type) ? 360 : 220,
    height: ['video', 'youtube', 'image'].includes(type) ? 200 : ['tasks', 'calendar', 'codex', 'claude'].includes(type) ? 220 : 110,
    color: '#effaf5',
    background: type === 'shape' ? '#62edab' : '#102832',
    fontSize: type === 'clock' ? 52 : 28,
    textStrokeColor: '#000000',
    textStrokeWidth: 0,
    opacity: 1,
    radius: 12,
    fit: 'cover',
    mediaScale: 1,
    z: index + 1,
    title: labels[type] || '',
    text: type === 'text' ? 'Your text' : '',
    source: '',
    maxItems: 4,
    showUsage: true,
    showTemperature: true
  };
}

function sanitizeElement(value, profile, index) {
  const safeProfile = sanitizeProfile(profile);
  const requestedType = value?.type === 'agents' ? 'codex' : value?.type;
  const type = ELEMENT_TYPES.has(requestedType) ? requestedType : 'text';
  const migrated = value?.type === 'agents' && value?.title === 'AI AGENTS' ? { ...value, title: 'CODEX' } : value;
  const base = { ...elementDefaults(type, index), ...(migrated || {}), type };
  const width = clamp(base.width, 40, safeProfile.width, Math.min(220, safeProfile.width));
  const height = clamp(base.height, 32, safeProfile.height, Math.min(110, safeProfile.height));
  const fontSize = clamp(base.fontSize, 6, 300, 28);
  const textColor = color(base.color, '#effaf5');
  const textStrokeColor = color(base.textStrokeColor, '#000000');
  const textStrokeWidth = Math.round(number(base.textStrokeWidth, 0, 30, 0) * 10) / 10;
  const legacyLabelScale = ['tasks', 'calendar', 'codex', 'claude', 'uptime'].includes(type) ? 1.52 : 0.38;
  return {
    id: safeId(base.id, 'element-' + index),
    type,
    x: clamp(base.x, 0, Math.max(0, safeProfile.width - width), 0),
    y: clamp(base.y, 0, Math.max(0, safeProfile.height - height), 0),
    width,
    height,
    color: textColor,
    background: elementBackground(base.background, '#102832'),
    fontSize,
    textStrokeColor,
    textStrokeWidth,
    labelColor: color(base.labelColor, textColor),
    labelFontSize: Math.round(number(base.labelFontSize, 4, 400, fontSize * legacyLabelScale) * 10) / 10,
    labelStrokeColor: color(base.labelStrokeColor, textStrokeColor),
    labelStrokeWidth: Math.round(number(base.labelStrokeWidth, 0, 30, textStrokeWidth) * 10) / 10,
    opacity: Math.round(number(base.opacity, 0.05, 1, 1) * 100) / 100,
    radius: clamp(base.radius, 0, 200, 12),
    fit: ['cover', 'contain', 'fill'].includes(base.fit) ? base.fit : 'cover',
    mediaScale: Math.round(number(base.mediaScale, 0.5, 4, 1) * 100) / 100,
    z: clamp(base.z, 0, 9999, index + 1),
    title: String(base.title || '').slice(0, 80),
    text: String(base.text || '').slice(0, 500),
    source: String(base.source || '').slice(0, 2048),
    maxItems: clamp(base.maxItems, 1, 20, 4),
    showUsage: base.showUsage !== false,
    showTemperature: base.showTemperature !== false
  };
}

function sanitizeCanvas(value, profile) {
  const source = value && typeof value === 'object' ? value : defaultCanvas(profile);
  const elements = Array.isArray(source.elements) ? source.elements : defaultElements(profile);
  const ids = new Set();
  return {
    background: color(source.background, '#071019'),
    backgroundImage: String(source.backgroundImage || '').slice(0, 2048),
    elements: elements.slice(0, 100).map((element, index) => {
      const safe = sanitizeElement(element, profile, index);
      while (ids.has(safe.id)) safe.id += '-copy';
      ids.add(safe.id);
      return safe;
    })
  };
}

function canvasFromLegacy(saved, profile) {
  if (saved.canvas) return sanitizeCanvas(saved.canvas, profile);
  const content = saved.displayContent || saved.caseContent || { type: 'dashboard', source: '' };
  if (content.type === 'video' || content.type === 'youtube') {
    return sanitizeCanvas({
      background: '#071019',
      elements: [{
        ...elementDefaults(content.type, 0),
        id: 'legacy-media',
        x: 0, y: 0, width: profile.width, height: profile.height,
        source: content.source || saved.mediaSources?.[content.type] || '',
        radius: 0
      }]
    }, profile);
  }
  if (content.type === 'tasks') {
    return sanitizeCanvas({
      background: '#071019',
      elements: [{ ...elementDefaults('tasks', 0), id: 'tasks', x: 0, y: 0, width: profile.width, height: profile.height, radius: 0, maxItems: 10 }]
    }, profile);
  }
  return defaultCanvas(profile);
}

function sanitizeUsb(usb = {}) {
  return {
    vendorId: String(usb.vendorId || '').toUpperCase().slice(0, 8),
    productId: String(usb.productId || '').toUpperCase().slice(0, 8),
    serialNumber: String(usb.serialNumber || '').slice(0, 160),
    manufacturer: String(usb.manufacturer || '').slice(0, 160)
  };
}

function sanitizeDisplay(value, index, legacy = {}) {
  const fallbackProfile = sanitizeProfile(value?.profile || value?.detectedProfile || legacy.displayProfile || DEFAULT_PROFILE);
  const detectedProfile = sanitizeProfile(value?.detectedProfile || fallbackProfile);
  const profile = sanitizeProfile(value?.profile || fallbackProfile);
  const canvas = value?.canvas
    ? sanitizeCanvas(value.canvas, profile)
    : index === 0 ? canvasFromLegacy(legacy, profile) : defaultCanvas(profile);
  return {
    id: safeId(value?.id, 'display-' + index),
    name: String(value?.name || profile.name || 'Jungle Display').slice(0, 80),
    portPath: String(value?.portPath || legacy.portPath || 'auto').slice(0, 260),
    usb: sanitizeUsb(value?.usb),
    detectedProfile,
    profile,
    canvas,
    brightness: clamp(value?.brightness ?? legacy.brightness, 0, 100, 100),
    maxFrameBytes: clamp(value?.maxFrameBytes ?? legacy.maxFrameBytes, 10000, 250000, 50000)
  };
}

function normalizeWorkspace(saved = {}) {
  const input = saved && typeof saved === 'object' ? saved : {};
  let displays;
  if (Array.isArray(input.displays) && input.displays.length) {
    displays = input.displays.slice(0, 20).map((display, index) => sanitizeDisplay(display, index, input));
  } else {
    displays = [sanitizeDisplay({
      id: 'default',
      name: input.displayProfile?.name || DEFAULT_PROFILE.name,
      portPath: input.portPath || 'auto',
      profile: input.displayProfile || DEFAULT_PROFILE,
      detectedProfile: input.displayProfile || DEFAULT_PROFILE,
      brightness: input.brightness,
      maxFrameBytes: input.maxFrameBytes,
      canvas: input.canvas
    }, 0, input)];
  }
  const unique = new Set();
  displays.forEach((display, index) => {
    while (unique.has(display.id)) display.id += '-' + index;
    unique.add(display.id);
  });
  const requestedActive = safeId(input.activeDisplayId, displays[0].id);
  const activeDisplayId = displays.some((display) => display.id === requestedActive) ? requestedActive : displays[0].id;
  return {
    schemaVersion: 3,
    language: input.language === 'vi' ? 'vi' : 'en',
    startup: {
      launchAtLogin: Boolean(input.startup?.launchAtLogin),
      startHidden: Boolean(input.startup?.startHidden),
      autoConnect: Boolean(input.startup?.autoConnect),
      autoReconnect: input.startup?.autoReconnect !== false,
      reconnectDelay: clamp(input.startup?.reconnectDelay, 2, 60, 5),
      openPreview: Boolean(input.startup?.openPreview)
    },
    activeDisplayId,
    displays,
    todos: Array.isArray(input.todos) ? input.todos.slice(0, 100).map((todo, index) => ({
      id: safeId(todo?.id, 'task-' + index),
      title: String(todo?.title || '').slice(0, 100),
      done: Boolean(todo?.done)
    })).filter((todo) => todo.title) : [],
    events: Array.isArray(input.events) ? input.events.slice(0, 200).map(sanitizeCalendarEvent).filter((event) => event.title && (event.date || event.monthDay)) : []
  };
}

function activeDisplay(settings) {
  const safe = normalizeWorkspace(settings);
  return safe.displays.find((display) => display.id === safe.activeDisplayId) || safe.displays[0];
}

module.exports = {
  ELEMENT_TYPES,
  defaultElements,
  defaultCanvas,
  sanitizeElement,
  sanitizeCanvas,
  sanitizeDisplay,
  sanitizeCalendarEvent,
  normalizeWorkspace,
  activeDisplay
};
