const assert = require('node:assert/strict');
const { BAUD_RATE, buildCommand, isJungleDisplayPort } = require('../src/jungle-display');
const { sanitizeProfile, fitPreview } = require('../src/display-profile');
const { defaultCanvas, normalizeWorkspace, activeDisplay, sanitizeCanvas } = require('../src/workspace');
const { parseDateKey, occursOn, listOccurrences, pageItems, marqueeDuration } = require('../src/renderer/calendar');

assert.equal(BAUD_RATE, 2_000_000);
assert.equal(buildCommand(0x06).toString('hex'), '55aa0700060c01');
assert.equal(buildCommand(0x03, Buffer.from([100])).toString('hex'), '55aa080003646e01');
assert.equal(buildCommand(0x11).toString('hex'), '55aa0700111701');
assert.equal(isJungleDisplayPort({ vendorId: '33c3', productId: '7788' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '33C3', productId: '7792' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '0402', productId: '3922' }), false);

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

console.log('Jungle Display protocol, profile and workspace checks passed.');
