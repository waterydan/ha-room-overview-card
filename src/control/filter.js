// Display-only rules. They never disable entities or change their HA settings.
export function controlFilterReason(entry, state, config) {
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
