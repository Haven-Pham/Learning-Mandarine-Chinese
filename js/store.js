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
    return {
      kind: "indexeddb", all,
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
      all: async (store) => new Map(cache[store]),
      putMany: async (store, entries) => { for (const [k, v] of entries) cache[store].set(k, v); save(store); },
      del: async (store, k) => { cache[store].delete(k); save(store); },
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

  // Sync secrets stay on this device only: never in backups, Gist content or progress codes.
  const SECRET_KEYS = ["syncToken", "syncGistId", "lastSyncTime"];
  // kv entries that stay on this device: never exported, synced, or wiped by a restore (private, copyrighted test packs)
  const LOCAL_KV = ["mockTests"];
  function publicSettings(s) { const c = JSON.parse(JSON.stringify(s || {})); for (const k of SECRET_KEYS) delete c[k]; return c; }
  async function exportAll() {
    const out = { app: "so-hoc-tieng-hoa", version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = Object.fromEntries(await all(s));
    if (out.kv && out.kv.settings) out.kv.settings = publicSettings(out.kv.settings);
    if (out.kv) for (const k of LOCAL_KV) delete out.kv[k];
    return out;
  }
  // mode "replace": wipe then load; "merge": keep the newer state per card
  async function importAll(data, mode) {
    if (!data || data.app !== "so-hoc-tieng-hoa") throw new Error("File này không phải bản sao lưu của Sổ học tiếng Hoa.");
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
      const cur = await b.all(s); const keep = [];
      for (const [k, v] of incoming) {
        if (s === "kv" && LOCAL_KV.includes(k)) continue;
        const c = cur.get(k);
        if (!c) keep.push([k, v]);
        else if (s === "srs") {
          const vLast = v.last || 0, cLast = c.last || 0;
          if (vLast > cLast || (vLast === cLast && (v.reps || 0) > (c.reps || 0))) keep.push([k, v]);
        }
        else if (s === "stats") {
          keep.push([k, {
            reviews: Math.max(c.reviews || 0, v.reviews || 0),
            again: Math.max(c.again || 0, v.again || 0),
            newCards: Math.max(c.newCards || 0, v.newCards || 0)
          }]);
        }
        else if (s === "inbox") {
          keep.push([k, Object.assign({}, c, v)]);
        }
        else if (s === "kv" && k === "settings") {
          keep.push([k, Object.assign({}, c, v)]);
        }
      }
      await b.putMany(s, keep);
    }
  }
  return { all, get, put, del, putMany, exportAll, importAll, kind, publicSettings };
})();
