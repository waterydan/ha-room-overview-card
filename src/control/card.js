import { validateConfig, discoverRoom, domainOf } from "./model.js";
import { presentRoom } from "./presentation.js";
import { entitiesCardConfig, tileCardConfig, pictureCardConfig, headingCardConfig } from "./native-config.js";
import { watchRegistries } from "../registry.js";
import { loadNativeComponents } from "../native.js";
import { CARD_STYLES } from "./styles.js";

export class RoomControlCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" }); this._nativeCards = new Map(); this._badges = new Map();
    this.shadowRoot.innerHTML = `<style>${CARD_STYLES}</style><div class="room-content"><div class="room-title"></div><div class="message" role="status"></div><div class="badges" aria-label="Room status"></div><ha-expansion-panel class="sensor-detail" hidden></ha-expansion-panel><main class="sections"></main><section class="cameras" hidden><div class="camera-heading"></div><div class="camera-content"></div><div class="camera-nav" hidden><ha-icon-button class="previous" label="Previous camera"><ha-icon icon="mdi:chevron-left"></ha-icon></ha-icon-button><span class="camera-count" aria-live="polite"></span><ha-icon-button class="next" label="Next camera"><ha-icon icon="mdi:chevron-right"></ha-icon></ha-icon-button></div></section><ha-expansion-panel class="room-details" header="More room details" hidden><div class="details-content"></div></ha-expansion-panel></div>`;
    this.shadowRoot.querySelector(".previous").addEventListener("click", () => this._navigateCamera(-1));
    this.shadowRoot.querySelector(".next").addEventListener("click", () => this._navigateCamera(1));
    this.shadowRoot.addEventListener("keydown", event => {
      if (event.key === "Escape" && this._sensor) { event.preventDefault(); event.stopPropagation(); this._closeSensor(); }
    });
    this.shadowRoot.querySelector(".sensor-detail").addEventListener("expanded-changed", event => {
      if (!event.detail.expanded) { this._sensor = null; this.shadowRoot.querySelector(".sensor-detail").hidden = true; }
    });
    this.shadowRoot.addEventListener("ll-rebuild", event => {
      const entry = [...this._nativeCards.values()].find(item => event.composedPath().includes(item.node));
      if (!entry) return;
      event.stopPropagation(); const node = this._helpers.createCardElement(entry.config);
      node.hass = this._hass; node.dataset.nativeKey = entry.node.dataset.nativeKey; entry.node.replaceWith(node); entry.node = node;
    });
  }
  static async getConfigElement() { await loadNativeComponents(); return document.createElement("room-control-card-editor"); }
  static getStubConfig(hass) { const area = Object.values(hass?.areas ?? {})[0]?.area_id; return area ? { area, layout: "compact" } : { entities: Object.keys(hass?.states ?? {}).slice(0, 6), layout: "compact" }; }
  setConfig(config) {
    this._config = validateConfig(config); this._sensor = null; this._selectedCamera = null;
    this.shadowRoot.querySelector(".room-details").expanded = false; this._render();
  }
  set hass(hass) { this._hass = hass; this._watch(); this._render(); }
  get hass() { return this._hass; }
  connectedCallback() {
    loadNativeComponents().then(helpers => { if (!this.isConnected) return; this._helpers = helpers; this._loadError = null; this._render(); }).catch(error => { this._loadError = error.message; this._render(); });
    this._watch(); this._render();
  }
  disconnectedCallback() { this._stop?.(); this._stop = null; this._connection = null; }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6, min_rows: 3 }; }
  _watch() {
    if (!this.isConnected || !this._hass) return;
    const connection = this._hass.connection ?? this._hass;
    if (this._connection === connection) return;
    this._stop?.(); this._connection = connection; this._registries = null; this._registryError = null;
    this._stop = watchRegistries(this._hass, (data, error) => { this._registries = data; this._registryError = error; this._render(); });
  }
  _card(key, config, container) {
    this._usedCards.add(key);
    let entry = this._nativeCards.get(key); const signature = JSON.stringify(config);
    if (!entry || entry.signature !== signature) {
      const node = this._helpers.createCardElement(config); node.dataset.nativeKey = key;
      if (entry) entry.node.replaceWith(node);
      entry = { node, config, signature }; this._nativeCards.set(key, entry);
    }
    entry.node.hass = this._hass;
    if (entry.node.parentNode !== container) container.append(entry.node);
    return entry.node;
  }
  _sensorBadge(group) {
    let badge = this._badges.get(group.key);
    if (!badge) {
      badge = document.createElement("ha-badge"); badge.type = "button"; badge.dataset.sensor = group.key;
      const icon = document.createElement("ha-icon"); icon.slot = "icon"; badge.append(icon, document.createElement("span"));
      const open = () => { this._sensor = this._sensor === badge.dataset.sensor ? null : badge.dataset.sensor; this._render(); };
      badge.addEventListener("click", open);
      badge.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
      this._badges.set(group.key, badge);
    }
    badge.label = group.label; badge.querySelector("ha-icon").setAttribute("icon", `mdi:${({ thermometer: "thermometer", droplets: "water-percent", "person-standing": "motion-sensor", "door-open": "door-closed", "battery-warning": "battery-alert", zap: "flash", activity: "gauge" })[group.icon] || "shield-alert"}`);
    badge.querySelector("span").textContent = group.value;
    badge.style.setProperty("--badge-color", group.warning ? "var(--warning-color)" : "var(--secondary-text-color)");
    return badge;
  }
  _closeSensor() {
    const selected = this._sensor; this._sensor = null; this._render(); this._badges.get(selected)?.shadowRoot?.querySelector('[role="button"]')?.focus();
  }
  _navigateCamera(offset) {
    const cameras = this._presentation?.cameras ?? [];
    if (!cameras.length) return;
    const index = Math.max(0, cameras.findIndex(entity => entity.entity_id === this._selectedCamera));
    this._selectedCamera = cameras[(index + offset + cameras.length) % cameras.length].entity_id; this._render();
  }
  _render() {
    if (!this._config || !this._hass) return;
    const message = this.shadowRoot.querySelector(".message");
    message.textContent = this._loadError || this._registryError?.message || (!this._helpers ? "Loading Home Assistant components…" : !this._registries ? "Loading room entities…" : "");
    message.hidden = !message.textContent;
    if (!this._helpers || !this._registries) return;
    const room = discoverRoom(this._config, this._hass, this._registries); this._room = room;
    const model = presentRoom(room, this._config); this._presentation = model; this._usedCards = new Set();
    const title = this.shadowRoot.querySelector(".room-title"); title.hidden = !this._config.show_title;
    if (this._config.show_title) this._card("title", { type: "heading", heading: room.name, heading_style: "title", icon: this._config.icon || room.area?.icon || "mdi:home-outline" }, title);
    const badges = this.shadowRoot.querySelector(".badges"); badges.hidden = !model.statuses.length;
    for (const group of model.statuses) { const badge = this._sensorBadge(group); if (badge.parentNode !== badges) badges.append(badge); }
    for (const [key, badge] of this._badges) if (!model.statuses.some(group => group.key === key)) { badge.remove(); this._badges.delete(key); }
    const detail = this.shadowRoot.querySelector(".sensor-detail"), selected = model.statuses.find(group => group.key === this._sensor);
    detail.hidden = !selected; detail.expanded = !!selected;
    if (selected) { detail.header = selected.label; this._card("sensor-readings", entitiesCardConfig(selected.entities), detail); }
    else this._sensor = null;
    const sections = this.shadowRoot.querySelector(".sections"); sections.dataset.layout = this._config.layout;
    const sectionKeys = new Set();
    for (const group of model.sections) {
      sectionKeys.add(group.name);
      let section = [...sections.children].find(node => node.dataset.section === group.name);
      if (!section) { section = document.createElement("section"); section.dataset.section = group.name; section.setAttribute("aria-label", group.name); sections.append(section); }
      this._card(`heading:${group.name}`, headingCardConfig(group.name), section);
      const advanced = group.entities.some(entity => ["climate", "fan", "media_player", "cover", "humidifier"].includes(domainOf(entity.entity_id)));
      if (this._config.layout !== "tiles" && !advanced) this._card(`rows:${group.name}`, entitiesCardConfig(group.entities), section);
      else {
        let grid = section.querySelector(".native-tiles"); if (!grid) { grid = document.createElement("div"); grid.className = "native-tiles"; section.append(grid); }
        for (const entity of group.entities) this._card(`tile:${entity.entity_id}`, tileCardConfig(entity), grid);
      }
    }
    for (const section of [...sections.children]) if (!sectionKeys.has(section.dataset.section)) section.remove();
    const cameras = this.shadowRoot.querySelector(".cameras"); cameras.hidden = !model.cameras.length;
    if (model.cameras.length) {
      this._card("camera-heading", headingCardConfig("Cameras"), cameras.querySelector(".camera-heading"));
      const content = cameras.querySelector(".camera-content"), nav = cameras.querySelector(".camera-nav");
      content.classList.toggle("native-tiles", this._config.camera_layout === "tiles");
      const selectedCamera = model.cameras.find(entity => entity.entity_id === this._selectedCamera) || model.cameras[0]; this._selectedCamera = selectedCamera.entity_id;
      const members = this._config.camera_layout === "carousel" ? [selectedCamera] : model.cameras;
      for (const entity of members) this._card(`camera:${entity.entity_id}`, pictureCardConfig(entity), content);
      nav.hidden = this._config.camera_layout !== "carousel" || model.cameras.length < 2;
      nav.querySelector(".camera-count").textContent = `${model.cameras.indexOf(selectedCamera) + 1} / ${model.cameras.length}`;
    }
    const more = this.shadowRoot.querySelector(".room-details"); more.hidden = !model.details.length;
    for (const group of model.details) this._card(`details:${group.name}`, entitiesCardConfig(group.entities, group.name), more.querySelector(".details-content"));
    for (const [key, entry] of this._nativeCards) if (!this._usedCards.has(key)) { entry.node.remove(); this._nativeCards.delete(key); }
    for (const grid of sections.querySelectorAll(".native-tiles:empty")) grid.remove();
    if (!room.entities.length && !message.textContent) { message.hidden = false; message.textContent = room.area || this._config.entities?.length ? "No entities found. Check room assignments and exclusions." : "Area not found. Choose an area in the card editor."; }
  }
}
if (!customElements.get("room-control-card")) customElements.define("room-control-card", RoomControlCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "room-control-card")) window.customCards.push({ type: "room-control-card", name: "Room Control Card", description: "Native Home Assistant controls grouped by room.", preview: true });
