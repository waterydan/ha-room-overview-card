import { validateConfig, DEFAULT_CONFIG } from "./model.js";
import { loadNativeComponents } from "../native.js";
export class RoomControlCardEditor extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = '<style>:host{display:block}.hint{color:var(--secondary-text-color)}.error{color:var(--error-color)}</style><ha-form></ha-form><p class="hint">Secondary readings and device settings are available under More room details. Always show promotes entities to the main controls; manual exclusions still apply.</p><p class="error" role="alert"></p>';
    this._form = this.shadowRoot.querySelector("ha-form");
    this._form.computeLabel = schema => ({ area: "Room", name: "Room title", icon: "Room icon", layout: "Control layout", camera_layout: "Camera display", entities: "Explicit entities (optional)", exclude_devices: "Exclude devices", exclude_entities: "Exclude entities", always_show: "Always show entities", everyday_controls: "Everyday controls", show_title: "Show room title", include_diagnostics: "Include diagnostic entities", include_hidden: "Include hidden entities" })[schema.name] || schema.name;
    this._form.schema = [
      { name: "area", selector: { area: {} } }, { name: "name", selector: { text: {} } }, { name: "icon", selector: { icon: {} } },
      { name: "layout", selector: { select: { options: [{ value: "compact", label: "Compact rows" }, { value: "tiles", label: "Native tiles" }, { value: "grouped", label: "Grouped rows (legacy)" }] } } },
      { name: "camera_layout", selector: { select: { options: [{ value: "carousel", label: "Carousel" }, { value: "tiles", label: "Individual cameras" }] } } },
      { name: "entities", selector: { entity: { multiple: true } } },
      { name: "exclude_devices", selector: { device: { multiple: true } } },
      ...["exclude_entities", "always_show"].map(name => ({ name, selector: { entity: { multiple: true } } })),
      ...["everyday_controls", "show_title", "include_diagnostics", "include_hidden"].map(name => ({ name, selector: { boolean: {} } })),
    ];
    this._form.addEventListener("value-changed", event => {
      event.stopPropagation(); const config = { ...this._config, ...event.detail.value };
      if (!config.entities?.length) delete config.entities;
      if (!config.area) delete config.area;
      this._draft = config;
      try { validateConfig(config); this._config = config; this._error = null; this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })); }
      catch (error) { this._error = error.message; }
      this._render();
    });
  }
  setConfig(config) { this._config = { ...DEFAULT_CONFIG, ...config }; this._draft = null; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  connectedCallback() { loadNativeComponents().then(() => this._render()).catch(error => { this._error = error.message; this._render(); }); }
  _render() { this._form.hass = this._hass; this._form.data = this._draft ?? this._config ?? {}; this.shadowRoot.querySelector(".error").textContent = this._error ?? ""; }
}
if (!customElements.get("room-control-card-editor")) customElements.define("room-control-card-editor", RoomControlCardEditor);
