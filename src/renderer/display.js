let settings;
let stats;
let timer;
const root = document.getElementById('display-root');
const isPreview = new URLSearchParams(location.search).get('preview') === '1';
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[character]));

function activeDisplay() {
  return settings.displays.find((display) => display.id === settings.activeDisplayId) || settings.displays[0];
}

function localMediaUrl(source) {
  const value = String(source || '');
  if (value.length > 2 && value[1] === ':' && value.charCodeAt(2) === 92) return encodeURI('file:///' + value.split(String.fromCharCode(92)).join('/')).replace(/#/g, '%23');
  return value;
}

function youtubeId(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.split('/').filter(Boolean)[0];
    if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
    return parsed.searchParams.get('v');
  } catch {
    const value = String(url || '').trim();
    return value.length === 11 ? value : null;
  }
}

function nowInfo() {
  const now = new Date();
  const locale = settings.language === 'vi' ? 'vi-VN' : 'en-GB';
  return {
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now),
    date: new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now)
  };
}

function formatUptime(seconds) {
  const hours = Math.floor((seconds || 0) / 3600);
  const minutes = Math.floor(((seconds || 0) % 3600) / 60);
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

function metric(type) {
  if (!stats) return '--';
  if (type === 'cpu') return stats.cpuPercent + '%';
  if (type === 'ram') return stats.memoryPercent + '%';
  if (type === 'gpu') return stats.gpu?.percent == null ? 'N/A' : stats.gpu.percent + '%';
  return formatUptime(stats.uptime);
}

function taskMarkup(element) {
  const remaining = settings.todos.filter((task) => !task.done).slice(0, element.maxItems || 4);
  if (!remaining.length) return '<li>' + (settings.language === 'vi' ? window.JUNGLE_I18N.dynamicVi.done : 'All tasks completed') + '</li>';
  return remaining.map((task) => '<li>' + escapeHtml(task.title) + '</li>').join('');
}

function contentMarkup(element) {
  const title = element.title ? '<span class="widget-label">' + escapeHtml(element.title) + '</span>' : '';
  if (element.type === 'video') {
    return element.source ? '<video src="' + escapeHtml(localMediaUrl(element.source)) + '" autoplay loop muted playsinline style="object-fit:' + element.fit + '"></video>' : '';
  }
  if (element.type === 'youtube') {
    const id = youtubeId(element.source);
    return id ? '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=1&loop=1&playlist=' + id + '&controls=0&rel=0&playsinline=1" allow="autoplay; encrypted-media"></iframe>' : '';
  }
  if (element.type === 'image') {
    return element.source ? '<img src="' + escapeHtml(localMediaUrl(element.source)) + '" style="object-fit:' + element.fit + '">' : '';
  }
  if (element.type === 'shape') return '';
  if (element.type === 'tasks') return '<div class="widget-inner task-widget">' + title + '<ol>' + taskMarkup(element) + '</ol></div>';
  if (element.type === 'text') return '<div class="widget-inner">' + title + '<b class="widget-value multiline">' + escapeHtml(element.text) + '</b></div>';
  if (element.type === 'clock') return '<div class="widget-inner">' + title + '<b class="widget-value" data-dynamic="clock">' + nowInfo().time + '</b></div>';
  if (element.type === 'date') return '<div class="widget-inner">' + title + '<b class="widget-value multiline" data-dynamic="date">' + escapeHtml(nowInfo().date) + '</b></div>';
  return '<div class="widget-inner">' + title + '<b class="widget-value" data-dynamic="' + element.type + '">' + metric(element.type) + '</b></div>';
}

function renderLayout() {
  const display = activeDisplay();
  const canvas = display.canvas;
  root.style.backgroundColor = canvas.background;
  const backgroundImage = canvas.backgroundImage ? localMediaUrl(canvas.backgroundImage).replaceAll('"', '%22') : '';
  root.style.backgroundImage = backgroundImage ? 'url("' + backgroundImage + '")' : 'none';
  root.style.backgroundSize = 'cover';
  root.style.backgroundPosition = 'center';
  root.style.transform = !isPreview && display.profile.rotation === 180 ? 'rotate(180deg)' : 'none';
  root.innerHTML = '';
  canvas.elements.slice().sort((a, b) => a.z - b.z).forEach((element) => {
    const node = document.createElement('section');
    node.className = 'widget ' + element.type;
    node.dataset.type = element.type;
    Object.assign(node.style, {
      left: element.x + 'px',
      top: element.y + 'px',
      width: element.width + 'px',
      height: element.height + 'px',
      zIndex: element.z,
      color: element.color,
      backgroundColor: element.background,
      fontSize: element.fontSize + 'px',
      opacity: element.opacity,
      borderRadius: element.radius + 'px'
    });
    node.innerHTML = contentMarkup(element);
    root.appendChild(node);
    node.querySelector('video')?.play().catch(() => {});
  });
}

async function updateDynamic() {
  stats = await window.jungle.getSystem();
  const now = nowInfo();
  document.querySelectorAll('[data-dynamic]').forEach((node) => {
    const type = node.dataset.dynamic;
    node.textContent = type === 'clock' ? now.time : type === 'date' ? now.date : metric(type);
  });
}

async function start() {
  settings = await window.jungle.getSettings();
  stats = await window.jungle.getSystem();
  renderLayout();
  clearInterval(timer);
  timer = setInterval(updateDynamic, 1000);
  window.jungle.onSettings((next) => {
    settings = next;
    renderLayout();
  });
}

start();