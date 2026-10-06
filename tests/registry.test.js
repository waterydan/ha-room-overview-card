import test from "node:test";
import assert from "node:assert/strict";
import { watchRegistries } from "../src/registry.js";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
  const events = new Map(), ready = new Set(), calls = [];
  const connection = { subscribeEvents: async (fn, type) => { events.set(type, fn); return () => events.delete(type); }, addEventListener: (_, fn) => ready.add(fn), removeEventListener: (_, fn) => ready.delete(fn) };
  const hass = { connection, callWS: async msg => { calls.push(msg.type); return [{ id: msg.type }]; } };
  return { hass, calls, events, ready };
}
test("all cards and editors share one registry fetch and three event subscriptions", async () => {
  const f = fixture(), seen = [];
  const a = watchRegistries(f.hass, data => seen.push(data));
  const b = watchRegistries(f.hass, data => seen.push(data));
  await pause(0);
  assert.equal(f.calls.length, 3); assert.equal(f.events.size, 3); assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
  a(); assert.equal(f.events.size, 3); b(); assert.equal(f.events.size, 0); assert.equal(f.ready.size, 0);
});
test("room membership changes and reconnection refresh the shared data", async () => {
  const f = fixture(); let notifications = 0;
  const stop = watchRegistries(f.hass, () => notifications++); await pause(0);
  f.events.get("entity_registry_updated")({}); f.events.get("device_registry_updated")({}); await pause(130);
  assert.equal(f.calls.length, 6); assert.equal(notifications, 2);
  for (const fn of f.ready) fn(); await pause(130); assert.equal(f.calls.length, 9); stop();
});
test("late subscription promises are disposed after the final card disconnects", async () => {
  const f = fixture(); let releases = 0;
  const resolvers = [];
  f.hass.connection.subscribeEvents = () => new Promise(resolve => resolvers.push(resolve));
  const stop = watchRegistries(f.hass, () => {}); stop();
  for (const resolve of resolvers) resolve(() => releases++); await pause(0); assert.equal(releases, 3);
});
test("failed reads report an error without pretending an empty room was loaded", async () => {
  const f = fixture(); f.hass.callWS = async () => { throw new Error("Not allowed"); };
  let observed;
  const stop = watchRegistries(f.hass, (data, error) => { observed = { data, error }; }); await pause(0);
  assert.equal(observed.data, null); assert.equal(observed.error, "Not allowed"); stop();
});

test("a disconnected client throwing synchronously still reports a registry error", async () => {
  const f = fixture(); f.hass.callWS = () => { throw new Error("Disconnected"); };
  let observed;
  const stop = watchRegistries(f.hass, (data, error) => { observed = { data, error }; }); await pause(0);
  assert.equal(observed.data, null); assert.equal(observed.error, "Disconnected"); stop();
});
