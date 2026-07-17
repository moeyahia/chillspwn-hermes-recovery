const CACHE_NAMESPACE = "chillspwn.command-os-v2.cache.v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("chillspwn.command-os-v2.") && key !== CACHE_NAMESPACE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Operational data is deliberately network-only. Static caching will be enabled only
// after route and invalidation tests prove it cannot mask a deployment or stale mission.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/v2")) return;
});
