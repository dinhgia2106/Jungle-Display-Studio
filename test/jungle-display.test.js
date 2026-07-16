const assert = require('node:assert/strict');
const { BAUD_RATE, buildCommand, isJungleDisplayPort } = require('../src/jungle-display');
const { sanitizeProfile, fitPreview } = require('../src/display-profile');
const { defaultCanvas, normalizeWorkspace, activeDisplay, sanitizeCanvas } = require('../src/workspace');

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
assert.equal(legacy.schemaVersion, 2);
assert.equal(legacy.startup.startHidden, false);
assert.equal(legacy.displays.length, 1);
assert.equal(activeDisplay(legacy).profile.width, 800);
assert.equal(activeDisplay(legacy).brightness, 75);
assert.equal(activeDisplay(legacy).canvas.elements[0].type, 'video');
assert.equal(activeDisplay(legacy).canvas.elements[0].source, 'C:/media/clip.mp4');
const hiddenStartup = normalizeWorkspace({ startup: { launchAtLogin: true, startHidden: true } });
assert.equal(hiddenStartup.startup.launchAtLogin, true);
assert.equal(hiddenStartup.startup.startHidden, true);

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

console.log('Jungle Display protocol, profile and workspace checks passed.');
