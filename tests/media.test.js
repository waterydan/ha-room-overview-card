import test from "node:test";
import assert from "node:assert/strict";
import { isMediaImage, resolveMediaImage, loadEditorSelectors } from "../src/media.js";

const mediaId = "media-source://media_source/local/example.png";
function fixture() {
  const calls = [];
  const hass = {
    connection: {}, hassUrl: path => `https://ha.example${path}`,
    callWS: async message => { calls.push(message); return { url: "/media/local/example.png?authSig=temporary", mime_type: "image/png" }; },
  };
  return { hass, calls };
}

test("media IDs are identified without changing existing image paths or URLs", () => {
  assert.equal(isMediaImage(mediaId), true);
  for (const value of [undefined, {}, "/local/example.png", "https://example.com/example.png"]) assert.equal(isMediaImage(value), false);
});

test("media images resolve through HA, keeping signed URLs out of the saved ID", async () => {
  const f = fixture();
  const result = await resolveMediaImage(f.hass, mediaId);
  assert.equal(result.url, "https://ha.example/media/local/example.png?authSig=temporary");
  assert.ok(result.expires > Date.now());
  assert.deepEqual(f.calls, [{ type: "media_source/resolve_media", media_content_id: mediaId }]);
});

test("cards sharing a connection reuse pending and resolved media URLs", async () => {
  const f = fixture();
  const results = await Promise.all([resolveMediaImage(f.hass, mediaId), resolveMediaImage({ ...f.hass }, mediaId)]);
  assert.equal(results[0], results[1]);
  assert.equal(await resolveMediaImage(f.hass, mediaId), results[0]);
  assert.equal(f.calls.length, 1);
  await resolveMediaImage({ ...f.hass, connection: {} }, mediaId);
  assert.equal(f.calls.length, 2);
});

test("cached media images retain their expiry and refresh before signatures expire", async () => {
  const f = fixture(), originalNow = Date.now;
  let now = originalNow(); Date.now = () => now;
  try {
    const first = await resolveMediaImage(f.hass, mediaId);
    now += 22 * 60 * 60 * 1000;
    assert.equal((await resolveMediaImage(f.hass, mediaId)).expires, first.expires);
    now += 60 * 60 * 1000;
    const refreshed = await resolveMediaImage(f.hass, mediaId);
    assert.equal(f.calls.length, 2);
    assert.ok(refreshed.expires > first.expires);
  } finally { Date.now = originalNow; }
});

test("invalid images and failed resolutions can be retried after correction", async () => {
  const f = fixture(), valid = f.hass.callWS;
  for (const result of [{ url: "/media/music.mp3", mime_type: "audio/mpeg" }, { url: "javascript:alert(1)", mime_type: "image/png" }]) {
    f.hass.callWS = async () => result;
    await assert.rejects(resolveMediaImage(f.hass, mediaId));
  }
  f.hass.callWS = () => { throw new Error("Disconnected"); };
  await assert.rejects(resolveMediaImage(f.hass, mediaId), /Disconnected/);
  f.hass.callWS = valid;
  assert.match((await resolveMediaImage(f.hass, mediaId)).url, /^https:\/\/ha.example\/media\//);
});

test("native editor selectors load through public HA helpers only when needed", async () => {
  const originalWindow = globalThis.window, originalElements = globalThis.customElements;
  let loaded = false, imports = 0;
  globalThis.customElements = { get: () => loaded, whenDefined: async () => assert.equal(loaded, true) };
  globalThis.window = { loadCardHelpers: async () => ({ createCardElement: config => {
    assert.deepEqual(config, { type: "button" });
    return { constructor: { getConfigElement: async () => { imports++; loaded = true; } } };
  } }) };
  try {
    await loadEditorSelectors(); await loadEditorSelectors();
    assert.equal(imports, 1);
  } finally {
    globalThis.window = originalWindow; globalThis.customElements = originalElements;
  }
});
