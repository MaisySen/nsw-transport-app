// Service worker: offline app shell, and Web Push notifications for watched trips.
const VERSION = "tb-__BUILD__";
const SHELL = ["/", "/app.js?v=8", "/ask.js?v=2", "/hit.js?v=2", "/style.css?v=6", "/ask.css?v=2", "/site.css?v=4", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/badge-96.png", "/vendor/leaflet.js", "/vendor/leaflet.css"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => null)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "tb-api").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    // Live data: always from the network; the last answer is kept for offline viewing.
    if (!/^\/api\/(departures|trip|commutes|watches|ask)$/.test(url.pathname)) return;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open("tb-api").then((c) => c.put(req, copy)).catch(() => null); }
      return res;
    }).catch(() => caches.open("tb-api").then((c) => c.match(req)).then((m) => m || new Response(JSON.stringify({ error: "offline", text: "You're offline. Showing nothing new until you're back online." }), { status: 503, headers: { "content-type": "application/json" } }))));
    return;
  }
  if (req.mode === "navigate") {
    // Only the app shell at / is cached for offline use; other pages (privacy, 404 and so on) are never stored as /.
    const isShell = url.pathname === "/";
    e.respondWith(fetch(req).then((res) => { if (isShell && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); } return res; })
      .catch(() => caches.match(isShell ? "/" : req).then((m) => m || caches.match("/"))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Transport", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Transport";
  const opts = {
    body: d.body || "", tag: d.tag || "tb", renotify: true, icon: "/icon-192.png", badge: "/badge-96.png",
    data: { url: d.url || "/", id: d.id || null }, timestamp: d.at || Date.now(),
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage({ type: "push", title, body: opts.body, url: opts.data.url, id: opts.data.id, tag: opts.tag }))),
  ]));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate ? c.navigate(url).catch(() => null) : null; return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
