/* CFoh! service worker: network-first for pages, cache-first for built assets, so the app opens offline. */
const VERSION = "cfoh-v1";
const PRECACHE = ["/cfoh/", "/cfoh/sqljs/sql-wasm.js", "/cfoh/sqljs/sql-wasm.wasm", "/cfoh/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isAsset = url.pathname.includes("/_next/") || url.pathname.includes("/sqljs/") || url.pathname.includes("/icons/");
  if (isAsset) {
    event.respondWith(caches.open(VERSION).then(async (cache) => (await cache.match(req)) ?? fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })
      .catch(async () => (await caches.match(req)) ?? (await caches.match("/cfoh/")) ?? Response.error()),
  );
});
