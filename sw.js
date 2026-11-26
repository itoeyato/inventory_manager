// Service worker: la app abre al instante y funciona sin internet.
const VERSION = "inv-v1.0.1";
const CORE = [
  "./", "./index.html", "./manifest.webmanifest", "./styles.css",
  "./app.js", "./store.js", "./ui.js", "./utils.js", "./icons.js",
  "./scanner.js", "./layers.js", "./config.js",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "inv-libs").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Librerías de Firebase: se guardan para abrir sin internet.
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(
      caches.open("inv-libs").then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (url.origin !== location.origin) return;

  // Archivos de la app: primero la copia guardada, y se actualiza en segundo plano.
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: req.mode === "navigate" });
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === "basic") c.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === "navigate") return c.match("./index.html");
      return new Response("", { status: 504 });
    })
  );
});
