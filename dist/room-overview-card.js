/* Room Overview Card v1.0.0 | MIT | Built from src/; run npm run build. */
(() => {
"use strict";
const GROUPS = {
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
const GROUP_ORDER = Object.keys(GROUPS);
const READ_ONLY_GROUPS = ["contacts", "occupancy"];
const CONTROL_GROUP_ORDER = GROUP_ORDER.filter(kind => !READ_ONLY_GROUPS.includes(kind));
const DEFAULT_THRESHOLDS = { temperature_low: 12, temperature_high: 30, humidity_low: 30, humidity_high: 75 };
const DOMAINS = { light: "lights", switch: "switches", fan: "fans", cover: "covers", climate: "climate", media_player: "media", lock: "locks" };
const CONTACT_CLASSES = new Set(["door", "window", "opening", "garage_door"]);
const OCCUPANCY_CLASSES = new Set(["motion", "occupancy", "presence"]);

function domainOf(id) { return id.split(".")[0]; }
function usable(state) { return !!state && !["unknown", "unavailable", ""].includes(state.state); }
function numeric(state) {
  if (!usable(state)) return null;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : null;
}
function effectiveArea(entity, devices) {
  return entity.area_id ?? devices.get(entity.device_id)?.area_id ?? null;
}
function deviceClass(entity, state) {
  return entity.device_class ?? state?.attributes?.device_class ?? entity.original_device_class;
}
function eligible(entity) {
  return !entity.disabled_by && !entity.hidden_by && !entity.entity_category;
}
function entityKind(entity, state) {
  const domain = domainOf(entity.entity_id), cls = deviceClass(entity, state);
  if (domain === "sensor" && ["temperature", "humidity"].includes(cls)) return cls;
  if (domain === "binary_sensor") {
    if (CONTACT_CLASSES.has(cls)) return "contacts";
    if (OCCUPANCY_CLASSES.has(cls)) return "occupancy";
  }
  return DOMAINS[domain];
}
function excludedEntityIds(config, registries, states = {}) {
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
function normalizeConfig(config) {
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
function discoverRoom(config, registries, states = {}) {
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
function groupStatus(kind, ids, states) {
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
function temperatureUnit(config, hass) { return config.temperature_unit && config.temperature_unit !== "auto" ? config.temperature_unit : hass.config?.unit_system?.temperature ?? "°C"; }
function convertTemperature(value, from, to) {
  if (!["°C", "°F"].includes(from) || !["°C", "°F"].includes(to)) return null;
  if (from === to) return value;
  return to === "°F" ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
}
function roomReading(kind, config, model, states, unit = "°C") {
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
function thresholdsFor(config, unit = "°C") {
  const defaults = { ...DEFAULT_THRESHOLDS };
  if (unit === "°F") for (const key of ["temperature_low", "temperature_high"]) defaults[key] = convertTemperature(defaults[key], "°C", "°F");
  return { ...defaults, ...config.thresholds };
}
function warningsFor(readings, thresholds) {
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
function safeImageUrl(value) {
  if (!value || typeof value !== "string") return "";
  const clean = value.trim();
  if (/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(clean)) return clean;
  if (clean.startsWith("/") && !clean.startsWith("//")) return clean;
  try { const url = new URL(clean); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}

const DIMMABLE_MODES = new Set(["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy", "white"]);
const COLOR_MODES = new Set(["hs", "rgb", "rgbw", "rgbww", "xy"]);

function lightCapabilities(state) {
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

function lightColor(attributes = {}, fallback = { hue: 0, saturation: 100 }) {
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

function lightTemperatureBounds(attributes = {}) {
  const warm = attributes.min_color_temp_kelvin ?? (attributes.max_mireds > 0 ? Math.round(1000000 / attributes.max_mireds) : 2000);
  const cool = attributes.max_color_temp_kelvin ?? (attributes.min_mireds > 0 ? Math.round(1000000 / attributes.min_mireds) : 6500);
  return Number.isFinite(warm) && Number.isFinite(cool) && warm > 0 && cool > warm ? [warm, cool] : [2000, 6500];
}

const registryStores = new WeakMap();
function watchRegistries(hass, callback) {
  const key = hass.connection ?? hass;
  let store = registryStores.get(key);
  if (!store) {
    store = { data: null, error: null, listeners: new Set(), unsubscribers: [], loading: null, timer: null, active: false, dirty: false };
    registryStores.set(key, store);
  }
  store.hass = hass;
  store.listeners.add(callback);
  const notify = () => { for (const listener of store.listeners) listener(store.data, store.error); };
  const refresh = () => {
    if (!store.listeners.size) return;
    if (store.loading) { store.dirty = true; return; }
    store.loading = Promise.resolve().then(() => Promise.all([
      store.hass.callWS({ type: "config/area_registry/list" }),
      store.hass.callWS({ type: "config/device_registry/list" }),
      store.hass.callWS({ type: "config/entity_registry/list" }),
    ])).then(([areas, devices, entities]) => {
      store.data = { areas, devices, entities }; store.error = null;
    }).catch(error => { store.error = error?.message ?? "Room information could not be loaded."; }).finally(() => {
      store.loading = null; notify();
      if (store.dirty) { store.dirty = false; refresh(); }
    });
  };
  if (!store.active) {
    store.active = true;
    const generation = Symbol(); store.generation = generation;
    const schedule = () => { clearTimeout(store.timer); store.timer = setTimeout(refresh, 100); };
    for (const type of ["area_registry_updated", "device_registry_updated", "entity_registry_updated"]) {
      Promise.resolve(hass.connection?.subscribeEvents(schedule, type)).then(unsubscribe => {
        if (typeof unsubscribe !== "function") return;
        if (store.generation !== generation || !store.listeners.size) unsubscribe(); else store.unsubscribers.push(unsubscribe);
      }).catch(() => { /* State updates and reconnects can still refresh the registry. */ });
    }
    if (hass.connection?.addEventListener) {
      hass.connection.addEventListener("ready", schedule);
      store.unsubscribers.push(() => hass.connection.removeEventListener("ready", schedule));
    }
    refresh();
  }
  if (store.data || store.error) callback(store.data, store.error);
  return () => {
    store.listeners.delete(callback);
    if (store.listeners.size) return;
    clearTimeout(store.timer);
    for (const unsubscribe of store.unsubscribers) unsubscribe();
    store.unsubscribers = []; store.active = false; store.generation = null;
  };
}


// Media URLs are signed for 24 hours. Share resolutions across cards, then
// refresh before the signature expires without saving it in the card config.
const MEDIA_IMAGE_CACHE_MS = 23 * 60 * 60 * 1000;
const mediaImageCaches = new WeakMap();

function isMediaImage(value) {
  return typeof value === "string" && value.startsWith("media-source://");
}

function resolveMediaImage(hass, mediaId) {
  const connection = hass.connection;
  let cache = mediaImageCaches.get(connection);
  if (!cache) { cache = new Map(); mediaImageCaches.set(connection, cache); }
  const previous = cache.get(mediaId);
  if (previous && previous.expires > Date.now()) return previous.promise;
  const entry = { expires: Date.now() + MEDIA_IMAGE_CACHE_MS };
  entry.promise = Promise.resolve().then(() => hass.callWS({
    type: "media_source/resolve_media", media_content_id: mediaId,
  })).then(result => {
    if (!result?.mime_type?.startsWith("image/")) throw new Error("Select an image from Media.");
    const url = safeImageUrl(result.url);
    if (!url) throw new Error("The image URL could not be loaded.");
    entry.expires = Date.now() + MEDIA_IMAGE_CACHE_MS;
    return { url: url.startsWith("/") && hass.hassUrl ? hass.hassUrl(url) : url, expires: entry.expires };
  }).catch(error => {
    if (cache.get(mediaId) === entry) cache.delete(mediaId);
    throw error;
  });
  cache.set(mediaId, entry);
  return entry.promise;
}

async function loadEditorSelectors() {
  if (customElements.get("ha-selector")) return;
  // Load the native form through HA's public card helper instead of importing
  // version-specific frontend bundles. ha-selector lazy-loads its own pickers.
  const helpers = await window.loadCardHelpers();
  await helpers.createCardElement({ type: "button" }).constructor.getConfigElement();
  await customElements.whenDefined("ha-selector");
}

const CARD_STYLE = `
:host{display:block;min-width:0;font-family:var(--ha-font-family-body,inherit);color:var(--primary-text-color)}
*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:3px}button:disabled{cursor:default;opacity:.5}
ha-card{display:block;position:relative;height:212px;overflow:hidden;border-radius:16px;background:var(--ha-card-background,var(--card-background-color,#27313b));isolation:isolate}
:host ha-card::before{content:none}
ha-card[data-lit=true]{outline:3px solid #ffca28;outline-offset:-2px;box-shadow:0 0 0 2px #ffca28cc,0 0 16px #ffca28e6,0 0 32px #ffca28a6,0 0 48px #ffca2859}
.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.shade{position:absolute;inset:0;background:linear-gradient(180deg,#0009 0%,#0002 40%,transparent 65%,#0002 100%);z-index:-1}
.heading{position:absolute;inset:12px 12px auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}.room-summary{min-width:0}.room-button{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:0;color:white;text-align:left;font-size:14px;font-weight:600;text-shadow:0 1px 3px #0009;min-width:0}.room-button ha-icon{--mdc-icon-size:20px;flex-shrink:0}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.readings{margin:4px 0 0 28px;display:flex;flex-wrap:wrap;gap:0 6px;font-size:12px;color:#fff;line-height:18px;text-shadow:0 1px 3px #0009}.reading{padding:0;border:0;background:none;color:inherit;font:inherit;white-space:nowrap}.reading+.reading::before{content:'|';margin-right:6px;opacity:.7}
.status-row{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:168px}.warnings,.sensor-status{display:flex;gap:4px}.warnings:empty,.sensor-status:empty,.sensor-status[hidden],.sensor-indicator[hidden]{display:none}
.warning,.sensor-indicator{width:24px;height:24px;padding:0;border:0;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.warning{background:#e3f2fd;color:#087cca}.warning ha-icon,.sensor-indicator ha-icon{--mdc-icon-size:18px}.warning[data-kind=temperature_high]{background:#fff3e0;color:#c65d00}.warning[data-kind=humidity_low]{background:#fff8e1;color:#9c6500}
.sensor-indicator{position:relative;background:#eceff1;color:#7d858b}.sensor-indicator[data-active=true]{background:#ffe4e6;color:#a86070}.sensor-indicator[data-unavailable=true]{background:#e2e8f0;color:#64748b}.sensor-indicator .unavailable-dot{top:-3px;right:-3px;width:10px;height:10px;line-height:10px;font-size:8px}
.tiles{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:nowrap;justify-content:flex-end;gap:6px;align-items:end}.tiles[data-alignment=left]{justify-content:flex-start}.tiles[data-alignment=center]{justify-content:center}.tile{flex:0 1 56px;width:56px;height:56px;min-width:0;display:grid;place-items:center;position:relative;padding:6px;border:var(--ha-card-border,1px solid #ffffff66);border-radius:12px;background:#ffffff80;backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));-webkit-backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));box-shadow:var(--ha-card-glass-inset-shadow,none);color:#888}.tile ha-icon{--mdc-icon-size:28px;stroke:#fff;stroke-width:1.5px;stroke-linejoin:round;paint-order:stroke fill}.tile[data-active=true]{color:#ffca28}.tile[data-unavailable=true]{color:#64748b}.unavailable-dot{position:absolute;top:5px;right:5px;width:12px;height:12px;border-radius:50%;background:#455a64;color:white;font-size:10px;line-height:12px;text-align:center}.unavailable-dot[hidden]{display:none}
.message{position:absolute;left:12px;right:12px;bottom:14px;color:#fff;font-size:12px;text-shadow:0 1px 3px #000}.message[hidden]{display:none}ha-card[data-has-controls=true] .message{bottom:76px}
dialog{padding:0;border:1px solid var(--divider-color,#ddd);border-radius:20px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);width:min(500px,calc(100vw - 32px));max-height:85dvh;overflow:hidden;box-shadow:0 16px 64px #0006}dialog::backdrop{background:#0007;backdrop-filter:blur(4px)}
.dialog-header{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--divider-color,#ddd)}.dialog-heading{flex:1;margin:0;font-size:18px;font-weight:600}.close{border:0;background:none;color:inherit;border-radius:50%;padding:8px;display:grid;place-items:center}.close ha-icon{--mdc-icon-size:22px}.dialog-body{max-height:calc(85dvh - 78px);overflow:auto;padding:8px 20px 20px;overscroll-behavior:contain}.group-title{margin:16px 0 6px;font-size:14px;color:var(--secondary-text-color,#666)}.entity-row{padding:10px 0;border-bottom:1px solid var(--divider-color,#eee);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.entity-details{border:0;background:none;color:inherit;padding:4px 0;display:flex;align-items:center;gap:12px;min-width:0;text-align:left}.entity-details ha-icon{--mdc-icon-size:24px;color:var(--secondary-text-color,#666);flex-shrink:0}.entity-text{min-width:0}.entity-name{display:block;overflow-wrap:anywhere;font-size:14px}.entity-state{display:block;margin-top:3px;font-size:12px;color:var(--secondary-text-color,#666)}.entity-action{min-width:58px;min-height:36px;border:1px solid var(--divider-color,#ddd);border-radius:10px;background:var(--secondary-background-color,#eee);color:inherit;font-size:12px}.entity-action[data-on=true]{background:var(--primary-color,#03a9f4);color:var(--text-primary-color,#fff);border-color:transparent}.brightness{grid-column:1/-1;width:100%;accent-color:var(--primary-color,#03a9f4)}.dialog-error{color:var(--error-color,#db4437);font-size:13px;margin:8px 0}.dialog-error:empty{display:none}.empty{font-size:14px;color:var(--secondary-text-color,#666);padding:16px 0}
.entity-state[hidden]{display:none}.entity-details ha-icon[data-on=true]{color:var(--state-light-active-color,#ffca28);filter:drop-shadow(0 0 5px #ffca2859)}
.entity-toggle{position:relative;width:58px;min-height:40px;border:0;border-radius:20px;padding:0;background:none;color:inherit;flex-shrink:0}
.entity-toggle::before{content:'';position:absolute;inset:6px 2px;border:1px solid var(--divider-color,#bbb);border-radius:20px;background:var(--secondary-background-color,#ddd);transition:background .18s}
.toggle-thumb{position:absolute;top:10px;left:6px;width:20px;height:20px;border-radius:50%;background:var(--secondary-text-color,#777);box-shadow:0 1px 3px #0003;transition:transform .18s,background .18s;pointer-events:none}
.entity-toggle[data-on=true]::before{background:var(--primary-color,#03a9f4);border-color:transparent}.entity-toggle[data-on=true] .toggle-thumb{transform:translateX(26px);background:var(--text-primary-color,#fff)}
.entity-toggle[aria-busy=true]{cursor:progress}
.light-control{grid-column:1/-1;display:grid;grid-template-columns:1fr auto;gap:0 12px;align-items:center;min-width:0;padding:2px 0}
.control-label,.control-value{font-size:12px;color:var(--secondary-text-color,#666)}.control-value{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.light-slider{grid-column:1/-1;appearance:none;-webkit-appearance:none;width:100%;min-width:0;height:38px;margin:0;padding:0 10px;border:0;background:transparent;cursor:pointer;--slider-gradient:linear-gradient(90deg,#161616,var(--light-color,#fff))}
.light-slider.color{--slider-gradient:linear-gradient(90deg,#f00 0%,#ff0 16.67%,#0f0 33.33%,#0ff 50%,#00f 66.67%,#f0f 83.33%,#f00 100%)}
.light-slider.temperature{--slider-gradient:linear-gradient(90deg,#ffad55,#fff2dd,#d6e9ff,#86bcff)}
.light-slider::-webkit-slider-runnable-track{height:16px;border-radius:8px;background:var(--slider-gradient);box-shadow:inset 0 0 0 1px #8885}
.light-slider::-moz-range-track{height:16px;border-radius:8px;background:var(--slider-gradient);box-shadow:inset 0 0 0 1px #8885}
.light-slider::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:24px;height:24px;margin-top:-4px;border:3px solid #fff;border-radius:50%;background:var(--light-color,#eee);box-shadow:0 1px 5px #0008}
.light-slider::-moz-range-thumb{width:18px;height:18px;border:3px solid #fff;border-radius:50%;background:var(--light-color,#eee);box-shadow:0 1px 5px #0008}
.light-slider.color::-webkit-slider-thumb{background:var(--swatch-color,var(--light-color,#eee))}.light-slider:disabled{opacity:.4;cursor:default}
ha-card[data-has-image=false] .shade{display:none}
ha-card[data-has-image=false] .room-button{color:var(--primary-text-color,#222);text-shadow:none}
ha-card[data-has-image=false] .readings,ha-card[data-has-image=false] .message{color:var(--secondary-text-color,#666);text-shadow:none}
ha-card[data-has-image=false] .tile{background:var(--secondary-background-color,#e8eef3);border:1px solid var(--divider-color,#ddd);backdrop-filter:none;-webkit-backdrop-filter:none}
ha-card[data-has-image=false] .tile ha-icon{stroke:none}
@media(prefers-reduced-motion:reduce){.entity-toggle::before,.toggle-thumb{transition:none}}
@media(max-width:480px){dialog{width:100vw;max-width:100vw;max-height:85dvh;margin:auto 0 0;border-radius:20px 20px 0 0}.dialog-body{padding-bottom:max(20px,env(safe-area-inset-bottom))}}
`;
const EDITOR_STYLE = `
:host ha-selector{display:block;width:100%}
:host{display:block;color:var(--primary-text-color);font-family:var(--ha-font-family-body,inherit)}*{box-sizing:border-box}.editor{padding:4px 0}.field{display:block;margin:0 0 16px}.label{display:block;font-size:13px;font-weight:500;margin-bottom:6px}select,input{width:100%;min-height:44px;border:1px solid var(--divider-color,#aaa);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);padding:10px 12px;font:inherit}select:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:2px}select:disabled{opacity:.6}.hint{font-size:12px;color:var(--secondary-text-color,#666);line-height:1.5;margin:6px 0 16px}.slots{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.section-title{font-size:14px;font-weight:600;margin:18px 0 12px}.reset{border:0;background:none;padding:4px 0;color:var(--primary-color,#03a9f4);cursor:pointer;font:inherit;font-size:13px}.advanced{margin-top:20px;border-top:1px solid var(--divider-color,#ddd);padding-top:16px}.advanced>summary{cursor:pointer;font-size:14px;padding-bottom:16px}select[multiple]{min-height:130px}.error{color:var(--error-color,#db4437);font-size:13px}.error:empty{display:none}.unit-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field small{font-size:12px;color:var(--secondary-text-color,#666)}
.exclusions{border-top:1px solid var(--divider-color,#ddd);padding-top:4px}.exclusions summary,.specific-entities summary{cursor:pointer;min-height:44px;padding:12px 0;font-size:14px}.exclusions>summary{font-weight:500}.exclusion-count{display:inline-block;margin-left:8px;font-size:12px;font-weight:400;color:var(--secondary-text-color,#666)}.exclusion-list .field{margin:0 0 8px}.exclusion-options{max-height:320px;overflow:auto;overscroll-behavior:contain}.exclusion-option{display:flex;gap:12px;align-items:center;min-height:56px;padding:8px 2px;border-bottom:1px solid var(--divider-color,#ddd);cursor:pointer}.exclusion-option[hidden],.exclusion-empty[hidden]{display:none}.exclusion-option input[type=checkbox]{appearance:auto;width:18px;height:18px;min-height:18px;margin:0;padding:0;flex:0 0 18px;accent-color:var(--primary-color,#03a9f4);cursor:inherit}.exclusion-option:has(input:disabled){opacity:.65;cursor:default}.exclusion-text{min-width:0}.exclusion-name,.exclusion-detail{display:block;overflow-wrap:anywhere}.exclusion-name{font-size:14px}.exclusion-detail{font-size:12px;color:var(--secondary-text-color,#666)}.specific-entities{margin-top:12px}input[type=search]{font-size:16px}.exclusion-empty{padding:8px 0}
`;


function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconNode(icon) { const node = element("ha-icon"); node.setAttribute("icon", icon); return node; }
function button(className, label, onClick) {
  const node = element("button", className); node.type = "button";
  node.setAttribute("aria-label", label); node.title = label;
  node.addEventListener("click", onClick); return node;
}

class RoomOverviewCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" }); this._pending = new Set(); this._rows = new Map(); this._lightValues = new Map();
    this.shadowRoot.innerHTML = `<style>${CARD_STYLE}</style><ha-card><img class="background" alt=""><div class="shade"></div><div class="heading"><div class="room-summary"><button type="button" class="room-button"><ha-icon></ha-icon><span class="name"></span></button><div class="readings"></div></div><div class="status-row"><div class="sensor-status"></div><div class="warnings"></div></div></div><div class="tiles"></div><div class="message" role="status" hidden></div></ha-card><dialog aria-labelledby="room-overview-dialog-title"><div class="dialog-header"><h2 id="room-overview-dialog-title" class="dialog-heading"></h2><button type="button" class="close" aria-label="Close room details"><ha-icon icon="mdi:close"></ha-icon></button></div><div class="dialog-body"><div class="dialog-error" role="alert"></div><div class="dialog-list"></div></div></dialog>`;
    this._dialog = this.shadowRoot.querySelector("dialog");
    this.shadowRoot.querySelector(".room-button").addEventListener("click", () => this._openDetails());
    this.shadowRoot.querySelector(".close").addEventListener("click", () => this._closeDialog());
    this._dialog.addEventListener("click", event => { if (event.target === this._dialog) { const r = this._dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this._closeDialog(); } });
    this._dialog.addEventListener("close", () => { this._dialogSelection = null; if (this._opener?.isConnected) this._opener.focus(); });
    this.shadowRoot.querySelector("ha-card").dataset.hasImage = "false";
    this.shadowRoot.querySelector("img").addEventListener("error", () => {
      this.shadowRoot.querySelector("img").hidden = true;
      this.shadowRoot.querySelector("ha-card").dataset.hasImage = "false";
    });
    this.shadowRoot.querySelector("img").addEventListener("load", () => {
      this.shadowRoot.querySelector("img").hidden = false;
      this.shadowRoot.querySelector("ha-card").dataset.hasImage = "true";
    });
  }
  static async getConfigElement() { await loadEditorSelectors(); return document.createElement("room-overview-card-editor"); }
  static getStubConfig(hass) {
    const areas = Object.values(hass?.areas ?? {});
    return { area: areas.find(a => a.icon)?.area_id ?? areas[0]?.area_id ?? "" };
  }
  setConfig(config) { this._config = normalizeConfig(config); this._tileSignature = null; this._update(); }
  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && this._connection !== hass.connection) { this._unwatch?.(); this._unwatch = null; this._connection = hass.connection; }
    this._watch(); this._update();
  }
  connectedCallback() { this._watch(); this._update(); }
  disconnectedCallback() { this._unwatch?.(); this._unwatch = null; this._dialogSelection = null; this._mediaRequest = null; clearTimeout(this._mediaRefresh); if (this._dialog.open) this._dialog.close(); }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6, min_rows: 3 }; }
  _watch() {
    if (!this.isConnected || !this._hass || this._unwatch) return;
    this._connection = this._hass.connection;
    this._unwatch = watchRegistries(this._hass, (data, error) => { this._registries = data; this._registryError = error; this._update(); });
  }
  _message(text) { const node = this.shadowRoot.querySelector(".message"); node.textContent = text; node.hidden = !text; }
  _backgroundImage(fallback) {
    const value = this._config.image;
    if (!isMediaImage(value)) {
      this._mediaRequest = null; this._mediaImage = ""; this._mediaError = false; clearTimeout(this._mediaRefresh);
      return safeImageUrl(value || fallback);
    }
    if (this.isConnected && (this._mediaRequest?.id !== value || this._mediaRequest?.connection !== this._hass.connection)) {
      clearTimeout(this._mediaRefresh);
      const request = { id: value, connection: this._hass.connection };
      this._mediaRequest = request; this._mediaImage = ""; this._mediaError = false;
      resolveMediaImage(this._hass, value).then(image => {
        if (this._mediaRequest !== request) return;
        this._mediaImage = image.url;
        this._mediaRefresh = setTimeout(() => { this._mediaRequest = null; this._update(); }, Math.max(1, image.expires - Date.now()));
        this._update();
      }).catch(() => {
        if (this._mediaRequest !== request) return;
        this._mediaError = true; this._update();
      });
    }
    return this._mediaImage || safeImageUrl(fallback);
  }
  _update() {
    if (!this._config || !this._hass) return;
    if (!this._registries) { this._message(this._registryError ? "Room information could not be loaded. Reload to try again." : "Loading room…"); return; }
    const model = discoverRoom(this._config, this._registries, this._hass.states);
    this._model = model;
    const name = this._config.name || model.area?.name || "Room not found";
    this.shadowRoot.querySelector(".name").textContent = name;
    this.shadowRoot.querySelector(".room-button ha-icon").setAttribute("icon", this._config.icon || model.area?.icon || "mdi:home-outline");
    this.shadowRoot.querySelector(".room-button").setAttribute("aria-label", `Open ${name} room details`);
    this.shadowRoot.querySelector(".room-button").title = `${name} · Room details`;
    const image = this._backgroundImage(model.area?.picture || "");
    const img = this.shadowRoot.querySelector("img");
    if (image !== this._image) { this._image = image; img.hidden = !image; if (image) img.src = image; else img.removeAttribute("src"); }
    this.shadowRoot.querySelector("ha-card").dataset.hasImage = String(Boolean(image) && !img.hidden);
    img.style.objectPosition = this._config.image_position || "50% 50%";
    const unit = temperatureUnit(this._config, this._hass);
    this._readings = Object.fromEntries(["temperature", "humidity"].map(kind => [kind, roomReading(kind, this._config, model, this._hass.states, unit)]));
    const readings = this.shadowRoot.querySelector(".readings");
    const readingSignature = JSON.stringify(Object.entries(this._readings).map(([kind, reading]) => [kind, reading?.entities]));
    if (readingSignature !== this._readingSignature) {
      this._readingSignature = readingSignature; readings.replaceChildren();
      for (const [kind, reading] of Object.entries(this._readings)) {
        if (!reading) continue;
        const node = button("reading", kind, event => this._openEntities(event.currentTarget.getAttribute("aria-label"), this._readings[kind].entities, event.currentTarget));
        node.dataset.kind = kind; readings.append(node);
      }
    }
    for (const [kind, reading] of Object.entries(this._readings)) {
      if (!reading) continue;
      const value = reading.value === null ? "—" : new Intl.NumberFormat(this._hass.locale?.language, { maximumFractionDigits: 1 }).format(reading.value);
      const label = `${kind === "temperature" ? "Temperature" : "Humidity"}: ${reading.value === null ? "unavailable" : `${value} ${reading.unit}`}`;
      const node = readings.querySelector(`[data-kind="${kind}"]`);
      node.setAttribute("aria-label", label); node.title = label;
      node.textContent = `${value}${reading.unit === "%" ? "" : " "}${reading.unit}`;
    }
    const warnings = this.shadowRoot.querySelector(".warnings");
    const activeWarnings = warningsFor(this._readings, thresholdsFor(this._config, unit));
    const warningSignature = JSON.stringify(activeWarnings.map(w => [w.key, w.entities]));
    if (warningSignature !== this._warningSignature) {
      this._warningSignature = warningSignature;
      const hadFocus = warnings.contains(this.shadowRoot.activeElement); warnings.replaceChildren();
      for (const warning of activeWarnings) {
        const node = button("warning", warning.text, event => this._openEntities(warning.text, warning.entities, event.currentTarget));
        node.dataset.kind = warning.key; node.append(iconNode(warning.icon)); warnings.append(node);
      }
      if (hadFocus) this.shadowRoot.querySelector(".room-button").focus();
    }
    const signature = JSON.stringify([model.tiles.map(t => [t.slot, t.kind]), model.indicators.map(t => t.kind)]);
    if (signature !== this._tileSignature) {
      this._tileSignature = signature;
      const tiles = this.shadowRoot.querySelector(".tiles"), indicators = this.shadowRoot.querySelector(".sensor-status");
      tiles.replaceChildren(); indicators.replaceChildren();
      tiles.dataset.alignment = this._config.tile_alignment ?? "right";
      this.shadowRoot.querySelector("ha-card").dataset.hasControls = String(model.tiles.length > 0);
      for (const tile of model.tiles) {
        const node = button("tile", GROUPS[tile.kind].name, event => this._openGroup(tile.kind, event.currentTarget));
        node.dataset.kind = tile.kind;
        node.append(iconNode(GROUPS[tile.kind].icon), element("span", "unavailable-dot", "!")); tiles.append(node);
      }
      for (const indicator of model.indicators) {
        const node = button("sensor-indicator", GROUPS[indicator.kind].name, event => this._openGroup(indicator.kind, event.currentTarget));
        node.dataset.kind = indicator.kind;
        node.append(iconNode(GROUPS[indicator.kind].icon), element("span", "unavailable-dot", "!")); indicators.append(node);
      }
    }
    for (const tile of [...model.tiles, ...model.indicators]) {
      const node = this.shadowRoot.querySelector(`.tile[data-kind="${tile.kind}"], .sensor-indicator[data-kind="${tile.kind}"]`);
      const status = groupStatus(tile.kind, tile.entities, this._hass.states);
      node.dataset.active = String(status.active); node.dataset.unavailable = String(status.unavailable === tile.entities.length);
      if (node.classList.contains("sensor-indicator")) {
        node.hidden = tile.kind === "contacts" && !status.active && !status.unavailable;
        if (node.hidden && this.shadowRoot.activeElement === node) this.shadowRoot.querySelector(".room-button").focus();
      }
      node.title = `${GROUPS[tile.kind].name}: ${status.status}`;
      node.setAttribute("aria-label", `${name} ${GROUPS[tile.kind].name}, ${status.status}`);
      node.querySelector(".unavailable-dot").hidden = !status.unavailable;
    }
    const sensorStatus = this.shadowRoot.querySelector(".sensor-status");
    sensorStatus.hidden = !sensorStatus.querySelector(".sensor-indicator:not([hidden])");
    this.shadowRoot.querySelector("ha-card").dataset.lit = String(groupStatus("lights", model.groups.lights, this._hass.states).active);
    this._message(!model.area ? "This room no longer exists. Select a room in the card editor." : this._registryError ? "Room assignments could not be refreshed." : this._mediaError ? "Background image could not be loaded. Select another image in the card editor." : !model.available.length && !this._readings.temperature && !this._readings.humidity ? "No supported devices assigned to this room" : "");
    if (this._dialog.open) this._updateDialog();
  }
  _openGroup(kind, opener) { this._showDialog({ kind, opener }); }
  _openDetails() { this._showDialog({ kind: "all", opener: this.shadowRoot.querySelector(".room-button") }); }
  _openEntities(title, entities, opener) {
    if (entities.length === 1) this._moreInfo(entities[0]);
    else this._showDialog({ kind: "sensors", title, entities, opener });
  }
  _showDialog(selection) {
    if (!this._model?.area) return;
    this._dialogSelection = selection; this._opener = selection.opener;
    this._dialogSignature = null; this.shadowRoot.querySelector(".dialog-error").textContent = "";
    this._updateDialog(); if (!this._dialog.open) this._dialog.showModal();
  }
  _closeDialog() { if (this._dialog.open) this._dialog.close(); }
  _dialogGroups() {
    const selection = this._dialogSelection;
    if (!selection) return [];
    if (selection.kind === "sensors") return [{ name: selection.title, entities: selection.entities.filter(id => !this._model.excluded.has(id)) }];
    if (selection.kind !== "all") return [{ name: GROUPS[selection.kind].name, entities: this._model.groups[selection.kind] }];
    const groups = this._model.available.map(kind => ({ name: GROUPS[kind].name, entities: this._model.groups[kind] }));
    const readings = [...new Set(Object.values(this._readings).flatMap(r => r?.entities ?? []))];
    if (readings.length) groups.unshift({ name: "Temperature and humidity", entities: readings });
    return groups;
  }
  _updateDialog() {
    const selection = this._dialogSelection; if (!selection) return;
    const name = this._config.name || this._model.area?.name || "Room";
    this.shadowRoot.querySelector(".dialog-heading").textContent = selection.kind === "all" ? `${name} · Room details` : `${name} · ${selection.title || GROUPS[selection.kind]?.name}`;
    const groups = this._dialogGroups();
    const signature = JSON.stringify(groups.map(group => ({ ...group, controls: group.entities.map(id => domainOf(id) === "light" ? lightCapabilities(this._hass.states[id]) : null) })));
    if (signature !== this._dialogSignature) {
      this._dialogSignature = signature; const list = this.shadowRoot.querySelector(".dialog-list"); list.replaceChildren(); this._rows.clear();
      if (!groups.some(g => g.entities.length)) list.append(element("p", "empty", "No devices in this group."));
      for (const group of groups) {
        if (selection.kind === "all") list.append(element("h3", "group-title", group.name));
        for (const id of group.entities) {
          const row = element("div", "entity-row"); row.dataset.entity = id;
          const details = button("entity-details", `Details for ${id}`, () => this._moreInfo(id));
          const icon = iconNode("mdi:help-circle-outline"), text = element("span", "entity-text"), label = element("span", "entity-name"), state = element("span", "entity-state");
          text.append(label, state); details.append(icon, text); row.append(details);
          const domain = domainOf(id);
          let action;
          const sliders = {};
          const isLight = domain === "light" || (domain === "switch" && this._model.groups.lights.includes(id));
          if (["light", "switch", "fan"].includes(domain)) {
            action = button(isLight ? "entity-toggle" : "entity-action", `Toggle ${id}`, () => this._toggle(id));
            if (isLight) { action.setAttribute("role", "switch"); action.append(element("span", "toggle-thumb")); }
            row.append(action);
          }
          const capabilities = domain === "light" ? lightCapabilities(this._hass.states[id]) : {};
          for (const [kind, title, min, max, change] of [
            ["brightness", "Brightness", 1, 100, value => this._setBrightness(id, value)],
            ["color", "Color", 0, 360, value => this._setColor(id, value)],
            ["temperature", "White temperature", ...lightTemperatureBounds(this._hass.states[id]?.attributes), value => this._setTemperature(id, value)],
          ]) {
            if (!capabilities[kind]) continue;
            const control = element("label", `light-control ${kind}-control`);
            const caption = element("span", "control-label", title), value = element("span", "control-value");
            const input = element("input", `light-slider ${kind}`); input.type = "range"; input.min = String(min); input.max = String(max); input.step = "1";
            input.addEventListener("input", () => {
              this._sliderValue(kind, input, value);
              if (kind === "color") row.style.setProperty("--light-color", `hsl(${input.value} 100% 50%)`);
            });
            input.addEventListener("change", () => change(Number(input.value)));
            control.append(caption, value, input); row.append(control); sliders[kind] = { input, value };
          }
          this._rows.set(id, { row, details, icon, label, state, action, sliders, isLight }); list.append(row);
        }
      }
    }
    for (const [id, nodes] of this._rows) {
      const state = this._hass.states[id], registry = this._registries.entities.find(e => e.entity_id === id);
      const name = state?.attributes?.friendly_name || registry?.name || registry?.original_name || id;
      nodes.label.textContent = name;
      const hidePowerState = nodes.isLight && ["on", "off"].includes(state?.state);
      nodes.state.textContent = hidePowerState ? "" : state ? this._formatState(state) : "Unavailable";
      nodes.state.hidden = hidePowerState;
      nodes.details.setAttribute("aria-label", `Details for ${name}`); nodes.details.title = `Open ${name} details`;
      const fallback = GROUPS[Object.keys(this._model.groups).find(k => this._model.groups[k].includes(id))]?.icon || (state?.attributes?.device_class === "temperature" ? "mdi:thermometer" : "mdi:water-percent");
      nodes.icon.setAttribute("icon", state?.attributes?.icon || fallback);
      nodes.icon.dataset.on = String(nodes.isLight && state?.state === "on");
      if (nodes.action) {
        const on = state?.state === "on";
        if (nodes.isLight) nodes.action.setAttribute("aria-checked", String(on));
        else nodes.action.textContent = this._pending.has(id) ? "…" : on ? "On" : "Off";
        nodes.action.dataset.on = String(on); nodes.action.disabled = !usable(state) || this._pending.has(id);
        nodes.action.setAttribute("aria-busy", String(this._pending.has(id)));
        nodes.action.setAttribute("aria-label", `${on ? "Turn off" : "Turn on"} ${name}`);
        nodes.action.title = `${on ? "Turn off" : "Turn on"} ${name}`;
      }
      if (Object.keys(nodes.sliders).length) {
        const attributes = state?.attributes ?? {}, previous = this._lightValues.get(id);
        const color = lightColor(attributes, previous);
        const brightness = Number.isFinite(attributes.brightness) && attributes.brightness > 0 ? Math.max(1, Math.round(attributes.brightness / 255 * 100)) : previous?.brightness ?? 100;
        const bounds = lightTemperatureBounds(attributes);
        const temperature = attributes.color_temp_kelvin ?? (attributes.color_temp > 0 ? Math.round(1000000 / attributes.color_temp) : previous?.temperature ?? bounds[0]);
        this._lightValues.set(id, { ...color, brightness, temperature });
        const editingColor = this.shadowRoot.activeElement === nodes.sliders.color?.input;
        if (!editingColor) nodes.row.style.setProperty("--light-color", !nodes.sliders.color || attributes.color_mode === "color_temp" || !color.saturation ? "#fff" : `hsl(${color.hue} ${color.saturation}% 50%)`);
        for (const [kind, { input, value }] of Object.entries(nodes.sliders)) {
          if (kind === "temperature") { input.min = String(bounds[0]); input.max = String(bounds[1]); }
          if (this.shadowRoot.activeElement !== input) input.value = String(kind === "brightness" ? brightness : kind === "color" ? Math.round(color.hue) : temperature);
          input.disabled = !usable(state) || this._pending.has(id);
          input.setAttribute("aria-label", `${name} ${kind === "temperature" ? "white temperature" : kind}`);
          this._sliderValue(kind, input, value);
        }
      }
    }
  }
  _sliderValue(kind, input, output) {
    const text = `${input.value}${kind === "brightness" ? "%" : kind === "color" ? "°" : " K"}`;
    output.textContent = kind === "color" ? "" : text; input.setAttribute("aria-valuetext", text);
    if (kind === "color") input.style.setProperty("--swatch-color", `hsl(${input.value} 100% 50%)`);
  }
  _formatState(state) {
    try { if (this._hass.formatEntityState) return this._hass.formatEntityState(state); } catch { /* Minimal HA clients still render the raw state. */ }
    return `${state.state.replace(/_/g, " ")}${state.attributes?.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : ""}`;
  }
  async _service(id, domain, service, data = {}) {
    if (this._pending.has(id) || !usable(this._hass.states[id])) return;
    this._pending.add(id); this._updateDialog(); this.shadowRoot.querySelector(".dialog-error").textContent = "";
    try { await this._hass.callService(domain, service, data, { entity_id: id }); }
    catch (error) { this.shadowRoot.querySelector(".dialog-error").textContent = error?.message || "The device could not be controlled. Please try again."; }
    finally { this._pending.delete(id); this._updateDialog(); }
  }
  _toggle(id) { const domain = domainOf(id); if (["light", "switch", "fan"].includes(domain)) return this._service(id, domain, this._hass.states[id]?.state === "on" ? "turn_off" : "turn_on"); }
  _setBrightness(id, percent) { return this._service(id, "light", "turn_on", { brightness_pct: Math.max(1, Math.min(100, percent)) }); }
  _setColor(id, hue) { return this._service(id, "light", "turn_on", { hs_color: [hue, 100] }); }
  _setTemperature(id, kelvin) { return this._service(id, "light", "turn_on", { color_temp_kelvin: kelvin }); }
  _moreInfo(entityId) { this._closeDialog(); this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } })); }
}

if (!customElements.get("room-overview-card")) customElements.define("room-overview-card", RoomOverviewCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "room-overview-card")) window.customCards.push({ type: "room-overview-card", name: "Room Overview Card", description: "Choose a room and up to four groups of devices.", preview: true });


class RoomOverviewCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._search = {}; }
  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && this._connection !== hass.connection) { this._unwatch?.(); this._unwatch = null; this._connection = hass.connection; }
    this._watch(); this._render();
  }
  connectedCallback() { this._watch(); this._render(); }
  disconnectedCallback() { this._unwatch?.(); this._unwatch = null; }
  _watch() {
    if (!this.isConnected || !this._hass || this._unwatch) return;
    this._connection = this._hass.connection;
    this._unwatch = watchRegistries(this._hass, (data, error) => { this._registries = data; this._registryError = error; this._render(); });
  }
  _change(key, value) {
    this._config = { ...this._config };
    if (value === undefined || value === "") delete this._config[key]; else this._config[key] = value;
    this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this._config } }));
    this._render();
  }
  _select(key, label, options, selected, onChange) {
    const field = element("label", "field"); field.append(element("span", "label", label));
    const select = element("select"); select.dataset.key = key;
    for (const choice of options) {
      const option = element("option", "", choice.label); option.value = choice.value; option.disabled = !!choice.disabled; select.append(option);
    }
    select.value = selected ?? "";
    select.addEventListener("change", () => onChange(select.value)); field.append(select); return field;
  }
  _input(key, label, value, onChange, type = "text") {
    const field = element("label", "field"); field.append(element("span", "label", label));
    const input = element("input"); input.type = type; input.dataset.key = key; input.value = value ?? "";
    if (type === "number") input.step = "0.1";
    input.addEventListener("change", () => onChange(input.value)); field.append(input); return field;
  }
  _selector(key, label, selector, value, onChange) {
    const field = element("div", "field"), picker = element("ha-selector");
    picker.dataset.key = key; picker.hass = this._hass; picker.label = label;
    picker.selector = selector; picker.value = value; picker.required = false;
    picker.addEventListener("value-changed", event => {
      event.stopPropagation(); onChange(event.detail.value);
    });
    field.append(picker); return field;
  }
  _multiSelect(key, label, entities, selected) {
    const field = element("label", "field"); field.append(element("span", "label", label));
    const select = element("select"); select.multiple = true; select.dataset.key = key;
    const ids = [...new Set([...entities.map(e => e.entity_id), ...selected])];
    for (const id of ids) {
      const entity = entities.find(e => e.entity_id === id);
      const option = element("option", "", this._hass.states[id]?.attributes?.friendly_name || entity?.name || entity?.original_name || id);
      option.value = id; option.selected = selected.includes(id); select.append(option);
    }
    select.addEventListener("change", () => this._change(key, [...select.selectedOptions].map(o => o.value))); field.append(select); return field;
  }
  _entityName(entity) {
    return this._hass.states[entity.entity_id]?.attributes?.friendly_name || entity.name || entity.original_name || entity.entity_id;
  }
  _exclusionChoices(model) {
    const registryEntities = new Map(this._registries.entities.map(e => [e.entity_id, e]));
    const registryDevices = new Map(this._registries.devices.map(d => [d.id, d]));
    const selectedDevices = new Set(this._config.exclude_devices ?? []);
    const entities = new Map(model.roomEntities.filter(e => entityKind(e, this._hass.states[e.entity_id])).map(e => [e.entity_id, e]));
    // Keep explicit and Area-selected readings manageable even when they live outside the room.
    for (const kind of ["temperature", "humidity"]) {
      for (const id of [model.area?.[`${kind}_entity_id`], this._config[`${kind}_sensor`]]) {
        const entity = registryEntities.get(id);
        if (entity) entities.set(id, entity);
      }
    }
    const roomIds = new Set(model.roomEntities.map(e => e.entity_id));
    const byDevice = new Map();
    for (const entity of entities.values()) if (entity.device_id) {
      if (!byDevice.has(entity.device_id)) byDevice.set(entity.device_id, []);
      byDevice.get(entity.device_id).push(entity);
    }
    const deviceIds = new Set([...byDevice.keys(), ...selectedDevices]);
    const deviceChoices = [...deviceIds].map(id => {
      const device = registryDevices.get(id), members = byDevice.get(id) ?? [];
      const kinds = [...new Set(members.map(e => {
        const kind = entityKind(e, this._hass.states[e.entity_id]);
        return GROUPS[kind]?.name ?? (kind === "temperature" ? "Temperature" : kind === "humidity" ? "Humidity" : "");
      }).filter(Boolean))];
      const detail = device ? `${members.length} ${members.length === 1 ? "entity" : "entities"} in this card${kinds.length ? ` · ${kinds.join(", ")}` : ""}` : "Device no longer exists";
      return { id, name: device?.name_by_user || device?.name || id, detail };
    });
    for (const id of this._config.exclude_entities ?? []) if (!entities.has(id)) entities.set(id, registryEntities.get(id) ?? { entity_id: id });
    // Retain siblings of saved device exclusions after reassignment so they are still visible.
    for (const entity of this._registries.entities) if (selectedDevices.has(entity.device_id) && entityKind(entity, this._hass.states[entity.entity_id])) entities.set(entity.entity_id, entity);
    const entityChoices = [...entities.values()].map(entity => {
      const id = entity.entity_id;
      const deviceExcluded = selectedDevices.has(entity.device_id);
      const linkedExcluded = model.excluded.has(id) && !(this._config.exclude_entities ?? []).includes(id);
      const inherited = deviceExcluded || linkedExcluded;
      const note = deviceExcluded ? "Excluded with device" : linkedExcluded ? "Excluded through a linked entity" : !registryEntities.has(id) ? "Entity no longer exists" : !roomIds.has(id) ? "Outside this room" : !entity.device_id ? "No device" : "";
      return { id, name: this._entityName(entity), detail: `${id}${note ? ` · ${note}` : ""}`, inherited };
    });
    const sort = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    return { devices: deviceChoices.sort(sort), entities: entityChoices.sort(sort) };
  }
  _exclusionList(key, label, choices) {
    const section = element("div", "exclusion-list"); section.setAttribute("role", "group"); section.setAttribute("aria-label", key === "exclude_devices" ? "Devices to exclude" : "Entities to exclude");
    const field = element("label", "field"); field.append(element("span", "label", label));
    const search = element("input"); search.type = "search"; search.dataset.key = `search-${key}`;
    search.placeholder = key === "exclude_devices" ? "Device name…" : "Entity name or ID…";
    search.value = this._search[key] ?? ""; field.append(search); section.append(field);
    const list = element("div", "exclusion-options"), selected = new Set(this._config[key] ?? []); list.dataset.list = key;
    const rows = choices.map(choice => {
      const row = element("label", "exclusion-option"); row.dataset.search = `${choice.name} ${choice.id} ${choice.detail}`.toLowerCase();
      const input = element("input"); input.type = "checkbox"; input.dataset.key = `${key}:${choice.id}`;
      input.checked = selected.has(choice.id) || !!choice.inherited; input.disabled = !!choice.inherited;
      input.setAttribute("aria-label", `Exclude ${key === "exclude_devices" ? "device" : "entity"} ${choice.name}`);
      input.addEventListener("change", () => {
        const ids = new Set(this._config[key] ?? []);
        if (input.checked) ids.add(choice.id); else ids.delete(choice.id);
        this._change(key, ids.size ? [...ids] : undefined);
      });
      const text = element("span", "exclusion-text");
      text.append(element("span", "exclusion-name", choice.name), element("span", "exclusion-detail", choice.detail));
      row.append(input, text); list.append(row); return row;
    });
    const empty = element("p", "hint exclusion-empty"); empty.setAttribute("role", "status"); list.append(empty);
    const filter = () => {
      const query = search.value.trim().toLowerCase();
      for (const row of rows) row.hidden = !row.dataset.search.includes(query);
      empty.hidden = rows.some(row => !row.hidden);
      empty.textContent = query ? "No matches" : key === "exclude_devices" ? "No supported devices assigned to this room. Helpers can be excluded under Specific entities." : "No supported entities assigned to this room.";
    };
    search.addEventListener("input", () => { this._search[key] = search.value; filter(); list.scrollTop = 0; });
    filter(); section.append(list); return section;
  }
  _exclusions(choices, openSections) {
    const details = element("details", "exclusions"); details.dataset.section = "exclusions"; details.open = openSections.exclusions ?? false;
    const deviceCount = new Set(this._config.exclude_devices ?? []).size, entityCount = new Set(this._config.exclude_entities ?? []).size;
    const summary = element("summary", "", "Device exclusions ");
    summary.append(element("span", "exclusion-count", `${deviceCount} ${deviceCount === 1 ? "device" : "devices"} · ${entityCount} ${entityCount === 1 ? "entity" : "entities"}`));
    details.append(summary, element("p", "hint", "Checked devices and all their entities are excluded from this card."));
    details.append(this._exclusionList("exclude_devices", "Search room devices", choices.devices));
    const entities = element("details", "specific-entities"); entities.dataset.section = "entities"; entities.open = openSections.entities ?? false;
    const entitySummary = element("summary", "", "Specific entities "); entitySummary.append(element("span", "exclusion-count", `${entityCount} excluded individually`));
    entities.append(entitySummary, this._exclusionList("exclude_entities", "Search room entities", choices.entities));
    details.append(entities); return details;
  }
  _render() {
    if (!this._hass || !this._registries) {
      this.shadowRoot.innerHTML = `<style>${EDITOR_STYLE}</style><p class="hint"></p>`;
      this.shadowRoot.querySelector("p").textContent = this._registryError ? "Room information could not be loaded. Reload to try again." : "Loading rooms…";
      return;
    }
    const model = discoverRoom(this._config, this._registries, this._hass.states);
    const exclusionChoices = this._exclusionChoices(model);
    const unit = temperatureUnit(this._config, this._hass), thresholds = thresholdsFor(this._config, unit);
    const selections = Array.from({ length: 4 }, (_, i) => {
      const kind = Array.isArray(this._config.tiles) ? this._config.tiles[i] : model.controlGroups[i];
      return CONTROL_GROUP_ORDER.includes(kind) ? kind : "none";
    });
    const signature = JSON.stringify([this._config, this._registries.areas, model.groups, model.sensors, exclusionChoices, unit]);
    if (signature === this._signature) {
      for (const picker of this.shadowRoot.querySelectorAll("ha-selector")) picker.hass = this._hass;
      return;
    }
    this._signature = signature;
    const focusKey = this.shadowRoot.activeElement?.dataset?.key;
    const searchSelection = this.shadowRoot.activeElement?.type === "search" ? [this.shadowRoot.activeElement.selectionStart, this.shadowRoot.activeElement.selectionEnd] : null;
    const openSections = Object.fromEntries([...this.shadowRoot.querySelectorAll("details[data-section]")].map(d => [d.dataset.section, d.open]));
    const scrollPositions = new Map([...this.shadowRoot.querySelectorAll("[data-list]")].map(list => [list.dataset.list, list.scrollTop]));
    this.shadowRoot.innerHTML = `<style>${EDITOR_STYLE}</style><div class="editor"></div>`;
    const root = this.shadowRoot.querySelector(".editor");
    const areas = [...this._registries.areas].sort((a, b) => a.name.localeCompare(b.name));
    const areaOptions = [{ value: "", label: "Select a room" }, ...areas.map(a => ({ value: a.area_id ?? a.id, label: a.name }))];
    if (this._config.area && !model.area) areaOptions.push({ value: this._config.area, label: "Room no longer exists" });
    root.append(this._select("area", "Room", areaOptions, this._config.area, value => {
      if (!value) return;
      this._config = { ...this._config };
      // A new room starts with its own defaults rather than stale entity selections.
      for (const key of ["tiles", "temperature_sensor", "humidity_sensor", "exclude_devices", "exclude_entities", "light_switches", "name", "icon", "image", "image_position"]) delete this._config[key];
      this._search = {};
      this._change("area", value);
    }));
    root.append(element("p", "hint", "The name, icon, image and devices follow the selected room. Motion and contacts appear beside the warning icons; control tiles share one row at the bottom."));
    root.append(this._selector("icon", "Room icon override", { icon: { placeholder: model.area?.icon || "mdi:home-outline" } }, this._config.icon, value => this._change("icon", value || undefined)));
    root.append(element("p", "hint", "Search all available Home Assistant icons. Clear the selection to use the room icon."));
    const imageField = this._selector("image", "Background image override", { media: { accept: ["image/*"], hide_content_type: true } }, this._config.image ? { media_content_id: this._config.image, media_content_type: "image" } : undefined, value => this._change("image", value?.media_content_id || undefined));
    if (this._config.image) {
      const resetImage = button("reset", "Use room background", () => this._change("image", undefined));
      resetImage.textContent = "Use room background"; imageField.append(resetImage);
    }
    root.append(imageField);
    root.append(element("p", "hint", "Browse My media to select an image from your Media folders, or enter an image URL or /local/ path. Clear the selection to use the room picture. Rooms without a picture use the theme's card background."));
    root.append(element("div", "section-title", "Control tiles"));
    const slots = element("div", "slots");
    for (let i = 0; i < 4; i++) {
      const choices = CONTROL_GROUP_ORDER.filter(kind => model.groups[kind].length || selections[i] === kind);
      const options = [{ value: "none", label: "None" }, ...choices.map(kind => ({ value: kind, label: `${GROUPS[kind].name} (${model.groups[kind].length})`, disabled: selections.some((k, slot) => slot !== i && k === kind) }))];
      const field = this._select(`tile-${i}`, `Tile ${i + 1}`, options, selections[i], value => { const tiles = [...selections]; tiles[i] = value; this._change("tiles", tiles); });
      field.querySelector("select").disabled = !model.area; slots.append(field);
    }
    root.append(slots);
    root.append(element("p", "hint", this._config.tiles === undefined ? "Tiles are filled automatically. Choose a group or None in any of the four slots to customise them." : "These four choices are saved. Group members still update automatically when room assignments change."));
    const reset = button("reset", "Use automatic mini tiles", () => this._change("tiles", undefined)); reset.textContent = "Use automatic mini tiles"; root.append(reset);
    root.append(this._select("tile_alignment", "Mini tile alignment", [
      { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
    ], this._config.tile_alignment ?? "right", value => this._change("tile_alignment", value)));
    root.append(this._exclusions(exclusionChoices, openSections));
    const details = element("details", "advanced"); details.dataset.section = "advanced"; details.open = openSections.advanced ?? false; details.append(element("summary", "", "Advanced"));
    details.append(this._input("name", "Room name override", this._config.name, value => this._change("name", value)));
    for (const kind of ["temperature", "humidity"]) {
      const preferred = model.area?.[`${kind}_entity_id`];
      const ids = [...new Set([...model.sensors[kind], ...(preferred ? [preferred] : []), ...(this._config[`${kind}_sensor`] && this._config[`${kind}_sensor`] !== "none" ? [this._config[`${kind}_sensor`]] : [])])];
      const options = [{ value: "", label: preferred && !model.excluded.has(preferred) ? `Automatic (${this._hass.states[preferred]?.attributes?.friendly_name || preferred})` : "Automatic" }, { value: "none", label: "None" }, ...ids.map(id => ({ value: id, label: `${this._hass.states[id]?.attributes?.friendly_name || id}${model.excluded.has(id) ? " (excluded)" : ""}`, disabled: model.excluded.has(id) }))];
      details.append(this._select(`${kind}_sensor`, kind === "temperature" ? "Temperature sensor" : "Humidity sensor", options, this._config[`${kind}_sensor`], value => this._change(`${kind}_sensor`, value)));
      if (model.excluded.has(this._config[`${kind}_sensor`] || preferred)) details.append(element("p", "hint", "The selected sensor is excluded. Remaining room sensors are used automatically, or a dash if none remain."));
    }
    details.append(this._select("temperature_unit", "Temperature unit", [{ value: "auto", label: "Home Assistant default" }, { value: "°C", label: "Celsius" }, { value: "°F", label: "Fahrenheit" }], this._config.temperature_unit ?? "auto", value => {
      const previous = temperatureUnit(this._config, this._hass);
      const next = value === "auto" ? this._hass.config?.unit_system?.temperature ?? "°C" : value;
      if (previous !== next && this._config.thresholds) {
        const converted = { ...this._config.thresholds };
        for (const key of ["temperature_low", "temperature_high"]) if (converted[key] != null) converted[key] = Number(convertTemperature(converted[key], previous, next).toFixed(2));
        this._config = { ...this._config, thresholds: converted };
      }
      this._change("temperature_unit", value);
    }));
    details.append(element("div", "section-title", "Warning thresholds"));
    const limits = element("div", "unit-grid");
    for (const key of ["temperature_low", "temperature_high", "humidity_low", "humidity_high"]) {
      const [kind, bound] = key.split("_");
      limits.append(this._input(key, `${bound === "low" ? "Low" : "High"} ${kind} (${kind === "temperature" ? unit : "%"})`, thresholds[key], value => this._change("thresholds", { ...this._config.thresholds, [key]: value === "" ? null : Number(value) }), "number"));
    }
    details.append(limits, element("p", "hint", "A warning appears outside these limits. Leave a limit blank to disable that warning."));
    const switches = model.entities.filter(e => domainOf(e.entity_id) === "switch");
    if (switches.length || this._config.light_switches?.length) details.append(this._multiSelect("light_switches", "Switches to include in Lights", switches, this._config.light_switches ?? []));
    details.append(element("p", "hint", "Use Ctrl or Command to select multiple lighting switches. Other room assignments are managed in Home Assistant."));
    root.append(details);
    const error = element("p", "error", this._registryError ? "Room assignments could not be refreshed." : ""); error.setAttribute("role", "alert"); root.append(error);
    for (const list of this.shadowRoot.querySelectorAll("[data-list]")) list.scrollTop = scrollPositions.get(list.dataset.list) ?? 0;
    if (focusKey) {
      const focused = [...this.shadowRoot.querySelectorAll("[data-key]")].find(node => node.dataset.key === focusKey);
      focused?.focus({ preventScroll: true });
      if (searchSelection && focused?.type === "search") focused.setSelectionRange(...searchSelection);
    }
  }
}
if (!customElements.get("room-overview-card-editor")) customElements.define("room-overview-card-editor", RoomOverviewCardEditor);

})();
