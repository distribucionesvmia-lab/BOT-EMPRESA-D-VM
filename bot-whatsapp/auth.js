// Rutas HTTP del CLIENTE: solicitud de alta, acceso con teléfono + PIN y sesión por cookie.
// (La administración de la empresa está aparte, en admin.js.)
// Regla de oro: el servidor decide de quién son los datos a partir de la SESIÓN. Ninguna ruta acepta un código de
// cliente enviado por el navegador, así que un cliente no puede pedir el historial de otro.
import crypto from "node:crypto";
import { normalizePhone, validEmail, pinValido } from "./cuentas-db.js";
import { nifCodes, nifClean } from "./nif-codes.js";
import { codeKey, validCode } from "./nif-key.js";

const COOKIE = "vm_session";
const MENSAJE_ELIMINADA = "Esta cuenta se eliminó. Si quieres volver a usar la aplicación, llámanos o solicita el alta de nuevo.";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Límite de intentos en memoria: máximo `max` por `windowMs` para cada clave. */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  const f = (key, now = Date.now()) => {
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
  /** Milisegundos que faltan para que se libere un intento de esa clave (0 si ya puede). */
  f.espera = (key, now = Date.now()) => { const l = (hits.get(key) ?? []).filter((t) => now - t < windowMs); return l.length < max ? 0 : Math.max(0, l[0] + windowMs - now); };
  return f;
}
/** Respuesta 429 que dice cuántos minutos hay que esperar. */
function demasiados(res, limiter, key, aviso = "Demasiados intentos.") {
  const min = Math.max(1, Math.ceil(limiter.espera(key) / 60_000));
  return send(res, 429, { error: `${aviso} Prueba de nuevo en ${min} minuto${min === 1 ? "" : "s"}.`, esperaMinutos: min }, { "Retry-After": String(min * 60) });
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
export function createAuth({ accounts, customers, misDatos = null, secure = false, trustProxy = false }) {
  // Límites por IP (configurables para las pruebas): accesos cada 10 minutos y solicitudes de alta cada hora
  const loginLimit = rateLimiter(Number(process.env.LOGIN_LIMIT ?? 20), 10 * 60_000);
  // Acceso solo con NIF (sin nombre): no hay una cuenta a la que contar los fallos, así que se limita más por IP y en conjunto
  const nifLimit = rateLimiter(Number(process.env.NIF_LIMIT ?? 10), 10 * 60_000);
  const nifGlobalFails = rateLimiter(Number(process.env.NIF_GLOBAL_FAILS ?? 15), 60 * 60_000); // fallos de NIF por hora, entre todos los clientes
  const usoLimit = rateLimiter(300, 10 * 60_000); // contadores: muchos permitidos, pero no infinitos por IP
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
      if (!registerLimit(ip(req))) return demasiados(res, registerLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const empresa = String(b.empresa ?? "").trim().replace(/\s+/g, " ");
      const correo = String(b.correo ?? "").trim();
      const pin = String(b.pin ?? "");
      const nif = nifClean(b.nif);
      if (!/^[A-Z0-9]{8,10}$/.test(nif) || nif.replace(/\D/g, "").length < 6) return send(res, 400, { error: "Escribe tu DNI, NIE o CIF (por ejemplo 12345678Z o B12345678)." }), true;
      if (empresa.length < 2 || empresa.length > 80) return send(res, 400, { error: "Escribe el nombre de tu empresa." }), true;
      if (!normalizePhone(b.telefono)) return send(res, 400, { error: "El teléfono no es válido." }), true;
      if (!validEmail(correo)) return send(res, 400, { error: "El correo no es válido." }), true;
      if (!pinValido(pin)) return send(res, 400, { error: "Elige un código de entrada de 6 letras o números." }), true;
      // El sistema comprueba la solicitud contra la base de clientes. Acceso automático si el nombre de la empresa coincide
      // con un cliente guardado Y su teléfono o su correo también; si no, queda pendiente para que la revise la empresa.
      const m = customers.matchRegistration({ phone: b.telefono, email: correo, business: empresa });
      if (m.customer) {
        const dato = [m.matched.phone ? "teléfono" : null, m.matched.email ? "correo" : null].filter(Boolean).join(" y ");
        const r = accounts.registerAuto({ phone: b.telefono, email: correo, business: empresa, pin, customerId: m.customer.id, matched: `nombre + ${dato}` });
        if (r.error) return send(res, 400, { error: r.error }), true;
        return send(res, 200, { ok: true, estado: "activa", mensaje: "Listo: ya tienes acceso. Entra con tu teléfono, el nombre de tu empresa y tu código de entrada." }), true;
      }
      const r = accounts.requestRegistration({ phone: b.telefono, email: correo, business: empresa, pin, nif, address: b.direccion }); // el DNI/CIF solo se guarda aquí (cliente nuevo) y se borra al resolver la solicitud
      if (r.error) return send(res, 400, { error: r.error }), true;
      const motivo = { ambiguo: "Hay varios clientes que encajan", contacto: "El nombre coincide pero no el teléfono ni el correo", nombre: "No hay ningún cliente con ese nombre" }[m.reason];
      accounts.setMatched(r.id, motivo);
      return send(res, 200, { ok: true, estado: "pendiente", mensaje: "Hemos recibido tu solicitud. En un plazo de 24 a 48 horas nos pondremos en contacto contigo y se aceptará tu cuenta para que puedas hacer pedidos." }), true;
    }

    if (p === "/api/acceso" && req.method === "POST") {
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const empresa = String(b.empresa ?? "").slice(0, 80);
      // Cliente habitual: solo los 6 primeros dígitos del DNI/CIF (el nombre es opcional: si se envía, estrecha la búsqueda)
      if (b.nif !== undefined) {
        if (nifCodes(b.nif).length === 0 && !validCode(b.nif)) return send(res, 400, { error: "Escribe los 6 primeros dígitos de tu DNI o CIF." }), true; // o el PIN personal
        if (!nifLimit(ip(req))) return demasiados(res, nifLimit, ip(req)), true;
        // ¿Es el código personal que el cliente puso en lugar del NIF? (si es así, no hace falta nada más)
        if (validCode(b.nif)) {
          const own = accounts.loginByCode(codeKey(b.nif));
          if (own.ok) {
            const customer = customers.getById(own.account.customerId);
            return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": cookie(own.token, 30 * 86400) }), true;
          }
          if (own.reason === "locked") return send(res, 401, { error: "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." }), true;
        }
        const nombre = empresa.trim().length >= 2 ? new Set(customers.candidates(empresa).map((c) => c.id)) : null;
        const ids = customers.findByNif(b.nif).filter((id) => (!nombre || nombre.has(id)) && !accounts.hasOwnCode(id)); // con código personal, el NIF ya no vale
        // Si nadie coincide no hay cuenta a la que anotar el fallo: se cuenta en conjunto y, si hay demasiados, se frena a todo el mundo un rato
        if (!ids.length) {
          if (!nifGlobalFails("fallos")) return demasiados(res, nifGlobalFails, "fallos", "Demasiados intentos. Si lo necesitas, llama a la empresa."), true;
          return send(res, 401, { error: "No encontramos ese NIF ni ese código de entrada entre los clientes habituales. Revisa los 6 primeros dígitos de tu DNI o CIF. Si eres cliente nuevo, solicita el alta (más abajo); si ya lo eres, llámanos." }), true;
        }
        // Varios negocios con el mismo NIF (p. ej. un mismo titular con dos locales): se pide además el nombre, sin anotar fallo
        if (ids.length > 1 && !nombre) return send(res, 409, { necesitaNombre: true, error: "Hay varios negocios con ese NIF. Escribe también el nombre de tu empresa." }), true;
        const r = accounts.loginNif(ids, () => true);
        if (r.reason === "deleted") return send(res, 401, { error: MENSAJE_ELIMINADA }), true;
        if (!r.ok || ids.length > 1) return send(res, 401, { error: r.reason === "locked" ? "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." : "NIF incorrecto. Si te sigue fallando, llama a la empresa." }), true;
        const customer = customers.getById(r.account.customerId);
        return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": cookie(r.token, 30 * 86400) }), true;
      }
      if (empresa.trim().length < 2) return send(res, 400, { error: "Escribe el nombre de tu empresa." }), true;
      // Teléfono + PIN + nombre de la empresa: el nombre debe coincidir con el del cliente guardado en la base de datos
      const registrada = accounts.hasPhone(b.telefono);
      let r = accounts.login(b.telefono, b.pin, undefined, (acc) => customers.nameMatches(customers.getById(acc.customerId), empresa));
      // Cliente habitual: el teléfono con el que suele contactar con nosotros (el de la lista de clientes) + la contraseña personal que eligió dentro de la aplicación
      if (!r.ok && !registrada && r.reason === "invalid" && validCode(b.pin)) {
        const c = customers.getByPhone(b.telefono);
        if (c && customers.nameMatches(c, empresa)) r = accounts.loginCustomerCode(c.id, codeKey(b.pin));
      }
      if (!r.ok) return send(res, 401, { error: r.reason === "deleted" ? MENSAJE_ELIMINADA : r.reason === "locked" ? "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." : "Teléfono, código de entrada o nombre de la empresa incorrectos. Usa el teléfono con el que sueles contactar con nosotros." }), true;
      const customer = customers.getById(r.account.customerId);
      return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": cookie(r.token, 30 * 86400) }), true;
    }

    if (p === "/api/salir" && req.method === "POST") {
      accounts.logout(parseCookies(req.headers.cookie)[COOKIE]);
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) }), true;
    }

    if (p === "/api/yo" && req.method === "GET") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 200, { cliente: null }), true; // invitado: sin sesión no es un error (la consola del navegador queda limpia)
      return send(res, 200, { cliente: { nombre: customers.getById(acc.customerId)?.name ?? "", codigoPropio: !!acc.ownCode } }), true;
    }

    // El cliente cambia el código de entrada (los 6 del NIF) por uno personal de 6 letras o números
    if (p === "/api/codigo" && req.method === "POST") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (!validCode(b.nuevo)) return send(res, 400, { error: "El código de entrada debe tener exactamente 6 letras o números." }), true;
      if (customers.findByNif(b.nuevo).length) return send(res, 400, { error: "Ese código no está disponible. Elige otro." }), true; // no puede coincidir con el NIF de nadie
      const r = accounts.setCodeKey(acc.id, codeKey(b.nuevo));
      if (r.error) return send(res, 400, { error: r.error }), true;
      return send(res, 200, { ok: true }), true;
    }

    // ── Uso de la aplicación (solo contadores por día; sin guardar quién ni qué pide) ──
    if (p === "/api/uso" && req.method === "POST") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!usoLimit(ip(req))) return send(res, 429, { error: "Demasiados avisos." }), true;
      const b = await readJson(req);
      if (!b || !accounts.anotarUso(String(b.evento ?? ""), b.seg)) return send(res, 400, { error: "Suceso no válido." }), true;
      return send(res, 200, { ok: true }), true;
    }

    // ── Derechos sobre los datos (RGPD): descargar lo que guardamos, pedir que se corrija/limite/deje de usarse y eliminar la cuenta ──
    if (p === "/api/mis-datos" && req.method === "GET") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const datos = misDatos ? misDatos(acc) : { cuenta: { telefono: acc.phone, correo: acc.email } };
      const fecha = new Date().toISOString().slice(0, 10);
      return send(res, 200, datos, { "Content-Disposition": `attachment; filename="mis-datos-${fecha}.json"` }), true;
    }

    if (p === "/api/derechos" && req.method === "POST") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!registerLimit(ip(req))) return demasiados(res, registerLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const r = accounts.addRightsRequest({ customerId: acc.customerId, tipo: b.tipo, texto: b.texto });
      if (r.error) return send(res, 400, { error: r.error }), true;
      return send(res, 200, { ok: true, mensaje: "Recibido. La empresa te contestará en el plazo máximo de un mes." }), true;
    }

    if (p === "/api/eliminar-cuenta" && req.method === "POST") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b || String(b.confirmo ?? "").trim().toUpperCase() !== "ELIMINAR") return send(res, 400, { error: "Para eliminar la cuenta escribe ELIMINAR." }), true;
      const r = accounts.deleteAccount(acc.id);
      if (!r.ok) return send(res, 400, { error: "No se pudo eliminar la cuenta." }), true;
      return send(res, 200, { ok: true, mensaje: "Tu cuenta se ha eliminado." }, { "Set-Cookie": cookie("", 0) }), true;
    }

    return false;
  }

  return { route, sessionOf };
}
