import { domainOf } from "./model.js";
const supportsFeature = (entity, flag) => !!((entity.attributes?.supported_features ?? 0) & flag);
const row = entity => ({ entity: entity.entity_id, name: entity.name });
export function entitiesCardConfig(entities, title) {
  return { type: "entities", ...(title ? { title } : {}), show_header_toggle: false, state_color: true, entities: entities.map(row) };
}
export function tileCardConfig(entity) {
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
export function pictureCardConfig(entity) { return { type: "picture-entity", ...row(entity), camera_view: "live", show_name: true, show_state: false, aspect_ratio: "16:9", tap_action: { action: "more-info" }, hold_action: { action: "more-info" } }; }
export function headingCardConfig(heading) { return { type: "heading", heading, heading_style: "subtitle" }; }
