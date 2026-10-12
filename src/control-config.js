import { exclusionList } from "./exclusions.js";
import { validateConfig } from "./control/model.js";

export function controlCardConfig(config) {
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
