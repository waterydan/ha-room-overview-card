import { expandExclusions } from "../exclusions.js";
import { controlFilterReason } from "./filter.js";
export const DEFAULT_CONFIG = { layout: "compact", camera_layout: "carousel", show_title: true, everyday_controls: true, include_diagnostics: false, include_hidden: true };
export const humanize = value => String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
export const domainOf = id => String(id).split(".")[0];
export const entityName = entity => entity.attributes?.friendly_name || humanize(entity.entity_id.split(".").slice(1).join("."));
export const unavailable = entity => !entity || ["unavailable", "unknown"].includes(entity.state);

export function validateConfig(config) {
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

export function discoverRoom(config, hass, registries) {
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

