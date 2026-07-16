const DEFAULT_PROFILE = {
  preset: '960x480',
  name: 'Jungle 5.5-inch Display',
  width: 960,
  height: 480,
  rotation: 180
};

function clamp(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sanitizeProfile(profile = {}) {
  return {
    preset: String(profile.preset || 'custom'),
    name: String(profile.name || 'Jungle Display').slice(0, 80),
    width: clamp(profile.width, 240, 3840, DEFAULT_PROFILE.width),
    height: clamp(profile.height, 240, 2160, DEFAULT_PROFILE.height),
    rotation: Number(profile.rotation) === 180 ? 180 : 0
  };
}

function fitPreview(profile) {
  const safe = sanitizeProfile(profile);
  const scale = Math.min(960 / safe.width, 640 / safe.height, 1);
  return {
    width: Math.max(320, Math.round(safe.width * scale)),
    height: Math.max(240, Math.round(safe.height * scale))
  };
}

module.exports = { DEFAULT_PROFILE, clamp, sanitizeProfile, fitPreview };