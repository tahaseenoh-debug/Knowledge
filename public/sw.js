// Service worker: lets the app be installed on a phone's home screen and open quickly.
// Stock data (/api/...) is never cached: it always comes live from the server.
const CACHE = "jinv-v1";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  // Big files that rarely change (photo-search model, QR tools): from the phone's cache once downloaded.
  if (url.pathname.startsWith("/vendor/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic") c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Everything else: newest version from the network, the saved copy only when offline.
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === "basic" && !res.redirected) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/") : Response.error())));
});
