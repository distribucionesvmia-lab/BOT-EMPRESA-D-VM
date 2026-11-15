// Rutas HTTP del CLIENTE: solicitud de alta, acceso con teléfono + PIN y sesión por cookie.
// (La administración de la empresa está aparte, en admin.js.)
// Regla de oro: el servidor decide de quién son los datos a partir de la SESIÓN. Ninguna ruta acepta un código de
// cliente enviado por el navegador, así que un cliente no puede pedir el historial de otro.
import crypto from "node:crypto";
import { normalizePhone, validEmail, pinValido } from "./cuentas-db.js";
import { nifCodes, nifClean } from "./nif-codes.js";
import { codeKey, validCode, claveCodigoCorreo } from "./nif-key.js";
import { tapar } from "./correo-cliente.js";
import { turnstileSite, turnstileActivo, verificarTurnstile, contadorIntentos, eventoSeguridad, cabecerasSeguridad, ipDe, conexionHttps } from "./seguridad.js";

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
const send = (res, code, data, headers = {}) => res.writeHead(code, { ...cabecerasSeguridad(), ...JSON_HEADERS, ...headers }).end(JSON.stringify(data));
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
const paginaEntrar = (titulo, texto, boton) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${titulo} · Distribuciones Valentín Martín</title><style>:root{--bg:#F5F5F7;--card:#fff;--t:#1D1D1F;--t2:#5F5F65;--a:#C8102E;--on:#fff}@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--t:#F5F5F7;--t2:#A8A8B0;--a:#FF6B7D;--on:#1D1D1F}}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--t);font:16px/1.45 system-ui,sans-serif}header{background:#C8102E;color:#fff;padding:20px 16px;text-align:center;font-weight:700;font-size:20px}main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px}.c{background:var(--card);border-radius:20px;padding:28px 22px;max-width:420px;width:100%;text-align:center}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 14px;color:var(--t2)}a.b,button{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border:0;border-radius:26px;background:var(--a);color:var(--on);font:inherit;font-weight:700;font-size:17px;cursor:pointer;text-decoration:none}a.s{display:block;margin-top:8px;padding:12px 0;color:var(--a);font-weight:600;min-height:44px;line-height:1.35}</style><body><header>Distribuciones Valentín Martín</header><main><div class="c"><h1>${titulo}</h1><p>${texto}</p>${boton}</div></main></body></html>`;
export function createAuth({ accounts, customers, misDatos = null, secure = false, trustProxy = false, onAcceso = null, onCodigo = null, enviarCodigo = null }) {
  // Límites por IP (configurables para las pruebas): accesos cada 10 minutos y solicitudes de alta cada hora
  const loginLimit = rateLimiter(Number(process.env.LOGIN_LIMIT ?? 20), 10 * 60_000);
  // Acceso solo con NIF (sin nombre): no hay una cuenta a la que contar los fallos, así que se limita más por IP y en conjunto
  const nifLimit = rateLimiter(Number(process.env.NIF_LIMIT ?? 10), 10 * 60_000);
  const nifGlobalFails = rateLimiter(Number(process.env.NIF_GLOBAL_FAILS ?? 15), 60 * 60_000); // fallos de NIF por hora, entre todos los clientes
  const usoLimit = rateLimiter(300, 10 * 60_000); // contadores: muchos permitidos, pero no infinitos por IP
  const registerLimit = rateLimiter(Number(process.env.REGISTER_LIMIT ?? 20), 60 * 60_000);
  const intentosAcceso = contadorIntentos(Number(process.env.CAPTCHA_DESPUES_DE ?? 5), 10 * 60_000); // pasados N intentos en 10 min desde una dirección, se pide «no soy un robot»
  // Entrada con código por correo: topes por dirección, por cliente+correo y en total (que nadie pueda usarlo para llenar buzones)
  const codigoActivo = () => !!enviarCodigo && process.env.CODIGO_CORREO !== "0";
  const soloCorreo = () => codigoActivo() && process.env.ACCESO_SOLO_CORREO !== "0"; // con el código por correo disponible, SOLO se entra con nombre + NIF + correo + código (ACCESO_SOLO_CORREO=0 reabre las otras formas, solo para emergencias)
  const altaAutomatica = () => process.env.ALTA_AUTOMATICA === "1"; // por defecto TODA alta la acepta la empresa; esto la dejaría entrar sola si coincide con un cliente (no recomendado)
  const correoIp = rateLimiter(Number(process.env.CODIGO_IP_LIMIT ?? 8), 10 * 60_000);
  const correoClave = rateLimiter(Number(process.env.CODIGO_CLAVE_LIMIT ?? 3), 10 * 60_000);
  const correoGlobal = rateLimiter(Number(process.env.CODIGO_GLOBAL_LIMIT ?? 120), 60 * 60_000);
  const correoVerificar = rateLimiter(Number(process.env.CODIGO_VERIFICAR_LIMIT ?? 15), 10 * 60_000);
  const MSG_CODIGO_ENVIADO = "Si los datos coinciden con un cliente, te hemos enviado un código a ese correo. Mira también la carpeta de spam. Vale 10 minutos.";
  const cleanMail = (v) => String(v ?? "").trim().toLowerCase();
  /** Clientes con ese NIF (o 6 primeros dígitos) que tienen ESE correo en su ficha o en su cuenta. El nombre de la empresa, si se escribe, estrecha la búsqueda. */
  function clientesConCorreo(nif, correo, empresa) {
    if (String(empresa ?? "").trim().length < 2) return [];
    return customers.findByNif(nif).filter((id) => {
      const c = customers.getById(id);
      return !!c && customers.nameMatches(c, empresa) && [...(c.emails ?? []), accounts.emailDe(id)].map(cleanMail).includes(correo);
    });
  }
  const pedirNombre = (res, b) => String(b.empresa ?? "").trim().length < 2 ? (send(res, 400, { error: "Escribe el nombre de tu empresa o negocio, tal como lo conocemos." }), true) : false;
  const ip = (req) => ipDe(req, trustProxy);
  /** Aparato desde el que se entra: huella corta del navegador (nunca se guarda la cadena entera). Avisa al servidor para que pueda decirle al cliente «alguien ha entrado desde un aparato nuevo». */
  const huellaAparato = (req) => crypto.createHash("sha256").update(String(req.headers["user-agent"] ?? "")).digest("hex").slice(0, 16);
  const avisoAcceso = (token, req) => { try { const acc = accounts.sessionAccount(token); if (acc) onAcceso?.(acc, huellaAparato(req)); } catch {} };
  /** ¿La conexión del cliente es HTTPS? Lo dice PUBLIC_URL o, detrás de un túnel/proxy de confianza, Cloudflare (CF-Visitor / X-Forwarded-Proto): así la cookie nunca viaja sin cifrar aunque falte PUBLIC_URL. */
  const esHttps = (req) => conexionHttps(req, { seguro: secure, confiarProxy: trustProxy });
  const cookie = (token, maxAge, req) => `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${esHttps(req) ? "; Secure" : ""}`;

  /** Cuenta de la sesión de esta petición (o null). */
  const sessionOf = (req) => accounts.sessionAccount(parseCookies(req.headers.cookie)[COOKIE]);

  /** Atiende las rutas del cliente: /api/registro, /api/acceso, /api/salir y /api/yo. Devuelve true si la ruta era suya. */
  async function route(req, res, url) {
    const p = url.pathname;
    // ── Enlace de invitación de la oficina: GET enseña una página con un botón (así las vistas previas de WhatsApp no lo gastan); solo el POST lo gasta y abre sesión ──
    if (p.startsWith("/entrar/") && (req.method === "GET" || req.method === "POST")) {
      const ya = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
      const token = decodeURIComponent(p.slice(8)), fin = (code, t, x, b) => (res.writeHead(code, ya).end(paginaEntrar(t, x, b)), true);
      if (!loginLimit(ip(req))) return fin(429, "Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", "");
      const v = accounts.invitacionVer(token);
      if (!v.ok) return fin(410, "Este enlace ya no sirve", v.motivo === "caducada" ? "Ha caducado." : v.motivo === "usada" ? "Ya se ha usado o la oficina lo ha anulado." : "No lo reconocemos.", '<a class="b" href="/cliente">Entrar de la forma normal</a><a class="s" href="/cliente#enlace-caducado">¿Necesitas otro enlace? Pídeselo a la oficina</a>');
      if (req.method === "GET" && v.tipo === "alta") return fin(200, "Bienvenido", "Pulsa para solicitar tu alta como cliente.", `<form method="POST" action="/entrar/${encodeURIComponent(token)}"><button type="submit">Solicitar mi alta</button></form>`);
      if (req.method === "GET") return fin(200, "Bienvenido", (v.soloVer ? "Pulsa para entrar y ver el catálogo." : "Pulsa para entrar y hacer tu pedido.") + (v.usosMax === 1 ? " Este enlace sirve una sola vez." : ""), `<form method="POST" action="/entrar/${encodeURIComponent(token)}"><button type="submit">Entrar</button></form>`);
      const u = accounts.invitacionUsar(token); // se gasta aquí: una sola vez
      if (!u.ok) return fin(410, "Este enlace ya no sirve", "Ya se ha usado o la oficina lo ha anulado.", '<a class="b" href="/cliente">Entrar de la forma normal</a>');
      if (u.tipo === "alta") return res.writeHead(303, { Location: "/cliente#alta=" + encodeURIComponent(u.nombre || ""), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end(), true; // persona nueva: sin sesión, solo abre su solicitud de alta con el nombre puesto
      const r = accounts.entrarPorInvitacion(u.customerId, { soloVer: u.soloVer, mensaje: u.mensaje, pedirCodigo: u.pedirCodigo });
      if (!r.ok) return fin(403, "No hemos podido entrar", "Tu cuenta está bloqueada ahora mismo. Llama a la oficina y lo solucionan.", '<a class="b" href="/cliente">Volver</a>');
      return res.writeHead(303, { "Set-Cookie": (avisoAcceso(r.token, req), cookie(r.token, 30 * 86400, req)), Location: u.pedirCodigo ? "/cliente#invitacion" : "/cliente#enlace", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end(), true;
    }
    // ── «Darme de baja de las ofertas por correo»: el enlace de cada correo de promoción. GET enseña un botón (así los programas que abren los enlaces solos no te dan de baja); el POST (el botón, o el «un clic» de Gmail) lo hace ──
    if (p.startsWith("/baja/") && (req.method === "GET" || req.method === "POST")) {
      const ya = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
      const token = decodeURIComponent(p.slice(6)), fin = (code, t, x, b) => (res.writeHead(code, ya).end(paginaEntrar(t, x, b)), true);
      if (!loginLimit(ip(req))) return fin(429, "Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", "");
      const id = accounts.bajaPorToken(token);
      if (!id) return fin(404, "Este enlace no es válido", "Puede que ya no exista. Si sigues recibiendo correos que no quieres, escríbenos y te damos de baja.", "");
      if (req.method === "GET") return fin(200, "Darme de baja de las ofertas", "No volverás a recibir ofertas ni promociones por correo. Seguirás recibiendo la confirmación de tus pedidos.", `<form method="POST" action="/baja/${encodeURIComponent(token)}"><button type="submit">Darme de baja</button></form>`);
      accounts.ofertasSet(id, false, "cliente");
      return fin(200, "Listo, te hemos dado de baja", "Ya no recibirás ofertas ni promociones por correo. Si cambias de idea, puedes volver a activarlas en «Mi cuenta» dentro de la aplicación.", '<a class="b" href="/cliente">Ir a la aplicación</a>');
    }
    if (!p.startsWith("/api/")) return false;

    if (p === "/api/seguridad" && req.method === "GET") return send(res, 200, { turnstile: turnstileSite() || null, codigoCorreo: codigoActivo(), soloCorreo: soloCorreo() }), true; // solo la clave PÚBLICA, si está activada

    if (p === "/api/registro" && req.method === "POST") {
      if (!registerLimit(ip(req))) return eventoSeguridad("muchas-solicitudes-de-alta", ip(req)), demasiados(res, registerLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (String(b.sitio_web ?? "").trim()) return eventoSeguridad("alta-con-campo-trampa", ip(req)), send(res, 200, { ok: true, estado: "pendiente" }), true; // campo oculto relleno = un bot: se finge que ha ido bien y no se guarda nada
      if (!(await verificarTurnstile(b.cf, ip(req))).ok) return eventoSeguridad("alta-sin-comprobacion-robot", ip(req)), send(res, 400, { error: "No hemos podido comprobar que no eres un robot. Recarga la página e inténtalo de nuevo.", verificacion: true }), true;
      const empresa = String(b.empresa ?? "").trim().replace(/\s+/g, " ");
      const correo = String(b.correo ?? "").trim();
      const pin = String(b.pin ?? "");
      const nif = nifClean(b.nif);
      if (!/^[A-Z0-9]{8,10}$/.test(nif) || nif.replace(/\D/g, "").length < 6) return send(res, 400, { error: "Escribe tu DNI, NIE o CIF (por ejemplo 12345678Z o B12345678)." }), true;
      if (empresa.length < 2 || empresa.length > 80) return send(res, 400, { error: "Escribe el nombre de tu empresa." }), true;
      if (!normalizePhone(b.telefono)) return send(res, 400, { error: "El teléfono no es válido." }), true;
      if (correo && !validEmail(correo)) return send(res, 400, { error: "El correo no es válido." }), true; // opcional solo si no se entra con código por correo
      if (codigoActivo() && !correo) return send(res, 400, { error: "Escribe tu correo electrónico: lo necesitas para entrar (te enviaremos un código a ese correo)." }), true;
      const sinCodigoEntrada = soloCorreo(); // con el acceso nuevo no hay «código de entrada»: ni se pide ni se guarda
      if (!sinCodigoEntrada && !pinValido(pin)) return send(res, 400, { error: "Elige un código de entrada de 6 letras o números." }), true;
      // El sistema comprueba la solicitud contra la base de clientes. Acceso automático si el nombre de la empresa coincide
      // con un cliente guardado Y su teléfono o su correo también; si no, queda pendiente para que la revise la empresa.
      const m = customers.matchRegistration({ phone: b.telefono, email: correo, business: empresa });
      if (m.customer && altaAutomatica() && !sinCodigoEntrada) {
        const dato = [m.matched.phone ? "teléfono" : null, m.matched.email ? "correo" : null].filter(Boolean).join(" y ");
        const r = accounts.registerAuto({ phone: b.telefono, email: correo, business: empresa, pin, customerId: m.customer.id, matched: `nombre + ${dato}` });
        if (r.error) return send(res, 400, { error: r.error }), true;
        return send(res, 200, { ok: true, estado: "activa", mensaje: "Listo: ya tienes acceso. Entra con tu teléfono y tu código de entrada." }), true;
      }
      const r = accounts.requestRegistration({ phone: b.telefono, email: correo, business: empresa, pin: sinCodigoEntrada ? undefined : pin, nif, address: b.direccion }); // el DNI/CIF solo se guarda aquí (cliente nuevo) y se borra al resolver la solicitud
      if (r.error) return send(res, 400, { error: r.error }), true;
      const datos = [m.matched?.phone ? "el teléfono" : null, m.matched?.email ? "el correo" : null].filter(Boolean);
      const nifCoincide = m.customer ? customers.findByNif(nif).map(String).includes(String(m.customer.id)) : false; // ¿el NIF escrito es el de ese cliente? (el NIF real no se guarda: se compara su huella)
      const motivo = m.customer
        ? `Parece el cliente «${m.customer.name}» (coincide el nombre${datos.length ? " y " + datos.join(" y ") : ""}). ${nifCoincide ? "El NIF escrito SÍ coincide con el de ese cliente." : "OJO: el NIF escrito NO coincide con el de ese cliente (¿error o suplantación?)."} Revísalo y acéptalo solo si es él.`
        : { ambiguo: "Hay varios clientes que encajan", contacto: "El nombre coincide pero no el teléfono ni el correo", nombre: "No hay ningún cliente con ese nombre" }[m.reason];
      accounts.setMatched(r.id, motivo);
      return send(res, 200, { ok: true, estado: "pendiente", mensaje: "Hemos recibido tu solicitud. En un plazo de 24 a 48 horas nos pondremos en contacto contigo y se aceptará tu cuenta para que puedas hacer pedidos." }), true;
    }

    // ── Entrar con NIF + correo + código que llega al correo ──
    // Paso 1: el cliente escribe su NIF y su correo; si coinciden con su ficha, se le manda un código. La respuesta es SIEMPRE la misma (coincida o no):
    // así nadie puede averiguar qué NIF o correos existen. El código solo va a un correo que ya consta en su ficha de a3ERP o en su cuenta.
    if (p === "/api/acceso/correo/enviar" && req.method === "POST") {
      if (!codigoActivo()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Entra de otra forma o llámanos." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (!correoIp(ip(req))) return eventoSeguridad("codigo-correo-muchas-peticiones", ip(req)), demasiados(res, correoIp, ip(req)), true;
      if (turnstileActivo() && intentosAcceso.pasado(intentosAcceso.suma(ip(req)))) {
        if (!(await verificarTurnstile(b.cf, ip(req))).ok) return eventoSeguridad("muchos-intentos-de-acceso", ip(req)), send(res, 403, { necesitaVerificacion: true, error: "Por seguridad, marca «No soy un robot» y vuelve a intentarlo." }), true;
      }
      const correo = cleanMail(b.correo);
      if (pedirNombre(res, b)) return true;
      if (nifCodes(b.nif).length === 0) return send(res, 400, { error: "Escribe tu NIF: los 6 primeros dígitos de tu DNI o CIF, o el NIF completo." }), true;
      if (!validEmail(correo)) return send(res, 400, { error: "Escribe tu correo electrónico, el mismo que nos diste." }), true;
      const clave = `${nifCodes(b.nif)[0]}|${correo}`; // el tope es por NIF + correo (el nombre no cuenta: así no se esquiva escribiéndolo distinto)
      if (!correoClave(clave)) return demasiados(res, correoClave, clave, "Ya te hemos enviado códigos hace poco. Espera unos minutos."), true;
      const ids = clientesConCorreo(b.nif, correo, b.empresa);
      if (ids.length === 1 && correoGlobal("todos")) {
        const id = ids[0], codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const r = accounts.codigoCorreoCrear(id, claveCodigoCorreo(id, codigo));
        if (r.ok) void Promise.resolve(enviarCodigo({ to: correo, nombre: customers.getById(id)?.name ?? "", codigo, minutos: 10 })).catch((e) => console.error("Código por correo:", e?.message));
      } else if (ids.length === 1) eventoSeguridad("codigo-correo-tope-global", "se alcanzó el máximo de códigos por hora");
      return send(res, 200, { ok: true, espera: 60, mensaje: MSG_CODIGO_ENVIADO, correo: tapar(correo) }), true;
    }
    // Paso 2: con el código recibido se entra. Vale una vez, caduca a los 10 minutos y se anula tras 5 fallos.
    if (p === "/api/acceso/correo/entrar" && req.method === "POST") {
      if (!codigoActivo()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Entra de otra forma o llámanos." }), true;
      if (!loginLimit(ip(req)) || !correoVerificar(ip(req))) return demasiados(res, correoVerificar, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const correo = cleanMail(b.correo), codigo = String(b.codigo ?? "").replace(/\s/g, "");
      if (pedirNombre(res, b)) return true;
      if (nifCodes(b.nif).length === 0 || !validEmail(correo)) return send(res, 400, { error: "Escribe el nombre de tu empresa, tu NIF y tu correo." }), true;
      if (!/^\d{6}$/.test(codigo)) return send(res, 400, { error: "El código tiene 6 cifras. Míralo en el correo que te hemos enviado." }), true;
      const ids = clientesConCorreo(b.nif, correo, b.empresa);
      const c = ids.length === 1 ? accounts.codigoCorreoComprobar(ids, (id) => claveCodigoCorreo(id, codigo)) : { ok: false, reason: "invalid" };
      if (!c.ok) return send(res, 401, { error: c.reason === "expired" ? "Ese código ha caducado. Pide uno nuevo." : c.reason === "agotado" ? "Has fallado demasiadas veces con ese código. Pide uno nuevo." : "Código incorrecto. Revísalo o pide uno nuevo." }), true;
      const r = accounts.loginNif([c.customerId], () => true); // misma apertura de sesión que el resto (cuenta eliminada o bloqueada incluidas)
      if (!r.ok) return send(res, 401, { error: r.reason === "deleted" ? MENSAJE_ELIMINADA : "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." }), true;
      const customer = customers.getById(r.account.customerId);
      return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), cookie(r.token, 30 * 86400, req)) }), true;
    }

    if (p === "/api/acceso" && req.method === "POST") {
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      if (soloCorreo()) return send(res, 403, { error: "Para entrar, usa tu NIF, tu correo y el código que te enviamos por correo." }), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (turnstileActivo() && intentosAcceso.pasado(intentosAcceso.suma(ip(req)))) { // muchos intentos seguidos: a partir de aquí, «no soy un robot»
        if (!(await verificarTurnstile(b.cf, ip(req))).ok) return eventoSeguridad("muchos-intentos-de-acceso", ip(req)), send(res, 403, { necesitaVerificacion: true, error: "Por seguridad, marca «No soy un robot» y vuelve a intentarlo." }), true;
      }
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
            return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(own.token, req), cookie(own.token, 30 * 86400, req)) }), true;
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
        return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), cookie(r.token, 30 * 86400, req)) }), true;
      }
      // Teléfono + código: el nombre de la empresa solo se pide si hace falta (varios clientes comparten ese teléfono). Si se escribe, debe coincidir.
      const sinNombre = empresa.trim().length < 2;
      const registrada = accounts.hasPhone(b.telefono);
      if (sinNombre && !registrada && !customers.getByPhone(b.telefono)) return send(res, 409, { necesitaNombre: true, error: "Escribe también el nombre de tu empresa." }), true; // teléfono desconocido o compartido: misma respuesta (no se puede averiguar cuál)
      let r = accounts.login(b.telefono, b.pin, undefined, (acc) => sinNombre || customers.nameMatches(customers.getById(acc.customerId), empresa));
      // Cliente habitual: el teléfono con el que suele contactar con nosotros (el de la lista de clientes) + la contraseña personal que eligió dentro de la aplicación
      if (!r.ok && !registrada && r.reason === "invalid" && validCode(b.pin)) {
        const c = customers.getByPhone(b.telefono);
        if (c && (sinNombre || customers.nameMatches(c, empresa))) r = accounts.loginCustomerCode(c.id, codeKey(b.pin));
      }
      if (!r.ok) return send(res, 401, { error: r.reason === "deleted" ? MENSAJE_ELIMINADA : r.reason === "locked" ? "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." : "Teléfono, código de entrada o nombre de la empresa incorrectos. Usa el teléfono con el que sueles contactar con nosotros." }), true;
      const customer = customers.getById(r.account.customerId);
      return send(res, 200, { ok: true, cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), cookie(r.token, 30 * 86400, req)) }), true;
    }

    if (p === "/api/salir" && req.method === "POST") {
      accounts.logout(parseCookies(req.headers.cookie)[COOKIE]);
      return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0, req) }), true;
    }

    if (p === "/api/yo" && req.method === "GET") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 200, { cliente: null }), true; // invitado: sin sesión no es un error (la consola del navegador queda limpia)
      return send(res, 200, { cliente: { nombre: customers.getById(acc.customerId)?.name ?? "", codigoPropio: !!acc.ownCode || soloCorreo(), soloCorreo: soloCorreo(), soloVer: !!acc.soloVer, mensajeEnlace: acc.mensajeEnlace || "", carrito: "vm_carrito_c_" + String(acc.customerId) } }), true; // «carrito»: dónde guarda el móvil el pedido del catálogo (no se enseña; sirve para que el asistente lo lea)
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
      try { onCodigo?.(acc); } catch {}
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
      return send(res, 200, { ok: true, mensaje: "Tu cuenta se ha eliminado." }, { "Set-Cookie": cookie("", 0, req) }), true;
    }

    return false;
  }

  return { route, sessionOf };
}
