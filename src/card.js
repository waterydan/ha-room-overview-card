import { GROUPS, GROUP_ORDER, normalizeConfig, discoverRoom, groupStatus, temperatureUnit, roomReading, thresholdsFor, warningsFor, safeImageUrl, domainOf, usable } from "./model.js";
import { watchRegistries } from "./registry.js";
import { lightCapabilities, lightColor, lightTemperatureBounds } from "./lights.js";
import { CARD_STYLE } from "./styles.js";
import { isMediaImage, resolveMediaImage, loadEditorSelectors } from "./media.js";

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function iconNode(icon) { const node = element("ha-icon"); node.setAttribute("icon", icon); return node; }
export function button(className, label, onClick) {
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
