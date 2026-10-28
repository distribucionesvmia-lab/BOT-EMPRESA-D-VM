import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { handleMessage, newSession, setCatalog, getCatalog as catalogNow, habitualProducts } from "./bot.js";
import { getCatalog, getCustomerByPhone, createOrder, listCustomers } from "./erp.js";
import { makeToken, readToken } from "./links.js";
import { getDb } from "./db.js";
import { scheduleDailyExport, runExport } from "./exporter.js";
import { BUSINESS } from "./config.js";

if (process.env.DEMO === "1") {
  // La demo usa su propia base de datos y carpeta, para no mezclarse con pedidos reales
  process.env.DB_PATH ??= "demo.sqlite";
  process.env.EXPORT_DIR ??= "exportaciones-demo";
}

setCatalog(await getCatalog()); // catálogo del ERP; si no hay, se usa el de config.js

const { PORT = 3000, VERIFY_TOKEN, WHATSAPP_TOKEN, PHONE_NUMBER_ID, APP_SECRET, OWNER_PHONE } = process.env;
const API = process.env.WHATSAPP_API_URL ?? `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`; // la variable solo sirve para pruebas
const SESSION_TTL = 24 * 60 * 60 * 1000;
// Dirección pública del servidor (HTTPS) para el enlace a la mini-aplicación de pedido
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const sessions = new Map(); // teléfono -> { session, last }

const hasCredentials = () => WHATSAPP_TOKEN && PHONE_NUMBER_ID;

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
  const entry = sessions.get(from);
  let current = entry && Date.now() - entry.last < SESSION_TTL ? entry.session : null;
  if (!current) {
    let customer = null;
    try {
      customer = await getCustomerByPhone(from);
    } catch (err) {
      console.error("No se pudo consultar el ERP; se atiende como cliente nuevo:", err.message);
    }
    // Cliente conocido: enlace personal (caduca en 24 h) para abrir su catálogo de pedido
    current = newSession(customer, customer ? `${PUBLIC_URL}/pedido/${makeToken(from, customer.id)}` : null);
  }
  const out = handleMessage(current, text);
  sessions.set(from, { session: out.session, last: Date.now() });

  if (out.order) {
    // La clave hace el pedido idempotente: el mismo mensaje de confirmación nunca crea dos pedidos
    out.order = { at: new Date().toISOString(), phone: from, key: msgId ? `wa:${msgId}` : `demo:${crypto.randomUUID()}`, ...out.order };
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
    return json(res, [
      ...listCustomers().map((c) => ({ name: c.name, phone: c.phone.replace(/\D/g, "") })),
      { name: "Número desconocido (cliente nuevo)", phone: "34699000000" },
    ]);
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
    const customer = link && (await getCustomerByPhone(link.p));
    if (!customer) return json(res, { error: "Enlace no válido o caducado" }, 410);

    if (req.method === "GET") {
      const habit = new Map(habitualProducts(customer).map((p) => [p.id, p]));
      const products = catalogNow()
        .map((p) => ({ id: String(p.id), name: p.name, price: p.price, lastQty: habit.get(p.id)?.lastQty ?? null, count: habit.get(p.id)?.count ?? 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return json(res, {
        business: BUSINESS.name,
        priceNote: BUSINESS.priceNote,
        customer: { name: customer.name, address: customer.address },
        used: getDb().hasOrderKey(linkKey(link)),
        products,
      });
    }

    if (req.method === "POST" && !m[2]) {
      if (getDb().hasOrderKey(linkKey(link))) return json(res, { error: "Este pedido ya se envió" }, 409);
      const body = await readJson(req);
      const catalog = new Map(catalogNow().map((p) => [String(p.id), p]));
      const merged = new Map();
      for (const l of Array.isArray(body?.lines) ? body.lines : []) {
        const p = catalog.get(String(l?.id));
        const qty = Math.floor(Number(l?.qty));
        if (p && qty >= 1 && qty <= 999) merged.set(p.id, { id: p.id, name: p.name, price: p.price, qty: (merged.get(p.id)?.qty ?? 0) + qty });
      }
      const items = [...merged.values()];
      if (!items.length) return json(res, { error: "El pedido está vacío" }, 400);

      const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
      const order = {
        at: new Date().toISOString(),
        key: linkKey(link),
        phone: link.p,
        customerId: customer.id,
        name: customer.name,
        address: customer.address,
        text: items.map((i) => `${i.qty} ${i.name}`).join(" + ") + (note ? ` · Nota: ${note}` : ""),
        items,
        total: items.reduce((t, i) => t + i.qty * i.price, 0),
        review: false,
        note,
      };
      const { duplicate } = await createOrder(order);
      if (duplicate) return json(res, { error: "Este pedido ya se envió" }, 409); // doble clic o dos pestañas
      const message = `🎉 ¡Pedido recibido, ${customer.name}! ${items.length} artículos, total aprox. ${order.total.toFixed(2)}${BUSINESS.currency}.\n\n${BUSINESS.payment}`;
      if (process.env.DEMO !== "1") {
        await send(link.p, message);
        if (OWNER_PHONE) await send(OWNER_PHONE, `🛒 Nuevo pedido de ${customer.name} (+${link.p})\n${order.text}\nTotal: ${order.total.toFixed(2)}\n📍 ${customer.address}`);
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

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") return res.end("Bot activo");
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
    if (process.env.DEMO !== "1") scheduleDailyExport(getDb());
  });
