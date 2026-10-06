export const GROUPS = {
  lights: { name: "Lights", icon: "mdi:lightbulb-group" },
  contacts: { name: "Contacts", icon: "mdi:door-open" },
  occupancy: { name: "Motion / presence", icon: "mdi:motion-sensor" },
  fans: { name: "Fans", icon: "mdi:fan" },
  covers: { name: "Covers", icon: "mdi:window-shutter" },
  switches: { name: "Switches", icon: "mdi:toggle-switch" },
  climate: { name: "Climate", icon: "mdi:thermostat" },
  media: { name: "Media players", icon: "mdi:speaker" },
  locks: { name: "Locks", icon: "mdi:lock" },
};
export const GROUP_ORDER = Object.keys(GROUPS);
export const READ_ONLY_GROUPS = ["contacts", "occupancy"];
export const CONTROL_GROUP_ORDER = GROUP_ORDER.filter(kind => !READ_ONLY_GROUPS.includes(kind));
export const DEFAULT_THRESHOLDS = { temperature_low: 12, temperature_high: 30, humidity_low: 30, humidity_high: 75 };
const DOMAINS = { light: "lights", switch: "switches", fan: "fans", cover: "covers", climate: "climate", media_player: "media", lock: "locks" };
const CONTACT_CLASSES = new Set(["door", "window", "opening", "garage_door"]);
const OCCUPANCY_CLASSES = new Set(["motion", "occupancy", "presence"]);

export function domainOf(id) { return id.split(".")[0]; }
export function usable(state) { return !!state && !["unknown", "unavailable", ""].includes(state.state); }
export function numeric(state) {
  if (!usable(state)) return null;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : null;
}
export function effectiveArea(entity, devices) {
  return entity.area_id ?? devices.get(entity.device_id)?.area_id ?? null;
}
export function deviceClass(entity, state) {
  return entity.device_class ?? state?.attributes?.device_class ?? entity.original_device_class;
}
export function eligible(entity) {
  return !entity.disabled_by && !entity.hidden_by && !entity.entity_category;
}
export function entityKind(entity, state) {
  const domain = domainOf(entity.entity_id), cls = deviceClass(entity, state);
  if (domain === "sensor" && ["temperature", "humidity"].includes(cls)) return cls;
  if (domain === "binary_sensor") {
    if (CONTACT_CLASSES.has(cls)) return "contacts";
    if (OCCUPANCY_CLASSES.has(cls)) return "occupancy";
  }
  return DOMAINS[domain];
}
export function excludedEntityIds(config, registries, states = {}) {
  const excluded = new Set(config.exclude_entities ?? []), devices = new Set(config.exclude_devices ?? []);
  if (!excluded.size && !devices.size) return excluded;
  // Include every sibling, even when its own area differs from the device's.
  for (const entity of registries.entities) if (devices.has(entity.device_id)) excluded.add(entity.entity_id);
  if (!excluded.size) return excluded;
  const dependents = new Map();
  const link = (source, dependent) => {
    if (typeof source !== "string" || !source || typeof dependent !== "string" || !dependent) return;
    if (!dependents.has(source)) dependents.set(source, new Set());
    dependents.get(source).add(dependent);
  };
  for (const entity of registries.entities) {
    const source = entity.options?.switch_as_x?.entity_id;
    if (source) { link(source, entity.entity_id); link(entity.entity_id, source); }
  }
  // A group must never reintroduce an excluded member, including through a nested group.
  for (const [id, state] of Object.entries(states)) {
    const members = state?.attributes?.group_entities ?? state?.attributes?.entity_id;
    if (Array.isArray(members)) for (const member of members) link(member, id);
  }
  const pending = [...excluded];
  for (let i = 0; i < pending.length; i++) for (const id of dependents.get(pending[i]) ?? []) {
    if (!excluded.has(id)) { excluded.add(id); pending.push(id); }
  }
  return excluded;
}
export function normalizeConfig(config) {
  if (!config || typeof config.area !== "string" || !config.area.trim()) throw new Error("Please select a room.");
  const result = { ...config, area: config.area.trim() };
  if (config.tiles !== undefined) {
    if (!Array.isArray(config.tiles) || config.tiles.length > 4 || config.tiles.some(k => k !== "none" && !GROUP_ORDER.includes(k))) {
      throw new Error("Select up to four device groups for the mini tiles.");
    }
    const selected = config.tiles.filter(k => k !== "none");
    if (new Set(selected).size !== selected.length) throw new Error("Each mini tile must select a different device group.");
    result.tiles = [...config.tiles];
  }
  for (const key of ["exclude_devices", "exclude_entities", "light_switches"]) {
    if (config[key] !== undefined) {
      if (!Array.isArray(config[key]) || config[key].some(id => typeof id !== "string" || !id.trim())) {
        throw new Error(`${key} must be a list of ${key === "exclude_devices" ? "device" : "entity"} IDs.`);
      }
      result[key] = [...new Set(config[key].map(id => id.trim()))];
    }
  }
  for (const key of ["temperature_sensor", "humidity_sensor", "image", "icon", "name"]) {
    if (config[key] !== undefined && typeof config[key] !== "string") throw new Error(`${key} must be text.`);
  }
  if (config.temperature_unit !== undefined && !["auto", "°C", "°F"].includes(config.temperature_unit)) throw new Error("Choose °C, °F, or Automatic.");
  if (config.tile_alignment !== undefined && !["left", "center", "right"].includes(config.tile_alignment)) throw new Error("Choose Left, Center, or Right for mini tile alignment.");
  if (config.thresholds !== undefined && (!config.thresholds || typeof config.thresholds !== "object" || Array.isArray(config.thresholds))) throw new Error("Warning thresholds must be an object.");
  for (const [key, value] of Object.entries(config.thresholds ?? {})) {
    if (!Object.hasOwn(DEFAULT_THRESHOLDS, key) || (value !== null && (typeof value !== "number" || !Number.isFinite(value)))) throw new Error("Warning thresholds must be numbers, or null to disable a warning.");
    if (key.startsWith("humidity") && value !== null && (value < 0 || value > 100)) throw new Error("Humidity thresholds must be between 0 and 100%.");
  }
  for (const kind of ["temperature", "humidity"]) {
    const low = config.thresholds?.[`${kind}_low`], high = config.thresholds?.[`${kind}_high`];
    if (low != null && high != null && low >= high) throw new Error(`The low ${kind} threshold must be below the high threshold.`);
  }
  return result;
}
export function discoverRoom(config, registries, states = {}) {
  const devices = new Map(registries.devices.map(d => [d.id, d]));
  const excluded = excludedEntityIds(config, registries, states);
  const roomEntities = registries.entities.filter(e => eligible(e) && effectiveArea(e, devices) === config.area);
  const entities = roomEntities.filter(e => !excluded.has(e.entity_id));
  const sourceSwitches = new Set(entities.map(e => e.options?.switch_as_x?.entity_id).filter(Boolean));
  const promoted = new Set(config.light_switches ?? []);
  const candidates = entities.filter(e => !sourceSwitches.has(e.entity_id));
  const candidateIds = new Set(candidates.map(e => e.entity_id));
  const groups = Object.fromEntries(GROUP_ORDER.map(k => [k, []]));
  const sensors = { temperature: [], humidity: [] };
  for (const e of candidates) {
    const id = e.entity_id, domain = domainOf(id), state = states[id];
    const members = state?.attributes?.group_entities ?? state?.attributes?.entity_id;
    // Prefer individual members to a second, duplicate control for their HA group.
    if (Array.isArray(members) && members.some(member => candidateIds.has(member))) continue;
    let kind = entityKind(e, state);
    if (["temperature", "humidity"].includes(kind)) { sensors[kind].push(id); continue; }
    if (domain === "switch" && promoted.has(id)) kind = "lights";
    if (kind) groups[kind].push(id);
  }
  for (const ids of [...Object.values(groups), ...Object.values(sensors)]) ids.sort();
  const area = registries.areas.find(a => a.area_id === config.area || a.id === config.area);
  const available = GROUP_ORDER.filter(k => groups[k].length);
  const controlGroups = CONTROL_GROUP_ORDER.filter(kind => groups[kind].length);
  const indicators = READ_ONLY_GROUPS.filter(kind => groups[kind].length).map(kind => ({ kind, entities: groups[kind] }));
  const tiles = (config.tiles ?? controlGroups.slice(0, 4)).map((kind, slot) => ({ kind, slot, entities: groups[kind] ?? [] })).filter(t => t.entities.length && !READ_ONLY_GROUPS.includes(t.kind));
  return { area, roomEntities, excluded, entities: candidates, groups, sensors, available, controlGroups, indicators, tiles };
}
export function groupStatus(kind, ids, states) {
  let active = 0, unavailable = 0;
  for (const id of ids) {
    const state = states[id];
    if (!usable(state)) { unavailable++; continue; }
    const value = state.state;
    if (["contacts", "occupancy"].includes(kind)) {
      if (value === "on") active++;
      else if (value !== "off") unavailable++;
    } else if (kind === "covers") {
      if (["open", "opening", "closing"].includes(value)) active++;
      else if (value !== "closed") unavailable++;
    } else if (kind === "locks") {
      if (["unlocked", "unlocking", "locking", "open", "opening"].includes(value)) active++;
      else if (value !== "locked") unavailable++;
    } else if (kind === "media") {
      if (["playing", "paused", "buffering", "on"].includes(value)) active++;
    } else if (kind === "climate") {
      if (!["off", "idle"].includes(value)) active++;
    } else {
      if (value === "on") active++;
      else if (value !== "off") unavailable++;
    }
  }
  const noun = kind === "contacts" || kind === "covers" ? "open" : kind === "occupancy" ? "detecting activity" : kind === "locks" ? "unlocked" : "active";
  const status = !ids.length ? "No devices" : unavailable === ids.length ? "Unavailable" : `${active} of ${ids.length} ${noun}${unavailable ? `; ${unavailable} unavailable` : ""}`;
  return { active: active > 0, count: active, unavailable, status };
}
export function temperatureUnit(config, hass) { return config.temperature_unit && config.temperature_unit !== "auto" ? config.temperature_unit : hass.config?.unit_system?.temperature ?? "°C"; }
export function convertTemperature(value, from, to) {
  if (!["°C", "°F"].includes(from) || !["°C", "°F"].includes(to)) return null;
  if (from === to) return value;
  return to === "°F" ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
}
export function roomReading(kind, config, model, states, unit = "°C") {
  const override = config[`${kind}_sensor`];
  if (override === "none") return null;
  const preferred = override || model.area?.[`${kind}_entity_id`];
  const ids = preferred && !model.excluded?.has(preferred) ? [preferred] : model.sensors[kind];
  if (!ids.length) {
    const hadExcludedSensor = model.excluded?.has(preferred) || model.roomEntities?.some(e => model.excluded?.has(e.entity_id) && entityKind(e, states[e.entity_id]) === kind);
    return hadExcludedSensor ? { value: null, entities: [], unit: kind === "temperature" ? unit : "%" } : null;
  }
  const values = ids.map(id => {
    const state = states[id], value = numeric(state);
    if (value === null) return null;
    if (kind === "temperature") return convertTemperature(value, state.attributes?.unit_of_measurement ?? unit, unit);
    return state.attributes?.unit_of_measurement && state.attributes.unit_of_measurement !== "%" ? null : value;
  }).filter(v => v !== null).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const value = !values.length ? null : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return { value, entities: ids, unit: kind === "temperature" ? unit : "%" };
}
export function thresholdsFor(config, unit = "°C") {
  const defaults = { ...DEFAULT_THRESHOLDS };
  if (unit === "°F") for (const key of ["temperature_low", "temperature_high"]) defaults[key] = convertTemperature(defaults[key], "°C", "°F");
  return { ...defaults, ...config.thresholds };
}
export function warningsFor(readings, thresholds) {
  const icons = { temperature_high: "mdi:thermometer-high", temperature_low: "mdi:thermometer-low", humidity_high: "mdi:water-alert", humidity_low: "mdi:water-minus" };
  const warnings = [];
  for (const kind of ["temperature", "humidity"]) {
    const reading = readings[kind];
    if (!reading || reading.value === null) continue;
    for (const bound of ["high", "low"]) {
      const key = `${kind}_${bound}`, threshold = thresholds[key];
      if (threshold == null || !(bound === "high" ? reading.value > threshold : reading.value < threshold)) continue;
      warnings.push({ key, icon: icons[key], text: `${bound === "high" ? "High" : "Low"} ${kind}`, entities: reading.entities });
    }
  }
  return warnings;
}
export function safeImageUrl(value) {
  if (!value || typeof value !== "string") return "";
  const clean = value.trim();
  if (/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(clean)) return clean;
  if (clean.startsWith("/") && !clean.startsWith("//")) return clean;
  try { const url = new URL(clean); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
