const CACHE_NAME = "mcm-shell-v28-launcher-logo";
const SHELL = [
  "./manifest.webmanifest",
  "./mcm-launcher-v2-192.png",
  "./mcm-launcher-v2-512.png",
  "./mcm-launcher-v2-maskable-192.png",
  "./mcm-launcher-v2-maskable-512.png",
  "./install.html",
  "./setup.html"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const mustBeFresh =
    event.request.mode === "navigate" ||
    event.request.destination === "document" ||
    requestUrl.pathname.includes("/reports/") ||
    requestUrl.pathname.includes("/versions/");

  if (mustBeFresh) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
