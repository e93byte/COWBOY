const VERSION = "cowboy-live-shell-v4";
const PRECACHE = ["/offline.html", "/offline-board.js", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith("northstar-") || key.startsWith("cowboy-")) && key !== VERSION).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache sports, account, free-pick, or any other API responses.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/account/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(VERSION);
      return (await cache.match("/offline.html")) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-") || url.pathname === "/offline-board.js") {
    event.respondWith(caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic" && !response.headers.get("Cache-Control")?.includes("no-store")) {
        await cache.put(request, response.clone());
      }
      return response;
    }));
  }
});
