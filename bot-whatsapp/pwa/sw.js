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
