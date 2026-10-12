import { GROUPS, normalizeConfig, discoverRoom, groupStatus, simpleGroupSummary, temperatureUnit, roomReading, thresholdsFor, warningsFor, safeImageUrl } from "./model.js";
import { watchRegistries } from "./registry.js";
import { controlCardConfig } from "./control-config.js";
import { loadNativeComponents } from "./native.js";
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
