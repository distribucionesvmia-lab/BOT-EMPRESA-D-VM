// Rutas HTTP del CLIENTE: solicitud de alta, acceso con teléfono + PIN y sesión por cookie.
// (La administración de la empresa está aparte, en admin.js.)
// Regla de oro: el servidor decide de quién son los datos a partir de la SESIÓN. Ninguna ruta acepta un código de
// cliente enviado por el navegador, así que un cliente no puede pedir el historial de otro.
import crypto from "node:crypto";
import { normalizePhone, validEmail } from "./cuentas-db.js";

const COOKIE = "vm_session";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Límite de intentos en memoria: máximo `max` por `windowMs` para cada clave. */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

const parseCookies = (header) =>
  Object.fromEntries(
    String(header ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );

function readJson(req, max = 20_000) {
  return new Promise((resolve) => {
    if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) return resolve(null); // evita envíos desde otras webs (CSRF)
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > max) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}
const send = (res, code, data, headers = {}) => res.writeHead(code, { ...JSON_HEADERS, ...headers }).end(JSON.stringify(data));
const sameToken = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/** Comprueba la clave de la empresa (cabecera Authorization: Bearer …). Sin clave configurada, nadie es administrador. */
export function makeAdminCheck(adminToken) {
  return (req) => {
    if (!adminToken) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    return !!m && sameToken(m[1], adminToken);
  };
}
export { send, readJson };

/**
 * accounts: base de cuentas · customers: { getById(id), matchRegistration(), nameMatches() }
 * secure: cookie solo por HTTPS · trustProxy: usar X-Forwarded-For para la IP
 */
export function createAuth({ accounts, customers, secure = false, trustProxy = false }) {
  // Límites por IP (configurables para las pruebas): accesos cada 10 minutos y solicitudes de alta cada hora
  const loginLimit = rateLimiter(Number(process.env.LOGIN_LIMIT ?? 20), 10 * 60_000);
  const registerLimit = rateLimiter(Number(process.env.REGISTER_LIMIT ?? 20), 60 * 60_000);
  const ip = (req) => (trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
  const cookie = (token, maxAge) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  /** Cuenta de la sesión de esta petición (o null). */
  const sessionOf = (req) => accounts.sessionAccount(parseCookies(req.headers.cookie)[COOKIE]);

  /** Atiende las rutas del cliente: /api/registro, /api/acceso, /api/salir y /api/yo. Devuelve true si la ruta era suya. */
  async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/")) return false;

    if (p === "/api/registro" && req.method === "POST") {
      if (!registerLimit(ip(req))) return send(res, 429, { error: "Demasiados intentos. Prueba más tarde." }), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const empresa = String(b.empresa ?? "").trim().replace(/\s+/g, " ");
      const correo = String(b.correo ?? "").trim();
      const pin = String(b.pin ?? "");
      if (empresa.length < 2 || empresa.length > 80) return send(res, 400, { error: "Escribe el nombre de tu empresa." }), true;
      if (!normalizePhone(b.telefono)) return send(res, 400, { error: "El teléfono no es válido." }), true;
      if (!validEmail(correo)) return send(res, 400, { error: "El correo no es válido." }), true;
      if (!/^\d{6}$/.test(pin)) return send(res, 400, { error: "Elige un PIN de 6 cifras." }), true;
      // El sistema comprueba la solicitud contra la base de clientes. Acceso automático si el nombre de la empresa coincide
      // con un cliente guardado Y su teléfono o su correo también; si no, queda pendiente para que la revise la empresa.
      const m = customers.matchRegistration({ phone: b.telefono, email: correo, business: empresa });
      if (m.customer) {
        const dato = [m.matched.phone ? "teléfono" : null, m.matched.email ? "correo" : null].filter(Boolean).join(" y ");
        const r = accounts.registerAuto({ phone: b.telefono, email: correo, business: empresa, pin, customerId: m.customer.id, matched: `nombre + ${dato}` });
        if (r.error) return send(res, 400, { error: r.error }), true;
        return send(res, 200, { ok: true, estado: "activa", mensaje: "Listo: ya tienes acceso. Entra con tu teléfono, el nombre de tu empresa y tu PIN." }), true;
      }
      const r = accounts.requestRegistration({ phone: b.telefono, email: correo, business: empresa, pin });
      if (r.error) return send(res, 400, { error: r.error }), true;
      const motivo = { ambiguo: "Hay varios clientes que encajan", contacto: "El nombre coincide pero no el teléfono ni el correo", nombre: "No hay ningún cliente con ese nombre" }[m.reason];
      accounts.setMatched(r.id, motivo);
      return send(res, 200, { ok: true, estado: "pendiente", mensaje: "Hemos recibido tu solicitud. La empresa la revisará y te avisará." }), true;
    }

    if (p === "/api/acceso" && req.method === "POST") {
      if (!loginLimit(ip(req))) return send(res, 429, { error: "Demasiados intentos. Prueba más tarde." }), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const empresa = String(b.empresa ?? "").slice(0, 80);
      if (empresa.trim().length < 2) return send(res, 400, { error: "Escribe el nombre de tu empresa." }), true;
      // Teléfono + PIN + nombre de la empresa: el nombre debe coincidir con el del cliente guardado en la base de datos
      const r = accounts.login(b.telefono, b.pin, undefined, (acc) => customers.nameMatches(customers.getById(acc.customerId), empresa));
      if (!r.ok) return send(res, 401, { error: r.reason === "locked" ? "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." : "Teléfono o PIN incorrectos." }), true;
      const customer = customers.getById(r.account.customerId);
      return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": cookie(r.token, 30 * 86400) }), true;
    }

    if (p === "/api/salir" && req.method === "POST") {
      accounts.logout(parseCookies(req.headers.cookie)[COOKIE]);
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) }), true;
    }

    if (p === "/api/yo" && req.method === "GET") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      return send(res, 200, { cliente: { nombre: customers.getById(acc.customerId)?.name ?? "" } }), true;
    }

    return false;
  }

  return { route, sessionOf };
}
