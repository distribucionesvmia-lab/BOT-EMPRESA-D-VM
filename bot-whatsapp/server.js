import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { handleMessage, newSession, setCatalog, setCustomerFinder, setLinkMaker, getCatalog as catalogNow, habitualProducts } from "./bot.js";
import { getCatalog, catalogVersion, getCustomerByPhone, getCustomerById, findCustomers, createOrder, getAccountsDb, customerDirectory, getDatabases } from "./erp.js";
import { makeToken, readToken } from "./links.js";
import { getDb } from "./db.js";
import { priceOrder } from "./pricing.js";
import { createAuth } from "./auth.js";
import { createAdmin } from "./admin.js";
import { webProducts, webHistory, webTree, webOrderFromBody } from "./weborder.js";
import { deliveryOptions, deliveryCalendarFrom, madridDay } from "./delivery.js";
import { scheduleDailyExport, runExport } from "./exporter.js";
import { crearSincronizacion, fileState } from "./sincronizar.js";
import { scheduleBackups } from "./backup.js";
import { sourceFromEnv } from "./drive.js";
import nodePath from "node:path";
import { BUSINESS } from "./config.js";

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
setCustomerFinder((query) => findCustomers(query));
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

// Pasa un mensaje por el bot: reconoce al cliente por su teléfono, guarda el pedido si lo hay y devuelve el resultado
async function handleIncoming(from, text, msgId = null) {
  await refreshCatalog();
  const entry = sessions.get(from);
  let current = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : null;
  if (!current) {
    let customer = null;
    try {
      customer = await getCustomerByPhone(from);
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
    await createOrder(out.order);
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

const json = (res, data, code = 200) =>
  res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(data));

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
  const m = /^\/pedido\/([\w.-]+)(\/datos)?$/.exec(url.pathname);
  if (!m) return false;
  const token = m[1];

  if (req.method === "GET" && !m[2]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return res.end(fs.readFileSync(new URL("./pedido.html", import.meta.url)));
  }

  (async () => {
    const link = readToken(token);
    const customer = link && ((link.c && (await getCustomerById(link.c))) || (await getCustomerByPhone(link.p)));
    if (!customer) return json(res, { error: "Enlace no válido o caducado" }, 410);

    if (req.method === "GET") {
      const products = webProducts(customer, catalogNow(), habitualProducts);
      return json(res, {
        business: BUSINESS.name,
        priceNote: BUSINESS.priceNote,
        customer: { name: customer.name, address: customer.address },
        used: getDb().hasOrderKey(linkKey(link)),
        products,
        history: webHistory(customer, catalogNow()),
        tree: webTree(catalogNow()),
        delivery: deliveryOptions(),
        today: madridDay(),
        minDate: deliveryCalendarFrom(),
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
      const { duplicate } = await createOrder(priced);
      if (duplicate) return json(res, { error: "Este pedido ya se envió" }, 409); // doble clic o dos pestañas
      const message = `🎉 ¡Pedido recibido, ${customer.name}! ${items.length} artículos, total aprox. ${priced.total.toFixed(2)}${BUSINESS.currency}.\n\n${BUSINESS.payment}`;
      if (process.env.DEMO !== "1") {
        await send(link.p, message);
        if (OWNER_PHONE) await send(OWNER_PHONE, `🛒 Nuevo pedido de ${customer.name} (+${link.p})\n${order.text}\nTotal: ${priced.total.toFixed(2)}\n📍 ${customer.address}`);
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
const auth = createAuth({
  accounts: getAccountsDb(),
  customers: customerDirectory,
  secure: PUBLIC_URL.startsWith("https://"),
  trustProxy: process.env.TRUST_PROXY === "1",
});
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
const admin = createAdmin({ sync, accounts: getAccountsDb(), customers: customerDirectory, orders: getDb(), adminToken: adminEnabled ? process.env.ADMIN_TOKEN : undefined }); // la aplicación del cliente ni conoce la clave
const page = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url));
const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const sendJson = (res, code, data) => res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(data));

// Conversación de un cliente con sesión: el cliente sale SIEMPRE de la cuenta (nunca de lo que envíe el navegador)
async function accountChat(account, text, msgId) {
  const customer = customerDirectory.getById(account.customerId);
  if (!customer) throw new Error("La cuenta no tiene cliente asociado");
  await refreshCatalog();
  const entry = chatSessions.get(account.id);
  let cur = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : newSession(customer, "/catalogo", { phone: account.phone, holdUnverified: false, showHabitual: true });
  cur = { ...cur, customer }; // datos al día (precios especiales, historial)
  const out = handleMessage(cur, text);
  chatSessions.set(account.id, { session: out.session, last: Date.now() });
  if (out.order) {
    const key = `chat:${account.id}:${msgId ?? crypto.randomUUID()}`; // el mismo mensaje reenviado no duplica el pedido
    await createOrder(priceOrder({ at: new Date().toISOString(), phone: account.phone, key, ...holdIfUnconfirmed(account, out.order) }, customer, catalogNow()));
  }
  return out;
}

// Cuenta de alta automática aún sin confirmar por la empresa: puede pedir, pero sus pedidos se retienen hasta que alguien los revise
const holdIfUnconfirmed = (account, order) => (account.verified ? order : { ...order, review: true, reason: "Cuenta de alta automática sin confirmar: comprueba que es el cliente antes de exportar" });
const isJson = (req) => /^application\/json/i.test(req.headers["content-type"] ?? "");

async function appRoutes(req, res, url) {
  const p = url.pathname;
  if (p === "/") {
    if (!String(req.headers.accept ?? "").includes("text/html")) return void res.end("Bot activo");
    return void res.writeHead(302, { Location: clientEnabled ? "/cliente" : "/empresa" }).end();
  }
  // Aplicación de la empresa (el empresario)
  if (p === "/empresa" || p === "/distribuidor") {
    if (!adminEnabled) return void res.writeHead(404).end();
    return void res.writeHead(200, HTML).end(page("empresa.html"));
  }
  if (p.startsWith("/api/admin/")) {
    if (!adminEnabled) return void res.writeHead(404).end(); // la aplicación del cliente no tiene administración, ni con clave
    if (await admin(req, res, url)) return;
  }
  // Aplicación del cliente
  if (!clientEnabled) return void res.writeHead(404).end();
  if (p === "/cliente" && req.method === "GET") return void res.writeHead(200, HTML).end(page("cliente.html"));
  if (await auth.route(req, res, url)) return;

  const account = auth.sessionOf(req);

  if (p === "/api/chat" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "No has iniciado sesión." });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const text = typeof body?.text === "string" ? body.text.slice(0, 1000) : "";
    const msgId = typeof body?.id === "string" && /^[\w-]{8,64}$/.test(body.id) ? body.id : undefined;
    const out = await accountChat(account, text, msgId);
    return void sendJson(res, 200, { reply: out.reply, ui: out.ui ?? null, handoff: !!out.handoff });
  }

  // Catálogo de pedido (la mini-aplicación) del cliente con sesión
  if (p === "/catalogo" && req.method === "GET") {
    if (!account) return void res.writeHead(302, { Location: "/cliente" }).end();
    return void res.writeHead(200, HTML).end(page("pedido.html"));
  }
  if (p === "/catalogo/datos" && req.method === "GET") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    const customer = customerDirectory.getById(account.customerId);
    return void sendJson(res, 200, {
      business: BUSINESS.name,
      priceNote: BUSINESS.priceNote,
      customer: { name: customer.name, address: customer.address },
      used: false,
      products: webProducts(customer, catalogNow(), habitualProducts),
      history: webHistory(customer, catalogNow()),
      tree: webTree(catalogNow()),
      delivery: deliveryOptions(),
      today: madridDay(),
      minDate: deliveryCalendarFrom(),
    });
  }
  if (p === "/catalogo" && req.method === "POST") {
    if (!account) return void sendJson(res, 401, { error: "Sesión caducada" });
    if (!isJson(req)) return void sendJson(res, 415, { error: "Formato no válido" });
    const body = await readJson(req);
    const key = typeof body?.key === "string" && /^[\w-]{8,64}$/.test(body.key) ? body.key : null;
    if (!key) return void sendJson(res, 400, { error: "Solicitud no válida" });
    const customer = customerDirectory.getById(account.customerId);
    const built = webOrderFromBody(body, customer, { key: `web:${account.id}:${key}`, phone: account.phone }, catalogNow());
    if (built.error) return void sendJson(res, 400, { error: built.error });
    const priced = priceOrder(holdIfUnconfirmed(account, built.order), customer, catalogNow());
    const { duplicate } = await createOrder(priced);
    if (duplicate) return void sendJson(res, 409, { error: "Este pedido ya se envió" }); // doble clic o dos pestañas
    return void sendJson(res, 200, { ok: true, message: `🎉 ¡Pedido recibido, ${customer.name}! ${priced.items.length} artículos, total aprox. ${priced.total.toFixed(2)}${BUSINESS.currency}.\n\n${BUSINESS.payment}` });
  }
  res.writeHead(404).end();
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/" || url.pathname === "/cliente" || url.pathname === "/empresa" || url.pathname === "/distribuidor" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/catalogo")) {
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
  .listen(PORT, () => {
    console.log(`Bot escuchando en http://localhost:${PORT}`);
    // Exportación diaria a Excel (EXPORT_TIME, por defecto 21:00 hora de Madrid). En modo demo no se programa.
    // EXPORT_AUTO=0 desactiva la exportación diaria automática: la empresa exporta cuando quiere y elige qué pedidos
    if (process.env.DEMO !== "1" && adminEnabled && process.env.EXPORT_AUTO !== "0") scheduleDailyExport(getDb());
    if (process.env.DEMO !== "1") sync?.start();
    // Copia diaria de TODAS las bases (pedidos, cuentas, clientes y catálogo), aunque la exportación a Excel esté desactivada
    if (process.env.DEMO !== "1" && adminEnabled) scheduleBackups(() => ({ pedidos: getDb(), cuentas: getAccountsDb(), clientes: getDatabases().customersDb, catalogo: getDatabases().catalogDb }));
    // En Render (o similar) los datos deben estar en el disco persistente: si no, se pierden en cada despliegue
    if (process.env.RENDER && !String(process.env.DB_PATH ?? "").startsWith("/var/data")) console.error("⚠️  ATENCIÓN: DB_PATH no apunta al disco persistente (/var/data). Los datos se perderán al reiniciar o redesplegar.");
  });
