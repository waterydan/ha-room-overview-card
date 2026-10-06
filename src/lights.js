const DIMMABLE_MODES = new Set(["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy", "white"]);
const COLOR_MODES = new Set(["hs", "rgb", "rgbw", "rgbww", "xy"]);

export function lightCapabilities(state) {
  const attributes = state?.attributes ?? {};
  const modes = attributes.supported_color_modes;
  const modern = Array.isArray(modes) && modes.length > 0;
  const features = attributes.supported_features ?? 0;
  const color = modern ? modes.some(mode => COLOR_MODES.has(mode)) : !!(features & 16);
  return {
    brightness: modern ? modes.some(mode => DIMMABLE_MODES.has(mode)) : !!(features & 1),
    color,
    temperature: !color && (modern ? modes.includes("color_temp") : !!(features & 2)),
  };
}

export function lightColor(attributes = {}, fallback = { hue: 0, saturation: 100 }) {
  const hs = attributes.hs_color;
  if (Array.isArray(hs) && hs.length >= 2 && hs.every(Number.isFinite)) {
    return { hue: Math.max(0, Math.min(360, hs[0])), saturation: Math.max(0, Math.min(100, hs[1])) };
  }
  const rgb = attributes.rgb_color ?? attributes.rgbw_color ?? attributes.rgbww_color;
  if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.slice(0, 3).every(Number.isFinite)) return fallback;
  const [r, g, b] = rgb.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel)) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
  if (!delta) return { hue: fallback.hue, saturation: 0 };
  const sector = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation: delta / high * 100 };
}

export function lightTemperatureBounds(attributes = {}) {
  const warm = attributes.min_color_temp_kelvin ?? (attributes.max_mireds > 0 ? Math.round(1000000 / attributes.max_mireds) : 2000);
  const cool = attributes.max_color_temp_kelvin ?? (attributes.min_mireds > 0 ? Math.round(1000000 / attributes.min_mireds) : 6500);
  return Number.isFinite(warm) && Number.isFinite(cool) && warm > 0 && cool > warm ? [warm, cool] : [2000, 6500];
}
