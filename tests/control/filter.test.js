import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig, discoverRoom } from "../../src/control/model.js";
import { controlCardConfig } from "../../src/control-config.js";
import { discoverRoom as overviewRoom } from "../../src/model.js";

const entries = [
  { entity_id: "light.ceiling" }, { entity_id: "switch.socket" }, { entity_id: "camera.room" },
  { entity_id: "scene.evening" }, { entity_id: "script.goodnight" }, { entity_id: "button.normal" },
  { entity_id: "button.identify", entity_category: "config", original_device_class: "identify" },
  { entity_id: "button.untagged_identify", original_device_class: "identify" },
  { entity_id: "select.power_on", entity_category: "config" },
  { entity_id: "update.firmware" }, { entity_id: "automation.arrival" },
  { entity_id: "sensor.voltage", entity_category: "diagnostic", original_device_class: "voltage" },
  { entity_id: "sensor.battery", entity_category: "diagnostic", original_device_class: "battery" },
  { entity_id: "sensor.signal", entity_category: "diagnostic", original_device_class: "signal_strength" },
  { entity_id: "sensor.temperature", original_device_class: "temperature" },
  { entity_id: "button.hidden", entity_category: "config", hidden_by: "user" },
  { entity_id: "button.disabled", entity_category: "config", disabled_by: "integration" },
  { entity_id: "button.outside", entity_category: "config", area_id: "other" },
].map(entry => ({ area_id: "room", device_id: "device", ...entry }));
const registries = { areas: [{ area_id: "room", name: "Room" }], devices: [{ id: "device", area_id: "room" }], entities: entries };
const states = Object.fromEntries(entries.map(entry => [entry.entity_id, { entity_id: entry.entity_id, state: "off", attributes: {} }]));
const ids = options => discoverRoom(validateConfig({ area: "room", include_hidden: false, ...options }), { states }, registries).entities.map(entity => entity.entity_id);

test("Everyday controls hides maintenance and automations while retaining normal controls and battery", () => {
  assert.deepEqual(new Set(ids()), new Set(["light.ceiling", "switch.socket", "camera.room", "scene.evening", "script.goodnight", "button.normal", "sensor.battery", "sensor.temperature"]));
  assert.equal(states["automation.arrival"].state, "off");
});

test("Always show overrides both purpose and diagnostic filters, without changing room membership", () => {
  const selected = ["button.identify", "update.firmware", "automation.arrival", "sensor.voltage", "button.hidden", "button.disabled", "button.outside", "button.missing"];
  const actual = ids({ always_show: selected });
  for (const id of selected.slice(0, 4)) assert(actual.includes(id));
  for (const id of selected.slice(4)) assert(!actual.includes(id));
});

test("entity, device, linked entity and group exclusions still win over Always show", () => {
  assert(!ids({ always_show: ["automation.arrival"], exclude_entities: ["automation.arrival"] }).includes("automation.arrival"));
  assert.deepEqual(ids({ always_show: ["sensor.battery", "button.identify"], exclude_devices: ["device"] }), []);
  const r = structuredClone(registries);
  r.entities.push({ entity_id: "light.alias", area_id: "room", options: { switch_as_x: { entity_id: "switch.socket" } } }, { entity_id: "light.group", area_id: "room" });
  const hass = { states: { ...states, "light.group": { entity_id: "light.group", state: "off", attributes: { entity_id: ["light.alias"] } } } };
  const room = discoverRoom(validateConfig({ area: "room", always_show: ["light.alias", "light.group"], exclude_entities: ["switch.socket"] }), hass, r);
  assert(!room.entities.some(entity => ["light.alias", "light.group"].includes(entity.entity_id)));
});

test("battery class metadata uses overrides and live state; voltage remains filtered", () => {
  const r = structuredClone(registries);
  r.entities.push({ entity_id: "sensor.live_battery", area_id: "room", entity_category: "diagnostic" });
  const hass = { states: { ...states, "sensor.live_battery": { entity_id: "sensor.live_battery", state: "0", attributes: { device_class: "battery", unit_of_measurement: "%" } } } };
  let room = discoverRoom(validateConfig({ area: "room" }), hass, r);
  assert(room.entities.some(entity => entity.entity_id === "sensor.live_battery"));
  r.entities.find(entry => entry.entity_id === "sensor.battery").device_class = "voltage";
  room = discoverRoom(validateConfig({ area: "room" }), hass, r);
  assert(!room.entities.some(entity => entity.entity_id === "sensor.battery"));
});

test("new entities are filtered automatically and the purpose filter can be disabled", () => {
  const r = structuredClone(registries);
  r.entities.push({ entity_id: "update.future", area_id: "room" }, { entity_id: "automation.future", area_id: "room" });
  assert(!discoverRoom(validateConfig({ area: "room" }), { states }, r).entities.some(entity => entity.entity_id.endsWith(".future")));
  const actual = ids({ everyday_controls: false, include_diagnostics: true });
  for (const id of ["button.identify", "update.firmware", "automation.arrival", "sensor.voltage"]) assert(actual.includes(id));
});

test("explicit entity sources also apply the automatic filter and preserve permitted ordering", () => {
  const options = { entities: ["update.firmware", "light.ceiling", "sensor.voltage", "automation.arrival", "sensor.battery"] };
  assert.deepEqual(ids(options), ["light.ceiling", "sensor.battery"]);
  assert.deepEqual(ids({ ...options, always_show: ["update.firmware", "sensor.voltage"] }), ["update.firmware", "light.ceiling", "sensor.voltage", "sensor.battery"]);
});

test("Always show settings are validated, cloned and kept separate from overview exclusions", () => {
  for (const bad of ["sensor.battery", [null], ["bad"], [" "]]) assert.throws(() => validateConfig({ area: "room", always_show: bad }));
  assert.throws(() => validateConfig({ area: "room", everyday_controls: "yes" }));
  const original = [" button.identify ", "button.identify"];
  const config = validateConfig({ area: "room", always_show: original });
  assert.deepEqual(config.always_show, ["button.identify"]);
  config.always_show.push("other.entity"); assert.equal(original.length, 2);
  const merged = { area: "room", overview_exclusions: { entities: ["light.ceiling"] }, control_options: { always_show: ["button.identify"] } };
  assert(discoverRoom(controlCardConfig(merged), { states }, registries).entities.some(entity => entity.entity_id === "light.ceiling"));
  assert(!overviewRoom(merged, registries, states).groups.lights.includes("light.ceiling"));
});
