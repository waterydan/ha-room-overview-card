import test from "node:test";
import assert from "node:assert/strict";
import { lightCapabilities, lightColor, lightTemperatureBounds } from "../src/lights.js";

const light = attributes => ({ state: "off", attributes });
test("on/off lights never gain sliders from stale legacy feature flags", () => {
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["onoff"], supported_features: 19 })), { brightness: false, color: false, temperature: false });
});
test("modern color and white lights expose their supported controls while off", () => {
  for (const mode of ["hs", "rgb", "rgbw", "rgbww", "xy"]) {
    assert.deepEqual(lightCapabilities(light({ supported_color_modes: [mode], supported_features: 0 })), { brightness: true, color: true, temperature: false });
    assert.deepEqual(lightCapabilities(light({ supported_color_modes: [mode, "color_temp"], color_mode: "color_temp" })), { brightness: true, color: true, temperature: false });
  }
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["color_temp", "hs"], brightness: null, hs_color: null })), { brightness: true, color: true, temperature: false });
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["color_temp"] })), { brightness: true, color: false, temperature: true });
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["brightness"] })), { brightness: true, color: false, temperature: false });
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["rgb", "white"] })), { brightness: true, color: true, temperature: false });
});
test("legacy lights retain compatibility and absent states have no sliders", () => {
  assert.deepEqual(lightCapabilities(light({ supported_features: 19 })), { brightness: true, color: true, temperature: false });
  assert.deepEqual(lightCapabilities(light({ supported_features: 3 })), { brightness: true, color: false, temperature: true });
  assert.deepEqual(lightCapabilities(undefined), { brightness: false, color: false, temperature: false });
  assert.deepEqual(lightCapabilities(light({ supported_color_modes: ["unknown"] })), { brightness: false, color: false, temperature: false });
});
test("color readings use HA hue and saturation, or derive them from RGB", () => {
  assert.deepEqual(lightColor({ hs_color: [210, 65], rgb_color: [255, 0, 0] }), { hue: 210, saturation: 65 });
  assert.deepEqual(lightColor({ rgb_color: [0, 255, 0] }), { hue: 120, saturation: 100 });
  assert.deepEqual(lightColor({ rgbw_color: [0, 0, 255, 0] }), { hue: 240, saturation: 100 });
  assert.deepEqual(lightColor({ rgbww_color: [255, 0, 255, 0, 0] }), { hue: 300, saturation: 100 });
  assert.deepEqual(lightColor({ rgb_color: [255, 255, 255] }, { hue: 210, saturation: 100 }), { hue: 210, saturation: 0 });
});
test("missing or invalid color readings retain the last known hue", () => {
  const previous = { hue: 240, saturation: 80 };
  assert.equal(lightColor({ hs_color: null, rgb_color: null }, previous), previous);
  assert.equal(lightColor({ hs_color: [NaN, 100], rgb_color: [1] }, previous), previous);
  assert.deepEqual(lightColor({ hs_color: [400, -1] }), { hue: 360, saturation: 0 });
});
test("white temperature sliders follow device Kelvin bounds and legacy ranges", () => {
  assert.deepEqual(lightTemperatureBounds({ min_color_temp_kelvin: 1500, max_color_temp_kelvin: 9000 }), [1500, 9000]);
  assert.deepEqual(lightTemperatureBounds({ min_mireds: 153, max_mireds: 500 }), [2000, 6536]);
  assert.deepEqual(lightTemperatureBounds({ min_color_temp_kelvin: 9000, max_color_temp_kelvin: 1500 }), [2000, 6500]);
  assert.deepEqual(lightTemperatureBounds(), [2000, 6500]);
});
