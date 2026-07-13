const CACHE = "echo-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put("/", copy));
      return response;
    }).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
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
