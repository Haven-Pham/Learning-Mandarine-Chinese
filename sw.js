// Offline support: app files are network-first (so updates arrive), data files are cache-first.
const VERSION = "shtv-135";
const SHELL = ["./", "index.html", "style.css", "css/tw.css", "vendor/hanzi-writer.min.js", "vendor/ts-fsrs.umd.js", "vendor/pinyin-pro.js", "vendor/opencc-cn2t.js", "vendor/material-symbols-outlined.woff2", "js/app.js", "js/srs.js", "js/store.js", "js/sync.js", "manifest.webmanifest"];

const SHELL_PATHS = new Set(SHELL.map((path) => new URL(path, self.registration.scope).pathname));

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
  if (e.request.method !== "GET") return;
  // Bypass Cache API for Range requests & large MP3 audio streams (prevents 206 Partial Content cache.put errors)
  if (e.request.headers.has("range") || url.pathname.endsWith(".mp3")) return;

  // Data files: cache-first
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // App shell & JS: network-first (bypass HTTP cache), fallback to cache
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then((res) => {
      if (res && res.ok && res.status === 200) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(async () => {
      const cache = await caches.open(VERSION);
      return (await cache.match(e.request)) ||
        (SHELL_PATHS.has(url.pathname) ? cache.match(e.request, { ignoreSearch: true }) : undefined);
    })
  );
});
