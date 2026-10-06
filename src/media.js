import { safeImageUrl } from "./model.js";

// Media URLs are signed for 24 hours. Share resolutions across cards, then
// refresh before the signature expires without saving it in the card config.
const MEDIA_IMAGE_CACHE_MS = 23 * 60 * 60 * 1000;
const mediaImageCaches = new WeakMap();

export function isMediaImage(value) {
  return typeof value === "string" && value.startsWith("media-source://");
}

export function resolveMediaImage(hass, mediaId) {
  const connection = hass.connection;
  let cache = mediaImageCaches.get(connection);
  if (!cache) { cache = new Map(); mediaImageCaches.set(connection, cache); }
  const previous = cache.get(mediaId);
  if (previous && previous.expires > Date.now()) return previous.promise;
  const entry = { expires: Date.now() + MEDIA_IMAGE_CACHE_MS };
  entry.promise = Promise.resolve().then(() => hass.callWS({
    type: "media_source/resolve_media", media_content_id: mediaId,
  })).then(result => {
    if (!result?.mime_type?.startsWith("image/")) throw new Error("Select an image from Media.");
    const url = safeImageUrl(result.url);
    if (!url) throw new Error("The image URL could not be loaded.");
    entry.expires = Date.now() + MEDIA_IMAGE_CACHE_MS;
    return { url: url.startsWith("/") && hass.hassUrl ? hass.hassUrl(url) : url, expires: entry.expires };
  }).catch(error => {
    if (cache.get(mediaId) === entry) cache.delete(mediaId);
    throw error;
  });
  cache.set(mediaId, entry);
  return entry.promise;
}

export async function loadEditorSelectors() {
  if (customElements.get("ha-selector")) return;
  // Load the native form through HA's public card helper instead of importing
  // version-specific frontend bundles. ha-selector lazy-loads its own pickers.
  const helpers = await window.loadCardHelpers();
  await helpers.createCardElement({ type: "button" }).constructor.getConfigElement();
  await customElements.whenDefined("ha-selector");
}
