import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, discoverRoom, groupStatus, roomReading, warningsFor, thresholdsFor, safeImageUrl } from "../src/model.js";

const entry = (id, fields = {}) => ({ entity_id: id, area_id: "one", ...fields });
const state = (value, attrs = {}) => ({ state: String(value), attributes: attrs });
const registry = (entities, fields = {}) => ({ areas: [{ area_id: "one", name: "Test room" }], devices: [], entities, ...fields });
const config = { area: "one" };

test("entity area overrides the device area, including an explicitly unassigned entity", () => {
  const entities = [entry("light.inherited", { area_id: null, device_id: "a" }), entry("light.override", { area_id: "two", device_id: "a" }), entry("light.unassigned", { area_id: "", device_id: "a" })];
  const model = discoverRoom(config, registry(entities, { devices: [{ id: "a", area_id: "one" }] }));
  assert.deepEqual(model.groups.lights, ["light.inherited"]);
});
test("hidden, disabled, diagnostic and config entities are excluded", () => {
  const model = discoverRoom(config, registry([entry("switch.normal"), entry("switch.hidden", { hidden_by: "user" }), entry("switch.disabled", { disabled_by: "integration" }), entry("switch.config", { entity_category: "config" }), entry("switch.diagnostic", { entity_category: "diagnostic" })]));
  assert.deepEqual(model.groups.switches, ["switch.normal"]);
});
test("converted light and fan suppress their source switch even when the source is visible", () => {
  const model = discoverRoom(config, registry([entry("switch.source"), entry("light.converted", { options: { switch_as_x: { entity_id: "switch.source" } } }), entry("switch.fan_source"), entry("fan.converted", { options: { switch_as_x: { entity_id: "switch.fan_source" } } })]));
  assert.deepEqual(model.groups.switches, []); assert.deepEqual(model.groups.lights, ["light.converted"]); assert.deepEqual(model.groups.fans, ["fan.converted"]);
});
test("a native group and its members do not appear twice", () => {
  for (const key of ["entity_id", "group_entities"]) {
    const model = discoverRoom(config, registry([entry("light.aggregate"), entry("light.ceiling"), entry("light.lamp")]), { "light.aggregate": state("on", { [key]: ["light.ceiling", "light.lamp"] }) });
    assert.deepEqual(model.groups.lights, ["light.ceiling", "light.lamp"]);
  }
});
test("sensor classes split contacts and occupancy from unrelated binary sensors", () => {
  const entities = [entry("binary_sensor.door", { original_device_class: "door" }), entry("binary_sensor.window", { original_device_class: "window" }), entry("binary_sensor.motion", { original_device_class: "motion" }), entry("binary_sensor.presence", { original_device_class: "occupancy" }), entry("binary_sensor.battery", { original_device_class: "battery" })];
  const model = discoverRoom(config, registry(entities));
  assert.deepEqual(model.groups.contacts, ["binary_sensor.door", "binary_sensor.window"]); assert.deepEqual(model.groups.occupancy, ["binary_sensor.motion", "binary_sensor.presence"]);
});
test("state device class and explicit registry override take precedence", () => {
  const model = discoverRoom(config, registry([entry("binary_sensor.reclassed", { device_class: "window", original_device_class: "motion" }), entry("binary_sensor.live")]), { "binary_sensor.live": state("off", { device_class: "motion" }) });
  assert.deepEqual(model.groups.contacts, ["binary_sensor.reclassed"]); assert.deepEqual(model.groups.occupancy, ["binary_sensor.live"]);
});
test("automatic defaults reserve four control slots and show read-only groups separately", () => {
  const model = discoverRoom(config, registry([entry("light.a"), entry("binary_sensor.b", { device_class: "door" }), entry("binary_sensor.c", { device_class: "motion" }), entry("fan.d"), entry("cover.e"), entry("switch.f")]));
  assert.deepEqual(model.tiles.map(t => t.kind), ["lights", "fans", "covers", "switches"]); assert.equal(model.available.length, 6);
  assert.deepEqual(model.indicators.map(t => t.kind), ["contacts", "occupancy"]);
});
test("four saved choices preserve ordering while None and read-only groups are omitted", () => {
  const model = discoverRoom({ ...config, tiles: ["switches", "none", "lights", "contacts"] }, registry([entry("light.a"), entry("switch.b"), entry("binary_sensor.door", { device_class: "door" }), entry("binary_sensor.motion", { device_class: "motion" })]));
  assert.deepEqual(model.tiles.map(t => [t.slot, t.kind]), [[0, "switches"], [2, "lights"]]);
  assert.deepEqual(model.indicators.map(t => t.kind), ["contacts", "occupancy"]);
});
test("zero tiles is valid, but duplicate and fifth tiles are rejected", () => {
  assert.deepEqual(normalizeConfig({ ...config, tiles: [] }).tiles, []);
  const model = discoverRoom({ ...config, tiles: [] }, registry([entry("binary_sensor.motion", { device_class: "motion" }), entry("light.a")]));
  assert.equal(model.tiles.length, 0); assert.deepEqual(model.indicators.map(t => t.kind), ["occupancy"]);
  assert.throws(() => normalizeConfig({ ...config, tiles: ["lights", "lights"] }), /different/);
  assert.throws(() => normalizeConfig({ ...config, tiles: Array(5).fill("none") }), /four/);
  assert.throws(() => normalizeConfig({ ...config, tiles: ["unknown"] }), /four/);
});
test("light switch overrides apply only inside the selected room and respect exclusions", () => {
  const model = discoverRoom({ ...config, light_switches: ["switch.lamp", "switch.outside"], exclude_entities: ["light.excluded"] }, registry([entry("switch.lamp"), entry("switch.outside", { area_id: "two" }), entry("light.excluded"), entry("switch.other")]));
  assert.deepEqual(model.groups.lights, ["switch.lamp"]); assert.deepEqual(model.groups.switches, ["switch.other"]);
});
test("device exclusions remove siblings and new entities without affecting another card", () => {
  const r = registry([
    entry("light.ceiling", { device_id: "excluded" }),
    entry("binary_sensor.motion", { device_id: "excluded", device_class: "motion" }),
    entry("sensor.temperature", { device_id: "excluded", device_class: "temperature" }),
    entry("sensor.humidity", { device_id: "excluded", device_class: "humidity" }),
    entry("light.lamp", { device_id: "allowed" }), entry("switch.helper"),
  ], { devices: [{ id: "excluded", area_id: "one" }, { id: "allowed", area_id: "one" }] });
  const excludedConfig = { ...config, exclude_devices: ["excluded"] };
  const model = discoverRoom(excludedConfig, r);
  assert.deepEqual(model.groups.lights, ["light.lamp"]);
  assert.deepEqual(model.groups.switches, ["switch.helper"]);
  assert.deepEqual(model.sensors, { temperature: [], humidity: [] });
  assert.deepEqual(model.indicators, []);
  assert.equal(model.roomEntities.length, 6);
  r.entities.push(entry("fan.new", { area_id: null, device_id: "excluded" }));
  assert.deepEqual(discoverRoom(excludedConfig, r).groups.fans, []);
  assert.deepEqual(discoverRoom(config, r).groups.fans, ["fan.new"]);
  assert.deepEqual(discoverRoom(config, r).groups.lights, ["light.ceiling", "light.lamp"]);
});
test("entity-only exclusions keep other entities belonging to the same device", () => {
  const r = registry([entry("binary_sensor.motion", { device_id: "a", device_class: "motion" }), entry("sensor.temperature", { device_id: "a", device_class: "temperature" })]);
  const model = discoverRoom({ ...config, exclude_entities: ["sensor.temperature"] }, r);
  assert.deepEqual(model.groups.occupancy, ["binary_sensor.motion"]);
  assert.deepEqual(model.sensors.temperature, []);
});
test("exclusions remove the final tile and sensor indicator and restore automatic choices", () => {
  const r = registry([entry("light.a", { device_id: "a" }), entry("binary_sensor.door", { device_id: "a", device_class: "door" })]);
  const excluded = discoverRoom({ ...config, exclude_devices: ["a"], tiles: ["lights"] }, r);
  assert.deepEqual(excluded.tiles, []); assert.deepEqual(excluded.indicators, []);
  const restored = discoverRoom({ ...config, tiles: ["lights"] }, r);
  assert.deepEqual(restored.tiles.map(tile => tile.kind), ["lights"]);
  assert.deepEqual(restored.indicators.map(indicator => indicator.kind), ["contacts"]);
});
test("groups cannot bring back excluded members, including nested groups and cycles", () => {
  const r = registry([entry("light.parent"), entry("light.nested"), entry("light.blocked", { device_id: "a" }), entry("light.allowed")]);
  const states = {
    "light.parent": state("on", { entity_id: ["light.nested"] }),
    "light.nested": state("on", { group_entities: ["light.blocked", "light.parent"] }),
    "light.blocked": state("on"), "light.allowed": state("off"),
  };
  assert.deepEqual(discoverRoom({ ...config, exclude_devices: ["a"] }, r, states).groups.lights, ["light.allowed"]);
  // Hiding the group itself should still leave its allowed members individually available.
  assert.deepEqual(discoverRoom({ ...config, exclude_entities: ["light.parent"] }, r, states).groups.lights, ["light.allowed", "light.blocked"]);
});
test("converted entities and their source switches cannot bypass an exclusion", () => {
  const r = registry([entry("switch.source", { device_id: "a" }), entry("light.converted", { options: { switch_as_x: { entity_id: "switch.source" } } }), entry("light.allowed")]);
  for (const exclusions of [{ exclude_devices: ["a"] }, { exclude_entities: ["light.converted"] }, { exclude_entities: ["switch.source"] }]) {
    const model = discoverRoom({ ...config, ...exclusions }, r);
    assert.deepEqual(model.groups.lights, ["light.allowed"]); assert.deepEqual(model.groups.switches, []);
  }
});
test("excluded preferred and overridden sensors fall back to eligible readings", () => {
  const r = registry([entry("sensor.preferred", { device_id: "a", device_class: "temperature", area_id: "two" }), entry("sensor.allowed", { device_class: "temperature" })], {
    areas: [{ area_id: "one", temperature_entity_id: "sensor.preferred" }],
  });
  const states = { "sensor.preferred": state(50, { unit_of_measurement: "°C" }), "sensor.allowed": state(21, { unit_of_measurement: "°C" }) };
  for (const exclusions of [{ exclude_devices: ["a"] }, { exclude_entities: ["sensor.preferred"] }, { exclude_devices: ["a"], temperature_sensor: "sensor.preferred" }]) {
    const cfg = { ...config, ...exclusions }, model = discoverRoom(cfg, r, states);
    const reading = roomReading("temperature", cfg, model, states);
    assert.equal(reading.value, 21); assert.deepEqual(reading.entities, ["sensor.allowed"]);
    assert.deepEqual(warningsFor({ temperature: reading }, thresholdsFor(cfg)), []);
  }
  const cfg = { ...config, exclude_devices: ["a"], exclude_entities: ["sensor.allowed"] };
  assert.deepEqual(roomReading("temperature", cfg, discoverRoom(cfg, r, states), states), { value: null, entities: [], unit: "°C" });
  assert.equal(roomReading("temperature", { ...cfg, temperature_sensor: "none" }, discoverRoom(cfg, r, states), states), null);
});
test("an excluded nested aggregate cannot supply an overridden sensor reading", () => {
  const r = registry([entry("sensor.aggregate", { device_class: "humidity" }), entry("sensor.blocked", { device_id: "a", device_class: "humidity" }), entry("sensor.allowed", { device_class: "humidity" })]);
  const cfg = { ...config, exclude_devices: ["a"], humidity_sensor: "sensor.aggregate" };
  const states = { "sensor.aggregate": state(99, { entity_id: ["sensor.blocked"], unit_of_measurement: "%" }), "sensor.allowed": state(45, { unit_of_measurement: "%" }) };
  const reading = roomReading("humidity", cfg, discoverRoom(cfg, r, states), states);
  assert.equal(reading.value, 45); assert.deepEqual(reading.entities, ["sensor.allowed"]);
});
test("exclusion lists validate IDs, remove duplicates and preserve missing saved choices", () => {
  const cfg = normalizeConfig({ ...config, exclude_devices: [" missing ", "missing"], exclude_entities: ["light.missing"] });
  assert.deepEqual(cfg.exclude_devices, ["missing"]);
  assert.deepEqual(cfg.exclude_entities, ["light.missing"]);
  assert.deepEqual(discoverRoom(cfg, registry([entry("light.allowed")])).groups.lights, ["light.allowed"]);
  for (const value of ["device", [null], [1], [" "]]) assert.throws(() => normalizeConfig({ ...config, exclude_devices: value }), /device IDs/);
  assert.throws(() => normalizeConfig({ ...config, exclude_entities: [false] }), /entity IDs/);
  assert.deepEqual(normalizeConfig({ ...config, exclude_devices: [] }).exclude_devices, []);
});
test("active aggregation preserves partial and total unavailable states", () => {
  const ids = ["light.a", "light.b"];
  const partial = groupStatus("lights", ids, { "light.a": state("on"), "light.b": state("unavailable") });
  assert.equal(partial.active, true); assert.equal(partial.unavailable, 1);
  const unknown = groupStatus("lights", ids, { "light.a": state("off") });
  assert.equal(unknown.active, false); assert.equal(unknown.unavailable, 1); assert.match(unknown.status, /unavailable/);
  assert.equal(groupStatus("lights", ids, {}).status, "Unavailable");
});
test("covers and locks recognise transitional states", () => {
  assert.equal(groupStatus("covers", ["cover.a"], { "cover.a": state("opening") }).active, true);
  assert.equal(groupStatus("locks", ["lock.a"], { "lock.a": state("locked") }).active, false);
  assert.equal(groupStatus("contacts", ["binary_sensor.a"], { "binary_sensor.a": state("unknown") }).unavailable, 1);
});
test("area preferred sensor wins over automatic candidates", () => {
  const r = registry([entry("sensor.a", { device_class: "temperature" })], { areas: [{ area_id: "one", temperature_entity_id: "sensor.preferred" }] });
  const states = { "sensor.a": state(35, { unit_of_measurement: "°C" }), "sensor.preferred": state(21, { unit_of_measurement: "°C" }) };
  assert.equal(roomReading("temperature", config, discoverRoom(config, r, states), states).value, 21);
});
test("automatic median normalises Celsius and Fahrenheit before combining", () => {
  const r = registry([entry("sensor.a", { device_class: "temperature" }), entry("sensor.b", { device_class: "temperature" }), entry("sensor.c", { device_class: "temperature" }), entry("sensor.d", { device_class: "temperature" })]);
  const states = { "sensor.a": state(20, { unit_of_measurement: "°C" }), "sensor.b": state(77, { unit_of_measurement: "°F" }), "sensor.c": state("unavailable"), "sensor.d": state(301, { unit_of_measurement: "K" }) };
  const model = discoverRoom(config, r, states);
  assert.equal(roomReading("temperature", config, model, states, "°C").value, 22.5); assert.equal(roomReading("temperature", config, model, states, "°F").value, 72.5);
});
test("sensor override and explicit None work, without masking an unavailable preferred sensor", () => {
  const r = registry([entry("sensor.a", { device_class: "humidity" })], { areas: [{ area_id: "one", humidity_entity_id: "sensor.missing" }] });
  const states = { "sensor.a": state(45, { unit_of_measurement: "%" }) }, model = discoverRoom(config, r, states);
  assert.equal(roomReading("humidity", config, model, states).value, null);
  assert.equal(roomReading("humidity", { ...config, humidity_sensor: "sensor.a" }, model, states).value, 45);
  assert.equal(roomReading("humidity", { ...config, humidity_sensor: "none" }, model, states), null);
});
test("all four warning conditions work and limits are strict", () => {
  const thresholds = thresholdsFor(config);
  assert.deepEqual(thresholds, { temperature_low: 12, temperature_high: 30, humidity_low: 30, humidity_high: 75 });
  const high = warningsFor({ temperature: { value: 31, entities: ["sensor.t"] }, humidity: { value: 76, entities: ["sensor.h"] } }, thresholds);
  assert.deepEqual(high.map(w => w.key), ["temperature_high", "humidity_high"]);
  const low = warningsFor({ temperature: { value: 11, entities: [] }, humidity: { value: 29, entities: [] } }, thresholds);
  assert.deepEqual(low.map(w => w.key), ["temperature_low", "humidity_low"]);
  assert.equal(warningsFor({ temperature: { value: 12 }, humidity: { value: 30 } }, thresholds).length, 0);
  assert.equal(warningsFor({ temperature: { value: 30 }, humidity: { value: 75 } }, thresholds).length, 0);
  assert.equal(warningsFor({ temperature: { value: 29 }, humidity: { value: 70 } }, thresholds).length, 0);
});
test("unknown readings and disabled thresholds produce no misleading warning", () => {
  assert.deepEqual(warningsFor({ temperature: { value: null }, humidity: null }, thresholdsFor(config)), []);
  assert.deepEqual(warningsFor({ temperature: { value: 50 } }, thresholdsFor({ ...config, thresholds: { temperature_high: null } })), []);
});
test("Fahrenheit thresholds and invalid config are handled", () => {
  assert.equal(thresholdsFor(config, "°F").temperature_low, 53.6);
  assert.equal(thresholdsFor(config, "°F").temperature_high, 86);
  assert.throws(() => normalizeConfig({ ...config, thresholds: { humidity_low: -1 } }), /0 and 100/);
  assert.throws(() => normalizeConfig({ ...config, thresholds: { temperature_low: 30, temperature_high: 20 } }), /below/);
  assert.throws(() => normalizeConfig({ ...config, thresholds: { humidity_high: "60" } }), /numbers/);
});
test("custom room image URLs accept local and HTTPS images and reject unsafe schemes", () => {
  assert.equal(safeImageUrl("javascript:alert(1)"), ""); assert.equal(safeImageUrl("data:image/svg+xml,<svg/>"), "");
  assert.equal(safeImageUrl("/local/photo.jpg"), "/local/photo.jpg"); assert.equal(safeImageUrl("https://example.com/photo.jpg"), "https://example.com/photo.jpg");
});

test("unsupported inherited names cannot be selected as groups or thresholds", () => {
  assert.throws(() => normalizeConfig({ ...config, tiles: ["constructor"] }), /device groups/);
  assert.throws(() => normalizeConfig({ ...config, thresholds: { constructor: 10 } }), /numbers/);
  assert.equal(groupStatus("lights", [], {}).status, "No devices");
});
