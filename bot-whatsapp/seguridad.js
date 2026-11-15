// Protección contra bots y abusos: campo trampa, comprobación «no soy un robot» (Cloudflare Turnstile, opcional) y cabeceras de seguridad.
// Todo es opcional y seguro por defecto: sin TURNSTILE_SITE / TURNSTILE_SECRET en la configuración, la comprobación no se pide.
const SITE = () => String(process.env.TURNSTILE_SITE ?? "").trim();
const SECRET = () => String(process.env.TURNSTILE_SECRET ?? "").trim();
export const turnstileSite = () => (SITE() && SECRET() ? SITE() : ""); // solo se activa si están las DOS claves
export const turnstileActivo = () => !!turnstileSite();

/** Comprueba el «no soy un robot» con Cloudflare. Sin claves: vale. Con claves y sin respuesta de Cloudflare: vale (no se deja fuera a los clientes si Cloudflare falla). */
export async function verificarTurnstile(token, ip, fetchFn = globalThis.fetch) {
  if (!turnstileActivo()) return { ok: true };
  if (typeof token !== "string" || token.length < 10 || token.length > 4096) return { ok: false };
  try {
    const cuerpo = new URLSearchParams({ secret: SECRET(), response: token }); if (ip && ip !== "?") cuerpo.set("remoteip", ip);
    const r = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: cuerpo, signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return { ok: j?.success === true };
  } catch { return { ok: true, sinRespuesta: true }; }
}

/** Intentos por dirección en una ventana: pasado el tope, se pide la comprobación «no soy un robot». */
export function contadorIntentos(tope, ventanaMs) {
  const m = new Map();
  return {
    suma(clave) { const ahora = Date.now(), e = m.get(clave); if (!e || ahora - e.t > ventanaMs) { m.set(clave, { n: 1, t: ahora }); return 1; } e.n++; return e.n; },
    pasado: (n) => n > tope,
  };
}

let registro = null, ultimoRegistro = new Map();
/** Dónde se guardan los hechos sospechosos para el panel y los avisos por correo (lo pone server.js con la base de cuentas). */
export const usarRegistro = (fn) => { registro = typeof fn === "function" ? fn : null; };
/** Dirección real de quien llama. Detrás de Cloudflare/un proxy (TRUST_PROXY=1) se usa la que pone el proxy: sin esto, TODOS los clientes parecerían uno solo y los límites de intentos bloquearían a todos a la vez. */
export const ipDe = (req, confiar = process.env.TRUST_PROXY === "1") => {
  if (confiar) {
    const cf = String(req.headers["cf-connecting-ip"] ?? "").trim(); // Cloudflare lo pone siempre y pisa el que mande el cliente
    if (cf) return cf;
    const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim(); if (xf) return xf;
  }
  return req.socket?.remoteAddress || "?";
};
/** ¿La clave del panel es corta o fácil de adivinar? (nunca se devuelve la clave) */
export const claveDebil = (c) => {
  const s = String(c ?? ""); if (!s) return false;
  if (s.length < 16) return true;
  if (/^(.)\1+$/.test(s) || /^(1234|abcd|qwer|clave|password|admin|demo|contrase)/i.test(s)) return true;
  return new Set(s).size < 6;
};
let ultimoAviso = new Map();
/** Anota un hecho sospechoso en el registro del programa (C:\vm\logs). Como máximo uno por tipo cada minuto, para no llenarlo. */
export function eventoSeguridad(tipo, detalle = "") {
  registrarSeguridad(tipo, detalle);
  const ahora = Date.now();
  if (ahora - (ultimoAviso.get(tipo) ?? 0) < 60_000) return;
  ultimoAviso.set(tipo, ahora); if (ultimoAviso.size > 50) ultimoAviso = new Map([[tipo, ahora]]);
  console.warn(`[VM seguridad] ${tipo}${detalle ? " · " + detalle : ""}`);
}
/** Apunta el hecho en la base (para el panel y el aviso por correo): como máximo uno cada 10 s por tipo, para que un ataque no llene la base. */
export function registrarSeguridad(tipo, detalle = "") {
  const ahora = Date.now(); if (ahora - (ultimoRegistro.get(tipo) ?? 0) < 10_000) return; ultimoRegistro.set(tipo, ahora);
  try { registro?.(tipo, String(detalle).slice(0, 120)); } catch {}
}

/** Cabeceras para todas las respuestas del cliente. HSTS solo si HSTS=1 (cuando ya hay HTTPS delante, p. ej. Cloudflare). */
export const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' blob: https://challenges.cloudflare.com",
  "object-src 'self'", "worker-src 'self'", "manifest-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join("; ");
export function cabecerasSeguridad() {
  return {
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(process.env.HSTS === "1" ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}

/** Rutas que solo busca un bot o un escáner de fallos (este programa no tiene nada de eso): quien las pide queda bloqueado un rato. */
export const RUTA_DE_ESCANER = /(^|\/)\.(env|git|svn|aws|ssh|htaccess|htpasswd|DS_Store)|\.(php\d?|asp|aspx|jsp|cgi|sql|bak|old|ini|log|sh)(\/|$|\?)|wp-(admin|login|content|includes|json)|xmlrpc|phpmyadmin|cgi-bin|\/vendor\/|\/actuator|\.\.|%2e%2e|%00/i;
const esLocal = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "?";
/**
 * Escudo general contra inundaciones y escáneres. `revisa(ip, ruta)` devuelve null si puede pasar o
 * { motivo, espera } (segundos) si hay que cortar. Cuenta peticiones por dirección y minuto; pasado el tope bloquea
 * 10 min (y el doble, el cuádruple… si reincide, hasta 24 h). Lo estático (fotos, estilos) tiene su propio tope más alto.
 */
export function crearEscudo({ porMinuto = 300, estaticoPorMinuto = 1500, banMin = 10, ahora = () => Date.now(), maxIps = 20000 } = {}) {
  const cuentas = new Map(), bloqueos = new Map(), castigos = new Map();
  const limpia = (t) => { for (const [k, v] of cuentas) if (t - v.t > 60_000) cuentas.delete(k); for (const [k, v] of bloqueos) if (t > v.hasta) bloqueos.delete(k); };
  const bloquea = (ip, motivo, t, base = banMin * 60_000) => {
    const veces = (castigos.get(ip) ?? 0) + 1; castigos.set(ip, veces); if (castigos.size > maxIps) castigos.clear();
    const dur = Math.min(base * 2 ** (veces - 1), 24 * 3600e3);
    bloqueos.set(ip, { hasta: t + dur, motivo });
    return { motivo, espera: Math.ceil(dur / 1000), nuevo: true };
  };
  return {
    revisa(ip, ruta = "") {
      if (esLocal(ip)) return null;
      const t = ahora();
      const b = bloqueos.get(ip);
      if (b) { if (t < b.hasta) return { motivo: b.motivo, espera: Math.ceil((b.hasta - t) / 1000) }; bloqueos.delete(ip); }
      if (RUTA_DE_ESCANER.test(ruta)) return bloquea(ip, "busca-rutas-de-ataque", t, 30 * 60_000);
      if (cuentas.size > maxIps) limpia(t);
      const estatico = /^\/(estatico|img|icono-|captura-|apple-touch|favicon)/.test(ruta);
      const k = ip + (estatico ? "|e" : "|d"), tope = estatico ? estaticoPorMinuto : porMinuto;
      let e = cuentas.get(k); if (!e || t - e.t > 60_000) { e = { n: 0, t }; cuentas.set(k, e); }
      if (++e.n > tope) return bloquea(ip, "inundacion-de-peticiones", t);
      return null;
    },
    bloqueadas: () => bloqueos.size,
  };
}
