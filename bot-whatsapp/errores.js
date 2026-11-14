// Registro de errores de la app del cliente: qué falló, dónde y en qué navegador, SIN datos personales.
// El navegador manda un aviso corto cuando una carga falla o salta un error de la página; aquí se limpia todo lo que llega
// (nunca se fía de lo recibido) y se deja solo lo necesario para que la oficina vea qué se rompe.

const TIPOS = new Set(["fetch", "js", "promesa"]);
const PANTALLAS = new Set(["cliente", "acceso", "catalogo", "pedido"]);

/** Navegador en pocas palabras («Chrome 126 · Android»): nunca se guarda la cadena completa del navegador (es casi una huella del móvil). */
export function navegadorCorto(ua) {
  const u = String(ua ?? "");
  const nav = /Edg\/(\d+)/.exec(u) ? ["Edge", RegExp.$1] : /SamsungBrowser\/(\d+)/.exec(u) ? ["Samsung Internet", RegExp.$1] : /(?:Chrome|CriOS)\/(\d+)/.exec(u) ? ["Chrome", RegExp.$1] : /Firefox\/(\d+)/.exec(u) ? ["Firefox", RegExp.$1] : /Version\/(\d+)[\d.]* .*Safari/.exec(u) ? ["Safari", RegExp.$1] : ["Otro", ""];
  const so = /Android/.test(u) ? "Android" : /iPhone|iPad|iPod/.test(u) ? "iOS" : /Windows/.test(u) ? "Windows" : /Mac OS X/.test(u) ? "macOS" : /Linux/.test(u) ? "Linux" : "otro sistema";
  return `${nav[0]}${nav[1] ? " " + nav[1] : ""} · ${so}`;
}

/** Quita lo que podría ser un dato personal: correos, cifras largas (teléfonos, NIF) y trozos largos tipo clave o enlace personal. */
export function sinPersonales(t, max = 200) {
  return String(t ?? "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]").replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[clave]").replace(/\b\d{6,}\b/g, "[cifras]").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Solo la ruta de la API (sin dirección, sin «?…», con las claves largas tapadas). */
export function rutaApi(u) {
  const ruta = String(u ?? "").replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  return ruta.split("/").map((seg) => (/^[A-Za-z0-9_-]{24,}$/.test(seg) ? ":clave" : seg.slice(0, 40))).join("/").slice(0, 120);
}

/** Devuelve el registro limpio { tipo, pantalla, api, estado, mensaje } o null si no es un aviso válido. */
export function limpiaError(b) {
  if (!b || typeof b !== "object" || !TIPOS.has(b.tipo)) return null;
  const pantalla = PANTALLAS.has(String(b.pantalla)) ? String(b.pantalla) : "otra", estado = Number.isInteger(b.estado) && b.estado >= 0 && b.estado <= 599 ? b.estado : 0;
  const mensaje = sinPersonales(b.mensaje), api = b.api ? rutaApi(b.api) : "";
  if (!mensaje && !api) return null;
  return { tipo: b.tipo, pantalla, api, estado, mensaje };
}
