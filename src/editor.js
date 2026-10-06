import { GROUPS, CONTROL_GROUP_ORDER, discoverRoom, domainOf, entityKind, temperatureUnit, thresholdsFor, convertTemperature } from "./model.js";
import { element, button } from "./card.js";
import { watchRegistries } from "./registry.js";
import { EDITOR_STYLE } from "./styles.js";

class RoomSceneCardEditor extends HTMLElement {
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
if (!customElements.get("room-scene-card-editor")) customElements.define("room-scene-card-editor", RoomSceneCardEditor);
