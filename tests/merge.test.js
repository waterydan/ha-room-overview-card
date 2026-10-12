import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, discoverRoom } from "../src/model.js";
import { discoverRoom as discoverControls } from "../src/control/model.js";
import { controlCardConfig } from "../src/control-config.js";
import { migrateExclusions } from "../src/exclusions.js";

const registries = {
  areas: [{ area_id: "room", name: "Living room" }], devices: [{ id: "device", area_id: "room" }],
  entities: [
    { entity_id: "light.a", device_id: "device" }, { entity_id: "sensor.temperature", device_id: "device" },
    { entity_id: "light.b", area_id: "room" }, { entity_id: "light.group", area_id: "room" },
    { entity_id: "switch.source", area_id: "room" },
    { entity_id: "light.alias", area_id: "room", options: { switch_as_x: { entity_id: "switch.source" } } },
  ],
};
const states = Object.fromEntries(registries.entities.map(entry => [entry.entity_id, { entity_id: entry.entity_id, state: "on", attributes: entry.entity_id === "light.group" ? { entity_id: ["light.a", "light.b"] } : {} }]));
const controls = config => discoverControls(controlCardConfig(config), { states }, registries).entities.map(entity => entity.entity_id);
const overview = config => discoverRoom(normalizeConfig(config), registries, states).groups.lights;

test("overview exclusions never hide the device or its sensors from controls", () => {
  const config = { area: "room", overview_exclusions: { devices: ["device"] }, control_exclusions: { entities: ["light.b"] } };
  assert(!overview(config).includes("light.a"));
  assert(overview(config).includes("light.b"));
  assert(controls(config).includes("light.a"));
  assert(controls(config).includes("sensor.temperature"));
  assert(!controls(config).includes("light.b"));
});

test("entity and device exclusions remain independent when a new sibling is added", () => {
  const config = { area: "room", control_exclusions: { devices: ["device"] } };
  assert(overview(config).includes("light.a"));
  assert(!controls(config).includes("light.a"));
  const registry = structuredClone(registries);
  registry.entities.push({ entity_id: "light.future", device_id: "device" });
  assert(!discoverControls(controlCardConfig(config), { states }, registry).entities.some(entity => entity.entity_id === "light.future"));
  assert(discoverRoom(normalizeConfig(config), registry, states).groups.lights.includes("light.future"));
});

test("aliases and aggregate entities cannot bypass control exclusions", () => {
  const config = { area: "room", control_exclusions: { entities: ["light.a", "switch.source"] } };
  for (const id of ["light.a", "light.group", "switch.source", "light.alias"]) assert(!controls(config).includes(id));
  assert(controls(config).includes("light.b"));
});

test("legacy exclusions migrate only to overview and explicit empty lists override them", () => {
  const legacy = { area: "room", exclude_devices: [" device ", "device"], exclude_entities: ["light.b"] };
  const migrated = migrateExclusions(legacy);
  assert.deepEqual(migrated.overview_exclusions, { devices: ["device"], entities: ["light.b"] });
  assert.deepEqual(migrated.control_exclusions, { devices: [], entities: [] });
  assert(!Object.hasOwn(migrated, "exclude_devices"));
  assert(controls(migrated).includes("light.a"));
  assert(overview({ ...legacy, overview_exclusions: {} }).includes("light.a"));
});

test("saved lists are cloned, deduplicated and validated for each surface", () => {
  const original = { area: "room", overview_exclusions: { devices: ["device", " device "] }, control_exclusions: { entities: [" light.a "] } };
  const next = normalizeConfig(original);
  assert.deepEqual(next.overview_exclusions, { devices: ["device"], entities: [] });
  next.overview_exclusions.devices.push("other");
  assert.deepEqual(original.overview_exclusions.devices, ["device", " device "]);
  for (const surface of ["overview", "control"]) for (const value of [null, [], "light.a", { devices: "device" }, { entities: [false] }, { devices: [" "] }, { typo: [] }]) assert.throws(() => normalizeConfig({ area: "room", [`${surface}_exclusions`]: value }));
});

test("control settings do not inherit overview exclusions or sizing", () => {
  const config = controlCardConfig({ area: "room", exclude_entities: ["light.a"], grid_options: { columns: 3 }, control_options: { layout: "grouped", camera_layout: "tiles" } });
  assert.equal(config.layout, "compact"); assert.equal(config.camera_layout, "tiles");
  assert.equal(config.show_title, false); assert.deepEqual(config.exclude_entities, []);
  assert(!Object.hasOwn(config, "grid_options"));
  for (const options of [false, [], { exclude_entities: ["light.a"] }, { area: "other" }, { layout: "invalid" }]) assert.throws(() => controlCardConfig({ area: "room", control_options: options }));
});
