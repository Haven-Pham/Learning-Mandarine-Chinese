// Offline support: app files are network-first (so updates arrive), data files are cache-first.
const VERSION = "shtv-10";
const SHELL = ["./", "index.html", "style.css", "js/app.js", "js/srs.js", "js/store.js", "js/sync.js", "vendor/hanzi-writer.min.js",
  "data/tocfl.json", "data/decks.json", "data/abbr.json", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const isData = url.pathname.includes("/data/");
  if (isData) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
  } else {
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
  }
});
