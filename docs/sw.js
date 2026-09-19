/* IL Bridge Maps service worker
 * Caches the app shell and inventory so search works offline after first load.
 * OpenStreetMap tiles are cached opportunistically (best-effort) and need a
 * network on first view of an area.
 */
"use strict";

const VERSION = "il-bridge-v13";
const SHELL = VERSION + "-shell";
const DATA = VERSION + "-data";
const TILES = VERSION + "-tiles";
const TILE_MAX = 250;

const SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css?v=v13",
  "./app.js?v=v13",
  "./lib/bridge-search.js?v=v13",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

const DATA_URLS = ["./data/bridges.json.gz", "./data/bridges.json"];

function isTileRequest(url) {
  return (
    /tile\.openstreetmap\.org\//.test(url) ||
    /[abc]\.tile\.openstreetmap\.org\//.test(url)
  );
}

function isDataRequest(url) {
  return /\/data\/bridges\.json(\.gz)?$/.test(url);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const local = SHELL_URLS.filter((u) => !/^https?:/i.test(u));
      const remote = SHELL_URLS.filter((u) => /^https?:/i.test(u));
      await cache.addAll(local);
      // Leaflet CDN / inventory must not fail install (offline or blocked CDN).
      await Promise.all(remote.map((u) => cache.add(u).catch(() => undefined)));
      caches.open(DATA).then((dc) =>
        Promise.all(
          DATA_URLS.map((u) => dc.add(u).catch(() => undefined))
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, DATA, TILES]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("il-bridge-") && !keep.has(n))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone());
  return resp;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fetchPromise = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => undefined);
  if (hit) {
    fetchPromise.catch(() => undefined);
    return hit;
  }
  const net = await fetchPromise;
  if (net) return net;
  throw new Error("offline and uncached: " + req.url);
}

async function cacheTiles(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp && resp.ok) {
    cache.put(req, resp.clone());
    trimCache(cache, TILE_MAX);
  }
  return resp;
}

function trimCache(cache, max) {
  cache.keys().then((keys) => {
    if (keys.length <= max) return;
    const extra = keys.length - max;
    for (let i = 0; i < extra; i++) cache.delete(keys[i]);
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = req.url;

  if (isTileRequest(url)) {
    event.respondWith(
      cacheTiles(req).catch(
        () => new Response("", { status: 503, statusText: "Offline tile" })
      )
    );
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }

  const dest = req.destination;
  if (
    dest === "document" ||
    dest === "script" ||
    dest === "style" ||
    dest === "image" ||
    dest === "manifest" ||
    dest === "font" ||
    url.includes("unpkg.com/leaflet")
  ) {
    event.respondWith(
      cacheFirst(req, SHELL).catch(
        () =>
          caches.match("./index.html").then(
            (r) =>
              r ||
              new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              })
          )
      )
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
