let settings;
let timer;
const root = document.getElementById('display-root');
const isPreview = new URLSearchParams(location.search).get('preview') === '1';
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));

const TEXT = {
  en: { tasks: 'TASKS', remaining: '{count} remaining', allDone: '✓ All tasks completed', taskTitle: 'TODAY', uptime: 'UPTIME' },
  vi: { tasks: 'CÔNG VIỆC', remaining: 'Còn {count} việc', allDone: '✓ Đã hoàn thành tất cả', taskTitle: 'HÔM NAY', uptime: 'UPTIME' }
};

function t(key, values = {}) {
  const language = settings?.language === 'vi' ? 'vi' : 'en';
  let text = TEXT[language][key] || TEXT.en[key] || key;
  Object.entries(values).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, value); });
  return text;
}

function applyRotation() {
  const rotation = Number(settings?.displayProfile?.rotation) || 0;
  root.style.transform = !isPreview && rotation === 180 ? 'rotate(180deg)' : 'none';
}

function youtubeId(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.split('/').filter(Boolean)[0];
    if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2];
    return parsed.searchParams.get('v');
  } catch {
    return String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1];
  }
}

function localMediaUrl(source) {
  const value = String(source || '');
  if (/^[a-zA-Z]:\\/.test(value)) return encodeURI(`file:///${value.replace(/\\/g, '/')}`).replace(/#/g, '%23');
  return value;
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clock() {
  const now = new Date();
  const locale = settings.language === 'vi' ? 'vi-VN' : 'en-GB';
  return {
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now),
    date: new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(now)
  };
}

function dashboard(stats) {
  const now = clock();
  const remaining = settings.todos.filter((task) => !task.done);
  const portrait = innerHeight > innerWidth;
  const square = innerWidth / innerHeight <= 1.3;
  const limit = portrait ? 5 : square ? 4 : 4;
  const taskRows = remaining.slice(0, limit).map((task, index) => `<li><i>${index + 1}</i><span>${escapeHtml(task.title)}</span></li>`).join('');
  return `<section class="dashboard">
    <div class="summary">
      <div class="clock"><strong>${now.time}</strong><small>${escapeHtml(now.date)}</small></div>
      <div class="meters">
        <div><span>CPU</span><b>${stats.cpuPercent}<sup>%</sup></b><i style="--value:${stats.cpuPercent}%"></i></div>
        <div><span>RAM</span><b>${stats.memoryPercent}<sup>%</sup></b><i style="--value:${stats.memoryPercent}%"></i></div>
        <div><span>${t('uptime')}</span><b class="uptime-value">${formatUptime(stats.uptime)}</b></div>
      </div>
    </div>
    <div class="dashboard-tasks">
      <header><strong>${t('tasks')}</strong><small>${t('remaining', { count: remaining.length })}</small></header>
      <ol>${taskRows || `<li class="all-done"><span>${t('allDone')}</span></li>`}</ol>
    </div>
  </section>`;
}

function taskBoard() {
  const now = clock();
  const remaining = settings.todos.filter((task) => !task.done);
  const limit = innerHeight > innerWidth ? 8 : 5;
  const items = remaining.slice(0, limit).map((task, index) => `<li><i>${index + 1}</i><span>${escapeHtml(task.title)}</span></li>`).join('');
  return `<section class="tasks-screen">
    <header><div><h1>${t('taskTitle')}</h1><strong>${t('remaining', { count: remaining.length })}</strong></div><time>${now.time}</time></header>
    <ol>${items || `<li class="all-done"><span>${t('allDone')}</span></li>`}</ol>
  </section>`;
}

async function render() {
  const content = settings.displayContent || { type: 'dashboard', source: '' };
  if (content.type === 'video' && content.source) {
    if (root.dataset.key !== `video:${content.source}`) {
      root.dataset.key = `video:${content.source}`;
      root.innerHTML = `<video class="media" src="${escapeHtml(localMediaUrl(content.source))}" autoplay loop muted playsinline></video>`;
      root.querySelector('video')?.play().catch(() => {});
    }
    return;
  }
  if (content.type === 'youtube' && youtubeId(content.source)) {
    const id = youtubeId(content.source);
    if (root.dataset.key !== `youtube:${id}`) {
      root.dataset.key = `youtube:${id}`;
      root.innerHTML = `<iframe class="media" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&rel=0&playsinline=1" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    }
    return;
  }
  root.dataset.key = content.type;
  root.innerHTML = content.type === 'tasks' ? taskBoard() : dashboard(await window.jungle.getSystem());
}

async function start() {
  settings = await window.jungle.getSettings();
  applyRotation();
  await render();
  clearInterval(timer);
  timer = setInterval(() => {
    const type = settings.displayContent?.type;
    if (type === 'dashboard' || type === 'tasks') render();
  }, 1000);
  window.addEventListener('resize', () => {
    const type = settings.displayContent?.type;
    if (type === 'dashboard' || type === 'tasks') render();
  });
  window.jungle.onSettings(async (next) => {
    settings = next;
    applyRotation();
    root.dataset.key = '';
    await render();
  });
}

start();