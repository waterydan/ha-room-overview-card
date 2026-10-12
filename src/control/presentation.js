import { domainOf, unavailable } from "./model.js";
const token = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const words = value => String(value).replaceAll('_', ' ').replace(/\bwiim\b/gi, 'WiiM').replace(/\bsonos\b/gi, 'Sonos').replace(/\bhomepod\b/gi, 'HomePod').replace(/\bapple tv\b/gi, 'Apple TV').replace(/\bmusic assistant\b/gi, 'Music Assistant').replace(/^./, char => char.toUpperCase());
const categories = new Set(['light', 'plug', 'switch', 'sensor', 'speaker', 'player', 'cover', 'fan', 'camera', 'button', 'climate']);

export function readableName(entity, room) {
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

export function displayState(entity) {
  if (unavailable(entity)) return words(entity.state);
  const value = Number(entity.state);
  const state = String(entity.state).trim() !== '' && Number.isFinite(value) ? prettyNumber(value) : words(entity.state);
  return `${state}${entity.attributes?.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : ''}`;
}

export function presentRoom(room, config = {}) {
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
