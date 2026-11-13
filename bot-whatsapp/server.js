import http from "node:http";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { handleMessage, newSession, setCatalog, setCustomerFinder, setLinkMaker, getCatalog as catalogNow, habitualProducts } from "./bot.js";
import { getCatalog, catalogVersion, getCustomerByPhone, getCustomerById, findCustomers, createOrder, getAccountsDb, customerDirectory, getDatabases, setOrderHook } from "./erp.js";
import { makeToken, readToken } from "./links.js";
import { getDb } from "./db.js";
import { priceOrder } from "./pricing.js";
import { createAuth } from "./auth.js";
import { createAdmin } from "./admin.js";
import { crearActualizador } from "./actualizar-datos.js";
import { estadoSistema, crearVigilante } from "./monitor.js";
import { privacidadHtml } from "./privacidad.js";
import { sendMail } from "./mailer.js";
import { webProducts, webHistory, webTree, webOrderFromBody, withOwnOrders } from "./weborder.js";
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
const avisoEntrega = (customer) => ({ entregaHoy: entregaHoyDisponible(customer), delivery: deliveryOptions(undefined, { hoy: puedeHoy(customer) }), today: madridDay(), minDate: deliveryCalendarFrom(undefined, { hoy: puedeHoy(customer) }) });
import { scheduleDailyExport, runExport } from "./exporter.js";
import { crearSincronizacion, fileState } from "./sincronizar.js";
import { crearAvisos } from "./avisos.js";
import { endpointValido, clavesValidas } from "./webpush.js";
import { mailConfigFromEnv } from "./mailer.js";
import { crearNotificador } from "./notificaciones.js";
import { scheduleBackups } from "./backup.js";
import { sourceFromEnv } from "./drive.js";
import nodePath from "node:path";
import { BUSINESS, ayudaPublica } from "./config.js";
import { puedeEditarPedido, weekday } from "./delivery.js";
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
    return enviar(res, 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, fs.readFileSync(new URL("./pedido.html", import.meta.url)));
  }

  (async () => {
    const link = readToken(token);
    const customer0 = link && ((link.c && (await getCustomerById(link.c))) || (await getCustomerByPhone(link.p)));
    const customer = customer0 && withOwnOrders(customer0, getDb().ordersOf(customer0.id));
    if (!customer) return json(res, { error: "Enlace no válido o caducado" }, 410);

    if (req.method === "GET" && m[2] === "/aviso") return json(res, avisoEntrega(customer));
    if (req.method === "GET") {
      // Identificado solo por nombre (link.u): no se enseña histórico, precios especiales ni dirección de ese cliente
      const view = link.u ? { ...customer, orders: [], usual: [], frequent: [], specialPrices: {}, discounts: {}, address: "" } : customer;
      const products = webProducts(view, catalogNow(), habitualProducts, imgUrl, imgEsIa);
      return json(res, {
        business: BUSINESS.name,
        priceNote: BUSINESS.priceNote,
        customer: { name: view.name, address: view.address },
        used: getDb().hasOrderKey(linkKey(link)),
        products,
        history: webHistory(view, catalogNow()),
        tree: webTree(catalogNow()),
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
const admin = createAdmin({ sync, mail: notificador, actualizador, estado: estadoDelSistema, actualizaciones: leerActualizaciones, accounts: getAccountsDb(), customers: customerDirectory, orders: getDb(), adminToken: adminEnabled ? process.env.ADMIN_TOKEN : undefined }); // la aplicación del cliente ni conoce la clave
const page = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url));
// El cliente con su historial de a3ERP MÁS lo que ha pedido por la aplicación o el chat (para «histórico» y «último pedido»)
const clienteConPedidos = (id) => withOwnOrders(customerDirectory.getById(id), getDb().ordersOf(id));
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

// Conversación de un cliente con sesión: el cliente sale SIEMPRE de la cuenta (nunca de lo que envíe el navegador)
async function accountChat(account, text, msgId) {
  const customer = clienteConPedidos(account.customerId);
  if (!customer) throw new Error("La cuenta no tiene cliente asociado");
  await refreshCatalog();
  const entry = chatSessions.get(account.id);
  let cur = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : newSession(customer, "/catalogo", { phone: account.phone, holdUnverified: false, showHabitual: true });
  cur = { ...cur, customer }; // datos al día (precios especiales, historial)
  const out = handleMessage(cur, text);
  chatSessions.set(account.id, { session: out.session, last: Date.now() });
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
  const PWA = { "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"], "/icono-192.png": ["icono-192.png", "image/png"], "/icono-512.png": ["icono-512.png", "image/png"], "/sw.js": ["sw.js", "text/javascript; charset=utf-8"] };
  if (PWA[p] && req.method === "GET") return void res.writeHead(200, { "Content-Type": PWA[p][1], "Cache-Control": p === "/sw.js" ? "no-cache" : "public, max-age=86400", "X-Content-Type-Options": "nosniff", ...(p === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}) }).end(fs.readFileSync(new URL(`./pwa/${PWA[p][0]}`, import.meta.url)));
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
  if (p === "/cliente" && req.method === "GET") return void enviar(res, 200, HTML, (page("cliente.html").toString().replaceAll("<div data-privacidad></div>", privacidadHtml({ titular: process.env.PRIVACY_TITULAR || undefined, cif: process.env.PRIVACY_CIF || "", direccion: process.env.PRIVACY_DIRECCION || undefined, email: process.env.PRIVACY_EMAIL || "" }))));
  if (await auth.route(req, res, url)) return;

  const account = auth.sessionOf(req);
  if (account && clientEnabled && Date.now() - _origenAt > 600_000 && avisosPush().recordarOrigen(req)) _origenAt = Date.now(); // deja guardada la dirección pública desde la que entran los clientes (contacto de los avisos)

  if (p === "/api/chat" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "No has iniciado sesión." });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const text = typeof body?.text === "string" ? body.text.slice(0, 1000) : "";
    const msgId = typeof body?.id === "string" && /^[\w-]{8,64}$/.test(body.id) ? body.id : undefined;
    const out = await accountChat(account, text, msgId);
    return void sendJson(res, 200, { reply: out.reply, ui: out.ui ?? null, handoff: !!out.handoff, cards: out.cards ?? null, short: out.short ?? null });
  }

  // Catálogo de pedido (la mini-aplicación) del cliente con sesión
  if (p === "/catalogo" && req.method === "GET") {
    if (!account) return void res.writeHead(302, { Location: "/cliente" }).end();
    return void enviar(res, 200, HTML, page("pedido.html"));
  }
  if (p === "/api/ayuda" && req.method === "GET") return void sendJson(res, 200, { ayuda: ayudaPublica() }); // datos públicos de contacto de la empresa
  if (p === "/catalogo/aviso" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    return void sendJson(res, 200, avisoEntrega(clienteConPedidos(account.customerId)));
  }
  if (p === "/catalogo/datos" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const customer = clienteConPedidos(account.customerId);
    return void sendJson(res, 200, {
      business: BUSINESS.name,
      priceNote: BUSINESS.priceNote,
      customer: { name: customer.name, address: customer.address, re: !!customer.recargoEquivalencia },
      used: false,
      favs: getAccountsDb().favorites(account.customerId),
      products: webProducts(customer, catalogNow(), habitualProducts, imgUrl, imgEsIa),
      history: webHistory(customer, catalogNow()),
      tree: webTree(catalogNow()),
      top: topIds(),
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
  if (p === "/api/pedido-fijo" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const f = getAccountsDb().getStanding(account.customerId);
    const hoy = madridDay(), dow = weekday(hoy), cat = new Map(catalogNow().map((x) => [String(x.id), x]));
    const lineas = (f?.lines ?? []).map((l) => { const pr = cat.get(l.id); if (!pr) return null; const k = Number.isInteger(pr.unitsPerBox) && pr.unitsPerBox > 1 ? pr.unitsPerBox : 1; return { ...l, nombre: pr.name, uds: l.unit === "caja" ? l.qty * k : l.qty }; }).filter(Boolean);
    const yaPidio = getDb().recentOrders(account.customerId, 5).some((o) => madridDay(o.created_at) === hoy);
    return void sendJson(res, 200, { fijo: f && { dias: f.days, pausado: f.paused, lineas, faltan: f.lines.length - lineas.length }, hoy: { dia: dow, nombre: DIAS_ES[dow], toca: !!f && !f.paused && f.days.includes(dow) && lineas.length > 0, yaPidio } });
  }
  if (p === "/api/pedido-fijo" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req), cat = new Set(catalogNow().map((x) => String(x.id)));
    const ok = getAccountsDb().setStanding(account.customerId, { lines: (body?.lineas ?? []).filter((l) => cat.has(String(l?.id))), days: body?.dias });
    return void sendJson(res, ok ? 200 : 400, ok ? { ok: true } : { error: "Elige al menos un artículo y un día de reparto." });
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
    const hist = webHistory(clienteConPedidos(account.customerId), catalogNow());
    const pedidos = hist.map((o) => {
      const propio = /^VM-\d{4}-\d{6}$/.test(o.doc) ? getDb().getOrderByRef(o.doc) : null; // un pedido hecho en la aplicación: se puede saber si aún se modifica
      const pe = propio && propio.customer_id === String(account.customerId) ? puedeEditarPedido(propio) : null;
      return {
        doc: o.doc, fecha: o.date, entrega: propio?.delivery_date ?? null, origen: propio ? "app" : "a3erp",
        estado: !propio ? "Entregado" : propio.export_status === "exported" ? "En preparación" : pe?.ok ? "Recibido · puedes modificarlo" : "Recibido",
        editable: !!pe?.ok, hasta: pe?.ok ? pe.texto : "", modificado: propio?.modified_at ?? null,
        lineas: o.lines.map((l) => ({ id: l.id, nombre: l.name, uds: l.qty })),
      };
    });
    return void sendJson(res, 200, {
      cliente: { nombre: c.name, razonSocial: c.legalName && c.legalName !== c.name ? c.legalName : "", codigo: c.id, direccion: c.address, poblacion: c.city, telefono: account.phone ?? "", correo: account.email ?? "" },
      pedidos, ayuda: ayudaPublica(),
    });
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
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
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
    if (url.pathname === "/" || url.pathname === "/robots.txt" || url.pathname === "/manifest.webmanifest" || url.pathname === "/sw.js" || url.pathname.startsWith("/icono-") || url.pathname === "/cliente" || url.pathname === "/empresa" || url.pathname === "/distribuidor" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/catalogo") || url.pathname.startsWith("/img/")) {
      appRoutes(req, res, url).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (url.pathname === "/health") {
      // Para vigilar el servicio (UptimeRobot, Render…): responde 200 solo si la base de datos funciona
      try {
        return getDb().ping() ? res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}') : res.writeHead(503).end('{"ok":false}');
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
    // Exportación diaria a Excel (EXPORT_TIME, por defecto 21:00 hora de Madrid). En modo demo no se programa.
    // EXPORT_AUTO=0 desactiva la exportación diaria automática: la empresa exporta cuando quiere y elige qué pedidos
    if (process.env.DEMO !== "1" && adminEnabled && process.env.EXPORT_AUTO !== "0") scheduleDailyExport(getDb());
    if (process.env.DEMO !== "1") sync?.start();
    notificador?.start(); // reintenta los avisos que no salieron
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
