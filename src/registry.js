const registryStores = new WeakMap();
export function watchRegistries(hass, callback) {
  const key = hass.connection ?? hass;
  let store = registryStores.get(key);
  if (!store) {
    store = { data: null, error: null, listeners: new Set(), unsubscribers: [], loading: null, timer: null, active: false, dirty: false };
    registryStores.set(key, store);
  }
  store.hass = hass;
  store.listeners.add(callback);
  const notify = () => { for (const listener of store.listeners) listener(store.data, store.error); };
  const refresh = () => {
    if (!store.listeners.size) return;
    if (store.loading) { store.dirty = true; return; }
    store.loading = Promise.resolve().then(() => Promise.all([
      store.hass.callWS({ type: "config/area_registry/list" }),
      store.hass.callWS({ type: "config/device_registry/list" }),
      store.hass.callWS({ type: "config/entity_registry/list" }),
    ])).then(([areas, devices, entities]) => {
      store.data = { areas, devices, entities }; store.error = null;
    }).catch(error => { store.error = error?.message ?? "Room information could not be loaded."; }).finally(() => {
      store.loading = null; notify();
      if (store.dirty) { store.dirty = false; refresh(); }
    });
  };
  if (!store.active) {
    store.active = true;
    const generation = Symbol(); store.generation = generation;
    const schedule = () => { clearTimeout(store.timer); store.timer = setTimeout(refresh, 100); };
    for (const type of ["area_registry_updated", "device_registry_updated", "entity_registry_updated"]) {
      Promise.resolve(hass.connection?.subscribeEvents(schedule, type)).then(unsubscribe => {
        if (typeof unsubscribe !== "function") return;
        if (store.generation !== generation || !store.listeners.size) unsubscribe(); else store.unsubscribers.push(unsubscribe);
      }).catch(() => { /* State updates and reconnects can still refresh the registry. */ });
    }
    if (hass.connection?.addEventListener) {
      hass.connection.addEventListener("ready", schedule);
      store.unsubscribers.push(() => hass.connection.removeEventListener("ready", schedule));
    }
    refresh();
  }
  if (store.data || store.error) callback(store.data, store.error);
  return () => {
    store.listeners.delete(callback);
    if (store.listeners.size) return;
    clearTimeout(store.timer);
    for (const unsubscribe of store.unsubscribers) unsubscribe();
    store.unsubscribers = []; store.active = false; store.generation = null;
  };
}
