const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { BAUD_RATE, TARGET_FRAME_INTERVAL_MS, remainingFrameDelay, buildCommand, isJungleDisplayPort } = require('../src/jungle-display');
const { sanitizeProfile, fitPreview } = require('../src/display-profile');
const { defaultCanvas, normalizeWorkspace, activeDisplay, sanitizeCanvas } = require('../src/workspace');
const { parseDateKey, occursOn, listOccurrences, pageItems, marqueeDuration } = require('../src/renderer/calendar');
const { normalizeTemperature, parseTemperatureOutput, windowsSensorScript } = require('../src/hardware-temperature');
const { normalizeCodexQuota, normalizeClaudeQuota, normalizeClaudeTasks, inferCodexLifecycle, sortTasks, recentTasks } = require('../src/agent-monitor');

assert.equal(BAUD_RATE, 2_000_000);
assert.equal(Math.round(1000 / TARGET_FRAME_INTERVAL_MS), 30);
assert.equal(Math.round(remainingFrameDelay(10)), 23);
assert.equal(remainingFrameDelay(50), 0);
assert.equal(buildCommand(0x06).toString('hex'), '55aa0700060c01');
assert.equal(buildCommand(0x03, Buffer.from([100])).toString('hex'), '55aa080003646e01');
assert.equal(buildCommand(0x11).toString('hex'), '55aa0700111701');
assert.equal(isJungleDisplayPort({ vendorId: '33c3', productId: '7788' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '33C3', productId: '7792' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '0402', productId: '3922' }), false);
assert.equal(normalizeTemperature('63.45'), 63.5);
assert.equal(normalizeTemperature('63,4'), 63.4);
assert.equal(normalizeTemperature(null), null);
assert.equal(normalizeTemperature(151), null);
assert.equal(parseTemperatureOutput('  \r\n'), null);
assert.equal(parseTemperatureOutput('\r\nnot-a-sensor\r\n72.25\r\n'), 72.3);
assert.match(windowsSensorScript('cpu'), /MSAcpi_ThermalZoneTemperature/);
assert.match(windowsSensorScript('cpu'), /High Precision Temperature/);
assert.doesNotMatch(windowsSensorScript('gpu'), /MSAcpi_ThermalZoneTemperature/);
assert.deepEqual(normalizeCodexQuota({ rateLimits: { planType: 'plus', primary: { usedPercent: 82, resetsAt: 123 }, credits: { balance: '0' } }, rateLimitResetCredits: { availableCount: 1 } }), {
  plan: 'plus', primary: { usedPercent: 82, resetsAt: 123 }, secondary: null,
  credits: { hasCredits: false, unlimited: false, balance: '0' }, resetCredits: 1
});
assert.deepEqual(normalizeClaudeQuota({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 456 }, seven_day: { used_percentage: 41.2, resets_at: 789 } } }), {
  fiveHour: { usedPercent: 23.5, resetsAt: 456 }, sevenDay: { usedPercent: 41.2, resetsAt: 789 }
});
assert.equal(inferCodexLifecycle('{"type":"event_msg","payload":{"type":"task_started"}}', Date.now()), 'running');
assert.equal(inferCodexLifecycle('{"type":"event_msg","payload":{"type":"task_started"}}\n{"type":"event_msg","payload":{"type":"task_complete"}}'), 'completed');
assert.equal(normalizeClaudeTasks([{ id: 'one', name: 'Build monitor', status: 'active' }])[0].status, 'running');
assert.deepEqual(sortTasks([{ status: 'completed', updatedAt: 20 }, { status: 'running', updatedAt: 10 }]).map((task) => task.status), ['running', 'completed']);
const recentNow = 2 * 24 * 60 * 60 * 1000;
assert.deepEqual(recentTasks([
  { id: 'running-old', provider: 'codex', status: 'running', updatedAt: 1 },
  { id: 'recent', provider: 'codex', status: 'completed', updatedAt: recentNow - 1000 },
  { id: 'old', provider: 'codex', status: 'completed', updatedAt: recentNow - 25 * 60 * 60 * 1000 },
  { id: 'claude-recent', provider: 'claude', status: 'completed', updatedAt: recentNow - 2000 }
], recentNow).map((task) => task.id), ['running-old', 'recent', 'claude-recent']);
assert.equal(recentTasks(Array.from({ length: 12 }, (_, index) => ({ id: index, provider: 'codex', status: 'completed', updatedAt: recentNow - index })), recentNow).length, 8);

function createYoutubeWatchdogFixture() {
  let nextTimerId = 1;
  const timers = new Map();
  const frameListeners = {};
  const windowListeners = {};
  const frame = {
    dataset: { youtubeId: 'video-id' },
    isConnected: true,
    src: '',
    contentWindow: { postMessage() {} },
    addEventListener(type, listener) { frameListeners[type] = listener; },
    matches(selector) { return selector === 'iframe[data-youtube-id]'; },
    querySelectorAll() { return []; }
  };
  const window = {
    addEventListener(type, listener) { windowListeners[type] = listener; }
  };
  const document = {
    querySelectorAll() { return [frame]; }
  };
  const setTimeout = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/renderer/youtube.js'), 'utf8'),
    { window, document, URL, URLSearchParams, setTimeout, clearTimeout }
  );
  return {
    youtube: window.JUNGLE_YOUTUBE,
    frame,
    frameListeners,
    timers,
    sendPlayerEvent(event) {
      windowListeners.message({
        origin: 'https://www.youtube-nocookie.com',
        source: frame.contentWindow,
        data: JSON.stringify({ event })
      });
    }
  };
}

const youtubeFixture = createYoutubeWatchdogFixture();
youtubeFixture.youtube.watch({ querySelector: () => youtubeFixture.frame });
assert.equal(youtubeFixture.frame.__jungleWatched, true);
assert.equal(youtubeFixture.timers.has(youtubeFixture.frame.__jungleRetryTimer), true);

youtubeFixture.frameListeners.load();
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '1');
assert.equal(youtubeFixture.frame.__jungleRetryTimer, null);

youtubeFixture.sendPlayerEvent('onReady');
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '1');
assert.equal(youtubeFixture.frame.dataset.youtubeReady, '1');
assert.equal(youtubeFixture.frame.__jungleRetryTimer, null);

youtubeFixture.sendPlayerEvent('onError');
const errorRetryTimer = youtubeFixture.frame.__jungleRetryTimer;
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '0');
assert.equal(youtubeFixture.frame.dataset.youtubeErrored, '1');
assert.equal(youtubeFixture.timers.get(errorRetryTimer).delay, 1500);
youtubeFixture.sendPlayerEvent('infoDelivery');
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '0');
assert.equal(youtubeFixture.frame.__jungleRetryTimer, errorRetryTimer);
youtubeFixture.frame.dataset.youtubeAttempt = '5';
youtubeFixture.timers.get(errorRetryTimer).callback();
assert.equal(youtubeFixture.frame.dataset.youtubeAttempt, '6');
assert.equal(youtubeFixture.frame.dataset.youtubeErrored, '0');
assert.equal(youtubeFixture.frame.dataset.youtubeReloading, '1');
assert.equal(youtubeFixture.timers.get(youtubeFixture.frame.__jungleRetryTimer).delay, 60000);
assert.match(youtubeFixture.frame.src, /jungle_retry=/);
youtubeFixture.frameListeners.load();
assert.equal(youtubeFixture.frame.dataset.youtubeErrored, '0');
assert.equal(youtubeFixture.frame.dataset.youtubeReloading, '0');
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '1');
assert.equal(youtubeFixture.frame.__jungleRetryTimer, null);
youtubeFixture.sendPlayerEvent('onReady');
assert.equal(youtubeFixture.frame.dataset.youtubeLoaded, '1');
assert.equal(youtubeFixture.frame.__jungleRetryTimer, null);

youtubeFixture.youtube.unwatch(youtubeFixture.frame);
assert.equal(youtubeFixture.frame.__jungleWatched, false);
assert.equal(youtubeFixture.frame.__jungleRetryTimer, null);

assert.deepEqual(sanitizeProfile({ preset: 'custom', name: 'Portrait', width: 480, height: 800, rotation: 0 }), {
  preset: 'custom', name: 'Portrait', width: 480, height: 800, rotation: 0
});
assert.equal(sanitizeProfile({ width: 100, height: 9999 }).width, 240);
assert.equal(sanitizeProfile({ width: 100, height: 9999 }).height, 2160);
assert.deepEqual(fitPreview({ width: 1920, height: 480 }), { width: 960, height: 240 });
assert.deepEqual(fitPreview({ width: 480, height: 800 }), { width: 384, height: 640 });

const canvas = defaultCanvas({ width: 960, height: 480, rotation: 180 });
assert.equal(canvas.elements.some((element) => element.type === 'gpu'), true);
assert.equal(canvas.elements.some((element) => element.type === 'tasks'), true);
assert.equal(canvas.elements.find((element) => element.type === 'cpu').showUsage, true);
assert.equal(canvas.elements.find((element) => element.type === 'cpu').showTemperature, true);

const legacy = normalizeWorkspace({
  language: 'vi',
  displayProfile: { name: 'Old screen', width: 800, height: 480, rotation: 180 },
  displayContent: { type: 'video', source: 'C:/media/clip.mp4' },
  brightness: 75,
  todos: [{ id: 'one', title: 'Test migration', done: false }]
});
assert.equal(legacy.schemaVersion, 3);
assert.equal(legacy.startup.startHidden, false);
assert.equal(legacy.displays.length, 1);
assert.equal(activeDisplay(legacy).profile.width, 800);
assert.equal(activeDisplay(legacy).brightness, 75);
assert.equal(activeDisplay(legacy).canvas.elements[0].type, 'video');
assert.equal(activeDisplay(legacy).canvas.elements[0].source, 'C:/media/clip.mp4');
const hiddenStartup = normalizeWorkspace({ startup: { launchAtLogin: true, startHidden: true } });
assert.equal(hiddenStartup.startup.launchAtLogin, true);
assert.equal(hiddenStartup.startup.startHidden, true);

const calendarWorkspace = normalizeWorkspace({
  events: [
    { id: 'standup', title: 'Daily stand-up', date: '2026-07-17', time: '09:30', repeat: 'daily', repeatUntil: '2026-07-19' },
    { id: 'invalid', title: 'Bad date', date: '2026-02-31', repeat: 'weekly' }
  ]
});
assert.equal(calendarWorkspace.events.length, 1);
assert.deepEqual(calendarWorkspace.events[0], { id: 'standup', title: 'Daily stand-up', date: '2026-07-17', monthDay: '', time: '09:30', repeat: 'daily', repeatUntil: '2026-07-19' });
assert.equal(occursOn(calendarWorkspace.events[0], parseDateKey('2026-07-18')), true);
assert.equal(occursOn(calendarWorkspace.events[0], parseDateKey('2026-07-20')), false);
const monthly = { title: 'Month end', date: '2026-01-31', repeat: 'monthly' };
assert.equal(occursOn(monthly, parseDateKey('2026-02-28')), false);
assert.equal(occursOn(monthly, parseDateKey('2026-03-31')), true);
const upcoming = listOccurrences(calendarWorkspace.events, parseDateKey('2026-07-17'), 7);
assert.deepEqual(upcoming.map((item) => item.key), ['2026-07-17', '2026-07-18', '2026-07-19']);
assert.deepEqual(pageItems(['a', 'b', 'c', 'd', 'e'], 2, 0).items, ['a', 'b']);
assert.deepEqual(pageItems(['a', 'b', 'c', 'd', 'e'], 2, 2).items, ['e']);
assert.deepEqual(pageItems(['a', 'b', 'c', 'd', 'e'], 2, 3).items, ['a', 'b']);
assert.equal(marqueeDuration(0), 0);
assert.equal(marqueeDuration(20), 2200);
assert.equal(marqueeDuration(380), 10000);
const annualWorkspace = normalizeWorkspace({ events: [{ id: 'birthday', title: 'Birthday', date: '1990-11-09', repeat: 'yearly' }] });
assert.equal(annualWorkspace.events[0].date, '');
assert.equal(annualWorkspace.events[0].monthDay, '11-09');
assert.equal(occursOn(annualWorkspace.events[0], parseDateKey('2026-11-09')), true);
assert.equal(occursOn(annualWorkspace.events[0], parseDateKey('2027-11-09')), true);
assert.equal(occursOn(annualWorkspace.events[0], parseDateKey('2027-11-10')), false);

const bounded = sanitizeCanvas({
  background: '#abcdef',
  elements: [{ id: 'outside', type: 'text', x: 9000, y: 9000, width: 5000, height: 5000, text: 'Hello' }]
}, { width: 480, height: 480 });
assert.equal(bounded.elements[0].width, 480);
assert.equal(bounded.elements[0].height, 480);
assert.equal(bounded.elements[0].x, 0);
assert.equal(bounded.elements[0].y, 0);

const transparent = sanitizeCanvas({
  elements: [{ id: 'transparent', type: 'cpu', background: 'transparent', textStrokeColor: '#ff00aa', textStrokeWidth: 99 }, { id: 'zoomed-video', type: 'video', mediaScale: 9 }]
}, { width: 480, height: 480 });
assert.equal(transparent.elements[0].background, 'transparent');
assert.equal(transparent.elements[0].textStrokeColor, '#ff00aa');
assert.equal(transparent.elements[0].textStrokeWidth, 30);
assert.equal(transparent.elements[0].labelColor, '#effaf5');
assert.equal(transparent.elements[0].labelFontSize, 10.6);
assert.equal(transparent.elements[0].labelStrokeColor, '#ff00aa');
assert.equal(transparent.elements[0].labelStrokeWidth, 30);
assert.equal(transparent.elements[1].mediaScale, 4);

const splitTypography = sanitizeCanvas({
  elements: [{
    id: 'split-tasks', type: 'tasks', color: '#ffffff', fontSize: 20,
    textStrokeColor: '#111111', textStrokeWidth: 1,
    labelColor: '#00ffaa', labelFontSize: 999,
    labelStrokeColor: '#0033ff', labelStrokeWidth: 2.5
  }]
}, { width: 960, height: 480 });
assert.equal(splitTypography.elements[0].color, '#ffffff');
assert.equal(splitTypography.elements[0].fontSize, 20);
assert.equal(splitTypography.elements[0].labelColor, '#00ffaa');
assert.equal(splitTypography.elements[0].labelFontSize, 400);
assert.equal(splitTypography.elements[0].labelStrokeColor, '#0033ff');
assert.equal(splitTypography.elements[0].labelStrokeWidth, 2.5);

const calendarCanvas = sanitizeCanvas({ elements: [{ id: 'reminders', type: 'calendar', maxItems: 50 }] }, { width: 960, height: 480 });
assert.equal(calendarCanvas.elements[0].type, 'calendar');
assert.equal(calendarCanvas.elements[0].maxItems, 20);
const agentCanvas = sanitizeCanvas({ elements: [{ id: 'codex', type: 'codex', maxItems: 8 }, { id: 'claude', type: 'claude' }] }, { width: 960, height: 480 });
assert.equal(agentCanvas.elements[0].type, 'codex');
assert.equal(agentCanvas.elements[0].title, 'CODEX');
assert.equal(agentCanvas.elements[1].type, 'claude');
assert.equal(agentCanvas.elements[1].title, 'CLAUDE CODE');
const migratedAgentCanvas = sanitizeCanvas({ elements: [{ id: 'legacy-agents', type: 'agents', title: 'AI AGENTS' }] }, { width: 960, height: 480 });
assert.equal(migratedAgentCanvas.elements[0].type, 'codex');
assert.equal(migratedAgentCanvas.elements[0].title, 'CODEX');

const hardwareCanvas = sanitizeCanvas({
  elements: [{ id: 'cpu-options', type: 'cpu', showUsage: false, showTemperature: true }]
}, { width: 960, height: 480 });
assert.equal(hardwareCanvas.elements[0].showUsage, false);
assert.equal(hardwareCanvas.elements[0].showTemperature, true);

console.log('Jungle Display protocol, profile and workspace checks passed.');
