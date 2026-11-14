import http from "node:http";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { handleMessage, newSession, setCatalog, setCustomerFinder, setLinkMaker, getCatalog as catalogNow, habitualProducts, tarjetaSiempre, lineasUltimoPedido, itemsDeCarrito } from "./bot.js";
import { getCatalog, catalogVersion, getCustomerByPhone, getCustomerById, findCustomers, createOrder, getAccountsDb, customerDirectory, getDatabases, setOrderHook } from "./erp.js";
import { makeToken, readToken } from "./links.js";
import { getDb } from "./db.js";
import { priceOrder, totals } from "./pricing.js";
import { createAuth, rateLimiter } from "./auth.js";
import { createAdmin } from "./admin.js";
import { crearActualizador } from "./actualizar-datos.js";
import { estadoSistema, crearVigilante } from "./monitor.js";
import { privacidadHtml, avisoLegalHtml } from "./privacidad.js";
import { estadoVersion } from "./version.js";
import { sendMail } from "./mailer.js";
import { webProducts, webHistory, webTree, webOrderFromBody, withOwnOrders, accesosDe, HISTORIAL_MAX, HISTORIAL_VER_MAS } from "./weborder.js";
import { deliveryOptions, deliveryCalendarFrom, madridDay, puedeHoy, entregaHoyDisponible } from "./delivery.js";
// Lo que el catálogo necesita para el aviso «entrega hoy» y las opciones de día: se calcula SIEMPRE en el servidor con la hora de Madrid
// «Lo más pedido» (para un cliente sin historial): identificadores de los artículos que más clientes compran, sin ningún dato personal; se recalcula cada 10 minutos
let topCache = { at: 0, ids: [] };
const topIds = () => {
  if (Date.now() - topCache.at > 600_000) {
    try { const conocidos = new Set(catalogNow().map((p) => String(p.id))); topCache = { at: Date.now(), ids: (customers.top?.(30) ?? []).map(String).filter((id) => conocidos.has(id)).slice(0, 8) }; } catch { topCache = { at: Date.now(), ids: [] }; }
  }
  return topCache.ids;
};
// Hasta cuándo se podrá cambiar un pedido hecho AHORA para cada día de reparto: la misma regla que el «Puedes modificarlo hasta…» de después de enviarlo
const plazosDe = (ops) => Object.fromEntries(ops.map((o) => [o.date, plazoModificacion(o.date)]).filter(([, v]) => v).map(([d, v]) => [d, { texto: v.texto.replace(/^Puedes modificarlo/, "Podrás modificarlo"), corto: v.corto }]));
const avisoEntrega = (customer) => ({ entregaHoy: entregaHoyDisponible(customer), delivery: deliveryOptions(undefined, { hoy: puedeHoy(customer) }), plazos: plazosDe(deliveryOptions(undefined, { hoy: puedeHoy(customer) })), today: madridDay(), minDate: deliveryCalendarFrom(undefined, { hoy: puedeHoy(customer) }) });
import { scheduleDailyExport, runExport } from "./exporter.js";
import { crearSincronizacion, fileState } from "./sincronizar.js";
import { crearAvisos } from "./avisos.js";
import { endpointValido, clavesValidas } from "./webpush.js";
import { mailConfigFromEnv } from "./mailer.js";
import { crearNotificador } from "./notificaciones.js";
import { scheduleBackups } from "./backup.js";
import { sourceFromEnv } from "./drive.js";
import nodePath from "node:path";
import { BUSINESS, AYUDA, ayudaPublica, condicionesPedido, envTexto } from "./config.js";
import { pdfPedido, datosPdf, lineaPdf } from "./pdf.js";
import { categorizar } from "./categorias.js";
import { empaquetar, estatico } from "./estaticos.js";
import { avisarCortes, horaAviso } from "./avisocorte.js";
import { zip as zipNode } from "./zip.js";
import { limpiaError, navegadorCorto } from "./errores.js";
const errLimitCliente = rateLimiter(Number(process.env.ERR_LIMIT ?? 30), 3600e3), errLimitIp = rateLimiter(Number(process.env.ERR_LIMIT_IP ?? 60), 3600e3); // avisos de error por hora: por cliente y, sin sesión, por dirección
import { puedeEditarPedido, plazoModificacion, longDate, weekday, addDays } from "./delivery.js";
const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

if (process.env.DEMO === "1") {
  // La demo usa su propia base de datos y carpeta, para no mezclarse con pedidos reales
  process.env.DB_PATH ??= "demo.sqlite";
  process.env.CATALOG_DB ??= "catalogo-demo.sqlite";
  process.env.CUSTOMERS_DB ??= "clientes-demo.sqlite";
  process.env.ACCOUNTS_DB ??= "cuentas-demo.sqlite";
  if (process.env.APP_MODE !== "cliente") process.env.ADMIN_TOKEN ??= "demo"; // clave de la aplicación de la empresa en la demo
  process.env.EXPORT_DIR ??= "exportaciones-demo";
}

setCatalog(await getCatalog()); // catálogo (base de productos); si no hay, se usa el de config.js
let catalogSeen = catalogVersion();
// Si se actualizan los productos o precios, el bot los usa sin reiniciar
async function refreshCatalog() {
  const v = catalogVersion();
  if (v !== catalogSeen) {
    catalogSeen = v;
    setCatalog(await getCatalog());
  }
}

const { PORT = 3000, VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID, APP_SECRET, OWNER_PHONE } = process.env;
const API = process.env.WHATSAPP_API_URL ?? `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`; // la variable solo sirve para pruebas
const SOLO_VER_TEXTO = "Has entrado con un enlace de solo consulta: puedes ver el catálogo, pero no enviar pedidos. Si quieres pedir, llama a la oficina o entra con tu código.";
const SESSION_TTL = 24 * 60 * 60 * 1000;
// Dirección pública del servidor (HTTPS) para el enlace a la mini-aplicación de pedido
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const sessions = new Map(); // teléfono -> { session, last }
const chatSessions = new Map(); // id de cuenta -> { session, last }: conversación de un cliente con sesión iniciada

const hasCredentials = () => WHATSAPP_TOKEN && PHONE_NUMBER_ID;

// Enlace personal (caduca en 24 h) para abrir el catálogo de pedido del cliente
const linkFor = (customer, phone, flags = {}) => `${PUBLIC_URL}/pedido/${makeToken(phone, customer.id, Date.now(), flags)}`;
const digits9 = (p) => String(p ?? "").replace(/\D/g, "").slice(-9);
// El cliente del chat de WhatsApp lleva su historial de a3ERP MÁS lo que ha pedido por el bot o la app (para «último pedido», «histórico» y «repetir»)
const conSusPedidos = (c) => (c ? withOwnOrders(c, getDb().ordersOf(c.id)) : c);
setCustomerFinder((query) => (findCustomers(query) ?? []).map(conSusPedidos));
// Quien se identifica por nombre desde un teléfono que no es el del cliente: su pedido de la mini-app queda retenido
setLinkMaker((customer, session) =>
  linkFor(customer, session.opts?.phone ?? "", session.opts?.holdUnverified && digits9(session.opts?.phone) !== digits9(customer.phone) ? { u: 1 } : {}),
);

async function post(payload) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) console.error("Error enviando a WhatsApp:", res.status, await res.text());
}

async function send(to, body) {
  if (!hasCredentials()) return console.log(`[sin credenciales] -> ${to}: ${body}`);
  await post({ to, type: "text", text: { body } });
}

// Envía la respuesta del bot; si lleva lista o botones, como mensaje interactivo de WhatsApp
async function sendOut(to, out) {
  if (!out.ui) return send(to, out.reply);
  let body = out.reply;
  if (body.length > 900) {
    // el cuerpo de un mensaje interactivo admite ~1024 caracteres: el texto largo va aparte
    await send(to, body);
    body = "Elige una opción:";
  }
  if (!hasCredentials()) return console.log(`[sin credenciales] -> ${to}: ${body}\n   ${JSON.stringify(out.ui)}`);
  const interactive =
    out.ui.type === "link"
      ? { type: "cta_url", body: { text: body }, action: { name: "cta_url", parameters: { display_text: out.ui.title, url: out.ui.url } } }
      : out.ui.type === "list"
        ? { type: "list", body: { text: body }, action: { button: out.ui.button, sections: [{ title: out.ui.section, rows: out.ui.rows }] } }
        : { type: "button", body: { text: body }, action: { buttons: out.ui.buttons.map((b) => ({ type: "reply", reply: b })) } };
  await post({ to, type: "interactive", interactive });
}

// Referencia del pedido (VM-2026-000123) para que el cliente pueda reclamar o consultarlo
const conReferencia = (reply, ref) => {
  if (!ref) return reply;
  const linea = `🧾 Tu referencia: *${ref}*`;
  return /\n\nEscribe \*menu\*/.test(reply) ? reply.replace(/\n\nEscribe \*menu\*/, `\n\n${linea}\n\nEscribe *menu*`) : `${reply}\n\n${linea}`;
};

// Pasa un mensaje por el bot: reconoce al cliente por su teléfono, guarda el pedido si lo hay y devuelve el resultado
async function handleIncoming(from, text, msgId = null) {
  await refreshCatalog();
  const entry = sessions.get(from);
  let current = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : null;
  if (!current) {
    let customer = null;
    try {
      customer = conSusPedidos(await getCustomerByPhone(from));
    } catch (err) {
      console.error("No se pudo consultar la base de clientes; se pregunta quién es:", err.message);
    }
    // En la demo siempre se pregunta quién es. Con un teléfono que no está (o lo comparten varios clientes) también:
    // el cliente escribe su nombre y se busca en la base de clientes. Su pedido queda retenido hasta que alguien lo revise.
    const identify = process.env.DEMO === "1" || !customer;
    current = newSession(identify ? null : customer, identify ? null : linkFor(customer, from), {
      identify,
      phone: from,
      holdUnverified: process.env.DEMO !== "1",
    });
  }
  const out = handleMessage(current, text);
  sessions.set(from, { session: out.session, last: Date.now() });

  if (out.order) {
    // La clave hace el pedido idempotente: el mismo mensaje de confirmación nunca crea dos pedidos
    out.order = { at: new Date().toISOString(), phone: from, key: msgId ? `wa:${msgId}` : `demo:${crypto.randomUUID()}`, ...out.order };
    // Precio de tarifa/especial, descuento, cajas/unidades e IVA según las fichas (ver pricing.js)
    out.order = priceOrder(out.order, current.customer ?? null, catalogNow());
    const { order: guardado } = await createOrder(out.order);
    out.reply = conReferencia(out.reply, guardado?.ref);
    avisoPedido(account, guardado);
  }
  return out;
}

async function onMessage(msg) {
  if (!getDb().markMessage(msg.id)) return; // Meta reenvía mensajes; este ya se procesó (también tras reiniciar)

  const from = msg.from;
  // El cliente escribe un texto, o pulsa una fila de lista / un botón (llega su id)
  const supported = msg.type === "text" || msg.type === "interactive";
  const text =
    msg.type === "text" ? msg.text.body : msg.type === "interactive" ? (msg.interactive?.list_reply?.id ?? msg.interactive?.button_reply?.id ?? "") : "";
  const out = await handleIncoming(from, text, msg.id);

  await sendOut(from, supported ? out : { ...out, reply: "Solo entiendo texto y botones 🙂\n\n" + out.reply });

  if (out.order && OWNER_PHONE) {
    const total = out.order.total == null ? "por revisar" : out.order.total.toFixed(2);
    await send(OWNER_PHONE, `🛒 Nuevo pedido de ${out.order.name} (+${from})\n${out.order.text}\nTotal: ${total}\n📍 ${out.order.address}`);
  }
  if (out.handoff) {
    console.log(`ATENCIÓN HUMANA solicitada por +${from}`);
    if (OWNER_PHONE) await send(OWNER_PHONE, `👤 +${from} pide hablar con una persona.`);
  }
}

// Modo demo (npm run demo): chat simulado en el navegador, sin WhatsApp ni Meta
const readOrders = () => getDb().listOrders().reverse().map((o) => ({ ...o, at: o.created_at, customerId: o.customer_id })); // el demo las pinta de más antiguo a más reciente

// Compresión (gzip) de páginas y datos: la página del cliente baja de ~106 KB a ~43 KB y el catálogo en JSON a una cuarta parte (importa con mala cobertura)
const conGzip = (res, headers, body) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (buf.length < 1024 || !/\bgzip\b/.test(String(res.req?.headers?.["accept-encoding"] ?? ""))) return [headers, buf];
  return [{ ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" }, zlib.gzipSync(buf, { level: 6 })];
};
const enviar = (res, code, headers, body) => { const [h, b] = conGzip(res, headers, body); return res.writeHead(code, h).end(b); };

// Respuesta con ETag: si el navegador ya tiene exactamente lo mismo (If-None-Match), se contesta 304 sin cuerpo (el catálogo pesa más de 1 MB)
const sendJsonEtag = (req, res, data) => {
  const cuerpo = JSON.stringify(data), etag = `"${crypto.createHash("sha1").update(cuerpo).digest("base64url")}"`;
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-cache", ETag: etag };
  if (req.headers["if-none-match"] === etag) return res.writeHead(304, { ETag: etag, "Cache-Control": "private, no-cache" }).end();
  return enviar(res, 200, h, cuerpo);
};
const json = (res, data, code = 200) => enviar(res, code, { "Content-Type": "application/json" }, JSON.stringify(data));

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function demoRoutes(req, res, url) {
  if (url.pathname === "/demo" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(new URL("./demo.html", import.meta.url)));
  }
  if (url.pathname === "/demo/pedidos" && req.method === "GET") return json(res, readOrders().reverse());
  if (url.pathname === "/demo/clientes" && req.method === "GET") {
    // El cliente ya no se elige: lo identifica el bot por el nombre que escribe
    return json(res, [{ name: "Móvil de prueba (sin identificar)", phone: "34600999999" }]);
  }
  if (url.pathname === "/demo/exportar" && req.method === "POST") {
    // Lanza ahora la exportación que en producción se hace cada noche
    try {
      const r = runExport(getDb());
      return json(res, { export: r.export, held: r.held });
    } catch (err) {
      console.error(err);
      return json(res, { error: err.message }, 500);
    }
  }
  if (url.pathname === "/demo/exportaciones" && req.method === "GET") return json(res, getDb().listExports(10));
  const dl = /^\/demo\/descargar\/(\d+)$/.exec(url.pathname);
  if (dl && req.method === "GET") {
    const e = getDb().getExport(Number(dl[1]));
    const file = e && path.join(process.env.EXPORT_DIR ?? "exportaciones", e.file_name);
    if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${e.file_name}"` });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === "/demo/reset" && req.method === "POST") {
    readBody(req).then(({ phone }) => {
      sessions.delete(String(phone));
      json(res, { ok: true });
    });
    return;
  }
  if (url.pathname === "/demo/mensaje" && req.method === "POST") {
    readBody(req).then(async ({ phone, text }) => {
      try {
        const out = await handleIncoming(String(phone ?? "34699000000"), String(text ?? "").slice(0, 1000));
        json(res, { reply: out.reply, ui: out.ui });
      } catch (err) {
        console.error(err);
        json(res, {}, 500);
      }
    });
    return;
  }
  return false;
}

// Mini-aplicación de pedido (catálogo estilo app) que se abre desde el enlace personal de WhatsApp
// Cada enlace sirve para enviar un solo pedido: se controla en la base de datos (clave "web:<id del enlace>")
const linkKey = (link) => `web:${link.n}`;

function readJson(req, max = 100_000) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > max) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve(null); }
    });
  });
}

function webOrderRoutes(req, res, url) {
  const m = /^\/pedido\/([\w.-]+)(\/datos|\/aviso)?$/.exec(url.pathname);
  if (!m) return false;
  const token = m[1];

  if (req.method === "GET" && !m[2]) {
    return enviar(res, 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, empaquetar(fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8"), "pedido"));
  }

  (async () => {
    const link = readToken(token);
    const customer0 = link && ((link.c && (await getCustomerById(link.c))) || (await getCustomerByPhone(link.p)));
    const customer = customer0 && withOwnOrders(customer0, getDb().ordersOf(customer0.id));
    if (!customer) return json(res, { error: "Enlace no válido o caducado" }, 410);

    if (req.method === "GET" && m[2] === "/aviso") return json(res, avisoEntrega(customer));
    if (req.method === "GET") {
      // Identificado solo por nombre (link.u): no se enseña histórico, precios especiales ni dirección de ese cliente
      const arbolEnlace = webTree(catalogNow());
      const view = link.u ? { ...customer, orders: [], usual: [], frequent: [], specialPrices: {}, discounts: {}, address: "" } : customer;
      const products = webProducts(view, catalogNow(), habitualProducts, imgUrl, imgEsIa);
      return json(res, {
        business: BUSINESS.name,
        priceNote: BUSINESS.priceNote,
        condiciones: condicionesPedido(),
        customer: { name: view.name, address: view.address, codigo: String(view.id ?? "") },
        used: getDb().hasOrderKey(linkKey(link)),
        products,
        history: webHistory(view, catalogNow()),
        tree: arbolEnlace, accesos: accesosDe(arbolEnlace),
        top: topIds(),
      ayuda: ayudaPublica(),
        ayuda: ayudaPublica(),
        ...avisoEntrega(customer),
      });
    }

    if (req.method === "POST" && !m[2]) {
      if (getDb().hasOrderKey(linkKey(link))) return json(res, { error: "Este pedido ya se envió" }, 409);
      const body = await readJson(req);
      const built = webOrderFromBody(body, customer, { key: linkKey(link), phone: link.p }, catalogNow());
      if (built.error) return json(res, { error: built.error }, 400);
      const order = built.order;
      if (link.u) order.review = true; // identificado solo por nombre: lo revisa una persona antes de exportarlo
      const { items } = order;
      const priced = priceOrder(order, customer, catalogNow());
      const { duplicate, order: guardado } = await createOrder(priced);
      if (duplicate) return json(res, { error: "Este pedido ya se envió" }, 409); // doble clic o dos pestañas
      const message = `🎉 ¡Pedido recibido, ${customer.name}! ${items.length} ${items.length === 1 ? "artículo" : "artículos"}, total aprox. ${priced.total.toFixed(2).replace(".", ",")} ${BUSINESS.currency.trim()}.${guardado?.ref ? `\n🧾 Tu referencia: *${guardado.ref}*` : ""}\n\n${BUSINESS.payment}`;
      if (process.env.DEMO !== "1") {
        await send(link.p, message);
        if (OWNER_PHONE) await send(OWNER_PHONE, `🛒 Nuevo pedido de ${customer.name} (+${link.p})\n${order.text}\nTotal: ${priced.total.toFixed(2)}\n📍 ${order.address}`);
      }
      return json(res, { ok: true, message });
    }
    res.writeHead(405).end();
  })().catch((err) => {
    console.error(err);
    json(res, { error: "Error del servidor" }, 500);
  });
}

function validSignature(raw, header) {
  if (!APP_SECRET) return true; // solo para pruebas locales
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Aplicación web de los clientes (sin WhatsApp): acceso con teléfono + PIN y vista del distribuidor ----
// Dos aplicaciones distintas con las mismas bases de datos (APP_MODE):
//   cliente  lo que se entrega al cliente: acceso, chat y catálogo (nada de administración)
//   empresa  lo del empresario: pedidos, exportación a Excel, solicitudes de alta y cuentas
//   todo     las dos en un mismo servidor (por defecto, y en la demo)
const APP_MODE = process.env.APP_MODE ?? "todo";
const clientEnabled = APP_MODE !== "empresa";
const adminEnabled = APP_MODE !== "cliente";
// Lo que guardamos de un cliente (derecho de acceso y portabilidad): cuenta, ficha, histórico de a3ERP, pedidos de la aplicación y favoritos
const datosDelCliente = (acc) => {
  const c = customerDirectory.getById(acc.customerId);
  return {
    aviso: "Estos son los datos que Distribuciones Valentín Martín guarda sobre ti. No guardamos tu DNI/CIF ni tu contraseña en claro.",
    generado: new Date().toISOString(),
    cuenta: { telefono: acc.phone ?? null, correo: acc.email ?? null, estado: acc.status, creada: acc.createdAt ?? null, ultimo_acceso: acc.lastLogin ?? null },
    cliente: c ? { codigo: c.id, nombre: c.name, razon_social: c.legalName, poblacion: c.city, direccion: c.address, telefonos: c.phones, correos: c.emails, recargo_equivalencia: c.recargoEquivalencia } : null,
    historial_de_compras: (c?.orders ?? []).map((o) => ({ documento: o.doc, fecha: o.date, lineas: o.lines })),
    pedidos_hechos_en_la_aplicacion: getDb().ordersFull(acc.customerId),
    favoritos: getAccountsDb().favorites(acc.customerId),
    direcciones_de_entrega_guardadas: getAccountsDb().addresses(acc.customerId).map((d) => d.texto),
    pedido_fijo_semanal: getAccountsDb().getStanding(acc.customerId),
    avisos_en_el_movil: getAccountsDb().pushOf(acc.customerId).length, // móviles donde tiene activados los avisos (las claves de cada móvil no se incluyen)
  };
};
const auth = createAuth({
  accounts: getAccountsDb(),
  customers: customerDirectory,
  misDatos: datosDelCliente,
  secure: PUBLIC_URL.startsWith("https://"),
  trustProxy: process.env.TRUST_PROXY === "1",
});
// Aviso por correo de cada pedido nuevo («PEDIDO REALIZADO - NOMBRE COMERCIAL»): solo si hay SMTP_HOST y MAIL_TO (ver .env.example)
let notificador = null;
{
  const cfg = mailConfigFromEnv();
  if (cfg) {
    notificador = crearNotificador({ db: getDb(), config: cfg });
    setOrderHook((o) => notificador.notificar(o));
  }
}
// Sincronización automática de clientes y productos con una carpeta de Google Drive (o del servidor): solo la aplicación de la empresa
let sync = null;
if (adminEnabled) {
  try {
    const dbs = getDatabases();
    const statePath = process.env.SYNC_STATE ?? nodePath.join(nodePath.dirname(process.env.CUSTOMERS_DB ?? "clientes.sqlite"), "sync-estado.json");
    sync = crearSincronizacion({ source: sourceFromEnv(), state: fileState(statePath), catalogDb: dbs.catalogDb, customersDb: dbs.customersDb, accountsDb: getAccountsDb(), onChange: () => refreshCatalog().catch(console.error) });
  } catch (e) {
    console.error("Sincronización desactivada:", e.message); // credenciales o carpeta mal configuradas: la aplicación sigue funcionando
  }
}
const dbsAdmin = adminEnabled ? getDatabases() : null;
const actualizador = adminEnabled ? crearActualizador({
  catalogDb: dbsAdmin.catalogDb, customersDb: dbsAdmin.customersDb, accountsDb: getAccountsDb(), imgDir: process.env.IMG_DIR ?? fileURLToPath(new URL("./imagenes/", import.meta.url)), copiaCatalogo: process.env.CATALOG_DB ?? "catalogo.sqlite",
  familias: (() => { try { return JSON.parse(fs.readFileSync(new URL("./familias-categorias.json", import.meta.url), "utf8")); } catch { return {}; } })(),
  registro: (e) => { try { fs.appendFileSync(nodePath.join(nodePath.dirname(process.env.CUSTOMERS_DB ?? "clientes.sqlite"), "actualizaciones.log"), JSON.stringify(e) + "\n"); } catch { /* el registro nunca bloquea */ } },
  onChange: () => { imgAt = 0; refreshCatalog().catch(console.error); },
}) : null;
const estadoDelSistema = adminEnabled ? () => {
  const dataDir = nodePath.dirname(nodePath.resolve(process.env.CUSTOMERS_DB ?? "clientes.sqlite"));
  const pend = getDb().listOrders({ exportStatus: "pending", limit: 500 }).map((o) => ({ fecha: o.created_at, estado: !o.review && o.customer_id ? "pendiente" : "retenido" }));
  return estadoSistema({
    pedidosPendientes: () => pend, solicitudesPendientes: () => getAccountsDb().listRegistrations("pending"), cuentasSinConfirmar: () => getAccountsDb().listAccounts().filter((a) => !a.verified).length,
    sync, correo: notificador, copiasDir: process.env.BACKUP_DIR ?? "respaldos", dataDir,
    catalogo: () => { const l = dbsAdmin.catalogDb.list({ activeOnly: true }); return { activos: l.length, sinPrecio: l.filter((p) => !(p.price > 0)).length }; },
  });
} : null;
const ficheroActualizaciones = nodePath.join(nodePath.dirname(process.env.CUSTOMERS_DB ?? "clientes.sqlite"), "actualizaciones.log");
const leerActualizaciones = () => { try { return fs.readFileSync(ficheroActualizaciones, "utf8").trim().split("\n").slice(-60).map((l) => JSON.parse(l)).reverse(); } catch { return []; } };
const admin = createAdmin({ sync, mail: notificador, actualizador, estado: estadoDelSistema, actualizaciones: leerActualizaciones, accounts: getAccountsDb(), customers: customerDirectory, orders: getDb(), catalogDb: dbsAdmin?.catalogDb ?? null, adminToken: adminEnabled ? process.env.ADMIN_TOKEN : undefined }); // la aplicación del cliente ni conoce la clave
/** Datos fiscales de la empresa para el PDF: los PRIVACY_* de la configuración (lo que esté vacío no se imprime) y el teléfono de ayuda. */
function datosPdfComunes() {
  const titular = envTexto("PRIVACY_TITULAR") || "Distribuciones Valentín Martín", cif = envTexto("PRIVACY_CIF"), dir = envTexto("PRIVACY_DIRECCION"), tel = AYUDA.telefono, mail = envTexto("PRIVACY_EMAIL");
  return { empresa: titular, datosEmpresa: [[cif && "CIF " + cif, dir].filter(Boolean).join(" · "), [tel && "Tel. " + tel, mail].filter(Boolean).join(" · ")].filter(Boolean) };
}
// PDF de un pedido hecho en la aplicación (con los precios guardados del día). null si no existe, es de otro cliente o está cancelado.
function pdfDePedidoApp(account, ref) {
  const o = getDb().getOrderByRef(ref);
  if (!o || o.customer_id !== String(account.customerId) || o.status === "cancelled") return null;
  const c = customerDirectory.getById(account.customerId);
  return { buf: pdfPedido(datosPdf(o, { ...datosPdfComunes(), cliente: c?.name ?? "", telefonoCliente: c?.phone ?? c?.phones?.[0] ?? "" })), nombre: `pedido-${o.ref}.pdf` };
}
// PDF de un pedido del historial de a3ERP: importes con los precios de hoy (el propio PDF lo avisa). null si no es de SU historial.
function pdfDeHistorial(account, doc) {
  const customer = clienteConPedidos(account.customerId, HISTORIAL_VER_MAS), catalog = catalogNow();
  const o = (customer.orders ?? []).find((x) => String(x.doc) === doc); // solo pedidos de SU historial
  const nombres = new Map(catalog.map((x) => [String(x.id), x.name]));
  const items = o ? o.lines.filter((l) => l.qty > 0 && nombres.has(String(l.productId))).map((l) => ({ id: String(l.productId), name: nombres.get(String(l.productId)), qty: l.qty, unit: "ud" })) : [];
  if (!o || !items.length) return null;
  const priced = priceOrder({ items }, customer, catalog), t = totals(priced.items, !!customer.recargoEquivalencia);
  return { buf: pdfPedido({
    ...datosPdfComunes(), cliente: customer.name ?? "", telefonoCliente: customer.phone ?? "", ref: "Pedido " + doc, fecha: o.date, entrega: null, direccion: customer.address, conRe: !!customer.recargoEquivalencia, totales: t,
    nota: "Importes con los precios de hoy: este pedido es anterior y no guarda los precios de ese día, así que son orientativos.",
    lineas: priced.items.map((i) => lineaPdf({ ...i, unit: "ud" })),
  }), nombre: `pedido-${doc.replace(/[^\w.-]/g, "")}.pdf` };
}
const page = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url));
// El cliente con su historial de a3ERP MÁS lo que ha pedido por la aplicación o el chat (para «histórico» y «último pedido»)
const clienteConPedidos = (id, max = HISTORIAL_MAX) => withOwnOrders(customerDirectory.getById(id), getDb().ordersOf(id, max), max);
const sinDocumento = (d) => !String(d ?? "").trim() || /^(undefined|null)$/i.test(String(d).trim()); // pedido de a3ERP sin número de documento: no hay PDF que enseñar
const lunesDe = (day) => addDays(day, -((weekday(day) + 6) % 7)); // lunes de esa semana
// Parecidos a un artículo retirado: mismas categoría y subcategoría y alguna palabra del nombre en común (hasta 3, solo del catálogo actual)
const stopP = new Set(["con", "sin", "del", "las", "los", "una", "uno", "para", "caja", "pack", "lata", "botella", "uds", "und", "de", "la", "el", "en"]);
const palabrasP = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stopP.has(w));
function parecidosA(nombre, cs, catalogo) {
  const w = new Set(palabrasP(nombre)); if (!w.size) return [];
  return catalogo.filter((x) => { const c = categorizar(x); return c.cat === cs.cat && c.sub === cs.sub && palabrasP(x.name).some((t) => w.has(t)); })
    .map((x) => ({ x, n: palabrasP(x.name).filter((t) => w.has(t)).length })).sort((a, b) => b.n - a.n).slice(0, 3).map(({ x }) => ({ id: String(x.id), nombre: x.name }));
}
// Pedidos de este cliente (y este teléfono) que todavía se pueden cambiar: para avisarle y dejarle AÑADIR en vez de duplicar
function abiertosDe(account) {
  const hoy = madridDay(), out = [];
  for (const o of getDb().recentOrders(account.customerId, 10)) {
    if (String(o.phone) !== String(account.phone) || !o.delivery_date || o.delivery_date < hoy) continue;
    const pe = puedeEditarPedido(o); if (!pe.ok) continue;
    out.push({ ref: o.ref, entrega: o.delivery_date, entregaTexto: longDate(o.delivery_date), hasta: pe.texto });
  }
  return out;
}
// Artículos que este cliente compró y ya no están en el catálogo (retirados o bloqueados): para ofrecerle uno parecido al repetir un pedido
function retiradosDe(customer) {
  const activos = new Set(catalogNow().map((p) => String(p.id))), out = {};
  try {
    const cdb = getDatabases().catalogDb;
    for (const o of customer.orders ?? []) for (const l of o.lines ?? []) {
      const id = String(l.productId); if (activos.has(id) || out[id] !== undefined || Object.keys(out).length >= 40) continue;
      const r = cdb.get(id); out[id] = r?.name ? { name: r.name, ...(({ cat, sub }) => ({ cat, sub }))(categorizar(r)) } : null;
    }
  } catch { /* sin catálogo de consulta: no se ofrecen parecidos */ }
  return out;
}
// Avisos al móvil (Web Push) de los clientes que los han activado. Nunca bloquean ni hacen fallar un pedido.
let _avisos = null, _origenAt = 0;
const avisosPush = () => (_avisos ??= crearAvisos({ accountsDb: getAccountsDb() }));
if (clientEnabled) avisosPush(); // crea ya los avisos: así deja guardado el contacto (PUBLIC_URL) para que también lo use la aplicación de la empresa
function avisoPedido(account, guardado, modificado = false) {
  if (!guardado?.ref) return;
  const pe = puedeEditarPedido(guardado);
  void avisosPush().aCliente(account.customerId, {
    title: modificado ? "Pedido modificado" : "Pedido recibido",
    body: `${modificado ? "Hemos cambiado" : "Hemos recibido"} tu pedido ${guardado.ref}.${pe.ok ? " Puedes modificarlo desde «Mi cuenta» hasta la hora límite." : ""}`,
    url: "/cliente", tag: "pedido-" + guardado.ref,
  });
}
// Fotos de producto: ficheros «<código>.png|jpg|webp» en la carpeta IMG_DIR (por defecto «imagenes»). Se listan al arrancar y cada 5 minutos.
const IMG_DIR = process.env.IMG_DIR ?? fileURLToPath(new URL("./imagenes/", import.meta.url));
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
let imgIndex = new Map(), imgAt = 0, imgIa = new Set(); // imgIa: códigos cuya foto está generada con IA (fotos-ia.json en la carpeta de fotos)
function imgs() {
  if (Date.now() - imgAt > 300_000) {
    imgAt = Date.now();
    try { imgIndex = new Map(fs.readdirSync(IMG_DIR).map((f) => /^([\w.-]{1,40})\.(png|jpe?g|webp)$/i.exec(f)).filter(Boolean).map((m) => [m[1], m[0]])); } catch { imgIndex = new Map(); }
    try { imgIa = new Set(JSON.parse(fs.readFileSync(IMG_DIR + "fotos-ia.json", "utf8")).map(String)); } catch { imgIa = new Set(); }
  }
  return imgIndex;
}
const imgUrl = (id) => (imgs().has(id) ? `/img/${encodeURIComponent(id)}` : null);
const imgEsIa = (id) => (imgs(), imgIa.has(String(id)));
const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const sendJson = (res, code, data) => enviar(res, code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(data));

// «Tu pedido de siempre» que el cliente ha editado o borrado: cambia la tarjeta del Inicio (sin fila guardada sale el último pedido, como siempre)
function aplicarSiempre(account, customer, ui) {
  if (!ui?.home) return ui;
  const u = getAccountsDb().getUsual(account.customerId);
  if (!u) return { ...ui, siempre: "auto" };
  const { last, ...resto } = ui;
  if (u.hidden) return { ...resto, siempre: "borrado" };
  const t = tarjetaSiempre(customer, u.lines, last?.fecha ?? lineasUltimoPedido(customer).fecha);
  return t ? { ...resto, last: t, siempre: "propio" } : { ...resto, siempre: "borrado" };
}
// Conversación de un cliente con sesión: el cliente sale SIEMPRE de la cuenta (nunca de lo que envíe el navegador)
async function accountChat(account, text, msgId, carrito = null) {
  const customer = clienteConPedidos(account.customerId);
  if (!customer) throw new Error("La cuenta no tiene cliente asociado");
  await refreshCatalog();
  const entry = chatSessions.get(account.id);
  let cur = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : newSession(customer, "/catalogo", { phone: account.phone, holdUnverified: false, showHabitual: true });
  cur = { ...cur, customer }; // datos al día (precios especiales, historial)
  const out = handleMessage(cur, text, { carritoExterno: itemsDeCarrito(carrito) });
  chatSessions.set(account.id, { session: out.session, last: Date.now() });
  if (out.order && account.soloVer) { out.order = null; out.reply = SOLO_VER_TEXTO; } // enlace de «solo ver»: nada se envía
  if (out.order) {
    const key = `chat:${account.id}:${msgId ?? crypto.randomUUID()}`; // el mismo mensaje reenviado no duplica el pedido
    const { order: guardado } = await createOrder(priceOrder({ at: new Date().toISOString(), phone: account.phone, key, ...holdIfUnconfirmed(account, out.order) }, customer, catalogNow()));
    out.reply = conReferencia(out.reply, guardado?.ref);
  }
  return out;
}

// Cuenta de alta automática aún sin confirmar por la empresa: puede pedir, pero sus pedidos se retienen hasta que alguien los revise
const holdIfUnconfirmed = (account, order) => (/^P\d{5}$/.test(String(account.customerId)) ? { ...order, review: true, reason: "Cliente nuevo con código provisional: ponle su código de a3ERP antes de exportar" } : account.verified ? order : { ...order, review: true, reason: "Cuenta de alta automática sin confirmar: comprueba que es el cliente antes de exportar" });
const isJson = (req) => /^application\/json/i.test(req.headers["content-type"] ?? "");

async function appRoutes(req, res, url) {
  const p = url.pathname;
  // Instalar la web como app (PWA): manifiesto, iconos y service worker (públicos: no llevan datos)
  const PWA = { "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"], "/icono-192.png": ["icono-192.png", "image/png"], "/icono-512.png": ["icono-512.png", "image/png"], "/icono-maskable-192.png": ["icono-maskable-192.png", "image/png"], "/icono-maskable-512.png": ["icono-maskable-512.png", "image/png"],
    "/captura-estrecha.png": ["captura-estrecha.png", "image/png"], "/captura-ancha.png": ["captura-ancha.png", "image/png"], "/favicon.ico": ["icono-192.png", "image/png"], "/apple-touch-icon.png": ["icono-192.png", "image/png"], "/sw.js": ["sw.js", "text/javascript; charset=utf-8"] };
  if (PWA[p] && (req.method === "GET" || req.method === "HEAD")) { // archivos fijos de la app instalable: siempre se sirven; si faltara alguno, 404 (nunca un error 500)
    try { const cuerpo = fs.readFileSync(new URL(`./pwa/${PWA[p][0]}`, import.meta.url)); return void res.writeHead(200, { "Content-Type": PWA[p][1], "Cache-Control": p === "/sw.js" ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff", ...(p === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}) }).end(req.method === "HEAD" ? undefined : cuerpo); }
    catch (e) { console.error("archivo fijo no disponible:", p, e.message); return void res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado"); }
  }
  if (p.startsWith("/estatico/") && (req.method === "GET" || req.method === "HEAD")) { // CSS, JS y logo de las páginas (sin datos de nadie): la ruta lleva la huella, así que se guardan un año
    const f = estatico(p);
    if (!f) return void res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("No encontrado");
    const etag = `"${p.split("/")[2]}"`;
    if (req.headers["if-none-match"] === etag) return void res.writeHead(304, { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" }).end();
    const h = { "Content-Type": f.tipo, "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "X-Content-Type-Options": "nosniff", Vary: "Accept-Encoding" };
    let b = f.cuerpo;
    if (/^text\//.test(f.tipo) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) { f.gz ??= zlib.gzipSync(f.cuerpo, { level: 9 }); b = f.gz; h["Content-Encoding"] = "gzip"; } // se comprime una sola vez
    return void res.writeHead(200, h).end(req.method === "HEAD" ? undefined : b);
  }
  if (p === "/robots.txt") return void res.writeHead(200, { "Content-Type": "text/plain" }).end("User-agent: *\nDisallow: /\n"); // que Google no indexe nada
  if (p === "/") {
    if (!String(req.headers.accept ?? "").includes("text/html")) return void res.end("Bot activo");
    return void res.writeHead(302, { Location: clientEnabled ? "/cliente" : "/empresa" }).end();
  }
  // Aplicación de la empresa (el empresario)
  if (p === "/empresa" || p === "/distribuidor") {
    if (!adminEnabled) return void res.writeHead(404).end();
    return void enviar(res, 200, HTML, page("empresa.html"));
  }
  if (p.startsWith("/api/admin/")) {
    if (!adminEnabled) return void res.writeHead(404).end(); // la aplicación del cliente no tiene administración, ni con clave
    if (await admin(req, res, url)) return;
  }
  // Aplicación del cliente
  if (!clientEnabled) return void res.writeHead(404).end();
  if (p === "/cliente" && req.method === "GET") return void enviar(res, 200, HTML, (() => { const dl = { titular: envTexto("PRIVACY_TITULAR") || undefined, cif: envTexto("PRIVACY_CIF"), direccion: envTexto("PRIVACY_DIRECCION") || undefined, email: envTexto("PRIVACY_EMAIL") }; return empaquetar(page("cliente.html").toString().replaceAll("<div data-privacidad></div>", privacidadHtml(dl)).replaceAll("<div data-aviso-legal></div>", avisoLegalHtml(dl)), "cliente"); })());
  if (await auth.route(req, res, url)) return;

  const account = auth.sessionOf(req);
  if (account && clientEnabled && Date.now() - _origenAt > 600_000 && avisosPush().recordarOrigen(req)) _origenAt = Date.now(); // deja guardada la dirección pública desde la que entran los clientes (contacto de los avisos)

  if (p === "/api/chat" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "No has iniciado sesión." });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const text = typeof body?.text === "string" ? body.text.slice(0, 1000) : "";
    const msgId = typeof body?.id === "string" && /^[\w-]{8,64}$/.test(body.id) ? body.id : undefined;
    const out = await accountChat(account, text, msgId, body?.carrito);
    return void sendJson(res, 200, { reply: out.reply, ui: out.ui ? aplicarSiempre(account, clienteConPedidos(account.customerId), out.ui) : null, handoff: !!out.handoff, cards: out.cards ?? null, short: out.short ?? null });
  }

  // Catálogo de pedido (la mini-aplicación) del cliente con sesión
  if (p === "/catalogo" && req.method === "GET") {
    if (!account) return void res.writeHead(302, { Location: "/cliente" }).end();
    return void enviar(res, 200, HTML, empaquetar(page("pedido.html").toString(), "pedido"));
  }
  // Direcciones de entrega guardadas (solo las suyas; máximo 5)
  if (p === "/api/direcciones" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, { direcciones: getAccountsDb().addresses(account.customerId) });
  }
  if (p === "/api/direcciones" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const r = body?.quitar != null ? { ok: getAccountsDb().removeAddress(account.customerId, body.quitar), error: "No encontramos esa dirección." } : getAccountsDb().addAddress(account.customerId, body?.texto);
    return void sendJson(res, r.ok ? 200 : 400, r.ok ? { ok: true, direcciones: getAccountsDb().addresses(account.customerId) } : { error: r.error });
  }
  // PDF de SU pedido (solo los hechos en la aplicación; un pedido de otro cliente responde igual que uno que no existe)
  const mPdf = /^\/api\/pedido\/(VM-\d{4}-\d{6})\/pdf$/.exec(p);
  const enviaPdf = (r) => res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `${url.searchParams.has("descargar") ? "attachment" : "inline"}; filename="${r.nombre}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": r.buf.length }).end(r.buf);
  if (mPdf && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const r = pdfDePedidoApp(account, mPdf[1]); if (!r) return void sendJson(res, 404, { error: "No encontramos ese pedido." });
    return void enviaPdf(r);
  }
  // PDF de un pedido del historial que viene de a3ERP (sin precios guardados): importes con los precios de hoy, avisado en el propio PDF
  const mHist = /^\/api\/historial\/([\w.-]{1,40})\/pdf$/.exec(p);
  if (mHist && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const r = pdfDeHistorial(account, mHist[1]); if (!r) return void sendJson(res, 404, { error: "No encontramos ese pedido." });
    return void enviaPdf(r);
  }
  // «Descargar todo el mes»: un ZIP con los PDF de SUS pedidos de ese mes (solo los que tienen PDF; sin PDF no hay ZIP)
  const mMes = /^\/api\/documentos\/mes\/(\d{4}-\d{2})$/.exec(p);
  if (mMes && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const mes = mMes[1], visibles = webHistory(clienteConPedidos(account.customerId, HISTORIAL_VER_MAS), catalogNow(), HISTORIAL_VER_MAS).filter((o) => String(o.date).slice(0, 7) === mes);
    const archivos = {};
    for (const o of visibles) { const r = /^VM-\d{4}-\d{6}$/.test(o.doc) ? pdfDePedidoApp(account, o.doc) : pdfDeHistorial(account, String(o.doc)); if (r) archivos[`${o.date}-${r.nombre}`] = r.buf; }
    if (!Object.keys(archivos).length) return void sendJson(res, 404, { error: "No hay documentos de ese mes." });
    const z = zipNode(archivos);
    return void res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="pedidos-${mes}.zip"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": z.length }).end(z);
  }
  if (p === "/api/ayuda" && req.method === "GET") return void sendJson(res, 200, { ayuda: ayudaPublica() }); // datos públicos de contacto de la empresa
  // Datos de la pantalla de Inicio del cliente: lo que suele pedir, lo más pedido, categorías y fotos de su último pedido (todo de su catálogo; nada de otros clientes)
  if (p === "/api/inicio" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    await refreshCatalog(); // ve ya las ofertas y los precios que la empresa acaba de cambiar
    const customer = clienteConPedidos(account.customerId);
    const todos = webProducts(customer, catalogNow(), habitualProducts, imgUrl, imgEsIa), arbolInicio = webTree(catalogNow());
    const corto = (x) => ({ id: x.id, name: x.name, price: x.price, ...(x.img ? { img: x.img } : {}), ...(x.unitsPerBox ? { unitsPerBox: x.unitsPerBox } : {}), ...(x.soloCaja ? { soloCaja: true } : {}) });
    const ids = String(url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8);
    const porId = new Map(todos.map((x) => [x.id, x]));
    const habituales = todos.filter((x) => x.count > 0).slice(0, 10).map((x) => ({ ...corto(x), ...(x.lastQty > 0 ? { ultima: x.lastQty } : {}) })); // «La última vez»: unidades
    const ofertas = todos.filter((x) => x.oferta).slice(0, 10).map((x) => ({ ...corto(x), oferta: { tipo: x.oferta.tipo, valor: x.oferta.valor, ...(x.oferta.hasta ? { hasta: x.oferta.hasta } : {}) } })); // solo las que de verdad le cambian el precio a ESTE cliente
    const lo_mas = habituales.length ? [] : topIds().map((id) => porId.get(String(id))).filter(Boolean).slice(0, 8).map(corto);
    return void sendJson(res, 200, {
      habituales, ofertas, loMasPedido: lo_mas, tieneHistorial: todos.some((x) => x.count > 0),
      fotos: Object.fromEntries(ids.map((id) => [id, porId.get(id)?.img ?? null])),
      categorias: arbolInicio.map((c) => ({ id: c.id, nombre: c.nombre })), accesos: accesosDe(arbolInicio),
      ayuda: ayudaPublica(),
    });
  }
  if (p === "/catalogo/plazo" && req.method === "GET") { // hasta cuándo podrá cambiar un pedido hecho ahora para ese día (para el calendario de «Otro día»)
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const d = String(url.searchParams.get("dia") ?? ""), pz = /^\d{4}-\d{2}-\d{2}$/.test(d) ? plazoModificacion(d) : null;
    return void sendJson(res, 200, pz ? { texto: pz.texto.replace(/^Puedes modificarlo/, "Podrás modificarlo"), corto: pz.corto } : { texto: "", corto: "" });
  }
  if (p === "/catalogo/aviso" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, avisoEntrega(clienteConPedidos(account.customerId)));
  }
  if (p === "/catalogo/datos" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    await refreshCatalog(); // el cliente ve ya los precios y las ofertas que la empresa acaba de cambiar
    const customer = clienteConPedidos(account.customerId), arbol = webTree(catalogNow());
    return void sendJsonEtag(req, res, {
      business: BUSINESS.name,
      priceNote: BUSINESS.priceNote,
      condiciones: condicionesPedido(),
      soloVer: !!account.soloVer, // enlace de «solo ver»: la página no deja enviar y el servidor tampoco
      customer: { name: customer.name, address: customer.address, codigo: String(customer.id ?? ""), re: !!customer.recargoEquivalencia },
      used: false,
      favs: getAccountsDb().favorites(account.customerId),
      products: webProducts(customer, catalogNow(), habitualProducts, imgUrl, imgEsIa),
      history: webHistory(customer, catalogNow()),
      tree: arbol, accesos: accesosDe(arbol),
      top: topIds(),
      retirados: retiradosDe(customer),
      abiertos: abiertosDe(account),
      ...avisoEntrega(customer),
    });
  }
  if (p.startsWith("/img/") && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const file = imgs().get(decodeURIComponent(p.slice(5)));
    if (!file) return void sendJson(res, 404, { error: "Sin foto" });
    return void res.writeHead(200, { "Content-Type": IMG_TYPES[file.split(".").pop().toLowerCase()], "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" }).end(fs.readFileSync(IMG_DIR + file));
  }
  if (p === "/catalogo/favorito" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const id = String(body?.id ?? "");
    if (!catalogNow().some((x) => String(x.id) === id)) return void sendJson(res, 400, { error: "Producto no válido" });
    if (!getAccountsDb().setFavorite(account.customerId, id, body?.on !== false)) return void sendJson(res, 400, { error: "Has llegado al máximo de favoritos (300)" });
    return void sendJson(res, 200, { ok: true, favs: getAccountsDb().favorites(account.customerId) });
  }
  // ── Pedido fijo semanal (F-16): se guarda la plantilla; nunca se envía solo ──
  // ── «Tu pedido de siempre» (portada): ver las líneas, editarlas, borrarlo o volver al último pedido. Nunca se envía solo. ──
  if (p === "/api/pedido-de-siempre" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const customer = clienteConPedidos(account.customerId), u = getAccountsDb().getUsual(account.customerId);
    const nombres = new Map(catalogNow().map((x) => [String(x.id), x]));
    const lineas = u && !u.hidden
      ? u.lines.map((l) => { const pr = nombres.get(l.id); return pr && { id: l.id, nombre: pr.name, qty: l.qty, unit: l.unit, upb: Number.isInteger(pr.unitsPerBox) && pr.unitsPerBox > 1 ? pr.unitsPerBox : 1 }; }).filter(Boolean)
      : lineasUltimoPedido(customer).lineas;
    return void sendJson(res, 200, { estado: u ? (u.hidden ? "borrado" : "propio") : "auto", lineas: u?.hidden ? [] : lineas });
  }
  if (p === "/api/pedido-de-siempre" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req), cat = new Set(catalogNow().map((x) => String(x.id)));
    const ok = getAccountsDb().setUsual(account.customerId, (Array.isArray(body?.lineas) ? body.lineas : []).filter((l) => cat.has(String(l?.id))));
    return void sendJson(res, ok ? 200 : 400, ok ? { ok: true } : { error: "Deja al menos un artículo, o usa «Borrar»." });
  }
  if (p === "/api/pedido-de-siempre/borrar" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, { ok: getAccountsDb().hideUsual(account.customerId) });
  }
  if (p === "/api/pedido-de-siempre/restaurar" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    getAccountsDb().resetUsual(account.customerId); return void sendJson(res, 200, { ok: true });
  }
  if (p === "/api/pedido-fijo" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const f = getAccountsDb().getStanding(account.customerId);
    const hoy = madridDay(), dow = weekday(hoy), cat = new Map(catalogNow().map((x) => [String(x.id), x]));
    const lineas = (f?.lines ?? []).map((l) => { const pr = cat.get(l.id); if (!pr) return null; const k = Number.isInteger(pr.unitsPerBox) && pr.unitsPerBox > 1 ? pr.unitsPerBox : 1; return { ...l, nombre: pr.name, uds: l.unit === "caja" ? l.qty * k : l.qty }; }).filter(Boolean);
    const yaPidio = getDb().recentOrders(account.customerId, 5).some((o) => madridDay(o.created_at) === hoy);
    const saltada = !!f && f.skipWeek === lunesDe(hoy);
    const retirados = []; // artículos del fijo que ya no están, con parecidos: se avisa ANTES de abrirlo
    if (f) for (const l of f.lines) { if (cat.has(l.id) || retirados.length >= 6) continue; try { const r = getDatabases().catalogDb.get(l.id); if (r?.name) retirados.push({ id: l.id, nombre: r.name, parecidos: parecidosA(r.name, categorizar(r), catalogNow()) }); } catch {} }
    return void sendJson(res, 200, { fijo: f && { dias: f.days, pausado: f.paused, saltada, lineas, faltan: f.lines.length - lineas.length, retirados }, hoy: { dia: dow, nombre: DIAS_ES[dow], toca: !!f && !f.paused && !saltada && f.days.includes(dow) && lineas.length > 0, yaPidio } });
  }
  if (p === "/api/pedido-fijo" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req), cat = new Set(catalogNow().map((x) => String(x.id)));
    const ok = getAccountsDb().setStanding(account.customerId, { lines: (body?.lineas ?? []).filter((l) => cat.has(String(l?.id))), days: body?.dias });
    return void sendJson(res, ok ? 200 : 400, ok ? { ok: true } : { error: "Elige al menos un artículo y un día de reparto." });
  }
  if (p === "/api/pedido-fijo/saltar" && req.method === "POST") { // «Saltar esta semana»: no se pide hoy ni el resto de la semana; el pedido fijo sigue guardado
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    return void sendJson(res, 200, { ok: getAccountsDb().skipStanding(account.customerId, body?.saltar === false ? null : lunesDe(madridDay())) });
  }
  if (p === "/api/pedido-fijo/pausa" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const body = await readJson(req);
    return void sendJson(res, 200, { ok: getAccountsDb().pauseStanding(account.customerId, body?.pausado !== false) });
  }
  if (p === "/api/pedido-fijo/borrar" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, { ok: getAccountsDb().deleteStanding(account.customerId) });
  }
  if (p === "/api/mis-pedidos" && req.method === "GET") { // «Mis pedidos»: los últimos y si todavía se pueden modificar (hasta la hora límite y mientras no se exporten)
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const lista = getDb().recentOrders(account.customerId, 6).map((o) => {
      const pe = puedeEditarPedido(o);
      return { ref: o.ref, fecha: o.created_at, entrega: o.delivery_date ?? null, total: o.total, lineas: o.items.length, resumen: o.items.slice(0, 3).map((i) => `${i.qty} ${i.name}`).join(" · "), modificado: o.modified_at ?? null, editable: pe.ok, hasta: pe.ok ? pe.texto : "" };
    });
    return void sendJson(res, 200, { pedidos: lista, ayuda: ayudaPublica() });
  }
  if (p === "/api/mi-cuenta" && req.method === "GET") { // «Mi cuenta»: SUS datos y SUS últimos pedidos (los de a3ERP y los hechos aquí), con las líneas para repetirlos o añadirlos al carrito
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const c = customerDirectory.getById(account.customerId);
    if (!c) return void sendJson(res, 404, { error: "No encontramos tu ficha." });
    const mas = url.searchParams.get("mas") === "1", max = mas ? HISTORIAL_VER_MAS : HISTORIAL_MAX; // «Ver más»: hasta 30 pedidos (por defecto, los 10 últimos)
    const todosH = webHistory(clienteConPedidos(account.customerId, HISTORIAL_VER_MAS), catalogNow(), HISTORIAL_VER_MAS), hist = todosH.slice(0, max);
    const pedidos = hist.map((o) => {
      const propio = /^VM-\d{4}-\d{6}$/.test(o.doc) ? getDb().getOrderByRef(o.doc) : null; // un pedido hecho en la aplicación: se puede saber si aún se modifica
      const pe = propio && propio.customer_id === String(account.customerId) ? puedeEditarPedido(propio) : null;
      const hoyD = madridDay(), ent = propio?.delivery_date ?? null;
      // Estado en 4 pasos (1 Recibido · 2 En preparación · 3 En reparto · 4 Entregado), deducido de la exportación y del día de entrega: no hay seguimiento real del reparto
      const paso = !propio || (ent && ent < hoyD) ? 4 : ent && ent === hoyD ? (propio.export_status === "exported" ? 3 : 2) : propio.export_status === "exported" ? 2 : 1;
      let total = null, orientativo = false;
      if (propio) { const t = propio.items?.length ? totals(propio.items, !!propio.re).total : null; total = Number.isFinite(t) && t > 0 ? t : (Number.isFinite(Number(propio.total)) ? Number(propio.total) : null); }
      else { const cust = clienteConPedidos(account.customerId); const pr = priceOrder({ items: o.lines.map((l) => ({ id: l.id, qty: l.qty, unit: "ud" })) }, cust, catalogNow()); total = totals(pr.items, !!cust?.recargoEquivalencia).total; orientativo = true; }
      return {
        total, totalOrientativo: orientativo, paso, proximo: !!propio && !!ent && ent >= hoyD, entregaTexto: ent ? longDate(ent) : "",
        doc: sinDocumento(o.doc) ? "" : o.doc, pdf: !sinDocumento(o.doc), fecha: o.date, entrega: ent, origen: propio ? "app" : "a3erp",
        estado: !propio ? "Entregado" : propio.export_status === "exported" ? "En preparación" : pe?.ok ? "Recibido · puedes modificarlo" : "Recibido",
        editable: !!pe?.ok, hasta: pe?.ok ? pe.texto : "", modificado: propio?.modified_at ?? null,
        lineas: o.lines.map((l) => { // «1 caja (6 uds)» igual que en el PDF; sin dato de caja (pedidos de a3ERP), unidades
          const g = propio?.items?.find((x) => String(x.product_id ?? x.id) === String(l.id)), cajas = g && g.unit === "caja" ? Number(g.boxes ?? g.qty) : 0;
          return { id: l.id, nombre: l.name, uds: l.qty, cant: cajas ? `${cajas} ${cajas === 1 ? "caja" : "cajas"} (${l.qty} uds)` : `${l.qty} ${l.qty === 1 ? "ud" : "uds"}` };
        }),
      };
    });
    return void sendJson(res, 200, {
      cliente: { nombre: c.name, razonSocial: c.legalName && c.legalName !== c.name ? c.legalName : "", direccion: c.address, poblacion: c.city, telefono: account.phone ?? "", correo: account.email ?? "" },
      pedidos, hayMas: !mas && todosH.length > HISTORIAL_MAX, ayuda: ayudaPublica(),
    });
  }
  if (p === "/api/bienvenida" && req.method === "GET") { // tarjeta de bienvenida: solo la primera vez (hasta que pulse «Entendido»), y no a quien ya ha hecho pedidos con la aplicación
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const yaPidio = getDb().ordersOf(account.customerId, 1).length > 0;
    return void sendJson(res, 200, { mostrar: !getAccountsDb().bienvenidaVista(account.customerId) && !yaPidio });
  }
  if (p === "/api/bienvenida/vista" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, { ok: getAccountsDb().bienvenidaMarcar(account.customerId) });
  }
  // Registro de errores de la app: el navegador avisa de lo que falla. Responde siempre rápido y sin cuerpo; si el aviso no vale, se ignora (nunca estorba a la app).
  if (p === "/api/log-error" && req.method === "POST") {
    if (Number(req.headers["content-length"] ?? 0) > 4096) { req.resume(); return void res.writeHead(413).end(); }
    try {
      const e = limpiaError(await readJson(req)), cid = account ? String(account.customerId) : null;
      if (e && (cid ? errLimitCliente(cid) : errLimitIp(req.socket.remoteAddress ?? "?"))) getAccountsDb().errorRegistrar(e, { customerId: cid, navegador: navegadorCorto(req.headers["user-agent"]) });
    } catch { /* un fallo al apuntar un fallo no se cuenta a nadie */ }
    return void res.writeHead(204).end();
  }
  if (p === "/api/avisos/corte" && req.method === "GET") { // «Avisarme antes de la hora límite»
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const m = horaAviso(process.env.AVISO_CORTE_HORA);
    return void sendJson(res, 200, { activo: getAccountsDb().corteActivo(account.customerId), hora: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, tieneFijo: !!getAccountsDb().getStanding(account.customerId) });
  }
  if (p === "/api/avisos/corte" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req); getAccountsDb().corteSet(account.customerId, body?.activo !== false);
    return void sendJson(res, 200, { ok: true, activo: body?.activo !== false });
  }
  if (p === "/api/push/clave" && req.method === "GET") { // clave pública para que el móvil pueda activar los avisos
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, { publica: avisosPush().publica() });
  }
  if (p === "/api/push/suscribir" && req.method === "POST") { // el cliente activa los avisos en ESTE móvil
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const sub = (await readJson(req))?.subscription;
    if (!sub || !endpointValido(sub.endpoint) || !clavesValidas(sub.keys)) return void sendJson(res, 400, { error: "Este móvil no permite recibir avisos." });
    getAccountsDb().pushSave(account.customerId, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    void avisosPush().aCliente(account.customerId, { title: "Avisos activados", body: "Te avisaremos aquí cuando recibamos tus pedidos.", url: "/cliente", tag: "avisos-activados" });
    return void sendJson(res, 200, { ok: true });
  }
  if (p === "/api/push/baja" && req.method === "POST") { // desactiva los avisos de este móvil (solo si son de este cliente)
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const endpoint = String((await readJson(req))?.endpoint ?? "");
    const mio = getAccountsDb().pushOf(account.customerId).some((x) => x.endpoint === endpoint);
    if (mio) getAccountsDb().pushRemove(endpoint);
    return void sendJson(res, 200, { ok: true });
  }
  if (p === "/catalogo/pedido" && req.method === "GET") { // contenido de un pedido modificable, para volver a abrirlo en el catálogo
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const o = getDb().getOrderByRef(url.searchParams.get("ref") ?? "");
    if (!o || o.customer_id !== String(account.customerId) || String(o.phone) !== String(account.phone)) return void sendJson(res, 404, { error: "No encontramos ese pedido." });
    const pe = puedeEditarPedido(o);
    if (!pe.ok) return void sendJson(res, 409, { error: "Ya no se puede modificar este pedido. Llámanos y lo cambiamos.", ayuda: ayudaPublica() });
    return void sendJson(res, 200, { ref: o.ref, hasta: pe.texto, entrega: o.delivery_date ?? null, nota: (o.note ?? "").replace(/^ENTREGA EN [^:]*: [^·]*(?: · )?/, ""), direccion: /^ENTREGA EN /.test(o.note ?? "") ? o.address : "", lineas: o.items.map((i) => ({ id: String(i.id), qty: i.qty, unit: i.unit, note: i.note ?? "" })) });
  }
  if (p === "/catalogo" && req.method === "POST") {
    await refreshCatalog(); // el pedido se calcula con los precios y ofertas de ahora mismo
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (account.soloVer) return void sendJson(res, 403, { error: SOLO_VER_TEXTO, soloVer: true }); // enlace de «solo ver»: el servidor no deja enviar pedidos, se haga como se haga
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const key = typeof body?.key === "string" && /^[\w-]{8,64}$/.test(body.key) ? body.key : null;
    if (!key) return void sendJson(res, 400, { error: "Solicitud no válida" });
    const customer = clienteConPedidos(account.customerId);
    if (typeof body.replaces === "string" && body.replaces) { // primero se comprueba que el pedido es suyo y que todavía se puede modificar
      const viejo = getDb().getOrderByRef(body.replaces);
      if (!viejo || viejo.customer_id !== String(account.customerId) || String(viejo.phone) !== String(account.phone)) return void sendJson(res, 404, { error: "No encontramos ese pedido." });
      if (!puedeEditarPedido(viejo).ok) return void sendJson(res, 409, { error: "Ya no se puede modificar este pedido. Llámanos y lo cambiamos." });
    }
    const built = webOrderFromBody(body, customer, { key: `web:${account.id}:${key}`, phone: account.phone }, catalogNow());
    if (built.error) return void sendJson(res, 400, { error: built.error });
    const priced = priceOrder(holdIfUnconfirmed(account, built.order), customer, catalogNow());
    if (typeof body.replaces === "string" && body.replaces) { // el cliente MODIFICA un pedido ya enviado: sustituye al anterior (mismo número), nunca crea otro
      const nuevo = getDb().replaceOrder(body.replaces, priced);
      if (!nuevo) return void sendJson(res, 409, { error: "Ya no se puede modificar este pedido. Llámanos y lo cambiamos." }); // se exportó mientras tanto
      avisoPedido(account, nuevo, true);
      const pe = puedeEditarPedido(nuevo);
      return void sendJson(res, 200, { ok: true, modificado: true, ref: nuevo.ref, ...(pe.ok ? { modificable: pe.texto || "Puedes seguir modificándolo mientras no lo preparemos" } : {}), message: `✅ Pedido modificado (${nuevo.ref}). ${priced.items.length} ${priced.items.length === 1 ? "artículo" : "artículos"}, total aprox. ${priced.total.toFixed(2).replace(".", ",")} ${BUSINESS.currency.trim()}.` });
    }
    const { duplicate, order: guardado } = await createOrder(priced);
    if (duplicate) return void sendJson(res, 409, { error: "Este pedido ya se envió" }); // doble clic o dos pestañas
    avisoPedido(account, guardado);
    const pe = guardado ? puedeEditarPedido(guardado) : { ok: false };
    return void sendJson(res, 200, { ok: true, ...(guardado?.ref ? { ref: guardado.ref } : {}), ...(pe.ok ? { modificable: pe.texto || "Puedes seguir modificándolo mientras no lo preparemos" } : {}), message: `🎉 ¡Pedido recibido, ${customer.name}! ${priced.items.length} ${priced.items.length === 1 ? "artículo" : "artículos"}, total aprox. ${priced.total.toFixed(2).replace(".", ",")} ${BUSINESS.currency.trim()}.${guardado?.ref ? `\n🧾 Tu referencia: *${guardado.ref}*` : ""}\n\n${BUSINESS.payment}` });
  }
  res.writeHead(404).end();
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/" || url.pathname === "/robots.txt" || url.pathname === "/manifest.webmanifest" || url.pathname === "/sw.js" || url.pathname === "/favicon.ico" || url.pathname === "/apple-touch-icon.png" || url.pathname.startsWith("/captura-") || url.pathname.startsWith("/icono-") || url.pathname === "/cliente" || url.pathname === "/empresa" || url.pathname === "/distribuidor" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/catalogo") || url.pathname.startsWith("/estatico/") || url.pathname.startsWith("/entrar/") || url.pathname.startsWith("/img/")) {
      appRoutes(req, res, url).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (url.pathname === "/health") {
      // Para vigilar el servicio (UptimeRobot, Render…): responde 200 solo si la base de datos funciona
      try {
        return getDb().ping() ? res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ ok: true, ...estadoVersion() })) : res.writeHead(503).end('{"ok":false}');
      } catch {
        return res.writeHead(503).end('{"ok":false}');
      }
    }
    if (process.env.DEMO === "1" && url.pathname.startsWith("/demo") && demoRoutes(req, res, url) !== false) return;
    if (url.pathname.startsWith("/pedido/") && webOrderRoutes(req, res, url) !== false) return;
    if (url.pathname !== "/webhook") return res.writeHead(404).end();

    // Verificación del webhook por parte de Meta
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
      return ok ? res.end(url.searchParams.get("hub.challenge")) : res.writeHead(403).end();
    }

    if (req.method === "POST") {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 1e6) req.destroy();
        else chunks.push(c);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        if (!validSignature(raw, req.headers["x-hub-signature-256"])) return res.writeHead(401).end();
        res.writeHead(200).end(); // responder rápido a Meta
        try {
          const data = JSON.parse(raw.toString());
          for (const e of data.entry ?? [])
            for (const c of e.changes ?? [])
              for (const m of c.value?.messages ?? []) onMessage(m).catch((err) => console.error(err));
        } catch (err) {
          console.error("Payload inválido", err);
        }
      });
      return;
    }
    res.writeHead(405).end();
  })
  // HOST=127.0.0.1 hace que solo se pueda entrar desde el propio servidor (la aplicación de la empresa); sin HOST escucha en todas las interfaces
  .listen(PORT, process.env.HOST || undefined, () => {
    console.log(`Bot escuchando en http://localhost:${PORT}` + (process.env.HOST ? ` (solo ${process.env.HOST})` : ""));
    // Si la oficina actualiza los archivos y el programa se queda con el código antiguo (no se reinició), se reinicia solo: el archivo iniciar-*.bat lo vuelve a arrancar a los 10 s.
    // Se espera 8 minutos desde que se nota la diferencia para no adelantarse a las pruebas de «VM Actualizar» (si fallan, vuelve atrás y no hace falta reiniciar).
    if (process.env.DEMO !== "1" && process.env.AUTO_REINICIO !== "0" && !process.env.VM_TEST) {
      let desde = 0;
      setInterval(() => {
        const e = estadoVersion();
        if (!e.reinicioPendiente) { desde = 0; return; }
        if (!desde) { desde = Date.now(); console.log(`Hay una versión nueva en el disco (${e.enDisco}); este programa corre la ${e.version}. Si sigue así, se reinicia en 8 minutos.`); return; }
        if (Date.now() - desde >= 8 * 60e3) { console.log(`Reinicio automático para cargar la versión ${e.enDisco}.`); process.exit(0); }
      }, 60e3).unref();
    }
    // Exportación diaria a Excel (EXPORT_TIME, por defecto 21:00 hora de Madrid). En modo demo no se programa.
    // EXPORT_AUTO=0 desactiva la exportación diaria automática: la empresa exporta cuando quiere y elige qué pedidos
    if (process.env.DEMO !== "1" && adminEnabled && process.env.EXPORT_AUTO !== "0") scheduleDailyExport(getDb());
    if (process.env.DEMO !== "1") sync?.start();
    notificador?.start(); // reintenta los avisos que no salieron
    // «Hoy es tu día»: aviso al móvil antes de la hora límite a quien tenga pedido fijo (AVISO_CORTE_HORA, por defecto 8:30; AVISO_CORTE=0 lo desactiva). Nunca envía ningún pedido.
    if (process.env.DEMO !== "1" && !process.env.VM_TEST && clientEnabled && process.env.AVISO_CORTE !== "0") {
      setInterval(() => { avisarCortes({ accounts: getAccountsDb(), db: getDb(), customers: customerDirectory, avisos: avisosPush() }).catch((e) => console.error("Aviso de hora límite:", e.message)); }, 60e3).unref();
    }
    // Vigilancia: avisa por correo de problemas nuevos y manda un informe diario (VIGILANCIA=0 la desactiva)
    if (process.env.DEMO !== "1" && adminEnabled && process.env.VIGILANCIA !== "0") {
      const cfg = mailConfigFromEnv();
      if (cfg) crearVigilante({ estado: estadoDelSistema, enviar: ({ subject, text }) => sendMail(cfg.smtp, { from: cfg.from, to: cfg.to, subject, text }) }).start();
    }
    // Copia diaria de TODAS las bases (pedidos, cuentas, clientes y catálogo), aunque la exportación a Excel esté desactivada
    if (process.env.DEMO !== "1" && adminEnabled) scheduleBackups(() => ({ pedidos: getDb(), cuentas: getAccountsDb(), clientes: getDatabases().customersDb, catalogo: getDatabases().catalogDb }));
    // En Render (o similar) los datos deben estar en el disco persistente: si no, se pierden en cada despliegue
    if (process.env.RENDER && !String(process.env.DB_PATH ?? "").startsWith("/var/data")) console.error("⚠️  ATENCIÓN: DB_PATH no apunta al disco persistente (/var/data). Los datos se perderán al reiniciar o redesplegar.");
  });
