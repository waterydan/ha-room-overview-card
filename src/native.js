// Use HA's loader; never bundle or imitate its components.
let nativeComponents;
export function loadNativeComponents() {
  nativeComponents ??= Promise.resolve().then(async () => {
    if (typeof window.loadCardHelpers !== "function") throw new Error("Open this card in a Home Assistant dashboard.");
    const helpers = await window.loadCardHelpers();
    helpers.createCardElement({ type: "tile", entity: "light.room_loader" });
    await customElements.whenDefined("hui-tile-card");
    // HA's editor imports its native forms and expansion panels as needed.
    await customElements.get("hui-tile-card").getConfigElement();
    return helpers;
  }).catch(error => { nativeComponents = undefined; throw error; });
  return nativeComponents;
}
