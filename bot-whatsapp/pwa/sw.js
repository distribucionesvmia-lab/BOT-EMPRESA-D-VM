// Service worker mínimo: permite instalar la web como app. NO guarda nada en caché (precios, pedidos y datos del cliente van siempre en directo);
// solo avisa si no hay conexión al abrir una página.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // lo demás sigue su camino normal
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title><body style="font-family:system-ui;text-align:center;padding:48px 20px"><h2>Sin conexión</h2><p>Para hacer tu pedido necesitas internet. Vuelve a intentarlo cuando tengas cobertura.</p>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// Avisos al móvil (Web Push): «Pedido recibido» y avisos de la empresa. Lo que llega es solo un título y un texto corto.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Distribuciones Valentín", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(String(d.title || "Distribuciones Valentín").slice(0, 80), { body: String(d.body || "").slice(0, 240), icon: "/icono-192.png", badge: "/icono-192.png", tag: d.tag || undefined, data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/cliente" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/cliente";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => { const w = ws.find((x) => new URL(x.url).origin === self.location.origin); return w ? w.focus() : self.clients.openWindow(url); }));
});
