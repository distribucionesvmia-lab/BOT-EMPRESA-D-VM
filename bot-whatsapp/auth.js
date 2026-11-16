// Rutas HTTP del CLIENTE: solicitud de alta, acceso con teléfono + PIN y sesión por cookie.
// (La administración de la empresa está aparte, en admin.js.)
// Regla de oro: el servidor decide de quién son los datos a partir de la SESIÓN. Ninguna ruta acepta un código de
// cliente enviado por el navegador, así que un cliente no puede pedir el historial de otro.
import crypto from "node:crypto";
import { normalizePhone, validEmail, pinValido } from "./cuentas-db.js";
import { nifCodes, nifClean } from "./nif-codes.js";
import { codeKey, validCode, claveCodigoOficina } from "./nif-key.js";
import { navegadorCorto } from "./errores.js";
import { leerPausa, TEXTO_PAUSA_ENTRADAS } from "./pausa.js";
import { modoGeo, claseDe } from "./geoip.js";
import { elegirDestino, tapar } from "./correo-cliente.js";
import { turnstileSite, turnstileActivo, verificarTurnstile, contadorIntentos, eventoSeguridad, cabecerasSeguridad, ipDe, conexionHttps } from "./seguridad.js";

const COOKIE = "vm_session";
const COOKIE_APARATO = "vm_aparato"; // aparato de confianza: tras una aprobación de la oficina, este navegador vuelve a entrar solo
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
  const clave = String(adminToken ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim(); // sin espacios ni comillas sobrantes del archivo de configuración
  return (req) => {
    if (!clave) return false;
    const m = /^Bearer\s+(.+?)\s*$/.exec(req.headers.authorization ?? "");
    if (!m) return false;
    let presentada = m[1]; // el navegador no puede mandar en una cabecera caracteres como «€» o «—»: el panel los manda en base64 con el prefijo «b64:»
    if (presentada.startsWith("b64:")) { try { presentada = Buffer.from(presentada.slice(4), "base64").toString("utf8"); } catch { return false; } }
    return sameToken(presentada.trim(), clave);
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
  // Entrada aprobada por la oficina: topes por dirección, por cliente y en total (que nadie pueda llenar el panel de la empresa de solicitudes)
  // Entrada con NOMBRE + NIF + CONTRASEÑA (por defecto). La primera vez, el cliente crea su contraseña; después solo la escribe (y el aparato queda recordado un año). ACCESO_MODO=oficina vuelve a «la oficina da paso / código por correo».
  const pwActiva = () => process.env.ACCESO_MODO !== "oficina";
  const pwIp = rateLimiter(Number(process.env.PW_IP_LIMIT ?? 12), 10 * 60_000); // intentos de entrar por dirección
  const pwCrearIp = rateLimiter(Number(process.env.PW_CREAR_IP_LIMIT ?? 5), 60 * 60_000); // contraseñas nuevas por dirección y hora
  const pwCrearGlobal = rateLimiter(Number(process.env.PW_CREAR_GLOBAL_LIMIT ?? 100), 60 * 60_000);
  const pwFallosGlobal = rateLimiter(Number(process.env.PW_FALLOS_GLOBAL ?? 120), 60 * 60_000); // intentos con datos que no coinciden con ningún cliente
  const pwFuera = rateLimiter(Number(process.env.GEO_FUERA_LIMIT ?? 4), 10 * 60_000); // intentos de entrar desde fuera de España por dirección: muy pocos
  const MSG_PASE = "Estás conectando desde fuera de España. Por seguridad, la oficina tiene que dar paso a este aparato (solo la primera vez). Ya la hemos avisado: espera su respuesta aquí o llámanos y dile tu número de comprobación.";
  const PW_TRIVIAL = new Set(["12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "password", "password1", "contrasena", "contraseña", "qwertyui", "qwertyuiop", "abcdefgh", "abc12345", "abcd1234", "iloveyou", "asdfghjk", "12345678a", "a1234567"]);
  const sinAcentos = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  /** ¿Sirve como contraseña? 8 a 64 caracteres, no de las típicas, no repetida y NO relacionada con su NIF ni con el nombre de su empresa (es lo primero que probaría alguien). Devuelve el motivo o "". */
  const motivoPassword = (p, nif, empresa) => {
    if (typeof p !== "string" || p.length < 8) return "La contraseña tiene que tener al menos 8 caracteres.";
    if (p.length > 64) return "La contraseña es demasiado larga (máximo 64 caracteres).";
    if (PW_TRIVIAL.has(p.toLowerCase()) || /^(.)\1+$/.test(p)) return "Esa contraseña es demasiado fácil de adivinar. Elige otra.";
    const q = sinAcentos(p), n = sinAcentos(nif), e = sinAcentos(empresa), cifras = n.replace(/[a-z]/g, "");
    const comoNif = n.length >= 6 && (q.includes(n) || (q.length >= 6 && n.includes(q)) || (cifras.length >= 6 && q.includes(cifras.slice(0, 6))));
    if (comoNif || (e.length >= 4 && (q === e || q.includes(e)))) return "No uses tu NIF ni el nombre de tu empresa: son datos que conoce cualquiera.";
    return "";
  };
  const codigoPorCorreo = () => !!enviarCodigo && process.env.CODIGO_CORREO !== "0"; // con correo configurado, el cliente entra SOLO con el código que le llega al correo que ya tenemos (sin que la oficina apruebe nada)
  const oficinaActiva = () => process.env.ACCESO_OFICINA !== "0";
  const soloOficina = () => oficinaActiva() && process.env.ACCESO_SOLO_OFICINA !== "0"; // por defecto SOLO se entra así (ACCESO_SOLO_OFICINA=0 reabre las otras formas, solo para emergencias)
  const altaAutomatica = () => process.env.ALTA_AUTOMATICA === "1"; // por defecto TODA alta la acepta la empresa; esto la dejaría entrar sola si coincide con un cliente (no recomendado)
  const solicitudIp = rateLimiter(Number(process.env.OFICINA_IP_LIMIT ?? 8), 10 * 60_000);
  const solicitudCliente = rateLimiter(Number(process.env.OFICINA_CLIENTE_LIMIT ?? 6), 60 * 60_000); // solicitudes por hora para el mismo cliente (nadie puede llenar el panel con el NIF de otro)
  const solicitudGlobal = rateLimiter(Number(process.env.OFICINA_GLOBAL_LIMIT ?? 200), 60 * 60_000);
  const estadoIp = rateLimiter(Number(process.env.OFICINA_ESTADO_LIMIT ?? 600), 10 * 60_000); // el navegador pregunta cada pocos segundos
  const codigoVerificar = rateLimiter(Number(process.env.OFICINA_CODIGO_LIMIT ?? 15), 10 * 60_000);
  const MSG_SOLICITUD = "Si los datos coinciden con un cliente, te hemos enviado un código de 6 cifras al correo que tenemos de ti (mira también el spam). Escríbelo aquí. Si no tienes correo o no te llega, pulsa «Necesito ayuda» y la oficina te dará paso.";
  const huellaSecreto = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
  // Entrada con contraseña: lo que IDENTIFICA al cliente son los 6 primeros dígitos de su NIF. El nombre ayuda solo cuando varios clientes comparten esos dígitos
  // (p. ej. un mismo titular con dos locales): basta con UNA palabra de su nombre o de su razón social (sin tildes ni mayúsculas, sin «bar», «restaurante», «S.L.»…).
  const NOMBRE_RUIDO = new Set(["bar", "cafe", "cafeteria", "restaurante", "taberna", "pub", "hotel", "hostal", "bodega", "pizzeria", "mesón", "meson", "asador", "los", "las", "del", "con", "por", "para", "sociedad", "limitada", "anonima", "slu", "sll", "cb"]);
  const palabrasNombre = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !NOMBRE_RUIDO.has(w));
  /** Cuántas palabras de lo escrito encajan con el nombre (o la razón social) de ese cliente. */
  const aciertosNombre = (c, escrito) => { const mias = palabrasNombre(escrito), suyas = palabrasNombre(`${c?.name ?? ""} ${c?.legalName ?? ""}`); return mias.filter((w) => suyas.some((s) => s === w || (w.length >= 4 && s.length >= 4 && (s.startsWith(w) || w.startsWith(s))))).length; };
  /** Clientes con esos 6 dígitos: si es UNO, vale cualquier nombre (o ninguno); si son varios, se queda el único cuyo nombre encaje con una palabra de lo escrito. */
  function clientesPorNif(nif, empresa) {
    const ids = customers.findByNif(nif);
    if (ids.length <= 1) return ids;
    const puntos = ids.map((id) => [id, aciertosNombre(customers.getById(id), empresa)]), mejor = Math.max(0, ...puntos.map((p) => p[1]));
    const ganadores = mejor > 0 ? puntos.filter((p) => p[1] === mejor).map((p) => p[0]) : [];
    return ganadores.length === 1 ? ganadores : []; // gana el que más palabras acierta; si hay empate, no se adivina
  }
  /** Clientes con ese NIF (o 6 primeros dígitos) cuyo nombre se parece al escrito. */
  function clientesPorNombreYNif(nif, empresa) {
    if (String(empresa ?? "").trim().length < 2) return [];
    return customers.findByNif(nif).filter((id) => { const c = customers.getById(id); return !!c && customers.nameMatches(c, empresa); });
  }
  /** Por qué NO se ha creado la solicitud (solo para el registro PRIVADO de la oficina, nunca para el cliente; no lleva NIF ni nombre escritos). */
  function motivoSinSolicitud(nif, empresa) {
    const porNif = customers.findByNif(nif);
    if (!porNif.length) return "ningún cliente tiene ese NIF (¿falta el NIF en su ficha de a3ERP o está mal escrito?)";
    const conNombre = porNif.filter((id) => customers.nameMatches(customers.getById(id), empresa));
    if (!conNombre.length) return `hay cliente con ese NIF (código ${porNif.join(", ")}) pero el nombre escrito no coincide con el suyo`;
    return conNombre.length > 1 ? "el NIF y el nombre encajan con varios clientes a la vez: no se adivina cuál" : "";
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
  const cookieAparato = (token, maxAge, req) => `${COOKIE_APARATO}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${esHttps(req) ? "; Secure" : ""}`;
  const huella = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
  /** Cliente al que pertenece el aparato de confianza de esta petición (o null). */
  const aparatoDe = (req) => { const t = parseCookies(req.headers.cookie)[COOKIE_APARATO]; return t && t.length >= 20 && t.length <= 100 ? accounts.aparatoValido(huella(t)) : null; };
  /** Abre sesión como ese cliente y deja (o renueva) el aparato de confianza. Devuelve { ok, token, account, cookies } o { ok:false, reason }. */
  const abrirConAparato = (customerId, req, { nuevo = false } = {}) => {
    const r = accounts.loginNif([String(customerId)], () => true); if (!r.ok) return r;
    const cookies = [cookie(r.token, 30 * 86400, req)];
    if (nuevo) { const t = crypto.randomBytes(32).toString("base64url"); accounts.aparatoCrear(customerId, huella(t), navegadorCorto(req.headers["user-agent"])); cookies.push(cookieAparato(t, 365 * 86400, req)); }
    else { const t = parseCookies(req.headers.cookie)[COOKIE_APARATO]; if (t) cookies.push(cookieAparato(t, 365 * 86400, req)); } // se renueva el plazo en el navegador
    return { ...r, cookies };
  };
  const sessionOf = (req) => accounts.sessionAccount(parseCookies(req.headers.cookie)[COOKIE]);

  /** Atiende las rutas del cliente: /api/registro, /api/acceso, /api/salir y /api/yo. Devuelve true si la ruta era suya. */
  async function route(req, res, url) {
    const pausaEntradas = () => leerPausa(accounts).entradas; // pausa de emergencia (panel de la empresa): nadie nuevo inicia sesión; los que ya están dentro siguen
    if (req.method === "POST" && /^\/api\/acceso(\/|$)/.test(url.pathname) && pausaEntradas()) return send(res, 503, { error: TEXTO_PAUSA_ENTRADAS, pausa: true }), true;
    const p = url.pathname;
    // ── Enlace de invitación de la oficina: GET enseña una página con un botón (así las vistas previas de WhatsApp no lo gastan); solo el POST lo gasta y abre sesión ──
    if (p.startsWith("/entrar/") && (req.method === "GET" || req.method === "POST")) {
      const ya = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
      const token = decodeURIComponent(p.slice(8)), fin = (code, t, x, b) => (res.writeHead(code, ya).end(paginaEntrar(t, x, b)), true);
      if (!loginLimit(ip(req))) return fin(429, "Demasiados intentos", "Espera unos minutos y vuelve a abrir el enlace.", "");
      if (req.method === "POST" && pausaEntradas()) return fin(503, "Entrada en pausa", TEXTO_PAUSA_ENTRADAS, "");
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

    if (p === "/api/seguridad" && req.method === "GET") return send(res, 200, { turnstile: turnstileSite() || null, accesoOficina: oficinaActiva(), soloOficina: soloOficina(), codigoCorreo: codigoPorCorreo(), accesoPassword: pwActiva() }), true; // solo la clave PÚBLICA, si está activada

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
      if (correo && !validEmail(correo)) return send(res, 400, { error: "El correo no es válido." }), true; // el correo es opcional: ya no se usa para entrar
      const sinCodigoEntrada = soloOficina(); // con el acceso por la oficina no hay «código de entrada»: ni se pide ni se guarda
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

    // ── Entrar con la aprobación de la OFICINA (sin correo) ──
    // Paso 1: el cliente escribe el nombre de su empresa y su NIF. La respuesta es SIEMPRE la misma (coincida o no): así nadie puede averiguar qué NIF existen.
    // Si coincide con UN cliente, aparece una solicitud en el panel de la empresa, con una «referencia» de 4 cifras que ve también el cliente (la oficina comprueba
    // por teléfono que es él). La oficina la aprueba con un clic o le da un código de 6 cifras. El navegador guarda un secreto que solo sirve para esa solicitud.
    if (p === "/api/acceso/oficina/pedir" && req.method === "POST") {
      if (!oficinaActiva()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Llámanos." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (!solicitudIp(ip(req))) return eventoSeguridad("acceso-oficina-muchas-peticiones", ip(req)), demasiados(res, solicitudIp, ip(req)), true;
      if (turnstileActivo() && !aparatoDe(req)) { // un aparato nuevo (el único caso que molesta a la oficina) tiene que pasar «no soy un robot» si está configurado
        intentosAcceso.suma(ip(req));
        if (!(await verificarTurnstile(b.cf, ip(req))).ok) return eventoSeguridad("muchos-intentos-de-acceso", ip(req)), send(res, 403, { necesitaVerificacion: true, error: "Por seguridad, marca «No soy un robot» y vuelve a intentarlo." }), true;
      }
      if (pedirNombre(res, b)) return true;
      if (nifCodes(b.nif).length === 0) return send(res, 400, { error: "Escribe tu NIF: los 6 primeros dígitos de tu DNI o CIF, o el NIF completo." }), true;
      // Contra bots: campo trampa relleno, o enviado más rápido de lo que escribe una persona (o sin decir cuánto tardó): se finge que ha ido bien y no llega nada a la oficina
      const falso = () => (send(res, 200, { ok: true, solicitud: crypto.randomBytes(32).toString("base64url"), ref: String(crypto.randomInt(0, 10_000)).padStart(4, "0"), mensaje: MSG_SOLICITUD }), true);
      if (String(b.sitio_web ?? "").trim()) return eventoSeguridad("acceso-con-campo-trampa", ip(req)), falso();
      if (!(Number(b.t) >= 1500)) return eventoSeguridad("acceso-demasiado-rapido", ip(req)), falso();
      // Aparato ya aprobado antes por la oficina: entra directamente (con su nombre y NIF otra vez, por si hubiera dos personas en el mismo aparato)
      const idsPre = clientesPorNombreYNif(b.nif, b.empresa), recordado = aparatoDe(req);
      if (recordado && idsPre.length === 1 && idsPre[0] === recordado) {
        const r = abrirConAparato(recordado, req);
        if (r.ok) return send(res, 200, { ok: true, entra: true, cliente: { nombre: customers.getById(recordado)?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), r.cookies) }), true;
      }
      const secreto = crypto.randomBytes(32).toString("base64url"), ref = String(crypto.randomInt(0, 10_000)).padStart(4, "0");
      const ids = clientesPorNombreYNif(b.nif, b.empresa);
      if (ids.length === 1 && !solicitudCliente(ids[0])) { eventoSeguridad("acceso-oficina-muchas-por-cliente", `cliente ${ids[0]}`); }
      else if (ids.length === 1 && solicitudGlobal("todas")) {
        const id = ids[0], destino = codigoPorCorreo() ? elegirDestino({ account: { email: accounts.emailDe(id) }, customer: customers.getById(id) }) : null;
        const r = accounts.accesoSolicitudCrear({ customerId: id, secretHash: huellaSecreto(secreto), ref, aparato: navegadorCorto(req.headers["user-agent"]), ip: ip(req), esperaS: Number(process.env.OFICINA_ESPERA_S ?? 20),
          visible: !destino, motivo: destino ? "" : codigoPorCorreo() ? "No tiene correo en su ficha" : "Correo no configurado", minutos: destino ? 15 : 30 }); // con correo: el cliente entra solo y la oficina no ve nada; sin correo: lo ve la oficina
        if (!r.ok) console.warn(`[VM acceso] Solicitud NO creada para el cliente ${id}: ya pidió otra hace menos de ${r.espera} s`);
        else if (!destino) console.log(`[VM acceso] Solicitud de entrada del cliente ${id} (referencia ${ref}): ${codigoPorCorreo() ? "sin correo en su ficha" : "correo no configurado"}, esperando a la oficina`);
        else {
          const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
          accounts.accesoSolicitudCodigo(r.id, claveCodigoOficina(id, codigo)); // solo se guarda su huella
          console.log(`[VM acceso] Código por correo para el cliente ${id} (${tapar(destino)})`);
          void Promise.resolve(enviarCodigo({ to: destino, nombre: customers.getById(id)?.name ?? "", codigo, minutos: 15 })).catch((e) => {
            console.error("[VM acceso] El servidor de correo NO ha enviado el código:", e?.message); eventoSeguridad("codigo-correo-error", String(e?.message ?? "error").slice(0, 120));
            accounts.accesoSolicitudVisible(r.id, "No se pudo enviar el correo"); // la oficina lo ve y puede dejarle entrar
          });
        }
      } else if (ids.length === 1) eventoSeguridad("acceso-oficina-tope-global", "se alcanzó el máximo de solicitudes por hora");
      else console.warn(`[VM acceso] Solicitud NO creada: ${motivoSinSolicitud(b.nif, b.empresa)}`);
      return send(res, 200, { ok: true, solicitud: secreto, ref, mensaje: MSG_SOLICITUD }), true;
    }
    // Paso 2: el navegador pregunta cada pocos segundos si la oficina ya aprobó (o escribe el código de 6 cifras que le dieron). Vale una sola vez.
    if (p === "/api/acceso/oficina/estado" && req.method === "POST") {
      if (!oficinaActiva()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Llámanos." }), true;
      if (!estadoIp(ip(req))) return demasiados(res, estadoIp, ip(req)), true;
      const b = await readJson(req);
      const secreto = typeof b?.solicitud === "string" ? b.solicitud : "";
      if (secreto.length < 20 || secreto.length > 100) return send(res, 400, { error: "Solicitud no válida." }), true;
      const h = huellaSecreto(secreto);
      const abrir = (customerId) => {
        const r = abrirConAparato(customerId, req, { nuevo: true }); // la oficina ya lo ha aprobado: este aparato queda recordado y no hará falta volver a pedir permiso
        if (!r.ok) return send(res, 401, { error: r.reason === "deleted" ? MENSAJE_ELIMINADA : "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." }), true;
        const customer = customers.getById(r.account.customerId);
        return send(res, 200, { ok: true, estado: "entra", cliente: { nombre: customer?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), r.cookies) }), true;
      };
      const codigo = String(b?.codigo ?? "").replace(/\s/g, "");
      if (codigo) {
        if (!codigoVerificar(ip(req))) return demasiados(res, codigoVerificar, ip(req)), true;
        if (!/^\d{6}$/.test(codigo)) return send(res, 400, { error: "El código tiene 6 cifras. Te lo da la oficina." }), true;
        const c = accounts.accesoSolicitudCodigoComprobar(h, (id) => claveCodigoOficina(id, codigo));
        if (!c.ok) return send(res, 401, { error: c.reason === "expired" ? "Esa solicitud ha caducado. Pide el acceso otra vez." : c.reason === "agotado" ? "Has fallado demasiadas veces. Pide el acceso otra vez." : c.reason === "sincodigo" ? "La oficina todavía no te ha dado ningún código." : "Código incorrecto. Revísalo con la oficina." }), true;
        return abrir(c.customerId);
      }
      const e = accounts.accesoSolicitudEstado(h);
      if (e.estado === "aprobada") { const c = accounts.accesoSolicitudConsumir(h); return c.ok ? abrir(c.customerId) : send(res, 200, { estado: "caducada" }), true; }
      return send(res, 200, { estado: ["pendiente", "rechazada", "caducada", "usada", "reemplazada"].includes(e.estado) ? e.estado : "pendiente", ...(e.estado === "pendiente" ? { ref: e.ref } : {}) }), true; // «desconocida» (NIF que no coincide) se enseña como pendiente: no se puede averiguar
    }

    // ── Entrar con nombre + NIF + CONTRASEÑA ──
    // Respuestas que no dicen si un NIF existe: datos que no coinciden → siempre «los datos no son correctos». Solo cuando nombre + NIF encajan con UN cliente que
    // todavía no tiene contraseña se le propone crearla (esa es la decisión de la empresa: crearla en el momento, sin esperar a nadie; la oficina lo ve en el panel y lo puede deshacer).
    if ((p === "/api/acceso/pw/entrar" || p === "/api/acceso/pw/crear") && req.method === "POST") {
      const crear = p.endsWith("/crear");
      if (!pwActiva()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Llámanos." }), true;
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      if (!pwIp(ip(req))) return eventoSeguridad("pw-muchos-intentos", ip(req)), demasiados(res, pwIp, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      const MAL = { error: "Los datos no son correctos. Revisa el nombre de tu empresa, tu NIF y tu contraseña. Si no la recuerdas, llámanos." };
      // Contra bots: campo trampa o enviado más rápido de lo que escribe una persona (o sin decirlo) → se responde como un fallo normal y no se prueba nada
      if (String(b.sitio_web ?? "").trim()) return eventoSeguridad("acceso-con-campo-trampa", ip(req)), send(res, 401, MAL), true;
      if (!(Number(b.t) >= 1500)) return eventoSeguridad("acceso-demasiado-rapido", ip(req)), send(res, 401, MAL), true;
      if (turnstileActivo() && (crear || intentosAcceso.pasado(intentosAcceso.suma(ip(req))))) { // «no soy un robot»: siempre para crear una contraseña, y al entrar cuando hay muchos intentos
        if (!(await verificarTurnstile(b.cf, ip(req))).ok) return eventoSeguridad("muchos-intentos-de-acceso", ip(req)), send(res, 403, { necesitaVerificacion: true, error: "Por seguridad, marca «No soy un robot» y vuelve a intentarlo." }), true;
      }
      if (nifCodes(b.nif).length === 0) return send(res, 400, { error: "Escribe tu NIF: los 6 primeros dígitos de tu DNI o CIF, o el NIF completo." }), true;
      const password = typeof b.password === "string" ? b.password : "";
      if (!password) return send(res, 400, { error: crear ? "Elige una contraseña." : "Escribe tu contraseña." }), true;
      const ids = clientesPorNif(b.nif, b.empresa);
      const abrir = (customerId) => {
        const r = abrirConAparato(customerId, req, { nuevo: true }); // este aparato queda recordado: la próxima vez entra solo
        if (!r.ok) return send(res, 401, { error: r.reason === "deleted" ? MENSAJE_ELIMINADA : "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." }), true;
        if (typeof b.pase === "string" && b.pase) accounts.accesoPaseGastar(huellaSecreto(b.pase)); // el pase vale una sola vez
        return send(res, 200, { ok: true, cliente: { nombre: customers.getById(r.account.customerId)?.name ?? "" } }, { "Set-Cookie": (avisoAcceso(r.token, req), r.cookies) }), true;
      };
      // ── Conexión desde FUERA DE ESPAÑA (lista de rangos de IP del programa, sin servicios externos; ver geoip.js) ──
      // Más estricto, no bloqueado: pocos intentos y, si el aparato es nuevo, la oficina tiene que dar un «pase» (el cliente sigue necesitando su contraseña: el pase nunca abre sesión). Un aparato ya recordado de ESE cliente pasa (está de viaje).
      const geoModo = modoGeo();
      if (geoModo !== "off" && claseDe(ip(req)) === "fuera") {
        eventoSeguridad("acceso-desde-otro-pais", `conexión desde fuera de España (${geoModo})`);
        if (!pwFuera(ip(req))) return demasiados(res, pwFuera, ip(req), "Demasiados intentos desde fuera de España. Llámanos si necesitas ayuda."), true;
        if (geoModo === "aprobar") {
          const pase = typeof b.pase === "string" ? b.pase : "", recordado = aparatoDe(req), confiado = ids.length === 1 && recordado === ids[0];
          const aprobado = ids.length === 1 && pase.length >= 20 && accounts.accesoPaseAprobado(huellaSecreto(pase), ids[0]);
          if (!confiado && !aprobado) {
            const falso = () => crypto.randomBytes(32).toString("base64url"), refNueva = () => String(crypto.randomInt(0, 10_000)).padStart(4, "0");
            const previo = pase.length >= 20 && ids.length === 1 ? accounts.accesoSolicitudEstado(huellaSecreto(pase)) : null;
            if (previo?.estado === "pendiente" && previo.customerId === ids[0]) return send(res, 403, { necesitaPase: true, solicitud: pase, pendiente: true, error: "Todavía no ha respondido la oficina. Espera un momento o llámanos." }), true;
            let secreto = null, ref = refNueva();
            if (ids.length === 1 && solicitudCliente(ids[0])) {
              const s = falso(), r = accounts.accesoSolicitudCrear({ customerId: ids[0], secretHash: huellaSecreto(s), ref, aparato: navegadorCorto(req.headers["user-agent"]), ip: ip(req), esperaS: Number(process.env.OFICINA_ESPERA_S ?? 20), visible: true, motivo: "Desde fuera de España", pase: true });
              if (r.ok) secreto = s;
            }
            return send(res, 403, { necesitaPase: true, solicitud: secreto ?? (pase || falso()), ref, error: MSG_PASE }), true; // misma respuesta coincida o no el cliente
          }
        }
      }
      if (crear) {
        const motivo = motivoPassword(password, b.nif, b.empresa); // se mira SIEMPRE (coincida o no el cliente): así no se averigua nada
        if (motivo) return send(res, 400, { error: motivo }), true;
        if (typeof b.password2 === "string" && b.password2 !== password) return send(res, 400, { error: "Las dos contraseñas no coinciden." }), true;
        if (!pwCrearIp(ip(req))) return eventoSeguridad("pw-muchas-altas", ip(req)), demasiados(res, pwCrearIp, ip(req), "Demasiadas contraseñas nuevas desde esta conexión. Llámanos si necesitas ayuda."), true;
        if (!pwCrearGlobal("todas")) return eventoSeguridad("pw-tope-global", "se alcanzó el máximo de contraseñas nuevas por hora"), send(res, 429, { error: "Ahora mismo no podemos crear más accesos. Llámanos." }), true;
        if (ids.length !== 1) { accounts.passwordFalso(); return send(res, 409, { error: "No hemos podido crear tu acceso con esos datos. Si ya tienes contraseña, entra con ella; si no la recuerdas, llámanos." }), true; }
        const c = accounts.passwordCrear(ids[0], password, { aparato: navegadorCorto(req.headers["user-agent"]), ip: ip(req) });
        if (!c.ok) return send(res, c.reason === "deleted" ? 401 : 409, { error: c.reason === "deleted" ? MENSAJE_ELIMINADA : c.reason === "locked" ? "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." : "No hemos podido crear tu acceso con esos datos. Si ya tienes contraseña, entra con ella; si no la recuerdas, llámanos." }), true;
        console.log(`[VM acceso] Contraseña creada por primera vez para el cliente ${ids[0]} (${navegadorCorto(req.headers["user-agent"])})`);
        const r = abrir(ids[0]); try { const acc = accounts.listAccounts().find((a) => a.customerId === ids[0]); if (acc) onCodigo?.(acc); } catch {} // aviso al móvil del cliente, si lo tiene: «si no has sido tú, llama»
        return r;
      }
      if (ids.length !== 1) { accounts.passwordFalso(); if (!pwFallosGlobal("fallos")) return demasiados(res, pwFallosGlobal, "fallos", "Demasiados intentos. Si lo necesitas, llama a la empresa."), true; return send(res, 401, MAL), true; }
      if (!accounts.passwordTiene(ids[0])) return send(res, 409, { necesitaCrear: true, error: "Es tu primera vez: elige una contraseña para tu cuenta." }), true;
      const r = accounts.passwordComprobar(ids[0], password);
      if (r.reason === "deleted") return send(res, 401, { error: MENSAJE_ELIMINADA }), true;
      if (r.reason === "locked") return send(res, 401, { error: "Cuenta bloqueada temporalmente por varios intentos fallidos. Inténtalo más tarde o llama a la empresa." }), true;
      if (!r.ok) return send(res, 401, MAL), true;
      return abrir(ids[0]);
    }
    // El navegador pregunta si la oficina ya ha dado el «pase» (NO abre sesión ni gasta nada: después hay que escribir la contraseña). Un secreto desconocido se contesta como «pendiente».
    if (p === "/api/acceso/pw/pase" && req.method === "POST") {
      if (!estadoIp(ip(req))) return demasiados(res, estadoIp, ip(req)), true;
      const b = await readJson(req), s = typeof b?.solicitud === "string" ? b.solicitud : "";
      if (s.length < 20 || s.length > 100) return send(res, 400, { error: "Solicitud no válida." }), true;
      const e = accounts.accesoSolicitudEstado(huellaSecreto(s));
      return send(res, 200, { estado: e.estado === "aprobada" ? "aprobada" : e.estado === "rechazada" ? "rechazada" : e.estado === "pendiente" || e.estado === "desconocida" ? "pendiente" : "caducada" }), true;
    }
    // El cliente (con sesión) cambia su contraseña: si ya tenía una, tiene que escribir la actual.
    if (p === "/api/password" && req.method === "POST") {
      const acc = sessionOf(req);
      if (!acc) return send(res, 401, { error: "No has iniciado sesión." }), true;
      if (!loginLimit(ip(req)) || !pwIp(ip(req))) return demasiados(res, pwIp, ip(req)), true;
      const b = await readJson(req);
      if (!b) return send(res, 400, { error: "Solicitud no válida." }), true;
      if (accounts.passwordTiene(acc.customerId)) {
        if (!accounts.passwordComprobar(acc.customerId, String(b.actual ?? "")).ok) return send(res, 401, { error: "La contraseña actual no es correcta." }), true;
      }
      const motivo = motivoPassword(b.nueva, "", ""); if (motivo) return send(res, 400, { error: motivo }), true;
      if (typeof b.nueva2 === "string" && b.nueva2 !== b.nueva) return send(res, 400, { error: "Las dos contraseñas no coinciden." }), true;
      accounts.passwordCambiar(acc.id, b.nueva, parseCookies(req.headers.cookie)[COOKIE]);
      try { onCodigo?.(acc); } catch {}
      return send(res, 200, { ok: true }), true;
    }

    // «Necesito ayuda»: el código por correo no llega (o no hay correo): la solicitud pasa a verse en el panel de la oficina, que le puede dejar entrar o darle un código
    if (p === "/api/acceso/oficina/ayuda" && req.method === "POST") {
      if (!oficinaActiva()) return send(res, 503, { error: "Esta forma de entrar no está disponible ahora. Llámanos." }), true;
      if (!estadoIp(ip(req))) return demasiados(res, estadoIp, ip(req)), true;
      const b = await readJson(req), secreto = typeof b?.solicitud === "string" ? b.solicitud : "";
      if (secreto.length < 20 || secreto.length > 100) return send(res, 400, { error: "Solicitud no válida." }), true;
      accounts.accesoSolicitudVisible(huellaSecreto(secreto), "Pidió ayuda"); // si no existe o ya caducó, no pasa nada (misma respuesta)
      return send(res, 200, { ok: true, mensaje: "Hemos avisado a la oficina. En cuanto lo apruebe, entrarás solo. También puedes llamarnos y decirnos tu número de comprobación." }), true;
    }

    if (p === "/api/acceso" && req.method === "POST") {
      if (!loginLimit(ip(req))) return demasiados(res, loginLimit, ip(req)), true;
      if (soloOficina()) return send(res, 403, { error: "Para entrar, escribe el nombre de tu empresa y tu NIF: la oficina te dará paso." }), true;
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
      const ck = parseCookies(req.headers.cookie);
      accounts.logout(ck[COOKIE]);
      if (ck[COOKIE_APARATO]) accounts.aparatoOlvidar(huella(ck[COOKIE_APARATO])); // cerrar sesión también olvida ESTE aparato: la próxima vez tendrá que aprobarlo la oficina (seguro en ordenadores compartidos)
      return send(res, 200, { ok: true }, { "Set-Cookie": [cookie("", 0, req), cookieAparato("", 0, req)] }), true;
    }

    if (p === "/api/yo" && req.method === "GET") {
      let acc = sessionOf(req), extra = {};
      if (!acc) { // sin sesión (caducó, o se cerró el navegador) pero con un aparato ya aprobado por la oficina: entra solo
        const rec = pausaEntradas() ? null : aparatoDe(req), r = rec ? abrirConAparato(rec, req) : null; // en pausa de emergencia tampoco se reabre sola la sesión
        if (r?.ok) { acc = r.account; extra = { "Set-Cookie": (avisoAcceso(r.token, req), r.cookies) }; }
      }
      if (!acc) return send(res, 200, { cliente: null }), true; // invitado: sin sesión no es un error (la consola del navegador queda limpia)
      return send(res, 200, { cliente: { nombre: customers.getById(acc.customerId)?.name ?? "", codigoPropio: !!acc.ownCode || soloOficina(), soloOficina: soloOficina(), tienePassword: accounts.passwordTiene(acc.customerId), soloVer: !!acc.soloVer, mensajeEnlace: acc.mensajeEnlace || "", carrito: "vm_carrito_c_" + String(acc.customerId) } }, extra), true; // «carrito»: dónde guarda el móvil el pedido del catálogo (no se enseña; sirve para que el asistente lo lea)
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
