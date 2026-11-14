// Offline support: app files are network-first (so updates arrive), data files are cache-first.
<<<<<<< HEAD
const VERSION = "shtv-40";
const SHELL = ["./", "index.html", "style.css", "css/tw.css", "js/app.js", "js/srs.js", "js/store.js", "js/sync.js", "manifest.webmanifest"];
=======
const VERSION = "shtv-37";
const SHELL = ["./", "index.html", "style.css", "vendor/hanzi-writer.min.js", "vendor/ts-fsrs.umd.js", "vendor/pinyin-pro.js", "vendor/opencc-cn2t.js", "js/app.js", "js/srs.js", "js/store.js", "js/sync.js", "manifest.webmanifest"];
>>>>>>> 5735b2c (v37: Integrate ts-fsrs, pinyin-pro, opencc-js (s2twp) locally + fill 238 Vietnamese meanings)

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Data files: cache-first
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }))
    );
    return;
  }

  // App shell & JS: network-first (bypass HTTP cache), fallback to cache
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
