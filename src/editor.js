import { GROUPS, GROUP_ORDER, CONTROL_GROUP_ORDER, discoverRoom, domainOf, entityKind, isPowerSensor, groupPowerSensors, temperatureUnit, thresholdsFor, convertTemperature } from "./model.js";
import { element, button } from "./card.js";
import { watchRegistries } from "./registry.js";
import { EDITOR_STYLE } from "./styles.js";
import { exclusionList, migrateExclusions } from "./exclusions.js";
import { controlCardConfig } from "./control-config.js";
import { controlFilterReason } from "./control/filter.js";

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
