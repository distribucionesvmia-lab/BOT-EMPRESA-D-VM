// Service worker mínimo: permite instalar la web como app. NO guarda nada en caché (precios, pedidos y datos del cliente van siempre en directo);
// solo avisa si no hay conexión al abrir una página.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// Página «Sin conexión» (sale al abrir la app sin red): con la marca, un botón para reintentar y el aviso de que el pedido empezado sigue guardado en el móvil
const SIN_CONEXION = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sin conexión · Distribuciones Valentín Martín</title>
<style>:root{--bg:#F5F5F7;--card:#fff;--text:#1D1D1F;--text2:#5F5F65;--accent:#C8102E;--on:#fff}@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--text:#F5F5F7;--text2:#A8A8B0;--accent:#FF6B7D;--on:#1D1D1F}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:#C8102E;color:#fff;padding:20px 16px;text-align:center;font-weight:700;font-size:20px;letter-spacing:.2px}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px}.c{background:var(--card);border-radius:20px;padding:28px 22px;max-width:420px;width:100%;text-align:center}
h1{margin:0 0 8px;font-size:24px}p{margin:0 0 12px;color:var(--text2)}p b{color:var(--text)}
button{margin-top:8px;width:100%;min-height:52px;border:0;border-radius:26px;background:var(--accent);color:var(--on);font:inherit;font-weight:700;font-size:17px;cursor:pointer}button:focus-visible{outline:3px solid var(--text);outline-offset:3px}</style>
<body><header>Distribuciones Valentín Martín</header><main><div class="c" role="alert"><h1>Sin conexión</h1><p>No hay internet ahora mismo, así que no podemos abrir la aplicación.</p><p><b>Tu pedido sigue guardado en este móvil.</b> En cuanto vuelva la cobertura lo tendrás tal y como lo dejaste.</p><button type="button" onclick="location.reload()">Reintentar</button></div></main></body></html>`;
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // lo demás sigue su camino normal
  e.respondWith(fetch(e.request).catch(() => new Response(SIN_CONEXION, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
});

// Avisos al móvil (Web Push): «Pedido recibido» y avisos de la empresa. Lo que llega es solo un título y un texto corto.
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Distribuciones Valentín Martín", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(String(d.title || "Distribuciones Valentín Martín").slice(0, 80), { body: String(d.body || "").slice(0, 240), icon: "/icono-192.png", badge: "/icono-192.png", tag: d.tag || undefined, data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/cliente" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/cliente";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => { const w = ws.find((x) => new URL(x.url).origin === self.location.origin); return w ? w.focus() : self.clients.openWindow(url); }));
});
