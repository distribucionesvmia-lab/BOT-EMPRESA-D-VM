// Rutas HTTP de cuentas: solicitud de alta, acceso con teléfono + PIN, sesión por cookie y administración de la empresa.
// Regla de oro: el servidor decide de quién son los datos a partir de la SESIÓN. Ninguna ruta acepta un código de
// cliente enviado por el navegador, así que un cliente no puede pedir el historial de otro.
import crypto from "node:crypto";

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

/**
 * accounts: base de cuentas · customers: { list(), getById(id) } · adminToken: clave de la empresa
 * secure: cookie solo por HTTPS · trustProxy: usar X-Forwarded-For para la IP
 */
export function createAuth({ accounts, customers, adminToken, secure = false, trustProxy = false }) {
  const loginLimit = rateLimiter(20, 10 * 60_000);
  const registerLimit = rateLimiter(5, 60 * 60_000);
  const ip = (req) => (trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
  const cookie = (token, maxAge) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  /** Cuenta de la sesión de esta petición (o null). */
  const sessionOf = (req) => accounts.sessionAccount(parseCookies(req.headers.cookie)[COOKIE]);

  const isAdmin = (req) => {
    if (!adminToken) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    return !!m && sameToken(m[1], adminToken);
  };

  /** Atiende las rutas /api/registro, /api/acceso, /api/salir, /api/yo y /api/admin/*. Devuelve true si la ruta era suya. */
  async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/")) return false;

    if (p === "/api/registro" && req.method === "POST") {
      if (!registerLimit(ip(req))) return send(res, 429, { error: "Demasiados intentos. Prueba más tarde." }), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const r = accounts.requestRegistration({ phone: b.telefono, email: b.correo, business: b.empresa });
      if (r.error) return send(res, 400, { error: r.error }), true;
      // Misma respuesta exista o no el cliente: no se revela nada
      return send(res, 200, { ok: true, mensaje: "Solicitud enviada. La empresa la revisará y te dará tu PIN de acceso." }), true;
    }

    if (p === "/api/acceso" && req.method === "POST") {
      if (!loginLimit(ip(req))) return send(res, 429, { error: "Demasiados intentos. Prueba más tarde." }), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const r = accounts.login(b.telefono, b.pin);
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

    // ---- Administración (la empresa) ----
    if (p.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return send(res, 403, { error: "Acceso no autorizado." }), true;
      if (p === "/api/admin/solicitudes" && req.method === "GET") {
        const regs = accounts.listRegistrations(url.searchParams.get("estado") ?? "pending");
        return send(res, 200, regs.map((r) => ({ ...r, sugerencias: customers.suggest(r.business, r.phone) }))), true;
      }
      if (p === "/api/admin/clientes" && req.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
        return send(res, 200, customers.list().filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.id) === q).slice(0, 15).map((c) => ({ id: c.id, name: c.name, phone: c.phone }))), true;
      }
      if (p === "/api/admin/cuentas" && req.method === "GET") {
        return send(res, 200, accounts.listAccounts().map((a) => ({ ...a, cliente: customers.getById(a.customerId)?.name ?? "" }))), true;
      }
      const m = /^\/api\/admin\/(solicitudes|cuentas)\/(\d+)\/(aprobar|rechazar|pin|bloquear)$/.exec(p);
      if (m && req.method === "POST") {
        const id = Number(m[2]);
        const b = (await readJson(req)) ?? {};
        if (m[1] === "solicitudes" && m[3] === "aprobar") {
          const cust = customers.getById(String(b.clienteId ?? ""));
          if (!cust) return send(res, 400, { error: "Elige un cliente de la lista." }), true;
          const r = accounts.approve(id, cust.id);
          return r.error ? send(res, 400, { error: r.error }) : send(res, 200, { ok: true, cliente: cust.name, telefono: r.account.phone, pin: r.pin }), true;
        }
        if (m[1] === "solicitudes" && m[3] === "rechazar") return send(res, accounts.reject(id) ? 200 : 404, { ok: true }), true;
        if (m[1] === "cuentas" && m[3] === "pin") {
          const pin = accounts.resetPin(id);
          return send(res, pin ? 200 : 404, pin ? { ok: true, pin } : { error: "No existe la cuenta." }), true;
        }
        if (m[1] === "cuentas" && m[3] === "bloquear") return accounts.setBlocked(id, b.bloquear !== false), send(res, 200, { ok: true }), true;
      }
      return send(res, 404, { error: "No existe." }), true;
    }
    return false;
  }

  return { route, sessionOf, isAdmin };
}
