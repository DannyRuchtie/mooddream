const VERSION = "v1";
const STATIC_CACHE = `moondream-static-${VERSION}`;
const RUNTIME_CACHE = `moondream-runtime-${VERSION}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(["/", "/offline.html", "/manifest.webmanifest"]))
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

async function cachePut(cacheName, req, res) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res);
  } catch {
    // ignore
  }
}

async function cacheMatch(req) {
  try {
    return await caches.match(req);
  } catch {
    return null;
  }
}

async function networkFirst(req, cacheName, fallbackUrl) {
  try {
    const res = await fetch(req);
    if (res && res.ok) cachePut(cacheName, req, res.clone());
    return res;
  } catch {
    const cached = await cacheMatch(req);
    if (cached) return cached;
    if (fallbackUrl) return (await cacheMatch(fallbackUrl)) || new Response("Offline", { status: 503 });
    return new Response("Offline", { status: 503 });
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await cacheMatch(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cachePut(cacheName, req, res.clone());
    return res;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cached = await cacheMatch(req);
  const fetchPromise = (async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) cachePut(cacheName, req, res.clone());
      return res;
    } catch {
      return null;
    }
  })();
  return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // HTML navigations: cache visited pages so projects can reopen offline.
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, RUNTIME_CACHE, "/offline.html"));
    return;
  }

  if (req.method !== "GET") return;

  // Next static assets (JS/CSS chunks).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Local file routes + API reads.
  if (url.pathname.startsWith("/files/") || url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});


