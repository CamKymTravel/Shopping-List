const CACHE_VERSION = "our-shopping-list-flat-shell-v20";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.0.4",
  "./manifest.webmanifest",
  "./app.js?v=1.0.4",
  "./db.js?v=1.0.4",
  "./data.js?v=1.0.4",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./coles-logo.svg",
  "./woolworths-logo.svg",
  "./aldi-logo.png",
  "./category-fruit-veg.png?v=1.0.4",
  "./category-meat-seafood.png?v=1.0.4",
  "./category-dairy-eggs.png?v=1.0.4",
  "./category-bakery.png?v=1.0.4",
  "./category-pantry.png?v=1.0.4",
  "./category-frozen.png?v=1.0.4",
  "./category-drinks.png?v=1.0.4",
  "./category-household.png?v=1.0.4",
  "./category-toiletries.png?v=1.0.4",
  "./category-pharmacy.png?v=1.0.4",
  "./category-pet-supplies.png?v=1.0.4",
  "./category-other.png?v=1.0.4"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});


self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
