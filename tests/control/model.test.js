import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig, discoverRoom } from "../../src/control/model.js";
const e = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
const registry = { areas: [{ area_id: "room", name: "Living room" }, { area_id: "other", name: "Other" }], devices: [{ id: "d", area_id: "room" }], entities: [
  { entity_id: "light.a", device_id: "d" }, { entity_id: "light.b", device_id: "d", area_id: "other" },
  { entity_id: "sensor.diagnostic", device_id: "d", entity_category: "diagnostic" },
  { entity_id: "sensor.hidden", area_id: "room", hidden_by: "user" },
  { entity_id: "sensor.disabled", area_id: "room", disabled_by: "user" },
  { entity_id: "vacuum.robot", area_id: "room" }
] };
const hass = { states: { "light.a": e("light.a", "on"), "vacuum.robot": e("vacuum.robot", "docked") } };
test("configuration rejects malformed sources and ambiguous layouts", () => {
  for (const config of [{}, { area: "" }, { entities: "light.a" }, { entities: ["bad"] }, { area: "room", layout: "list" }, { area: "room", include_hidden: "yes" }]) assert.throws(() => validateConfig(config));
  assert.deepEqual(validateConfig({ entities: ["light.a", "light.a"] }).entities, ["light.a"]);
});
test("auto discovery uses entity area first, includes diagnostics when requested, and ignores disabled entries", () => {
  const room = discoverRoom(validateConfig({ area: "Living room", include_diagnostics: true }), hass, registry);
  assert.equal(room.area.area_id, "room");
  assert.deepEqual(new Set(room.entities.map(x => x.entity_id)), new Set(["light.a", "sensor.diagnostic", "sensor.hidden", "vacuum.robot"]));
  assert.equal(room.entities.find(x => x.entity_id === "sensor.hidden").state, "unavailable");
});
test("explicit lists are authoritative and preserve order, including missing entities", () => {
  const room = discoverRoom(validateConfig({ area: "room", entities: ["light.b", "sensor.disabled", "light.a"] }), hass, registry);
  assert.deepEqual(room.entities.map(x => x.entity_id), ["light.b", "sensor.disabled", "light.a"]);
});
test("entity/device exclusions and opt-out diagnostic/hidden filters apply", () => {
  assert.deepEqual(discoverRoom(validateConfig({ area: "room", include_hidden: false, include_diagnostics: false, exclude_entities: ["vacuum.robot"] }), hass, registry).entities.map(x => x.entity_id), ["light.a"]);
  assert(!discoverRoom(validateConfig({ area: "room", exclude_devices: ["d"] }), hass, registry).entities.some(x => x.entity_id === "light.a"));
});
test("frontend registry caches can discover rooms before a websocket fetch", () => {
  const cached = { ...hass, areas: { room: registry.areas[0] }, devices: { d: registry.devices[0] }, entities: Object.fromEntries(registry.entities.map(x => [x.entity_id, x])) };
  assert.equal(discoverRoom(validateConfig({ area: "room" }), cached).entities.length, 3);
  assert.equal(discoverRoom(validateConfig({ area: "missing" }), cached).entities.length, 0);
});
