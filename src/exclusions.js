// Each surface owns its own exclusions. Legacy keys affect the overview only.
export function exclusionList(config, surface = "overview") {
  return config[`${surface}_exclusions`] ?? (surface === "overview"
    ? { devices: config.exclude_devices ?? [], entities: config.exclude_entities ?? [] }
    : { devices: [], entities: [] });
}

export function normalizeExclusions(value, label) {
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

export function migrateExclusions(config) {
  const next = { ...config };
  for (const surface of ["overview", "control"]) next[`${surface}_exclusions`] = normalizeExclusions(exclusionList(config, surface), `${surface}_exclusions`);
  delete next.exclude_devices; delete next.exclude_entities;
  return next;
}

export function expandExclusions(lists, registries, states = {}) {
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
