// Expense Manager service worker - app-shell offline cache for iPhone Add to Home Screen.
const CACHE = "expense-manager-v35";
const APP_SHELL = [
  "./",
  "./index.html",
  "./favicon.ico",
  "./styles.css",
  "./vendor/web-haptics.js",
  "./haptics.js",
  "./lock.js",
  "./utils.js",
  "./parsers.js",
  "./recurring.js",
  "./database.js",
  "./dashboard.js",
  "./transactions.js",
  "./inbox.js",
  "./accounts.js",
  "./categories.js",
  "./settings.js",
  "./vault.js",
  "./gitremote.js",
  "./ledger.js",
  "./github-sync.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow pages to trigger activation without a reload cycle.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Cache-first for same-origin GET, network fallback. Never cache GitHub API.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "api.github.com") return; // always live for sync
  if (url.origin !== self.location.origin) return; // let CDN (sql.js, apexcharts) use browser HTTP cache
  // Navigations (including ?inbox=... / ?fresh=... deep links) always resolve
  // to the cached app shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then((cached) => {
      if (cached) {
        // revalidate in background
        event.waitUntil(
          fetch(request).then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          }).catch(() => {})
        );
        return cached;
      }
      return fetch(request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
