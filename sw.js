// Offline copy of the game for the public site (dev/build_site.py publishes this as sw.js).
// Network first, so an update shows at once; the copy kept here is used only when the network
// fails. Clips are fetched in ranges and are left alone (offline they are skipped like a missing
// file), and so is anything from another site.
const CACHE = "enbu";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || r.headers.has("range") || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => {
    if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || Response.error())));
});
