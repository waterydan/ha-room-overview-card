import test from "node:test";
import assert from "node:assert/strict";
import { entitiesCardConfig, tileCardConfig, pictureCardConfig } from "../../src/control/native-config.js";
import { validateConfig } from "../../src/control/model.js";
const entity = (domain, attributes = {}) => ({ entity_id: `${domain}.example`, name: "Readable label", state: "off", attributes });
test("compact native entity rows preserve exact targets, names, and disabled group toggles", () => {
  const config = entitiesCardConfig([entity("light"), entity("switch")]);
  assert.equal(config.type, "entities"); assert.equal(config.show_header_toggle, false);
  assert.deepEqual(config.entities, [{ entity: "light.example", name: "Readable label" }, { entity: "switch.example", name: "Readable label" }]);
  assert.equal(validateConfig({ area: "room" }).layout, "compact");
  assert.equal(validateConfig({ area: "room", layout: "grouped" }).layout, "compact");
  assert.equal(validateConfig({ area: "room" }).camera_layout, "carousel");
});
test("native climate, cover and fan features follow the entity's capabilities", () => {
  assert.deepEqual(tileCardConfig(entity("climate", { supported_features: 1, hvac_modes: ["off", "heat"] })).features.map(feature => feature.type), ["target-temperature", "climate-hvac-modes"]);
  assert.deepEqual(tileCardConfig(entity("cover", { supported_features: 7 })).features.map(feature => feature.type), ["cover-open-close", "cover-position"]);
  assert.equal(tileCardConfig(entity("cover", { supported_features: 0 })).features, undefined);
  assert.deepEqual(tileCardConfig(entity("fan", { supported_features: 1 })).features.map(feature => feature.type), ["toggle", "fan-speed"]);
});
test("dimming and playback are offered only when supported; native more-info remains available", () => {
  assert.deepEqual(tileCardConfig(entity("light", { supported_color_modes: ["onoff"] })).features, [{ type: "toggle" }]);
  assert.deepEqual(tileCardConfig(entity("light", { supported_color_modes: ["color_temp"] })).features.map(feature => feature.type), ["toggle", "light-brightness"]);
  assert.deepEqual(tileCardConfig(entity("media_player", { supported_features: 16389 })).features.map(feature => feature.type), ["media-player-playback", "media-player-volume-slider"]);
  assert.equal(tileCardConfig(entity("media_player")).features, undefined);
  assert.deepEqual(tileCardConfig(entity("lock")).tap_action, { action: "more-info" });
});
test("cameras use native picture-entity configuration and never carry stored access tokens", () => {
  const config = pictureCardConfig(entity("camera", { entity_picture: "/api/camera_proxy/camera.example?token=private" }));
  assert.equal(config.type, "picture-entity"); assert.equal(config.entity, "camera.example");
  assert.equal(config.aspect_ratio, "16:9"); assert.equal(JSON.stringify(config).includes("private"), false);
});
