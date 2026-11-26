import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = ["store", "sync"].map((name) => fs.readFileSync(new URL(`../js/${name}.js`, import.meta.url), "utf8")).join("\n");
const legacyName = "so-hoc-tieng-hoa-sync.json";
const day = "2026-11-26";
const backup = (extra = {}) => ({ app: "so-hoc-tieng-hoa", version: 1, ...extra });
const file = (data) => ({ content: JSON.stringify(data) });

function mockGist(legacy = backup()) {
  const files = { [legacyName]: file(legacy) };
  const writes = [];
  const cloud = { files, writes, failNextWrite: false, onWrite: null };
  cloud.fetch = async (_url, options) => {
    if (options?.method === "PATCH") {
      if (cloud.failNextWrite) {
        cloud.failNextWrite = false;
        return { ok: false, status: 503 };
      }
      const patch = JSON.parse(options.body).files;
      writes.push(patch);
      if (cloud.onWrite) await cloud.onWrite();
      Object.assign(files, patch);
    }
    const snapshot = structuredClone(files);
    return { ok: true, json: async () => ({ public: false, files: snapshot }) };
  };
  return cloud;
}

function device(number, cloud) {
  const db = new Map();
  const sandbox = {
    crypto: { randomUUID: () => `00112233-4455-4677-8899-${String(number).padStart(12, "0")}` },
    setTimeout, clearTimeout, fetch: cloud.fetch,
    console: { error() {}, warn() {} },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    navigator: {},
    localStorage: {
      getItem: (key) => db.get(key) ?? null,
      setItem: (key, value) => db.set(key, value),
    },
    S: { settings: { syncToken: "synthetic", syncGistId: "synthetic-id", autoSync: false } },
    URL
  };
  return vm.runInNewContext(`${source}\n({ Store, Sync })`, sandbox);
}

test("three devices merge parallel writes, preserve old history and deduplicate repeated sync", async () => {
  const cloud = mockGist(backup({ stats: { [day]: { reviews: 5 } }, srs: { old: { last: 1 } } }));
  const devices = [1, 2, 3].map((number) => device(number, cloud));
  await Promise.all(devices.map(async ({ Store }, i) => {
    await Store.put("stats", day, { reviews: 5 });
    await Store.put("srs", `card-${i}`, { last: i + 2 });
    await Store.put("kv", "mockTests", { private: true });
    await Promise.all(Array.from({ length: i + 1 }, () => Store.incrementStats(day, { reviews: 1, newCards: 1 })));
  }));
  const original = cloud.files[legacyName].content;
  await Promise.all(devices.map(({ Sync }) => Sync.syncNow()));
  assert.equal(cloud.writes.length, 3);
  assert.equal(Object.keys(cloud.files).length, 4);
  assert.equal(cloud.files[legacyName].content, original);
  for (const patch of cloud.writes) {
    const [snapshot] = Object.values(patch);
    assert.doesNotMatch(snapshot.content, /syncToken|syncGistId|mockTests|syncDeviceId/);
  }
  for (const { Store, Sync } of devices) {
    await Sync.syncNow();
    assert.equal((await Store.get("stats", day)).reviews, 11);
    assert.equal((await Store.get("stats", day)).newCards, 6);
    assert.equal((await Store.all("srs")).size, 4);
  }
  const writes = cloud.writes.length;
  await Promise.all(devices.map(({ Sync }) => Sync.syncNow()));
  assert.equal(cloud.writes.length, writes);
});

test("failed upload preserves progress and retry publishes a review recorded during upload", async () => {
  const cloud = mockGist();
  const { Store, Sync } = device(1, cloud);
  await Store.incrementStats(day, { reviews: 1 });
  cloud.failNextWrite = true;
  await assert.rejects(Sync.syncNow(), /503/);
  assert.equal((await Store.get("stats", day)).reviews, 1);
  cloud.onWrite = async () => {
    cloud.onWrite = null;
    await Store.incrementStats(day, { reviews: 1 });
    Sync.onCardGraded();
  };
  await Sync.syncNow();
  await Sync.syncNow();
  const other = device(2, cloud);
  await other.Sync.syncNow();
  assert.equal((await other.Store.get("stats", day)).reviews, 2);
});

test("an invalid remote snapshot stops sync before changing either local or remote data", async () => {
  const cloud = mockGist(backup({ srs: { remote: { last: 12 } } }));
  cloud.files["progress-00112233-4455-4677-8899-000000000002.json"] = file(backup({ stats: [] }));
  const { Store, Sync } = device(1, cloud);
  await Store.put("srs", "local", { last: 9 });
  await assert.rejects(Sync.syncNow(), /không hợp lệ/);
  assert.equal((await Store.all("srs")).size, 1);
  assert.equal(await Store.get("srs", "remote"), undefined);
  assert.equal(cloud.writes.length, 0);
});
