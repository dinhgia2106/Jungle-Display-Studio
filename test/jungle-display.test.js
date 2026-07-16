const assert = require('node:assert/strict');
const { BAUD_RATE, buildCommand, isJungleDisplayPort } = require('../src/jungle-display');
const { sanitizeProfile, fitPreview } = require('../src/display-profile');

assert.equal(BAUD_RATE, 2_000_000);
assert.equal(buildCommand(0x06).toString('hex'), '55aa0700060c01');
assert.equal(buildCommand(0x03, Buffer.from([100])).toString('hex'), '55aa080003646e01');
assert.equal(buildCommand(0x11).toString('hex'), '55aa0700111701');
assert.equal(isJungleDisplayPort({ vendorId: '33c3', productId: '7788' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '33C3', productId: '7792' }), true);
assert.equal(isJungleDisplayPort({ vendorId: '0402', productId: '3922' }), false);
assert.deepEqual(sanitizeProfile({ preset: 'custom', name: 'Portrait', width: 480, height: 800, rotation: 0 }), { preset: 'custom', name: 'Portrait', width: 480, height: 800, rotation: 0 });
assert.equal(sanitizeProfile({ width: 100, height: 9999 }).width, 240);
assert.equal(sanitizeProfile({ width: 100, height: 9999 }).height, 2160);
assert.deepEqual(fitPreview({ width: 1920, height: 480 }), { width: 960, height: 240 });
assert.deepEqual(fitPreview({ width: 480, height: 800 }), { width: 384, height: 640 });
console.log('Jungle Display protocol and profile checks passed.');