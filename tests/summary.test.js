import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, discoverRoom, simpleGroupSummary, groupPowerSensors } from "../src/model.js";

const entry = (id, fields = {}) => ({ entity_id: id, area_id: "one", ...fields });
const state = (value, attributes = {}) => ({ state: String(value), attributes });
const registry = entities => ({ areas: [{ area_id: "one" }], devices: [], entities });
function summary(group, entities, states, extra = {}) {
  const config = normalizeConfig({ area: "one", mode: "simple", group, ...extra });
  const registries = registry(entities), model = discoverRoom(config, registries, states);
  return simpleGroupSummary(config, model, registries, states, "en");
}

test("grid sizing supersedes old pixel settings while optional text validates", () => {
  const defaultConfig = normalizeConfig({ area: "one" });
  assert.equal(defaultConfig.simple_size, undefined); assert.equal(defaultConfig.full_height, undefined);
  assert.equal(defaultConfig.show_room_title, undefined); assert.equal(defaultConfig.show_state, undefined);
  const input = { area: "one", grid_options: { columns: 3, rows: 2 }, simple_size: 144, full_height: 320, show_room_title: true, show_state: false };
  const sized = normalizeConfig(input);
  assert.deepEqual(sized.grid_options, { columns: 3, rows: 2 });
  assert.equal(sized.simple_size, undefined); assert.equal(sized.full_height, undefined);
  assert.equal(input.simple_size, 144); assert.equal(input.full_height, 320);
  for (const key of ["show_room_title", "show_state"]) assert.throws(() => normalizeConfig({ area: "one", [key]: "true" }), /true or false/);
});

test("device summaries count on devices and recognise open and unlocked states", () => {
  assert.equal(summary("lights", [entry("light.a"), entry("light.b"), entry("light.c")], { "light.a": state("on"), "light.b": state("on"), "light.c": state("unavailable") }), "2 on");
  assert.equal(summary("lights", [], {}), "No devices");
  assert.equal(summary("lights", [entry("light.a")], {}), "Unavailable");
  assert.equal(summary("covers", [entry("cover.a")], { "cover.a": state("opening") }), "1 open");
  assert.equal(summary("locks", [entry("lock.a")], { "lock.a": state("unlocked") }), "1 unlocked");
});

test("media summaries show a playing track and artist, prioritising playback over paused players", () => {
  const entities = [entry("media_player.a"), entry("media_player.b")];
  const states = { "media_player.a": state("paused", { media_title: "Old song" }), "media_player.b": state("playing", { media_title: "Current song", media_artist: "Artist" }) };
  assert.equal(summary("media", entities, states), "Current song · Artist · +1 more");
  states["media_player.a"].state = "off";
  assert.equal(summary("media", entities, states), "Current song · Artist");
  states["media_player.b"].state = "paused";
  assert.equal(summary("media", entities, states), "Paused · Current song · Artist");
  states["media_player.b"].state = "buffering";
  assert.equal(summary("media", entities, states), "Buffering · Current song · Artist");
});

test("idle and off players never present stale tracks as currently playing", () => {
  const entities = [entry("media_player.a")];
  for (const [value, expected] of [["idle", "Idle"], ["off", "Off"], ["on", "1 active"], ["unavailable", "Unavailable"]]) {
    assert.equal(summary("media", entities, { "media_player.a": state(value, { media_title: "Stale song" }) }), expected);
  }
  assert.equal(summary("media", entities, { "media_player.a": state("playing") }), "1 playing");
});

const plugs = [entry("switch.a", { device_id: "a" }), entry("switch.b", { device_id: "b" }), entry("sensor.a", { device_id: "a", original_device_class: "power" }), entry("sensor.b", { device_id: "b", original_device_class: "power" }), entry("sensor.house", { original_device_class: "power" })];
const plugStates = { "switch.a": state("on"), "switch.b": state("on"), "sensor.a": state(19, { unit_of_measurement: "W" }), "sensor.b": state(.029, { unit_of_measurement: "kW" }), "sensor.house": state(1000, { unit_of_measurement: "W" }) };

test("power totals use switch device sensors and convert kW to watts, omitting unrelated meters", () => {
  assert.equal(summary("switches", plugs, plugStates), "2 on (48 W)");
  assert.equal(summary("switches", plugs, { ...plugStates, "switch.b": state("off") }), "1 on (48 W)");
});

test("automatic power choices omit overlapping meters and partially selected multi-channel devices", () => {
  const duplicates = [...plugs, entry("sensor.a_total", { device_id: "a", original_device_class: "power" })];
  assert.equal(summary("switches", duplicates, plugStates), "2 on (29 W measured)");
  const channels = [...plugs, entry("switch.a_second", { device_id: "a", area_id: "two" })];
  assert.equal(summary("switches", channels, plugStates), "2 on (29 W measured)");
});

test("missing, excluded or invalid power readings do not become zero or an unqualified total", () => {
  assert.equal(summary("switches", plugs, { ...plugStates, "sensor.b": state("unavailable") }), "2 on (19 W measured)");
  assert.equal(summary("switches", plugs, plugStates, { exclude_entities: ["sensor.b"] }), "2 on (19 W measured)");
  assert.equal(summary("switches", plugs, { ...plugStates, "sensor.a": state(19, { unit_of_measurement: "kWh" }), "sensor.b": state("unavailable") }), "2 on");
  assert.equal(summary("switches", plugs, plugStates, { exclude_devices: ["b"] }), "1 on (19 W)");
});

test("explicit power choices support helpers, deduplicate readings and allow disabling wattage", () => {
  assert.equal(summary("switches", plugs, plugStates, { power_sensors: ["sensor.house", "sensor.house"] }), "2 on (1,000 W)");
  assert.equal(summary("switches", plugs, plugStates, { power_sensors: [] }), "2 on");
  assert.equal(summary("switches", plugs, plugStates, { power_sensors: ["sensor.house"], exclude_entities: ["sensor.house"] }), "2 on");
  assert.throws(() => normalizeConfig({ area: "one", power_sensors: ["switch.a"] }), /sensor entity IDs/);
  const config = normalizeConfig({ area: "one", group: "switches" }), registries = registry(plugs);
  assert.deepEqual(groupPowerSensors(config, discoverRoom(config, registries, plugStates), registries, plugStates).entities, ["sensor.a", "sensor.b"]);
});
