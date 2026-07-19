let settings;
let stats;
let agentSnapshot;
let timer;
let listTimer;
let lastCalendarDate;
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
function temperature(value) {
  return value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) + '\u00b0C' : 'N/A';
}

function metric(type) {
  if (!stats) return '--';
  if (type === 'cpu') return stats.cpuPercent + '%';
  if (type === 'ram') return stats.memoryPercent + '%';
  if (type === 'gpu') return stats.gpu?.percent == null ? 'N/A' : stats.gpu.percent + '%';
  return formatUptime(stats.uptime);
}

function taskMarkup(element, page = 0) {
  const remaining = settings.todos.filter((task) => !task.done);
  const visible = window.JUNGLE_CALENDAR.pageItems(remaining, element.maxItems || 4, page).items;
  if (!visible.length) return '<li><span class="list-text-viewport"><span class="list-text">' + (settings.language === 'vi' ? window.JUNGLE_I18N.dynamicVi.done : 'All tasks completed') + '</span></span></li>';
  return visible.map((task) => '<li><span class="list-text-viewport"><span class="list-text">' + escapeHtml(task.title) + '</span></span></li>').join('');
}

function agentProviderKey(element) {
  return element.type === 'claude' ? 'claude' : 'codex';
}

function agentQuota(element) {
  const key = agentProviderKey(element);
  const provider = agentSnapshot?.providers?.[key];
  const values = [];
  if (key === 'codex') {
    if (provider?.quota?.primary?.usedPercent != null) values.push({ label: '5H', value: Math.round(provider.quota.primary.usedPercent) + '%' });
    if (provider?.quota?.secondary?.usedPercent != null) values.push({ label: '7D', value: Math.round(provider.quota.secondary.usedPercent) + '%' });
  } else {
    if (provider?.quota?.fiveHour?.usedPercent != null) values.push({ label: '5H', value: Math.round(provider.quota.fiveHour.usedPercent) + '%' });
    if (provider?.quota?.sevenDay?.usedPercent != null) values.push({ label: '7D', value: Math.round(provider.quota.sevenDay.usedPercent) + '%' });
  }
  return { status: provider?.connected ? 'connected' : 'offline', values, text: provider?.available ? 'NO QUOTA' : 'OFFLINE' };
}

function agentRows(element) {
  const key = agentProviderKey(element);
  return (agentSnapshot?.tasks || []).filter((task) => task.provider === key).map((task) => ({ status: task.status, text: (task.status === 'running' ? '\u25cf' : task.status === 'completed' ? '\u2713' : '\u25cb') + ' ' + task.title }));
}

function agentQuotaMarkup(element) {
  const quota = agentQuota(element);
  const content = quota.values.length
    ? quota.values.map((item) => '<span><small>' + escapeHtml(item.label) + '</small><b>' + escapeHtml(item.value) + '</b></span>').join('')
    : '<strong>' + escapeHtml(quota.text) + '</strong>';
  return '<div class="agent-quota ' + escapeHtml(quota.status) + '">' + content + '</div>';
}

function agentMarkup(element, page = 0) {
  const visible = agentRows(element).slice(0, 8);
  return visible.length
    ? visible.map((item) => '<li class="agent-row ' + escapeHtml(item.status) + '"><span class="list-text-viewport"><span class="list-text">' + escapeHtml(item.text) + '</span></span></li>').join('')
    : '<li class="agent-row empty"><span class="list-text-viewport"><span class="list-text">NO TASKS</span></span></li>';
}

function calendarText(key) {
  const english = { noEvents: 'No events', todayShort: 'Today', tomorrow: 'Tomorrow' };
  return settings.language === 'vi' ? window.JUNGLE_I18N.dynamicVi[key] : english[key];
}

function calendarMarkup(element, page = 0) {
  const occurrences = window.JUNGLE_CALENDAR.listOccurrences(settings.events || [], new Date(), 90, 200);
  const visible = window.JUNGLE_CALENDAR.pageItems(occurrences, element.maxItems || 4, page).items;
  if (!visible.length) return '<li><span class="list-text-viewport"><span class="list-text">' + escapeHtml(calendarText('noEvents')) + '</span></span></li>';
  return visible.map((occurrence) => {
    const day = occurrence.daysFromToday === 0 ? calendarText('todayShort') : occurrence.daysFromToday === 1 ? calendarText('tomorrow') : new Intl.DateTimeFormat(settings.language === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: '2-digit' }).format(occurrence.date);
    const when = day + (occurrence.event.time ? ' · ' + occurrence.event.time : '');
    return '<li><span class="calendar-when">' + escapeHtml(when) + '</span><span class="list-text-viewport"><span class="list-text">' + escapeHtml(occurrence.event.title) + '</span></span></li>';
  }).join('');
}

function contentMarkup(element, page = 0) {
  const title = element.title ? '<span class="widget-label">' + escapeHtml(element.title) + '</span>' : '';
  if (element.type === 'video') {
    return element.source ? '<video src="' + escapeHtml(localMediaUrl(element.source)) + '" autoplay loop muted playsinline style="object-fit:' + element.fit + '"></video>' : '';
  }
  if (element.type === 'youtube') {
    const id = youtubeId(element.source);
    return id ? '<iframe data-youtube-id="' + escapeHtml(id) + '" src="' + escapeHtml(window.JUNGLE_YOUTUBE.embedUrl(id)) + '" loading="eager" allow="autoplay; encrypted-media"></iframe>' : '';
  }
  if (element.type === 'image') {
    return element.source ? '<img src="' + escapeHtml(localMediaUrl(element.source)) + '" style="object-fit:' + element.fit + '">' : '';
  }
  if (element.type === 'shape') return '';
  if (element.type === 'tasks') return '<div class="widget-inner task-widget">' + title + '<ol>' + taskMarkup(element, page) + '</ol></div>';
  if (element.type === 'calendar') return '<div class="widget-inner calendar-widget">' + title + '<ol>' + calendarMarkup(element, page) + '</ol></div>';
  if (['codex', 'claude'].includes(element.type)) return '<div class="widget-inner agent-widget">' + title + agentQuotaMarkup(element) + '<ol>' + agentMarkup(element, page) + '</ol></div>';
  if (element.type === 'text') return '<div class="widget-inner">' + title + '<b class="widget-value multiline">' + escapeHtml(element.text) + '</b></div>';
  if (element.type === 'clock') return '<div class="widget-inner">' + title + '<b class="widget-value" data-dynamic="clock">' + nowInfo().time + '</b></div>';
  if (element.type === 'date') return '<div class="widget-inner">' + title + '<b class="widget-value multiline" data-dynamic="date">' + escapeHtml(nowInfo().date) + '</b></div>';
  if (['cpu', 'gpu'].includes(element.type)) {
    const usage = element.showUsage !== false ? '<b class="widget-value" data-dynamic="' + element.type + '">' + metric(element.type) + '</b>' : '';
    const hardwareTemperature = element.showTemperature !== false ? '<b class="widget-value" data-temperature="' + element.type + '">' + temperature(element.type === 'cpu' ? stats?.cpuTemperature : stats?.gpu?.temperature) + '</b>' : '';
    return '<div class="widget-inner">' + title + usage + hardwareTemperature + '</div>';
  }
  return '<div class="widget-inner">' + title + '<b class="widget-value" data-dynamic="' + element.type + '">' + metric(element.type) + '</b></div>';
}

function contentSignature(element) {
  const signature = [element.type, element.title, element.text, element.source, element.maxItems, element.showUsage, element.showTemperature];
  if (element.type === 'tasks') signature.push(settings.todos);
  if (element.type === 'calendar') signature.push(settings.events, window.JUNGLE_CALENDAR.dateKey(new Date()), settings.language);
  if (['codex', 'claude'].includes(element.type)) signature.push(agentSnapshot, settings.language);
  return JSON.stringify(signature);
}

function resolvedLabelStyle(element) {
  const scale = ['tasks', 'calendar', 'codex', 'claude', 'uptime'].includes(element.type) ? 1.52 : 0.38;
  return {
    color: element.labelColor || element.color,
    fontSize: Number.isFinite(Number(element.labelFontSize)) ? Number(element.labelFontSize) : element.fontSize * scale,
    strokeColor: element.labelStrokeColor || element.textStrokeColor || '#000000',
    strokeWidth: Number.isFinite(Number(element.labelStrokeWidth)) ? Number(element.labelStrokeWidth) : (element.textStrokeWidth || 0)
  };
}

function styleWidgetLabel(node, element) {
  const label = node.querySelector('.widget-label');
  if (!label) return;
  const style = resolvedLabelStyle(element);
  Object.assign(label.style, {
    color: style.color,
    fontSize: style.fontSize + 'px',
    WebkitTextStrokeColor: style.strokeColor,
    WebkitTextStrokeWidth: style.strokeWidth + 'px',
    paintOrder: 'stroke fill'
  });
}

function styleWidget(node, element, refreshContent = true) {
  if (refreshContent) window.JUNGLE_YOUTUBE.unwatch(node);
  Object.assign(node.style, {
    left: element.x + 'px',
    top: element.y + 'px',
    width: element.width + 'px',
    height: element.height + 'px',
    zIndex: element.z,
    color: element.color,
    backgroundColor: element.background,
    fontSize: element.fontSize + 'px',
    WebkitTextStrokeColor: element.textStrokeColor || '#000000',
    WebkitTextStrokeWidth: (element.textStrokeWidth || 0) + 'px',
    paintOrder: 'stroke fill',
    opacity: element.opacity,
    borderRadius: element.radius + 'px'
  });
  if (refreshContent) {
    node.innerHTML = contentMarkup(element, Number(node.dataset.listPage) || 0);
    node.dataset.contentSignature = contentSignature(element);
  }
  styleWidgetLabel(node, element);
  if (element.type === 'youtube') window.JUNGLE_YOUTUBE.watch(node);
  const media = node.querySelector('video,img,iframe');
  if (media) {
    media.style.objectFit = element.fit;
    media.style.transform = 'scale(' + (element.mediaScale || 1) + ')';
  }
  if (refreshContent) node.querySelector('video')?.play().catch(() => {});
  if (['tasks', 'calendar'].includes(element.type)) scheduleWidgetListMotion(node, element);
  if (['codex', 'claude'].includes(element.type)) scheduleAgentTaskLayout(node);
}

function rotatingItemCount(element) {
  if (element.type === 'tasks') return settings.todos.filter((task) => !task.done).length;
  if (element.type === 'calendar') return window.JUNGLE_CALENDAR.listOccurrences(settings.events || [], new Date(), 90, 200).length;
  return 0;
}

function scheduleAgentTaskLayout(node) {
  const version = String((Number(node.dataset.agentLayoutVersion) || 0) + 1);
  node.dataset.agentLayoutVersion = version;
  requestAnimationFrame(() => {
    if (node.isConnected && node.dataset.agentLayoutVersion === version) layoutAgentTaskRows(node);
  });
}

function layoutAgentTaskRows(node) {
  const list = node.querySelector('.agent-widget ol');
  const rows = [...(list?.children || [])];
  if (!list || !rows.length) return;
  rows.forEach((row) => {
    row.hidden = false;
    row.querySelector('.list-text')?.removeAttribute('style');
  });
  list.style.removeProperty('grid-template-rows');
  const rowStyle = getComputedStyle(rows[0]);
  const font = parseFloat(rowStyle.fontSize) || 12;
  const line = parseFloat(rowStyle.lineHeight) || font * 1.15;
  const padding = (parseFloat(rowStyle.paddingTop) || 0) + (parseFloat(rowStyle.paddingBottom) || 0);
  const minimum = Math.ceil(line + padding + 2);
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  const capacity = Math.max(1, Math.min(rows.length, Math.floor((list.clientHeight + gap) / (minimum + gap)) || 1));
  rows.forEach((row, index) => { row.hidden = index >= capacity; });
  list.style.gridTemplateRows = 'repeat(' + capacity + ', minmax(' + minimum + 'px, 1fr))';
  list.dataset.visibleRows = String(capacity);
}

function scheduleWidgetListMotion(node, element) {
  const version = String((Number(node.dataset.motionVersion) || 0) + 1);
  node.dataset.motionVersion = version;
  requestAnimationFrame(() => {
    if (node.isConnected && node.dataset.motionVersion === version) prepareWidgetListMotion(node, element);
  });
}

function prepareWidgetListMotion(node, element) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const allowMarquee = element.type !== 'codex';
  const longest = [...node.querySelectorAll('.list-text')].reduce((maximum, target) => {
    target.classList.remove('is-overflowing');
    target.style.removeProperty('--marquee-distance');
    target.style.removeProperty('--marquee-duration');
    if (reduced || !allowMarquee) return maximum;
    const distance = Math.max(0, target.scrollWidth - target.clientWidth);
    if (distance < 2) return maximum;
    const duration = window.JUNGLE_CALENDAR.marqueeDuration(distance);
    target.style.setProperty('--marquee-distance', -distance + 'px');
    target.style.setProperty('--marquee-duration', duration + 'ms');
    void target.offsetWidth;
    target.classList.add('is-overflowing');
    return Math.max(maximum, duration);
  }, 0);
  const pageCount = Math.max(1, Math.ceil(rotatingItemCount(element) / (element.maxItems || 4)));
  node.dataset.nextListAt = pageCount > 1 || longest > 0 ? String(Date.now() + longest + 3500) : '0';
}

function advanceWidgetLists() {
  const now = Date.now();
  root.querySelectorAll('.widget.tasks, .widget.calendar').forEach((node) => {
    const due = Number(node.dataset.nextListAt) || 0;
    if (!due || now < due) return;
    const element = activeDisplay().canvas.elements.find((item) => item.id === node.dataset.elementId);
    if (!element) return;
    const pageCount = Math.max(1, Math.ceil(rotatingItemCount(element) / (element.maxItems || 4)));
    const current = (Number(node.dataset.listPage) || 0) % pageCount;
    const next = pageCount > 1 ? (current + 1) % pageCount : current;
    node.dataset.listPage = next;
    styleWidget(node, element, true);
    if (next !== current) {
      node.classList.remove('list-advancing');
      void node.offsetWidth;
      node.classList.add('list-advancing');
      setTimeout(() => node.classList.remove('list-advancing'), 450);
    }
  });
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
  const validIds = new Set(canvas.elements.map((element) => element.id));
  canvas.elements.forEach((element) => {
    let node = root.querySelector('[data-element-id="' + CSS.escape(element.id) + '"]');
    if (!node) {
      node = document.createElement('section');
      node.className = 'widget ' + element.type;
      node.dataset.elementId = element.id;
      node.dataset.type = element.type;
      styleWidget(node, element);
      root.appendChild(node);
    } else {
      styleWidget(node, element, node.dataset.contentSignature !== contentSignature(element));
    }
  });
  root.querySelectorAll('.widget').forEach((node) => {
    if (!validIds.has(node.dataset.elementId)) node.remove();
  });
}

async function updateDynamic() {
  stats = await window.jungle.getSystem();
  const calendarDate = window.JUNGLE_CALENDAR.dateKey(new Date());
  if (lastCalendarDate && calendarDate !== lastCalendarDate) renderLayout();
  lastCalendarDate = calendarDate;
  const now = nowInfo();
  document.querySelectorAll('[data-dynamic]').forEach((node) => {
    const type = node.dataset.dynamic;
    node.textContent = type === 'clock' ? now.time : type === 'date' ? now.date : metric(type);
  });
  document.querySelectorAll('[data-temperature]').forEach((node) => {
    node.textContent = temperature(node.dataset.temperature === 'cpu' ? stats?.cpuTemperature : stats?.gpu?.temperature);
  });
}

async function start() {
  [settings, stats, agentSnapshot] = await Promise.all([window.jungle.getSettings(), window.jungle.getSystem(), window.jungle.getAgents()]);
  renderLayout();
  lastCalendarDate = window.JUNGLE_CALENDAR.dateKey(new Date());
  clearInterval(timer);
  clearInterval(listTimer);
  timer = setInterval(updateDynamic, 1000);
  listTimer = setInterval(advanceWidgetLists, 200);
  window.jungle.onSettings((next) => {
    settings = next;
    renderLayout();
  });
  window.jungle.onAgents((next) => {
    agentSnapshot = next;
    renderLayout();
  });
}

start();
