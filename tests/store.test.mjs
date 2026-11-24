// Unit tests for Store.importAll (merge & replace) in js/store.js.
// Run: node --test tests/store.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "store.js"), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));

function createStore() {
  const storage = new Map();
  const sandbox = {
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  return vm.runInContext(`${STORE_SRC}\nStore;`, sandbox);
}

function makeBackup(overrides = {}) {
  return {
    app: "so-hoc-tieng-hoa",
    version: 1,
    srs: {},
    stats: {},
    inbox: {},
    kv: {},
    ...overrides,
  };
}

test("importAll rejects invalid backup payloads", async () => {
  const Store = createStore();
  await assert.rejects(() => Store.importAll(null, "merge"), /không phải bản sao lưu/);
  await assert.rejects(() => Store.importAll({ app: "other-app" }, "merge"), /không phải bản sao lưu/);
});

test("importAll merge (srs): newer last wins, ties break by higher reps, local-only kept", async () => {
  const Store = createStore();
  await Store.putMany("srs", [
    ["local-only", { last: 100, reps: 2, ivl: 5 }],
    ["local-newer", { last: 500, reps: 1, ivl: 10 }],
    ["incoming-newer", { last: 200, reps: 5, ivl: 3 }],
    ["tie-local-wins", { last: 300, reps: 4, ivl: 8 }],
    ["tie-incoming-wins", { last: 300, reps: 2, ivl: 4 }],
    ["tie-equal", { last: 300, reps: 3, ivl: 6 }],
  ]);

  await Store.importAll(
    makeBackup({
      srs: {
        "incoming-only": { last: 150, reps: 1, ivl: 1 },
        "local-newer": { last: 400, reps: 9, ivl: 99 },
        "incoming-newer": { last: 250, reps: 1, ivl: 2 },
        "tie-local-wins": { last: 300, reps: 3, ivl: 7 },
        "tie-incoming-wins": { last: 300, reps: 5, ivl: 12 },
        "tie-equal": { last: 300, reps: 3, ivl: 99 },
      },
    }),
    "merge"
  );

  const srs = await Store.all("srs");
  assert.deepEqual(plain(srs.get("local-only")), { last: 100, reps: 2, ivl: 5 });
  assert.deepEqual(plain(srs.get("incoming-only")), { last: 150, reps: 1, ivl: 1 });
  assert.deepEqual(plain(srs.get("local-newer")), { last: 500, reps: 1, ivl: 10 });
  assert.deepEqual(plain(srs.get("incoming-newer")), { last: 250, reps: 1, ivl: 2 });
  assert.deepEqual(plain(srs.get("tie-local-wins")), { last: 300, reps: 4, ivl: 8 });
  assert.deepEqual(plain(srs.get("tie-incoming-wins")), { last: 300, reps: 5, ivl: 12 });
  assert.deepEqual(plain(srs.get("tie-equal")), { last: 300, reps: 3, ivl: 6 });
});

test("importAll merge (stats): takes per-field max across devices and keeps distinct dates", async () => {
  const Store = createStore();
  await Store.putMany("stats", [
    ["2026-11-22", { reviews: 20, again: 3, newCards: 5 }],
    ["2026-11-23", { reviews: 10, again: 4, newCards: 8 }],
  ]);

  await Store.importAll(
    makeBackup({
      stats: {
        "2026-11-23": { reviews: 25, again: 2, newCards: 6 },
        "2026-11-24": { reviews: 15, again: 1, newCards: 10 },
      },
    }),
    "merge"
  );

  const stats = await Store.all("stats");
  assert.deepEqual(plain(stats.get("2026-11-22")), { reviews: 20, again: 3, newCards: 5 });
  assert.deepEqual(plain(stats.get("2026-11-23")), { reviews: 25, again: 4, newCards: 8 });
  assert.deepEqual(plain(stats.get("2026-11-24")), { reviews: 15, again: 1, newCards: 10 });
});

test("importAll merge (settings.dictation): unions doneMap with 'ok' winning and takes furthest pos", async () => {
  const Store = createStore();
  await Store.put("kv", "settings", {
    theme: "light",
    bands: { B1: true },
    dictation: {
      speed: 0.9,
      doneMap: {
        "lesson-a": { "0": "ok", "1": "try", "2": "ok" },
        "lesson-local": { "0": "ok" },
      },
      pos: { "lesson-a": 5, "lesson-local": 3 },
    },
  });

  await Store.importAll(
    makeBackup({
      kv: {
        settings: {
          theme: "dark",
          bands: { B2: true },
          dictation: {
            speed: 1.0,
            doneMap: {
              "lesson-a": { "0": "try", "1": "ok", "3": "ok" },
              "lesson-remote": { "0": "ok" },
            },
            pos: { "lesson-a": 2, "lesson-remote": 4 },
          },
        },
      },
    }),
    "merge"
  );

  const settings = plain(await Store.get("kv", "settings"));
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.bands, { B1: true, B2: true });
  assert.deepEqual(settings.dictation.doneMap, {
    "lesson-a": { "0": "ok", "1": "ok", "2": "ok", "3": "ok" },
    "lesson-local": { "0": "ok" },
    "lesson-remote": { "0": "ok" },
  });
  assert.deepEqual(settings.dictation.pos, {
    "lesson-a": 5,
    "lesson-local": 3,
    "lesson-remote": 4,
  });
});

test("importAll preserves local sync secrets and mockTests in both merge and replace modes", async () => {
  const Store = createStore();
  await Store.put("kv", "settings", {
    syncToken: "local-secret-placeholder",
    syncGistId: "gist-local-123",
    lastSyncTime: 1700000000,
    dailyNew: 20,
  });
  await Store.put("kv", "mockTests", [{ id: "private-pack" }]);

  // Incoming maliciously/accidentally tries to overwrite secrets and mockTests
  const incoming = makeBackup({
    srs: { "新": { last: 999, reps: 1, ivl: 1 } },
    kv: {
      settings: {
        syncToken: "foreign-token",
        syncGistId: "foreign-gist",
        lastSyncTime: 9999999999,
        dailyNew: 30,
      },
      mockTests: [{ id: "should-be-ignored" }],
    },
  });

  await Store.importAll(incoming, "merge");
  let settings = plain(await Store.get("kv", "settings"));
  assert.equal(settings.syncToken, "local-secret-placeholder");
  assert.equal(settings.syncGistId, "gist-local-123");
  assert.equal(settings.lastSyncTime, 1700000000);
  assert.equal(settings.dailyNew, 30);
  assert.deepEqual(plain(await Store.get("kv", "mockTests")), [{ id: "private-pack" }]);

  // Replace mode clears srs/stats, applies incoming settings, but still keeps local secrets & mockTests
  await Store.put("srs", "old-card", { last: 1, reps: 1 });
  await Store.importAll(incoming, "replace");
  const srsAfterReplace = await Store.all("srs");
  assert.equal(srsAfterReplace.has("old-card"), false);
  assert.equal(srsAfterReplace.has("新"), true);
  settings = plain(await Store.get("kv", "settings"));
  assert.equal(settings.syncToken, "local-secret-placeholder");
  assert.equal(settings.syncGistId, "gist-local-123");
  assert.deepEqual(plain(await Store.get("kv", "mockTests")), [{ id: "private-pack" }]);

  // exportAll strips secrets and mockTests
  const exported = await Store.exportAll();
  assert.equal(exported.kv.settings.syncToken, undefined);
  assert.equal(exported.kv.settings.syncGistId, undefined);
  assert.equal(exported.kv.settings.lastSyncTime, undefined);
  assert.equal(exported.kv.mockTests, undefined);
});
