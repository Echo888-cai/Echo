// v2: /api/* and /trpc/* are network-only (a delete that succeeds must never be
// answered from a stale cached GET — that was the direct cause of "removed but
// refetch brings it back"). Static shell assets stay stale-while-revalidate.
const CACHE = "echo-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/trpc/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    // Network-only: never answer app data from cache, and never cache it either.
    event.respondWith(fetch(event.request).catch(() => new Response(
      JSON.stringify({ ok: false, error: { code: "offline", message: "当前离线，无法获取最新数据" } }),
      { status: 503, headers: { "content-type": "application/json" } }
    )));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put("/", copy));
      return response;
    }).catch(() => caches.match("/")));
    return;
  }

  // Static assets: stale-while-revalidate — serve cached immediately, refresh in background.
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  })));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Echo Research", body: "有新的研究提醒。", url: "/watch" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* use safe defaults */ }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, icon: "/icon.svg", badge: "/icon.svg", data: { url: payload.url }, tag: payload.tag || "echo" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/watch";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  }));
});
