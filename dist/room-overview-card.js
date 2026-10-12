/* Room Overview + Control Card v1.3.2
MIT License

Copyright (c) 2026 Room Control Card contributors
Copyright (c) 2026 Room Overview Card contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Built from src/; run npm run build.
*/
(() => {
"use strict";
// Each surface owns its own exclusions. Legacy keys affect the overview only.
function exclusionList(config, surface = "overview") {
  return config[`${surface}_exclusions`] ?? (surface === "overview"
    ? { devices: config.exclude_devices ?? [], entities: config.exclude_entities ?? [] }
    : { devices: [], entities: [] });
}

function normalizeExclusions(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain device and entity lists.`);
  for (const key of Object.keys(value)) if (!["devices", "entities"].includes(key)) throw new Error(`Unknown ${label} option: ${key}.`);
  const result = {};
  for (const key of ["devices", "entities"]) {
    const ids = value[key] ?? [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim())) throw new Error(`${label}.${key} must be a list of IDs.`);
    result[key] = [...new Set(ids.map(id => id.trim()))];
  }
  return result;
}

function migrateExclusions(config) {
  const next = { ...config };
  for (const surface of ["overview", "control"]) next[`${surface}_exclusions`] = normalizeExclusions(exclusionList(config, surface), `${surface}_exclusions`);
  delete next.exclude_devices; delete next.exclude_entities;
  return next;
}

function expandExclusions(lists, registries, states = {}) {
  const excluded = new Set(lists.entities ?? []), devices = new Set(lists.devices ?? []);
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

// Use HA's loader; never bundle or imitate its components.
let nativeComponents;
function loadNativeComponents() {
  nativeComponents ??= Promise.resolve().then(async () => {
    if (typeof window.loadCardHelpers !== "function") throw new Error("Open this card in a Home Assistant dashboard.");
    const helpers = await window.loadCardHelpers();
    helpers.createCardElement({ type: "tile", entity: "light.room_loader" });
    await customElements.whenDefined("hui-tile-card");
    // HA's editor imports its native forms and expansion panels as needed.
    await customElements.get("hui-tile-card").getConfigElement();
    return helpers;
  }).catch(error => { nativeComponents = undefined; throw error; });
  return nativeComponents;
}

const { validateConfig, controlFilterReason } = (() => {
// Display-only rules. They never disable entities or change their HA settings.
function controlFilterReason(entry, state, config) {
  if ((config.always_show ?? []).includes(entry.entity_id)) return "";
  const domain = entry.entity_id.split(".")[0];
  const deviceClass = entry.device_class ?? state?.attributes?.device_class ?? entry.original_device_class;
  if (config.everyday_controls !== false) {
    if (domain === "automation") return "Automation";
    if (domain === "update") return "Update / firmware";
    if (deviceClass === "identify") return "Identify button";
    if (entry.entity_category === "config") return "Device configuration";
  }
  // Battery percentage is useful room status even when classified Diagnostic.
  if (!config.include_diagnostics && entry.entity_category === "diagnostic" && !(domain === "sensor" && deviceClass === "battery")) return "Diagnostic detail";
  return "";
}

const DEFAULT_CONFIG = { layout: "compact", camera_layout: "carousel", show_title: true, everyday_controls: true, include_diagnostics: false, include_hidden: true };
const humanize = value => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
const domainOf = id => String(id).split(".")[0];
const entityName = entity => entity.attributes?.friendly_name || humanize(entity.entity_id.split(".").slice(1).join("."));
const unavailable = entity => !entity || ["unavailable", "unknown"].includes(entity.state);

function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Provide a card configuration.");
  if (config.area !== undefined && (typeof config.area !== "string" || !config.area.trim())) throw new Error("area must be a non-empty area ID or name.");
  for (const key of ["entities", "exclude_entities", "exclude_devices", "always_show"]) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some(id => typeof id !== "string" || !id.trim()))) throw new Error(`${key} must be a list of IDs.`);
  }
  if (config.entities?.some(id => !/^[a-z_]+\.[a-z0-9_]+$/.test(id))) throw new Error("entities must contain valid entity IDs.");
  if (config.always_show?.some(id => !/^[a-z_]+\.[a-z0-9_]+$/.test(id.trim()))) throw new Error("always_show must contain valid entity IDs.");
  if (!config.area && !config.entities?.length) throw new Error("Select an area or provide an entities list.");
  if (config.layout !== undefined && !["compact", "tiles", "grouped"].includes(config.layout)) throw new Error("layout must be compact, tiles or grouped.");
  if (config.camera_layout !== undefined && !["carousel", "tiles"].includes(config.camera_layout)) throw new Error("camera_layout must be carousel or tiles.");
  for (const key of ["show_title", "everyday_controls", "include_diagnostics", "include_hidden"]) if (config[key] !== undefined && typeof config[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  for (const key of ["name", "icon"]) if (config[key] !== undefined && typeof config[key] !== "string") throw new Error(`${key} must be a string.`);
  return { ...DEFAULT_CONFIG, ...config, ...(config.layout === "grouped" ? { layout: "compact" } : {}), ...(config.entities ? { entities: [...new Set(config.entities)] } : {}), ...(config.always_show ? { always_show: [...new Set(config.always_show.map(id => id.trim()))] } : {}) };
}

function discoverRoom(config, hass, registries) {
  const areas = registries?.areas ?? Object.values(hass?.areas ?? {});
  const area = areas.find(item => item.area_id === config.area) ?? areas.find(item => item.name?.toLowerCase() === config.area?.toLowerCase());
  const devices = new Map((registries?.devices ?? Object.values(hass?.devices ?? {})).map(item => [item.id, item]));
  const entries = registries?.entities ?? Object.values(hass?.entities ?? {});
  const registry = new Map(entries.map(entry => [entry.entity_id, entry]));
  const excluded = expandExclusions({ entities: config.exclude_entities, devices: config.exclude_devices }, { entities: entries }, hass?.states);
  const explicit = !!config.entities?.length;
  const ids = explicit ? config.entities : entries.filter(entry => {
    if (!area || entry.disabled_by) return false;
    if (!config.include_hidden && entry.hidden_by) return false;
    return (entry.area_id ?? devices.get(entry.device_id)?.area_id) === area.area_id;
  }).map(entry => entry.entity_id);
  const entities = [...new Set(ids)].filter(id => !excluded.has(id) && !controlFilterReason(registry.get(id) ?? { entity_id: id }, hass?.states?.[id], config)).map(id => hass?.states?.[id] ?? { entity_id: id, state: "unavailable", attributes: { friendly_name: registry.get(id)?.name || humanize(id.split(".")[1]) } });
  if (!explicit) entities.sort((a, b) => entityName(a).localeCompare(entityName(b)));
  return { area, entities, devices, name: config.name || area?.name || (explicit ? "Room" : humanize(config.area)), registry };
}


const token = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const words = value => String(value).replaceAll('_', ' ').replace(/\bwiim\b/gi, 'WiiM').replace(/\bsonos\b/gi, 'Sonos').replace(/\bhomepod\b/gi, 'HomePod').replace(/\bapple tv\b/gi, 'Apple TV').replace(/\bmusic assistant\b/gi, 'Music Assistant').replace(/^./, char => char.toUpperCase());
const categories = new Set(['light', 'plug', 'switch', 'sensor', 'speaker', 'player', 'cover', 'fan', 'camera', 'button', 'climate']);

function readableName(entity, room) {
  const original = entity.attributes?.friendly_name || entity.entity_id;
  // Only shorten machine-style dotted names. Human-authored names stay intact.
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/i.test(original)) {
    const entry = room.registry?.get(entity.entity_id);
    const device = room.devices?.get(entry?.device_id);
    const prefix = device?.name_by_user || device?.name;
    if (!entry?.name && prefix && original.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return original.slice(prefix.length + 1);
    return original;
  }
  const parts = original.split('.');
  if ([token(room.name), token(room.area?.name), token(room.area?.area_id)].includes(token(parts[0]))) parts.shift();
  else if (original === entity.entity_id) parts.shift();
  else return original;
  const category = parts[0];
  if (categories.has(category) && parts.length > 1) parts.shift();
  if (parts.at(-1) === 'binary_sensor') parts.pop();
  if (domainOf(entity.entity_id) === 'camera' && parts.at(-1) === 'live_view') parts.pop();
  return parts.map(words).join(' · ') || words(category || domainOf(entity.entity_id));
}

const SETUP_KEYS = new Set(['click_mode', 'power_on_behavior', 'motion_detection', 'status_light', 'crossfade', 'loudness', 'bass', 'treble', 'balance', 'tv_autoplay', 'ungroup_on_autoplay', 'touch_controls', 'favorite_current_song']);
const CONTROL_SECTIONS = {
  light: 'Lights', switch: 'Power', input_boolean: 'Power',
  climate: 'Climate & air', fan: 'Climate & air', humidifier: 'Climate & air', water_heater: 'Climate & air',
  cover: 'Doors & blinds', lock: 'Security',
  media_player: 'Media', vacuum: 'Cleaning', scene: 'Scenes & actions', script: 'Scenes & actions',
  button: 'Scenes & actions', input_button: 'Scenes & actions',
  select: 'Controls', input_select: 'Controls', number: 'Controls', input_number: 'Controls',
};
const SECTION_ORDER = ['Lights', 'Power', 'Climate & air', 'Doors & blinds', 'Security', 'Media', 'Cleaning', 'Scenes & actions', 'Controls'];
const IMPORTANT_SENSORS = new Set(['temperature', 'humidity', 'motion', 'occupancy', 'presence', 'door', 'window', 'opening', 'garage_door', 'smoke', 'gas', 'moisture', 'carbon_monoxide', 'carbon_dioxide', 'pm25', 'pm10', 'volatile_organic_compounds', 'power', 'enum']);
const STATUS_NAMES = { temperature: 'Temperature', humidity: 'Humidity', presence: 'Presence', openings: 'Openings', smoke: 'Smoke', gas: 'Gas', moisture: 'Moisture', carbon_monoxide: 'Carbon monoxide', carbon_dioxide: 'CO₂', pm25: 'PM2.5', pm10: 'PM10', volatile_organic_compounds: 'Air quality', power: 'Power' };
const STATUS_ICONS = { temperature: 'thermometer', humidity: 'droplets', presence: 'person-standing', openings: 'door-open', smoke: 'shield-alert', gas: 'shield-alert', moisture: 'droplet', power: 'zap', battery: 'battery-warning' };
const prettyNumber = number => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(number);

function sensorType(entity) {
  const value = entity.attributes?.device_class;
  if (['motion', 'occupancy', 'presence'].includes(value)) return 'presence';
  if (['door', 'window', 'opening', 'garage_door'].includes(value)) return 'openings';
  return value;
}

function displayState(entity) {
  if (unavailable(entity)) return words(entity.state);
  const value = Number(entity.state);
  const state = String(entity.state).trim() !== '' && Number.isFinite(value) ? prettyNumber(value) : words(entity.state);
  return `${state}${entity.attributes?.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : ''}`;
}

function presentRoom(room, config = {}) {
  const always = new Set(config.always_show ?? []);
  const groups = new Map();
  const details = { Sensors: [], Batteries: [], 'Events & history': [], 'Device settings': [], 'Other entities': [] };
  const cameras = [];
  const sensorGroups = new Map();
  const named = room.entities.map(entity => ({ ...entity, attributes: { ...entity.attributes, device_class: room.registry?.get(entity.entity_id)?.device_class ?? entity.attributes?.device_class ?? room.registry?.get(entity.entity_id)?.original_device_class }, name: readableName(entity, room) }));
  // Preserve distinctions when two entities have the same user-facing name.
  const counts = new Map();
  for (const entity of named) counts.set(entity.name, (counts.get(entity.name) || 0) + 1);
  const duplicates = new Map();
  for (const entity of named) {
    if (counts.get(entity.name) > 1) {
      const name = entity.name, index = (duplicates.get(name) || 0) + 1;
      duplicates.set(name, index);
      entity.name += ` · ${index}`;
    }
    const domain = domainOf(entity.entity_id), dc = entity.attributes.device_class;
    const key = (entity.attributes.friendly_name || entity.entity_id).split('.').at(-1);
    if (domain === 'camera') { cameras.push(entity); continue; }
    if (['sensor', 'binary_sensor', 'event'].includes(domain)) {
      const history = domain === 'event' || dc === 'timestamp';
      const battery = dc === 'battery';
      const important = domain !== 'event' && IMPORTANT_SENSORS.has(dc);
      if ((important || always.has(entity.entity_id)) && !history) {
        const type = sensorType(entity) || 'generic';
        // Distinct enum/power readings retain their identity; don't combine
        // different measurements into an invented room total.
        const groupKey = ['enum', 'power', 'generic'].includes(type) ? entity.entity_id : `${domain}:${type}:${entity.attributes.unit_of_measurement || ''}`;
        if (!sensorGroups.has(groupKey)) sensorGroups.set(groupKey, { key: groupKey, type, label: ['enum', 'power', 'generic'].includes(type) ? entity.name : STATUS_NAMES[type] || words(type), icon: STATUS_ICONS[type] || 'activity', entities: [] });
        sensorGroups.get(groupKey).entities.push(entity);
      } else if (always.has(entity.entity_id)) {
        sensorGroups.set(entity.entity_id, { key: entity.entity_id, type: 'generic', label: entity.name, icon: 'activity', entities: [entity] });
      } else details[battery ? 'Batteries' : history ? 'Events & history' : 'Sensors'].push(entity);
      continue;
    }
    const setting = room.registry?.get(entity.entity_id)?.entity_category === 'config' || SETUP_KEYS.has(key) || [...SETUP_KEYS].some(value => entity.entity_id.endsWith(`_${value}`)) || ['number', 'select'].includes(domain) && /(?:^|_)(?:calibration|sensitivity|volume)$/.test(key);
    if (setting && !always.has(entity.entity_id)) { details['Device settings'].push(entity); continue; }
    if (['image', 'remote', 'device_tracker'].includes(domain) && !always.has(entity.entity_id)) { details['Other entities'].push(entity); continue; }
    const section = CONTROL_SECTIONS[domain];
    if (!section && !always.has(entity.entity_id)) { details['Other entities'].push(entity); continue; }
    const groupName = section || 'Controls';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(entity);
  }
  const statuses = [...sensorGroups.values()].map(group => {
    const available = group.entities.filter(e => !unavailable(e));
    const missing = group.entities.length - available.length;
    const warningType = ['smoke', 'gas', 'moisture', 'carbon_monoxide'].includes(group.type);
    const active = available.filter(e => e.state === 'on').length;
    let value = 'Unavailable';
    if (available.length) {
      if (domainOf(available[0].entity_id) === 'binary_sensor') value = group.type === 'presence' ? (active ? 'Detected' : 'Clear') : group.type === 'openings' ? (active ? `${active} open` : 'All closed') : warningType ? (active ? 'Detected' : 'Clear') : displayState(available[0]);
      else if (available.length === 1) value = displayState(available[0]);
      else if (available.every(e => String(e.state).trim() !== '' && Number.isFinite(Number(e.state)))) {
        const min = Math.min(...available.map(e => Number(e.state))), max = Math.max(...available.map(e => Number(e.state)));
        value = `${prettyNumber(min)}${min === max ? '' : `–${prettyNumber(max)}`}${available[0].attributes.unit_of_measurement ? ` ${available[0].attributes.unit_of_measurement}` : ''}`;
      } else value = `${available.length} readings`;
    }
    if (missing && available.length) value += ` · ${missing} unavailable`;
    return { ...group, value, warning: missing > 0 || warningType && active > 0 };
  });
  const batteries = named.filter(e => e.attributes.device_class === 'battery' && !always.has(e.entity_id));
  const low = batteries.filter(e => !unavailable(e) && (domainOf(e.entity_id) === 'binary_sensor' ? e.state === 'on' : String(e.state).trim() !== '' && Number.isFinite(Number(e.state)) && Number(e.state) <= 20));
  const missing = batteries.filter(unavailable);
  if (low.length || missing.length) statuses.push({ key: 'battery-warning', type: 'battery', label: 'Battery', icon: 'battery-warning', value: [low.length ? `${low.length} low` : '', missing.length ? `${missing.length} unavailable` : ''].filter(Boolean).join(' · '), warning: true, entities: [...low, ...missing] });
  return { id: room.area?.area_id, name: room.name, statuses, sections: [...groups].sort(([a], [b]) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)).map(([name, entities]) => ({ name, entities })), cameras, details: Object.entries(details).filter(([, entities]) => entities.length).map(([name, entities]) => ({ name, entities })), entityIds: named.map(e => e.entity_id) };
}

const supportsFeature = (entity, flag) => !!((entity.attributes?.supported_features ?? 0) & flag);
const row = entity => ({ entity: entity.entity_id, name: entity.name });
function entitiesCardConfig(entities, title) {
  return { type: "entities", ...(title ? { title } : {}), show_header_toggle: false, state_color: true, entities: entities.map(row) };
}
function tileCardConfig(entity) {
  const domain = domainOf(entity.entity_id), a = entity.attributes ?? {}, features = [];
  const add = (type, extra = {}) => features.push({ type, ...extra });
  if (["light", "switch", "input_boolean", "fan"].includes(domain)) add("toggle");
  if (domain === "light" && (a.supported_color_modes?.some(mode => mode !== "onoff" && mode !== "unknown") || supportsFeature(entity, 1))) add("light-brightness");
  if (domain === "fan" && supportsFeature(entity, 1)) add("fan-speed");
  if (domain === "climate") {
    if (supportsFeature(entity, 1) || supportsFeature(entity, 2)) add("target-temperature");
    if (a.hvac_modes?.length) add("climate-hvac-modes", { style: "dropdown" });
  }
  if (domain === "cover") {
    if (supportsFeature(entity, 1) || supportsFeature(entity, 2)) add("cover-open-close");
    if (supportsFeature(entity, 4)) add("cover-position");
  }
  if (domain === "media_player") {
    if ([1, 2, 16, 32, 16384].some(flag => supportsFeature(entity, flag))) add("media-player-playback");
    if (supportsFeature(entity, 4)) add("media-player-volume-slider");
  }
  if (domain === "humidifier") { add("humidifier-toggle"); add("target-humidity"); }
  if (["number", "input_number"].includes(domain)) add("numeric-input", { style: "buttons" });
  if (["select", "input_select"].includes(domain)) add("select-options", { style: "dropdown" });
  return { type: "tile", ...row(entity), vertical: false, tap_action: { action: "more-info" }, features_position: features.length === 1 ? "inline" : "bottom", ...(features.length ? { features } : {}) };
}
function pictureCardConfig(entity) { return { type: "picture-entity", ...row(entity), camera_view: "live", show_name: true, show_state: false, aspect_ratio: "16:9", tap_action: { action: "more-info" }, hold_action: { action: "more-info" } }; }
function headingCardConfig(heading) { return { type: "heading", heading, heading_style: "subtitle" }; }

const CARD_STYLES = `
:host{display:block;min-width:0;color:var(--primary-text-color);container-type:inline-size}
[hidden]{display:none!important}.room-content{display:flex;flex-direction:column;gap:16px;min-width:0}.message{padding:12px;color:var(--secondary-text-color)}
.badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap}ha-badge{max-width:100%}
.sections{display:flex;flex-direction:column;gap:16px}.sections>section{min-width:0;display:flex;flex-direction:column;gap:8px}.native-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.native-tiles>*{min-width:0}.details-content{display:flex;flex-direction:column;gap:12px;padding-top:8px}.cameras{display:flex;flex-direction:column;gap:8px}.camera-content{max-width:640px;width:100%;margin-inline:auto}.camera-nav{display:flex;align-items:center;justify-content:center;gap:12px}.camera-count{color:var(--secondary-text-color);font-size:var(--ha-font-size-s,14px)}
@container(max-width:540px){.native-tiles{grid-template-columns:minmax(0,1fr)}}
`;


class RoomControlCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" }); this._nativeCards = new Map(); this._badges = new Map();
    this.shadowRoot.innerHTML = `<style>${CARD_STYLES}</style><div class="room-content"><div class="room-title"></div><div class="message" role="status"></div><div class="badges" aria-label="Room status"></div><ha-expansion-panel class="sensor-detail" hidden></ha-expansion-panel><main class="sections"></main><section class="cameras" hidden><div class="camera-heading"></div><div class="camera-content"></div><div class="camera-nav" hidden><ha-icon-button class="previous" label="Previous camera"><ha-icon icon="mdi:chevron-left"></ha-icon></ha-icon-button><span class="camera-count" aria-live="polite"></span><ha-icon-button class="next" label="Next camera"><ha-icon icon="mdi:chevron-right"></ha-icon></ha-icon-button></div></section><ha-expansion-panel class="room-details" header="More room details" hidden><div class="details-content"></div></ha-expansion-panel></div>`;
    this.shadowRoot.querySelector(".previous").addEventListener("click", () => this._navigateCamera(-1));
    this.shadowRoot.querySelector(".next").addEventListener("click", () => this._navigateCamera(1));
    this.shadowRoot.addEventListener("keydown", event => {
      if (event.key === "Escape" && this._sensor) { event.preventDefault(); event.stopPropagation(); this._closeSensor(); }
    });
    this.shadowRoot.querySelector(".sensor-detail").addEventListener("expanded-changed", event => {
      if (!event.detail.expanded) { this._sensor = null; this.shadowRoot.querySelector(".sensor-detail").hidden = true; }
    });
    this.shadowRoot.addEventListener("ll-rebuild", event => {
      const entry = [...this._nativeCards.values()].find(item => event.composedPath().includes(item.node));
      if (!entry) return;
      event.stopPropagation(); const node = this._helpers.createCardElement(entry.config);
      node.hass = this._hass; node.dataset.nativeKey = entry.node.dataset.nativeKey; entry.node.replaceWith(node); entry.node = node;
    });
  }
  static async getConfigElement() { await loadNativeComponents(); return document.createElement("room-control-card-editor"); }
  static getStubConfig(hass) { const area = Object.values(hass?.areas ?? {})[0]?.area_id; return area ? { area, layout: "compact" } : { entities: Object.keys(hass?.states ?? {}).slice(0, 6), layout: "compact" }; }
  setConfig(config) {
    this._config = validateConfig(config); this._sensor = null; this._selectedCamera = null;
    this.shadowRoot.querySelector(".room-details").expanded = false; this._render();
  }
  set hass(hass) { this._hass = hass; this._watch(); this._render(); }
  get hass() { return this._hass; }
  connectedCallback() {
    loadNativeComponents().then(helpers => { if (!this.isConnected) return; this._helpers = helpers; this._loadError = null; this._render(); }).catch(error => { this._loadError = error.message; this._render(); });
    this._watch(); this._render();
  }
  disconnectedCallback() { this._stop?.(); this._stop = null; this._connection = null; }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6, min_rows: 3 }; }
  _watch() {
    if (!this.isConnected || !this._hass) return;
    const connection = this._hass.connection ?? this._hass;
    if (this._connection === connection) return;
    this._stop?.(); this._connection = connection; this._registries = null; this._registryError = null;
    this._stop = watchRegistries(this._hass, (data, error) => { this._registries = data; this._registryError = error; this._render(); });
  }
  _card(key, config, container) {
    this._usedCards.add(key);
    let entry = this._nativeCards.get(key); const signature = JSON.stringify(config);
    if (!entry || entry.signature !== signature) {
      const node = this._helpers.createCardElement(config); node.dataset.nativeKey = key;
      if (entry) entry.node.replaceWith(node);
      entry = { node, config, signature }; this._nativeCards.set(key, entry);
    }
    entry.node.hass = this._hass;
    if (entry.node.parentNode !== container) container.append(entry.node);
    return entry.node;
  }
  _sensorBadge(group) {
    let badge = this._badges.get(group.key);
    if (!badge) {
      badge = document.createElement("ha-badge"); badge.type = "button"; badge.dataset.sensor = group.key;
      const icon = document.createElement("ha-icon"); icon.slot = "icon"; badge.append(icon, document.createElement("span"));
      const open = () => { this._sensor = this._sensor === badge.dataset.sensor ? null : badge.dataset.sensor; this._render(); };
      badge.addEventListener("click", open);
      badge.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
      this._badges.set(group.key, badge);
    }
    badge.label = group.label; badge.querySelector("ha-icon").setAttribute("icon", `mdi:${({ thermometer: "thermometer", droplets: "water-percent", "person-standing": "motion-sensor", "door-open": "door-closed", "battery-warning": "battery-alert", zap: "flash", activity: "gauge" })[group.icon] || "shield-alert"}`);
    badge.querySelector("span").textContent = group.value;
    badge.style.setProperty("--badge-color", group.warning ? "var(--warning-color)" : "var(--secondary-text-color)");
    return badge;
  }
  _closeSensor() {
    const selected = this._sensor; this._sensor = null; this._render(); this._badges.get(selected)?.shadowRoot?.querySelector('[role="button"]')?.focus();
  }
  _navigateCamera(offset) {
    const cameras = this._presentation?.cameras ?? [];
    if (!cameras.length) return;
    const index = Math.max(0, cameras.findIndex(entity => entity.entity_id === this._selectedCamera));
    this._selectedCamera = cameras[(index + offset + cameras.length) % cameras.length].entity_id; this._render();
  }
  _render() {
    if (!this._config || !this._hass) return;
    const message = this.shadowRoot.querySelector(".message");
    message.textContent = this._loadError || this._registryError?.message || (!this._helpers ? "Loading Home Assistant components…" : !this._registries ? "Loading room entities…" : "");
    message.hidden = !message.textContent;
    if (!this._helpers || !this._registries) return;
    const room = discoverRoom(this._config, this._hass, this._registries); this._room = room;
    const model = presentRoom(room, this._config); this._presentation = model; this._usedCards = new Set();
    const title = this.shadowRoot.querySelector(".room-title"); title.hidden = !this._config.show_title;
    if (this._config.show_title) this._card("title", { type: "heading", heading: room.name, heading_style: "title", icon: this._config.icon || room.area?.icon || "mdi:home-outline" }, title);
    const badges = this.shadowRoot.querySelector(".badges"); badges.hidden = !model.statuses.length;
    for (const group of model.statuses) { const badge = this._sensorBadge(group); if (badge.parentNode !== badges) badges.append(badge); }
    for (const [key, badge] of this._badges) if (!model.statuses.some(group => group.key === key)) { badge.remove(); this._badges.delete(key); }
    const detail = this.shadowRoot.querySelector(".sensor-detail"), selected = model.statuses.find(group => group.key === this._sensor);
    detail.hidden = !selected; detail.expanded = !!selected;
    if (selected) { detail.header = selected.label; this._card("sensor-readings", entitiesCardConfig(selected.entities), detail); }
    else this._sensor = null;
    const sections = this.shadowRoot.querySelector(".sections"); sections.dataset.layout = this._config.layout;
    const sectionKeys = new Set();
    for (const group of model.sections) {
      sectionKeys.add(group.name);
      let section = [...sections.children].find(node => node.dataset.section === group.name);
      if (!section) { section = document.createElement("section"); section.dataset.section = group.name; section.setAttribute("aria-label", group.name); sections.append(section); }
      this._card(`heading:${group.name}`, headingCardConfig(group.name), section);
      const advanced = group.entities.some(entity => ["climate", "fan", "media_player", "cover", "humidifier"].includes(domainOf(entity.entity_id)));
      if (this._config.layout !== "tiles" && !advanced) this._card(`rows:${group.name}`, entitiesCardConfig(group.entities), section);
      else {
        let grid = section.querySelector(".native-tiles"); if (!grid) { grid = document.createElement("div"); grid.className = "native-tiles"; section.append(grid); }
        for (const entity of group.entities) this._card(`tile:${entity.entity_id}`, tileCardConfig(entity), grid);
      }
    }
    for (const section of [...sections.children]) if (!sectionKeys.has(section.dataset.section)) section.remove();
    const cameras = this.shadowRoot.querySelector(".cameras"); cameras.hidden = !model.cameras.length;
    if (model.cameras.length) {
      this._card("camera-heading", headingCardConfig("Cameras"), cameras.querySelector(".camera-heading"));
      const content = cameras.querySelector(".camera-content"), nav = cameras.querySelector(".camera-nav");
      content.classList.toggle("native-tiles", this._config.camera_layout === "tiles");
      const selectedCamera = model.cameras.find(entity => entity.entity_id === this._selectedCamera) || model.cameras[0]; this._selectedCamera = selectedCamera.entity_id;
      const members = this._config.camera_layout === "carousel" ? [selectedCamera] : model.cameras;
      for (const entity of members) this._card(`camera:${entity.entity_id}`, pictureCardConfig(entity), content);
      nav.hidden = this._config.camera_layout !== "carousel" || model.cameras.length < 2;
      nav.querySelector(".camera-count").textContent = `${model.cameras.indexOf(selectedCamera) + 1} / ${model.cameras.length}`;
    }
    const more = this.shadowRoot.querySelector(".room-details"); more.hidden = !model.details.length;
    for (const group of model.details) this._card(`details:${group.name}`, entitiesCardConfig(group.entities, group.name), more.querySelector(".details-content"));
    for (const [key, entry] of this._nativeCards) if (!this._usedCards.has(key)) { entry.node.remove(); this._nativeCards.delete(key); }
    for (const grid of sections.querySelectorAll(".native-tiles:empty")) grid.remove();
    if (!room.entities.length && !message.textContent) { message.hidden = false; message.textContent = room.area || this._config.entities?.length ? "No entities found. Check room assignments and exclusions." : "Area not found. Choose an area in the card editor."; }
  }
}
if (!customElements.get("room-control-card")) customElements.define("room-control-card", RoomControlCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "room-control-card")) window.customCards.push({ type: "room-control-card", name: "Room Control Card", description: "Native Home Assistant controls grouped by room.", preview: true });

class RoomControlCardEditor extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = '<style>:host{display:block}.hint{color:var(--secondary-text-color)}.error{color:var(--error-color)}</style><ha-form></ha-form><p class="hint">Secondary readings and device settings are available under More room details. Always show promotes entities to the main controls; manual exclusions still apply.</p><p class="error" role="alert"></p>';
    this._form = this.shadowRoot.querySelector("ha-form");
    this._form.computeLabel = schema => ({ area: "Room", name: "Room title", icon: "Room icon", layout: "Control layout", camera_layout: "Camera display", entities: "Explicit entities (optional)", exclude_devices: "Exclude devices", exclude_entities: "Exclude entities", always_show: "Always show entities", everyday_controls: "Everyday controls", show_title: "Show room title", include_diagnostics: "Include diagnostic entities", include_hidden: "Include hidden entities" })[schema.name] || schema.name;
    this._form.schema = [
      { name: "area", selector: { area: {} } }, { name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } },
      { name: "layout", selector: { select: { options: [{ value: "compact", label: "Compact rows" }, { value: "tiles", label: "Native tiles" }, { value: "grouped", label: "Grouped rows (legacy)" }] } } },
      { name: "camera_layout", selector: { select: { options: [{ value: "carousel", label: "Carousel" }, { value: "tiles", label: "Individual cameras" }] } } },
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "exclude_devices", selector: { device: { multiple: true } } },
      ...["exclude_entities", "always_show"].map(name => ({ name, selector: { entity: { multiple: true } } })),
      ...["everyday_controls", "show_title", "include_diagnostics", "include_hidden"].map(name => ({ name, selector: { boolean: {} } })),
    ];
    this._form.addEventListener("value-changed", event => {
      event.stopPropagation(); const config = { ...this._config, ...event.detail.value };
      if (!config.entities?.length) delete config.entities;
      if (!config.area) delete config.area;
      this._draft = config;
      try { validateConfig(config); this._config = config; this._error = null; this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })); }
      catch (error) { this._error = error.message; }
      this._render();
    });
  }
  setConfig(config) { this._config = { ...DEFAULT_CONFIG, ...config }; this._draft = null; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  connectedCallback() { loadNativeComponents().then(() => this._render()).catch(error => { this._error = error.message; this._render(); }); }
  _render() { this._form.hass = this._hass; this._form.data = this._draft ?? this._config ?? {}; this.shadowRoot.querySelector(".error").textContent = this._error ?? ""; }
}
if (!customElements.get("room-control-card-editor")) customElements.define("room-control-card-editor", RoomControlCardEditor);

return { validateConfig, controlFilterReason };
})();
(() => {

function controlCardConfig(config) {
  const options = config.control_options ?? {};
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("control_options must be an object.");
  const supported = ["layout", "camera_layout", "everyday_controls", "include_hidden", "include_diagnostics", "entities", "always_show"];
  for (const key of Object.keys(options)) if (!supported.includes(key)) throw new Error(`Unknown control_options setting: ${key}.`);
  const exclusions = exclusionList(config, "control");
  return validateConfig({
    type: "custom:room-control-card", area: config.area,
    ...(config.name ? { name: config.name } : {}), ...(config.icon ? { icon: config.icon } : {}),
    layout: "compact", camera_layout: "carousel", include_hidden: false, include_diagnostics: false,
    ...options, show_title: false,
    exclude_devices: exclusions.devices ?? [], exclude_entities: exclusions.entities ?? [],
  });
}

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
  return expandExclusions(exclusionList(config), registries, states);
}
function normalizeConfig(config) {
  if (!config || typeof config.area !== "string" || !config.area.trim()) throw new Error("Please select a room.");
  const mode = config.mode ?? "full";
  if (!["full", "simple"].includes(mode)) throw new Error("Choose Full or Simple for the card mode.");
  if (config.group !== undefined && !GROUP_ORDER.includes(config.group)) throw new Error("Choose a supported device group for the simple card.");
  const result = { ...config, area: config.area.trim(), mode };
  for (const key of ["overview_exclusions", "control_exclusions"]) {
    if (config[key] !== undefined) result[key] = normalizeExclusions(config[key], key);
  }
  if (mode === "simple") result.group = config.group ?? "lights";
  for (const key of ["show_room_title", "show_state"]) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  }
  // The dashboard Layout settings own sizing, including older pixel-sized configs.
  delete result.simple_size; delete result.full_height;
  if (config.tiles !== undefined) {
    if (!Array.isArray(config.tiles) || config.tiles.length > 4 || config.tiles.some(k => k !== "none" && !GROUP_ORDER.includes(k))) {
      throw new Error("Select up to four device groups for the mini tiles.");
    }
    const selected = config.tiles.filter(k => k !== "none");
    if (new Set(selected).size !== selected.length) throw new Error("Each mini tile must select a different device group.");
    result.tiles = [...config.tiles];
  }
  for (const key of ["exclude_devices", "exclude_entities", "light_switches", "power_sensors"]) {
    if (config[key] !== undefined) {
      if (!Array.isArray(config[key]) || config[key].some(id => typeof id !== "string" || !id.trim())) {
        throw new Error(`${key} must be a list of ${key === "exclude_devices" ? "device" : "entity"} IDs.`);
      }
      result[key] = [...new Set(config[key].map(id => id.trim()))];
      if (key === "power_sensors" && result[key].some(id => domainOf(id) !== "sensor")) throw new Error("Power sensors must be sensor entity IDs.");
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
function isPowerSensor(entity, states) {
  return domainOf(entity.entity_id) === "sensor" && deviceClass(entity, states[entity.entity_id]) === "power";
}
function groupPowerSensors(config, model, registries, states) {
  if (config.power_sensors !== undefined) return { entities: config.power_sensors.filter(id => !model.excluded.has(id)), complete: true };
  const registry = new Map(registries.entities.map(entity => [entity.entity_id, entity]));
  const members = model.groups.switches;
  const devices = new Set(members.map(id => registry.get(id)?.device_id).filter(Boolean));
  const entities = [];
  let complete = members.length > 0 && members.every(id => registry.get(id)?.device_id);
  for (const device of devices) {
    const choices = registries.entities.filter(entity => entity.device_id === device && eligible(entity) && !model.excluded.has(entity.entity_id) && isPowerSensor(entity, states));
    // Multiple channels or overlapping meters need an explicit choice to avoid double-counting.
    const otherSwitches = registries.entities.some(entity => entity.device_id === device && eligible(entity) && domainOf(entity.entity_id) === "switch" && !members.includes(entity.entity_id));
    if (choices.length === 1 && !otherSwitches) entities.push(choices[0].entity_id);
    else complete = false;
  }
  return { entities, complete };
}
function simpleGroupSummary(config, model, registries, states, language) {
  const kind = config.group, ids = model.groups[kind], status = groupStatus(kind, ids, states);
  if (!ids.length || status.unavailable === ids.length) return status.status;
  if (kind === "media") {
    const priority = ["playing", "buffering", "paused", "on"];
    const active = ids.map(id => states[id]).filter(state => usable(state) && priority.includes(state.state)).sort((a, b) => priority.indexOf(a.state) - priority.indexOf(b.state));
    const primary = active[0];
    if (!primary) return ids.some(id => usable(states[id]) && states[id].state === "idle") ? "Idle" : "Off";
    if (primary.state === "on") return `${active.length} active`;
    const title = typeof primary.attributes?.media_title === "string" ? primary.attributes.media_title.trim() : "";
    const artist = typeof primary.attributes?.media_artist === "string" ? primary.attributes.media_artist.trim() : "";
    const playback = primary.state === "paused" ? "Paused" : primary.state === "buffering" ? "Buffering" : "Playing";
    if (!title) return `${active.length} ${playback.toLowerCase()}`;
    return `${primary.state === "playing" ? "" : `${playback} · `}${title}${artist ? ` · ${artist}` : ""}${active.length > 1 ? ` · +${active.length - 1} more` : ""}`;
  }
  const noun = ["lights", "fans", "switches"].includes(kind) ? "on" : ["contacts", "covers"].includes(kind) ? "open" : kind === "locks" ? "unlocked" : "active";
  let summary = `${status.count} ${noun}`;
  if (kind === "switches") {
    const power = groupPowerSensors(config, model, registries, states);
    const units = { W: 1, kW: 1000, MW: 1000000, mW: .001 };
    const values = power.entities.map(id => {
      const value = numeric(states[id]), unit = states[id]?.attributes?.unit_of_measurement;
      return value !== null && Object.hasOwn(units, unit) ? value * units[unit] : null;
    }).filter(value => value !== null);
    if (values.length) {
      const watts = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(values.reduce((total, value) => total + value, 0));
      summary += ` (${watts} W${power.complete && values.length === power.entities.length ? "" : " measured"})`;
    }
  }
  return summary;
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
*{box-sizing:border-box}ha-button{--ha-button-label-overflow:visible;--wa-color-on-normal:currentColor;--wa-color-on-quiet:currentColor;--wa-form-control-padding-inline:0}
/* The host owns each button's shape; size and align HA's native shadow parts too. */
ha-button::part(base){box-sizing:border-box;min-width:0;min-height:0;height:100%;padding:0;border:0;border-radius:inherit;background:transparent;box-shadow:none;color:inherit;font:inherit;line-height:inherit}
ha-button::part(label){min-width:0;padding:0;line-height:inherit;white-space:inherit}
ha-card{display:block;position:relative;height:212px;overflow:hidden;border-radius:16px;background:var(--ha-card-background,var(--card-background-color,#27313b));isolation:isolate}
:host([data-layout-height=true]){height:100%;min-height:0}ha-card[data-layout-height=true]{height:100%;min-height:0}
:host ha-card::before{content:none}
ha-card[data-lit=true]{outline:3px solid #ffca28;outline-offset:-2px;box-shadow:0 0 0 2px #ffca28cc,0 0 16px #ffca28e6,0 0 32px #ffca28a6,0 0 48px #ffca2859}
.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.shade{position:absolute;inset:0;background:linear-gradient(180deg,#0009 0%,#0002 40%,transparent 65%,#0002 100%);z-index:-1}
.heading{position:absolute;inset:12px 12px auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 8px;align-items:start}.room-summary{display:contents}.room-button{display:flex;align-items:center;width:100%;height:24px;border:0;background:none;padding:0;color:white;text-align:left;font-size:14px;font-weight:600;text-shadow:0 1px 3px #0009;min-width:0}.room-button::part(base){width:100%;justify-content:flex-start}.room-button::part(label){display:flex;align-items:center;gap:8px;overflow:hidden;text-align:left}.room-button ha-icon{display:block;--mdc-icon-size:20px;flex-shrink:0}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.readings{grid-column:1/-1;margin:0 0 0 28px;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;font-size:12px;color:#fff;line-height:18px;text-shadow:0 1px 3px #0009}.reading{display:inline-flex;flex:none;align-items:center;height:18px;padding:0;border:0;background:none;color:inherit;font:inherit;white-space:nowrap}.reading+.reading::before{content:'|';margin-right:6px;opacity:.7}
.status-row{grid-column:2;grid-row:1;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:168px}.warnings,.sensor-status{display:flex;gap:4px}.warnings:empty,.sensor-status:empty,.sensor-status[hidden],.sensor-indicator[hidden]{display:none}
.warning,.sensor-indicator{width:24px;height:24px;padding:0;border:0;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.warning::part(base),.sensor-indicator::part(base),.tile::part(base){width:100%}.warning::part(label),.sensor-indicator::part(label),.tile::part(label){display:flex;align-items:center;justify-content:center}.warning{background:#e3f2fd;color:#087cca}.warning ha-icon,.sensor-indicator ha-icon{display:block;--mdc-icon-size:18px}.warning[data-kind=temperature_high]{background:#fff3e0;color:#c65d00}.warning[data-kind=humidity_low]{background:#fff8e1;color:#9c6500}
.sensor-indicator{position:relative;background:#eceff1;color:#7d858b}.sensor-indicator[data-active=true]{background:#ffe4e6;color:#a86070}.sensor-indicator[data-unavailable=true]{background:#e2e8f0;color:#64748b}.sensor-indicator .unavailable-dot{top:-3px;right:-3px;width:10px;height:10px;line-height:10px;font-size:8px}
.tiles{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:nowrap;justify-content:flex-end;gap:6px;align-items:end}.tiles[data-alignment=left]{justify-content:flex-start}.tiles[data-alignment=center]{justify-content:center}.tile{flex:0 1 56px;width:56px;height:56px;min-width:0;display:grid;place-items:center;position:relative;padding:6px;border:var(--ha-card-border,1px solid #ffffff66);border-radius:12px;background:#ffffff80;backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));-webkit-backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));box-shadow:var(--ha-card-glass-inset-shadow,none);color:#888}.tile ha-icon{--mdc-icon-size:28px;stroke:#fff;stroke-width:1.5px;stroke-linejoin:round;paint-order:stroke fill}.tile[data-active=true]{color:#ffca28}.tile[data-unavailable=true]{color:#64748b}.unavailable-dot{position:absolute;top:5px;right:5px;width:12px;height:12px;border-radius:50%;background:#455a64;color:white;font-size:10px;line-height:12px;text-align:center}.unavailable-dot[hidden]{display:none}
.message{position:absolute;left:12px;right:12px;bottom:14px;color:#fff;font-size:12px;text-shadow:0 1px 3px #000}.message[hidden]{display:none}ha-card[data-has-controls=true] .message{bottom:76px}
ha-card[data-mode=simple]{height:auto;aspect-ratio:1;width:100%;container-type:inline-size}
ha-card[data-mode=simple][data-layout-height=true]{height:100%;aspect-ratio:auto;container-type:size}
.simple-tile{--ha-button-height:100%;position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;border:0;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;text-align:center}
.simple-tile::part(base){width:100%;height:100%}.simple-tile::part(label){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.simple-tile ha-icon{--mdc-icon-size:50cqi;flex-shrink:0}
.simple-tile[data-has-text=true] ha-icon{--mdc-icon-size:35cqi}
ha-card[data-layout-height=true] .simple-tile ha-icon{--mdc-icon-size:50cqmin}
ha-card[data-layout-height=true] .simple-tile[data-has-text=true] ha-icon{--mdc-icon-size:35cqmin}
.simple-title,.simple-state{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;max-width:100%;color:var(--primary-text-color,#222);font-size:12px;line-height:1.2;font-weight:500}
.simple-state{color:var(--secondary-text-color,#666);font-size:11px;font-weight:400}
.simple-title[hidden],.simple-state[hidden]{display:none}
@container(max-width:140px) or (max-height:140px){.simple-tile[data-has-text=true]{gap:4px;padding:6px}.simple-title{font-size:11px;-webkit-line-clamp:1}.simple-state{font-size:10px;-webkit-line-clamp:1}}
@container(max-width:80px) or (max-height:80px){.simple-tile[data-has-text=true]{gap:2px;padding:4px}.simple-title,.simple-state{font-size:10px}}
.simple-tile[hidden],ha-card[data-mode=simple]>.heading,ha-card[data-mode=simple]>.tiles,ha-card[data-mode=simple]>.background,ha-card[data-mode=simple]>.shade{display:none}
ha-card[data-mode=simple]>.message{inset:0;display:grid;place-items:center;padding:4px;background:var(--ha-card-background,var(--card-background-color,#27313b));color:var(--primary-text-color);text-shadow:none;text-align:center;pointer-events:none}
ha-card[data-mode=simple]>.message[hidden]{display:none}
ha-dialog{--ha-dialog-width-lg:840px;--dialog-content-padding:0 16px 16px;--ha-dialog-surface-background:var(--primary-background-color,var(--card-background-color))}.dialog-body,.control-container{min-width:0}room-control-card{display:block}

ha-card[data-has-image=false] .shade{display:none}
ha-card[data-has-image=false] .room-button{color:var(--primary-text-color,#222);text-shadow:none}
ha-card[data-has-image=false] .readings,ha-card[data-has-image=false] .message{color:var(--secondary-text-color,#666);text-shadow:none}
ha-card[data-has-image=false] .tile{background:var(--secondary-background-color,#e8eef3);border:1px solid var(--divider-color,#ddd);backdrop-filter:none;-webkit-backdrop-filter:none}
ha-card[data-has-image=false] .tile ha-icon{stroke:none}

`;
const EDITOR_STYLE = `
:host{display:block;color:var(--primary-text-color);font-family:var(--ha-font-family-body,inherit)}*{box-sizing:border-box}ha-selector{display:block;width:100%}.editor{padding:4px 0}.field{display:block;margin:0 0 16px}.hint{font-size:var(--ha-font-size-s,14px);color:var(--secondary-text-color);line-height:1.5;margin:6px 0 16px}.slots,.unit-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.section-title{font-weight:var(--ha-font-weight-medium,500);margin:18px 0 12px}.reset{margin-bottom:12px}.advanced,.exclusions,.specific-entities{margin-top:12px}.error{color:var(--error-color)}.error:empty{display:none}
@media(max-width:420px){.slots,.unit-grid{grid-template-columns:1fr}}
`;


function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconNode(icon) { const node = element("ha-icon"); node.setAttribute("icon", icon); return node; }
function button(className, label, onClick) {
  const node = element("ha-button", className); node.appearance = "plain";
  node.ariaLabel = label; node.title = label;
  if (onClick) node.addEventListener("click", onClick); return node;
}

class RoomOverviewCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${CARD_STYLE}</style><ha-card><img class="background" alt=""><div class="shade"></div><div class="heading"><div class="room-summary"><ha-button appearance="plain" class="room-button"><ha-icon></ha-icon><span class="name"></span></ha-button><div class="readings"></div></div><div class="status-row"><div class="sensor-status"></div><div class="warnings"></div></div></div><div class="tiles"></div><div class="message" role="status" hidden></div></ha-card><ha-dialog width="large"><div class="dialog-body"><div class="control-container"></div></div></ha-dialog>`;
    this._dialog = this.shadowRoot.querySelector("ha-dialog");
    this._bindRoomActions();
    this._simpleTile = button("tile simple-tile", "Open room controls", undefined);
    this._simpleTile.hidden = true; this._simpleTile.disabled = true;
    this._simpleTitle = element("span", "simple-title"); this._simpleTitle.hidden = true;
    this._simpleState = element("span", "simple-state"); this._simpleState.hidden = true;
    this._simpleTile.append(iconNode(GROUPS.lights.icon), this._simpleTitle, this._simpleState, element("span", "unavailable-dot", "!"));
    this.shadowRoot.querySelector("ha-card").append(this._simpleTile);
    this._dialog.addEventListener("closed", event => {
      if (event.target !== this._dialog) return;
      this._dialog.open = false; this._unmountControls();
      if (this._opener?.isConnected) this._opener.focus({ preventScroll: true });
    });
    this._dialog.addEventListener("keydown", event => {
      if (event.key === "Escape" && this._control?._sensor) {
        event.preventDefault(); event.stopPropagation(); this._control._closeSensor();
      }
    }, true);
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
  setConfig(config) {
    const next = normalizeConfig(config);
    if (this._config && (this._config.area !== next.area || this._config.mode !== next.mode || this._config.group !== next.group)) this._closeDialog();
    controlCardConfig(next);
    this._config = next; this._tileSignature = null; this._update();
  }
  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && this._connection !== hass.connection) { this._unwatch?.(); this._unwatch = null; this._connection = hass.connection; }
    this._watch(); this._update();
  }
  connectedCallback() {
    this._watch(); this._update();
    window.addEventListener("scroll", this._cancelOnScroll, true);
    window.addEventListener("blur", this._cancelOnBlur);
    document.addEventListener("visibilitychange", this._cancelOnVisibility);
  }
  disconnectedCallback() {
    this._cancelPress(); this._closeDialog(); this._unmountControls();
    window.removeEventListener("scroll", this._cancelOnScroll, true);
    window.removeEventListener("blur", this._cancelOnBlur);
    document.removeEventListener("visibilitychange", this._cancelOnVisibility);
    this._unwatch?.(); this._unwatch = null; this._mediaRequest = null; clearTimeout(this._mediaRefresh);
  }
  getCardSize() { return this._config?.mode === "simple" ? 2 : 4; }
  getGridOptions() { return this._config?.mode === "simple" ? { columns: 3, rows: "auto", min_columns: 2, min_rows: 1 } : { columns: 12, rows: "auto", min_columns: 6, min_rows: 2 }; }
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
    if (!this._config) return;
    const simple = this._config.mode === "simple", card = this.shadowRoot.querySelector("ha-card");
    card.dataset.mode = this._config.mode;
    this._simpleTile.hidden = !simple;
    const layoutHeight = typeof this._config.grid_options?.rows === "number" && this._config.grid_options.rows > 0;
    this.dataset.layoutHeight = String(layoutHeight); card.dataset.layoutHeight = String(layoutHeight);
    if (simple) {
      this._mediaRequest = null; this._mediaImage = ""; this._mediaError = false; clearTimeout(this._mediaRefresh);
      const img = this.shadowRoot.querySelector("img"); img.removeAttribute("src"); img.hidden = true;
      this._image = ""; card.dataset.hasImage = "false"; card.dataset.lit = "false"; card.dataset.hasControls = "false";
      this._simpleTile.querySelector("ha-icon").setAttribute("icon", GROUPS[this._config.group].icon);
      this._simpleTitle.hidden = !this._config.show_room_title; this._simpleState.hidden = !this._config.show_state;
      this._simpleTile.dataset.hasText = String(!!(this._config.show_room_title || this._config.show_state));
    }
    if (!this._hass) return;
    if (!this._registries) { this._message(this._registryError ? "Room information could not be loaded. Reload to try again." : "Loading room…"); return; }
    const model = discoverRoom(this._config, this._registries, this._hass.states);
    this._model = model;
    const name = this._config.name || model.area?.name || "Room not found";
    if (simple) {
      const kind = this._config.group, entities = model.groups[kind], status = groupStatus(kind, entities, this._hass.states);
      this._simpleTile.dataset.kind = kind; this._simpleTile.dataset.active = String(status.active);
      this._simpleTile.dataset.unavailable = String(entities.length > 0 && status.unavailable === entities.length);
      this._simpleTile.disabled = !model.area;
      const summary = this._config.show_state ? simpleGroupSummary(this._config, model, this._registries, this._hass.states, this._hass.locale?.language) : "";
      this._simpleTitle.textContent = name; this._simpleState.textContent = summary;
      this._simpleTile.title = `${name} · ${GROUPS[kind].name}: ${status.status}${summary ? ` · ${summary}` : ""}`;
      this._simpleTile.ariaLabel = `${name} ${GROUPS[kind].name}, ${status.status}${summary ? `. ${summary}` : ""}. Open room controls`;
      this._simpleTile.querySelector(".unavailable-dot").hidden = !status.unavailable;
      this._message(!model.area ? "Room no longer exists" : this._registryError ? "Room assignments could not be refreshed." : "");
      if (this._dialog.open) this._updateControls();
      return;
    }
    this.shadowRoot.querySelector(".name").textContent = name;
    this.shadowRoot.querySelector(".room-button ha-icon").setAttribute("icon", this._config.icon || model.area?.icon || "mdi:home-outline");
    this.shadowRoot.querySelector(".room-button").ariaLabel = `Open ${name} room details`;
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
        const node = button("reading", kind, undefined);
        node.dataset.kind = kind; readings.append(node);
      }
    }
    for (const [kind, reading] of Object.entries(this._readings)) {
      if (!reading) continue;
      const value = reading.value === null ? "—" : new Intl.NumberFormat(this._hass.locale?.language, { maximumFractionDigits: 1 }).format(reading.value);
      const label = `${kind === "temperature" ? "Temperature" : "Humidity"}: ${reading.value === null ? "unavailable" : `${value} ${reading.unit}`}`;
      const node = readings.querySelector(`[data-kind="${kind}"]`);
      node.ariaLabel = label; node.title = label;
      node.textContent = `${value}${reading.unit === "%" ? "" : " "}${reading.unit}`;
    }
    const warnings = this.shadowRoot.querySelector(".warnings");
    const activeWarnings = warningsFor(this._readings, thresholdsFor(this._config, unit));
    const warningSignature = JSON.stringify(activeWarnings.map(w => [w.key, w.entities]));
    if (warningSignature !== this._warningSignature) {
      this._warningSignature = warningSignature;
      const hadFocus = warnings.contains(this.shadowRoot.activeElement); warnings.replaceChildren();
      for (const warning of activeWarnings) {
        const node = button("warning", warning.text, undefined);
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
        const node = button("tile", GROUPS[tile.kind].name, undefined);
        node.dataset.kind = tile.kind;
        node.append(iconNode(GROUPS[tile.kind].icon), element("span", "unavailable-dot", "!")); tiles.append(node);
      }
      for (const indicator of model.indicators) {
        const node = button("sensor-indicator", GROUPS[indicator.kind].name, undefined);
        node.dataset.kind = indicator.kind;
        node.append(iconNode(GROUPS[indicator.kind].icon), element("span", "unavailable-dot", "!")); indicators.append(node);
      }
    }
    for (const tile of [...model.tiles, ...model.indicators]) {
      const node = this.shadowRoot.querySelector(`.tile[data-kind="${tile.kind}"], .sensor-indicator[data-kind="${tile.kind}"]`);
      const status = groupStatus(tile.kind, tile.entities, this._hass.states);
      node.dataset.active = String(status.active); node.dataset.unavailable = String(status.unavailable === tile.entities.length);
      if (node.classList.contains("sensor-indicator")) {
        const hadFocus = this.shadowRoot.activeElement === node;
        node.hidden = ["contacts", "occupancy"].includes(tile.kind) && !status.active && !status.unavailable;
        if (node.hidden && hadFocus) this.shadowRoot.querySelector(".room-button").focus();
      }
      node.title = `${GROUPS[tile.kind].name}: ${status.status}`;
      node.ariaLabel = `${name} ${GROUPS[tile.kind].name}, ${status.status}`;
      node.querySelector(".unavailable-dot").hidden = !status.unavailable;
    }
    const sensorStatus = this.shadowRoot.querySelector(".sensor-status");
    sensorStatus.hidden = !sensorStatus.querySelector(".sensor-indicator:not([hidden])");
    this.shadowRoot.querySelector("ha-card").dataset.lit = String(groupStatus("lights", model.groups.lights, this._hass.states).active);
    this._message(!model.area ? "This room no longer exists. Select a room in the card editor." : this._registryError ? "Room assignments could not be refreshed." : this._mediaError ? "Background image could not be loaded. Select another image in the card editor." : !model.available.length && !this._readings.temperature && !this._readings.humidity ? "No supported devices assigned to this room" : "");
    if (this._dialog.open) this._updateControls();
  }
  _bindRoomActions() {
    this._cancelOnScroll = () => this._cancelPress();
    this._cancelOnVisibility = () => { if (document.hidden) this._cancelPress(); };
    this._cancelOnBlur = () => this._cancelPress();
    const isOverview = event => event.composedPath().includes(this.shadowRoot.querySelector("ha-card"));
    this.shadowRoot.addEventListener("click", event => {
      if (!isOverview(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.detail && Date.now() < (this._ignoreClickUntil ?? 0)) return;
      this._openControls(event.composedPath().find(node => node.tagName === "BUTTON") ?? this.shadowRoot.querySelector(".room-button"));
    }, true);
    this.shadowRoot.addEventListener("pointerdown", event => {
      if (!isOverview(event) || event.isPrimary === false || event.button !== 0) return;
      this._cancelPress();
      const press = { id: event.pointerId, x: event.clientX, y: event.clientY, opener: event.target.closest("button") };
      press.timer = setTimeout(() => {
        if (this._press !== press) return;
        this._ignoreClickUntil = Date.now() + 1000; this._cancelPress(); this._openControls(press.opener);
      }, 550);
      this._press = press;
    }, true);
    this.shadowRoot.addEventListener("pointermove", event => {
      if (this._press && (this._press.id !== event.pointerId || Math.hypot(event.clientX - this._press.x, event.clientY - this._press.y) > 10)) this._cancelPress();
    }, true);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) this.shadowRoot.addEventListener(type, () => this._cancelPress(), true);
    this.shadowRoot.addEventListener("contextmenu", event => {
      if (!isOverview(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this._ignoreClickUntil = Date.now() + 1000; this._cancelPress(); this._openControls();
    }, true);

  }
  _cancelPress() { if (this._press) clearTimeout(this._press.timer); this._press = null; }
  async _openControls(opener) {
    if (!this.isConnected || !this._model?.area) return;
    this._opener = opener ?? this.shadowRoot.querySelector(this._config.mode === "simple" ? ".simple-tile" : ".room-button");
    this._cancelPress();
    const request = this._openRequest = {};
    try { await loadNativeComponents(); }
    catch (error) { this._message(error.message); return; }
    if (!this.isConnected || this._openRequest !== request) return;
    this._updateControls(); this._dialog.open = true;
  }
  _updateControls() {
    this._dialog.headerTitle = this._config.name || this._model.area?.name || "Room";
    const config = controlCardConfig(this._config), signature = JSON.stringify(config);
    if (!this._control) {
      this._control = document.createElement("room-control-card");
      this._control.setConfig(config); this._control.hass = this._hass;
      this.shadowRoot.querySelector(".control-container").append(this._control);
    } else if (signature !== this._controlSignature) this._control.setConfig(config);
    this._controlSignature = signature; this._control.hass = this._hass;
  }
  _unmountControls() {
    this._control?.remove(); this._control = null; this._controlSignature = null;
    if (this._dialog.bodyContainer) this._dialog.bodyContainer.scrollTop = 0;
  }
  _closeDialog() {
    this._openRequest = null; this._dialog.open = false;
    this._unmountControls();
  }

}

if (!customElements.get("room-overview-card")) customElements.define("room-overview-card", RoomOverviewCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "room-overview-card")) window.customCards.push({ type: "room-overview-card", name: "Room Overview Card", description: "Room overview with integrated room controls and independent exclusions.", preview: true });


class RoomOverviewCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; }
  setConfig(config) {
    this._config = migrateExclusions(config); delete this._config.simple_size; delete this._config.full_height;
    this._render();
  }
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
    return this._selector(key, label, { select: { options: options.filter(option => !option.disabled).map(({ value, label }) => ({ value, label })) } }, selected ?? "", onChange);
  }
  _input(key, label, value, onChange, type = "text") {
    return this._selector(key, label, type === "number" ? { number: { mode: "box", step: 0.1 } } : { text: {} }, value, value => onChange(value ?? ""));
  }
  _checkbox(key, label) { return this._selector(key, label, { boolean: {} }, !!this._config[key], value => this._change(key, value)); }
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
    const ids = [...new Set([...entities.map(entity => entity.entity_id), ...selected])];
    return this._selector(key, label, { entity: { multiple: true, include_entities: ids } }, selected, value => this._change(key, value ?? []));
  }
  _exclusionChoices(model, surface = "overview") {
    const exclusions = exclusionList(this._config, surface);
    const ids = new Set(model.roomEntities.filter(entity => surface === "control" || entityKind(entity, this._hass.states[entity.entity_id])).map(entity => entity.entity_id));
    if (surface === "overview") for (const kind of ["temperature", "humidity"]) {
      for (const id of [model.area?.[`${kind}_entity_id`], this._config[`${kind}_sensor`]]) if (id && id !== "none") ids.add(id);
    }
    for (const id of [...exclusions.entities, ...(surface === "control" ? this._config.control_options?.always_show ?? [] : [])]) ids.add(id);
    return { devices: [], entities: [...ids].map(id => ({ id })) };
  }
  _exclusionList(surface, key, label, choices) {
    const always = key === "always_show", configKey = always ? "control_options" : `${surface}_exclusions`;
    const selected = this._config[configKey]?.[key] ?? [];
    const selector = key === "devices" ? { device: { multiple: true } } : { entity: { multiple: true, include_entities: [...new Set([...choices.map(choice => choice.id), ...selected])] } };
    return this._selector(`${configKey}.${key}`, label, selector, selected, value => this._change(configKey, { ...this._config[configKey], [key]: value ?? [] }));
  }
  _exclusions(surface, choices, openSections) {
    const key = `${surface}-exclusions`, exclusions = exclusionList(this._config, surface);
    const panel = element("ha-expansion-panel", "exclusions"); panel.dataset.section = key; panel.expanded = openSections[key] ?? false;
    panel.header = `${surface === "overview" ? "Overview" : "Control"} exclusions`;
    panel.secondary = `${exclusions.devices.length} devices · ${exclusions.entities.length} entities`;
    panel.append(element("p", "hint", surface === "overview" ? "These exclusions affect overview tiles, counts, readings and indicators." : "These exclusions affect room controls, sensor badges and cameras."));
    panel.append(this._exclusionList(surface, "devices", "Excluded devices", choices.devices), this._exclusionList(surface, "entities", "Excluded entities", choices.entities));
    return panel;
  }
  _controlModel() {
    const devices = new Map(this._registries.devices.map(device => [device.id, device]));
    const options = controlCardConfig(this._config);
    const roomEntities = options.entities?.length ? options.entities.map(id => this._registries.entities.find(entity => entity.entity_id === id) ?? { entity_id: id }) : this._registries.entities.filter(entity => !entity.disabled_by &&
      (entity.area_id ?? devices.get(entity.device_id)?.area_id) === this._config.area &&
      (options.include_hidden || !entity.hidden_by));
    return { roomEntities };
  }
  _render() {
    if (!this._hass || !this._registries) {
      this.shadowRoot.innerHTML = `<style>${EDITOR_STYLE}</style><p class="hint"></p>`;
      this.shadowRoot.querySelector("p").textContent = this._registryError ? "Room information could not be loaded. Reload to try again." : "Loading rooms…";
      return;
    }
    const model = discoverRoom(this._config, this._registries, this._hass.states);
    const exclusionChoices = this._exclusionChoices(model), controlChoices = this._exclusionChoices(this._controlModel(), "control");
    const unit = temperatureUnit(this._config, this._hass), thresholds = thresholdsFor(this._config, unit);
    const selections = Array.from({ length: 4 }, (_, i) => {
      const kind = Array.isArray(this._config.tiles) ? this._config.tiles[i] : model.controlGroups[i];
      return CONTROL_GROUP_ORDER.includes(kind) ? kind : "none";
    });
    const signature = JSON.stringify([this._config, this._registries.areas, model.groups, model.sensors, exclusionChoices, controlChoices, unit]);
    if (signature === this._signature) {
      for (const picker of this.shadowRoot.querySelectorAll("ha-selector")) picker.hass = this._hass;
      return;
    }
    this._signature = signature;
    const focusKey = this.shadowRoot.activeElement?.dataset?.key;
    const openSections = Object.fromEntries([...this.shadowRoot.querySelectorAll("ha-expansion-panel[data-section]")].map(d => [d.dataset.section, d.expanded]));
    this.shadowRoot.innerHTML = `<style>${EDITOR_STYLE}</style><div class="editor"></div>`;
    const root = this.shadowRoot.querySelector(".editor");
    const simple = this._config.mode === "simple";
    root.append(this._select("mode", "Card mode", [{ value: "full", label: "Full" }, { value: "simple", label: "Simple" }], this._config.mode ?? "full", value => {
      if (value === "simple" && !this._config.group) this._config = { ...this._config, group: model.tiles[0]?.kind ?? model.available[0] ?? "lights" };
      this._change("mode", value);
    }));
    const areas = [...this._registries.areas].sort((a, b) => a.name.localeCompare(b.name));
    const areaOptions = [{ value: "", label: "Select a room" }, ...areas.map(a => ({ value: a.area_id ?? a.id, label: a.name }))];
    if (this._config.area && !model.area) areaOptions.push({ value: this._config.area, label: "Room no longer exists" });
    root.append(this._select("area", "Room", areaOptions, this._config.area, value => {
      if (!value) return;
      this._config = { ...this._config };
      // A new room starts with its own defaults rather than stale entity selections.
      for (const key of ["tiles", "temperature_sensor", "humidity_sensor", "overview_exclusions", "control_exclusions", "control_options", "exclude_devices", "exclude_entities", "light_switches", "power_sensors", "name", "icon", "image", "image_position"]) delete this._config[key];
      this._config.overview_exclusions = { devices: [], entities: [] };
      this._config.control_exclusions = { devices: [], entities: [] };
      this._search = {};
      this._change("area", value);
    }));
    if (simple) {
      root.append(this._select("group", "Device group", GROUP_ORDER.map(kind => ({ value: kind, label: `${GROUPS[kind].name} (${model.groups[kind].length})` })), this._config.group ?? "lights", value => this._change("group", value)));
      root.append(element("p", "hint", "One group icon fills the card. Tap it to open the room controls. Contacts and motion / presence show sensor status."));
      root.append(element("p", "hint", "Choose columns and rows in the Layout tab. The card and icon fit that grid space. Turn on Auto height for a square card."));
      root.append(this._checkbox("show_room_title", "Show room title"), this._checkbox("show_state", "Show device status"));
      root.append(element("p", "hint", "Status shows the active count, current speaker track, or switch count with measured power when sensors are available."));
    } else {
      root.append(element("p", "hint", "Choose columns and rows in the Layout tab. The card fills that grid space. Auto height keeps the existing room layout."));
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
        field.querySelector("ha-selector").disabled = !model.area; slots.append(field);
      }
      root.append(slots);
      root.append(element("p", "hint", this._config.tiles === undefined ? "Tiles are filled automatically. Choose a group or None in any of the four slots to customise them." : "These four choices are saved. Group members still update automatically when room assignments change."));
      const reset = button("reset", "Use automatic mini tiles", () => this._change("tiles", undefined)); reset.textContent = "Use automatic mini tiles"; root.append(reset);
      root.append(this._select("tile_alignment", "Mini tile alignment", [
        { value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" },
      ], this._config.tile_alignment ?? "right", value => this._change("tile_alignment", value)));
    }
    root.append(this._exclusions("overview", exclusionChoices, openSections), this._exclusions("control", controlChoices, openSections));
    root.append(element("div", "section-title", "Room controls"));
    const options = controlCardConfig(this._config);
    for (const [key, label, choices] of [
      ["layout", "Control layout", [{ value: "compact", label: "Compact rows" }, { value: "tiles", label: "Native tiles" }, { value: "grouped", label: "Grouped rows (legacy)" }]],
      ["camera_layout", "CCTV display", [{ value: "carousel", label: "Carousel" }, { value: "tiles", label: "Individual camera tiles" }]],
    ]) root.append(this._select(`control_options.${key}`, label, choices, options[key], value => this._change("control_options", { ...this._config.control_options, [key]: value })));
    for (const [key, label] of [["everyday_controls", "Everyday controls"], ["include_hidden", "Include hidden entities in controls"], ["include_diagnostics", "Include diagnostic entities in controls"]]) {
      root.append(this._selector(`control_options.${key}`, label, { boolean: {} }, options[key], value => this._change("control_options", { ...this._config.control_options, [key]: value })));
    }
    root.append(element("p", "hint", "Everyday controls hides device setup, Identify buttons, updates and automations. Battery readings remain available in More room details; low and unavailable batteries appear in the status badges."));
    const always = element("ha-expansion-panel", "specific-entities"); always.dataset.section = "always-show"; always.expanded = openSections["always-show"] ?? false;
    always.header = `Always show (${options.always_show?.length ?? 0})`; always.append( element("p", "hint", "Choose room entities to keep visible despite automatic filters. Manual exclusions and hidden or disabled entities still apply."), this._exclusionList("control", "always_show", "Search room entities", controlChoices.entities));
    root.append(always);
    const details = element("ha-expansion-panel", "advanced"); details.dataset.section = "advanced"; details.expanded = openSections.advanced ?? false; details.header = "Advanced";
    details.append(this._input("name", "Room name override", this._config.name, value => this._change("name", value)));
    if (simple && this._config.group === "switches") {
      const automatic = groupPowerSensors({ ...this._config, power_sensors: undefined }, model, this._registries, this._hass.states).entities;
      const choices = this._registries.entities.filter(entity => isPowerSensor(entity, this._hass.states) && !model.excluded.has(entity.entity_id) && (model.entities.some(member => member.entity_id === entity.entity_id) || automatic.includes(entity.entity_id)));
      details.append(this._multiSelect("power_sensors", "Power sensors", choices, this._config.power_sensors ?? automatic));
      const resetPower = button("reset", "Use automatic power sensors", () => this._change("power_sensors", undefined)); resetPower.textContent = "Use automatic power sensors";
      details.append(resetPower, element("p", "hint", "Automatic uses a single power sensor on each switch device. Choose sensors explicitly for other meters. Clear the selection to hide wattage. Excluded sensors are ignored. Partial measurements are labelled measured."));
    }
    if (!simple) {
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
    }
    const switches = model.entities.filter(e => domainOf(e.entity_id) === "switch");
    if (switches.length || this._config.light_switches?.length) details.append(this._multiSelect("light_switches", "Switches to include in Lights", switches, this._config.light_switches ?? []));
    details.append(element("p", "hint", "Choose the lighting switches with the native entity picker. Room assignments are managed in Home Assistant."));
    root.append(details);
    const error = element("p", "error", this._registryError ? "Room assignments could not be refreshed." : ""); error.setAttribute("role", "alert"); root.append(error);
    if (focusKey) {
      const focused = [...this.shadowRoot.querySelectorAll("[data-key]")].find(node => node.dataset.key === focusKey);
      focused?.focus({ preventScroll: true });
    }
  }
}
if (!customElements.get("room-overview-card-editor")) customElements.define("room-overview-card-editor", RoomOverviewCardEditor);

})();
})();
