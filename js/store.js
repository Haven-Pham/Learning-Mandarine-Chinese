// Progress storage in the browser, with backup/restore to a JSON file.
// Uses IndexedDB; falls back to localStorage if IndexedDB is unavailable or does not answer.
const Store = (() => {
  const NAME = "so-hoc-tieng-hoa", VERSION = 1, STORES = ["srs", "stats", "inbox", "kv"];
  let backendP = null;

  function idbBackend(db) {
    const all = (store) => new Promise((resolve, reject) => {
      const t = db.transaction(store, "readonly"); const s = t.objectStore(store); let keys = [], vals = [];
      s.getAllKeys().onsuccess = (e) => { keys = e.target.result; };
      s.getAll().onsuccess = (e) => { vals = e.target.result; };
      t.oncomplete = () => { const m = new Map(); keys.forEach((k, i) => m.set(k, vals[i])); resolve(m); };
      t.onerror = () => reject(t.error);
    });
    const write = (store, fn) => new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite"); fn(t.objectStore(store));
      t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
    const updateMany = (store, entries, change) => new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite");
      const s = t.objectStore(store);
      let value;
      for (const [key, incoming] of entries) s.get(key).onsuccess = (event) => {
        try {
          const current = event.target.result;
          value = change(current, incoming);
          if (value !== current) s.put(value, key);
        } catch (error) { reject(error); t.abort(); }
      };
      t.oncomplete = () => resolve(value);
      t.onabort = () => reject(t.error || new Error("Không lưu được tiến độ."));
    });
    return {
      kind: "indexeddb", all,
      updateMany,
      putMany: (store, entries) => write(store, (s) => { for (const [k, v] of entries) s.put(v, k); }),
      del: (store, key) => write(store, (s) => s.delete(key)),
      clear: (store) => write(store, (s) => s.clear()),
    };
  }
  function lsBackend() {
    const key = (store) => `${NAME}:${store}`;
    const load = (store) => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(key(store)) || "{}"))); } catch (e) { return new Map(); } };
    const cache = {}; for (const s of STORES) cache[s] = load(s);
    const save = (store) => { localStorage.setItem(key(store), JSON.stringify(Object.fromEntries(cache[store]))); };
    return {
      kind: "localstorage",
      updateMany: async (store, entries, change) => {
        cache[store] = load(store);
        let value;
        for (const [k, incoming] of entries) {
          value = change(cache[store].get(k), incoming);
          cache[store].set(k, value);
        }
        save(store);
        return value;
      },
      all: async (store) => load(store),
      putMany: async (store, entries) => { cache[store] = load(store); for (const [k, v] of entries) cache[store].set(k, v); save(store); },
      del: async (store, k) => { cache[store] = load(store); cache[store].delete(k); save(store); },
      clear: async (store) => { cache[store].clear(); save(store); },
    };
  }
  function backend() {
    if (backendP) return backendP;
    backendP = new Promise((resolve, reject) => {
      let done = false;
      const fallback = () => { if (done) return; done = true; try { resolve(lsBackend()); } catch (e) { reject(e); } };
      const timer = setTimeout(fallback, 2500);
      try {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
        req.onsuccess = () => { if (done) return; done = true; clearTimeout(timer); resolve(idbBackend(req.result)); };
        req.onerror = () => { clearTimeout(timer); fallback(); };
      } catch (e) { clearTimeout(timer); fallback(); }
    });
    return backendP;
  }
  const all = async (store) => (await backend()).all(store);
  const put = async (store, key, val) => (await backend()).putMany(store, [[key, val]]);
  const putMany = async (store, entries) => (await backend()).putMany(store, entries);
  const del = async (store, key) => (await backend()).del(store, key);
  const kind = async () => (await backend()).kind;
  const get = async (store, key) => (await all(store)).get(key);
  const update = async (store, key, change) => (await backend()).updateMany(store, [[key]], change);

  const COUNTERS = ["reviews", "again", "newCards"];
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const maxCounters = (a, b) => Object.fromEntries(COUNTERS.map((key) => [key, Math.max(count(a?.[key]), count(b?.[key]))]));
  const statsBase = (row) => row?.byDevice ? row.base : row;
  function newerCard(current, incoming) {
    if (!current || (incoming.last || 0) > (current.last || 0)) return incoming;
    if ((incoming.last || 0) === (current.last || 0) && (incoming.reps || 0) > (current.reps || 0)) return incoming;
    return current;
  }
  function mergeStats(a, b) {
    const base = maxCounters(statsBase(a), statsBase(b));
    if (!a?.byDevice && !b?.byDevice) return base;
    const byDevice = {};
    for (const row of [a, b]) for (const [id, counts] of Object.entries(row?.byDevice || {})) {
      if (/^[0-9a-f-]{36}$/i.test(id)) byDevice[id] = maxCounters(byDevice[id], counts);
    }
    const totals = { ...base };
    for (const counts of Object.values(byDevice)) for (const key of COUNTERS) totals[key] += counts[key] || 0;
    return { ...totals, base, byDevice };
  }

  const deviceId = () => update("kv", "syncDeviceId", (id) => id || crypto.randomUUID());
  async function incrementStats(day, delta) {
    const id = await deviceId();
    return update("stats", day, (row) => {
      const previous = row?.byDevice?.[id] || {};
      const counts = Object.fromEntries(COUNTERS.map((key) => [key, count(previous[key]) + count(delta[key])]));
      return mergeStats(row, { base: statsBase(row), byDevice: { [id]: counts } });
    });
  }

  // Sync secrets stay on this device only: never in backups, Gist content or progress codes.
  const SECRET_KEYS = ["syncToken", "syncGistId", "lastSyncTime"];
  // kv entries that stay on this device: never exported, synced, or wiped by a restore (private, copyrighted test packs)
  const LOCAL_KV = ["mockTests", "syncDeviceId"];
  function publicSettings(s) { const c = JSON.parse(JSON.stringify(s || {})); for (const k of SECRET_KEYS) delete c[k]; return c; }
  async function exportAll() {
    const out = { app: "so-hoc-tieng-hoa", version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = Object.fromEntries(await all(s));
    if (out.kv && out.kv.settings) out.kv.settings = publicSettings(out.kv.settings);
    if (out.kv) for (const k of LOCAL_KV) delete out.kv[k];
    return out;
  }
  // mode "replace": wipe then load; "merge": keep the newer state per card
  function validateBackup(data) {
    if (!data || data.app !== "so-hoc-tieng-hoa") throw new Error("File này không phải bản sao lưu của Sổ học tiếng Hoa.");
    for (const store of STORES) {
      const value = data[store];
      if (value === undefined) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bản sao lưu có dữ liệu không hợp lệ.");
      if ((store === "stats" || store === "srs") && Object.values(value).some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new Error("Bản sao lưu có dữ liệu tiến độ không hợp lệ.");
      }
    }
  }
  async function importAll(data, mode) {
    validateBackup(data);
    const b = await backend();
    const localKv = await b.all("kv"); const localSettings = localKv.get("settings") || {};
    const keepSecrets = (v) => { const c = Object.assign({}, v); for (const k of SECRET_KEYS) { delete c[k]; if (localSettings[k] !== undefined) c[k] = localSettings[k]; } return c; };
    if (data.kv && data.kv.settings) data = Object.assign({}, data, { kv: Object.assign({}, data.kv, { settings: keepSecrets(data.kv.settings) }) });
    for (const s of STORES) {
      const incoming = Object.entries(data[s] || {});
      if (mode === "replace") {
        const keepLocal = s === "kv" ? LOCAL_KV.filter((k) => localKv.has(k)).map((k) => [k, localKv.get(k)]) : [];
        await b.clear(s); await b.putMany(s, incoming.filter(([k]) => !(s === "kv" && LOCAL_KV.includes(k))).concat(keepLocal)); continue;
      }
      if (s === "stats" || s === "srs") {
        if (incoming.length) await b.updateMany(s, incoming, s === "stats" ? mergeStats : newerCard);
        continue;
      }
      const cur = await b.all(s); const keep = [];
      for (const [k, v] of incoming) {
        if (s === "kv" && LOCAL_KV.includes(k)) continue;
        const c = cur.get(k);
        if (!c) keep.push([k, v]);
        else if (s === "inbox") {
          keep.push([k, Object.assign({}, c, v)]);
        }
        else if (s === "kv" && k === "settings") {
          const merged = Object.assign({}, c, v);
          if (c.bands || v.bands) merged.bands = Object.assign({}, c.bands, v.bands);
          if (c.decks || v.decks) merged.decks = Object.assign({}, c.decks, v.decks);
          if (c.extra || v.extra) merged.extra = Object.assign({}, c.extra, v.extra);
          if (c.dictation || v.dictation) {   // dictation progress: union of done sentences ("ok" wins), furthest position per lesson
            const a = c.dictation || {}, b2 = v.dictation || {}, dm = {}, pos = Object.assign({}, a.pos, b2.pos);
            for (const id of new Set([...Object.keys(a.doneMap || {}), ...Object.keys(b2.doneMap || {})])) {
              const x = (a.doneMap || {})[id] || {}, y = (b2.doneMap || {})[id] || {}; dm[id] = Object.assign({}, x, y);
              for (const i of Object.keys(x)) if (x[i] === "ok") dm[id][i] = "ok";
            }
            for (const id of Object.keys(a.pos || {})) pos[id] = Math.max(a.pos[id] || 0, (b2.pos || {})[id] || 0);
            merged.dictation = Object.assign({}, a, b2, { doneMap: dm, pos });
          }
          keep.push([k, merged]);
        }
      }
      await b.putMany(s, keep);
    }
  }
  return { all, get, put, del, putMany, update, exportAll, importAll, validateBackup, incrementStats, deviceId, kind, publicSettings };
})();
