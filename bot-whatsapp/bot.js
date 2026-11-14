import { BUSINESS, PRODUCTS } from "./config.js";
import { numberWords, NUMBER_WORDS, extractDelivery, explainDelivery, deliveryRows, isYes, isNo, isDone, parseRemove, parseChangeQty, lev } from "./nlu.js";
import { isTooGeneric } from "./identify.js";
import { categorizar } from "./categorias.js";
import { deliveryAllowed, longDate, puedeHoy, entregaHoyDisponible, AVISO_HOY } from "./delivery.js";
import { priceLine, totals, soloCaja } from "./pricing.js";
import { responder as responderAsistente } from "./asistente.js";

const money = (n) => `${n.toFixed(2).replace(".", ",")} ${BUSINESS.currency}`; // «3,30 €», como en la web
const moneyP = (n) => `${Number(n).toFixed(3).replace(".", ",")} ${BUSINESS.currency}`; // precio de un artículo: SIEMPRE con 3 decimales («1,665 €»)
const udsT = (n) => `${n} ${n === 1 ? "ud" : "uds"}`; // «1 ud», «6 uds»
const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const tokenize = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

// Una línea de pedido: { id, name, price, qty, unit: "ud" | "caja", upb (unidades por caja, si se conoce), note? }
// El cliente puede pedir en unidades o en cajas; las unidades de una caja salen de la ficha del artículo (unitsPerBox).
const upbOf = (p) => (Number.isInteger(p?.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null);
// Precios especiales del cliente de la conversación en curso (se fijan en handleMessage, que es síncrona)
let PRICES = null;
let CLIENTE = null; // cliente de la conversación en curso (handleMessage es síncrono): sus precios, descuentos y recargo
const priceOf = (p) => PRICES?.[String(p.id)] ?? p.price;
const mkItem = (p, qty, unit = "ud", extra = {}) => {
  if (soloCaja(p)) { // solo se vende por cajas enteras: «2 leches» son 2 cajas; solo si dice «unidades» a las claras se pasan a cajas (hacia arriba)
    const k = upbOf(p), cajas = unit === "caja" || !extra.unitStated ? qty : Math.max(1, Math.ceil(qty / k));
    return { id: p.id, name: p.name, price: priceOf(p), qty: cajas, unit: "caja", upb: k, ...extra, soloCaja: true, unitStated: true };
  }
  return { id: p.id, name: p.name, price: priceOf(p), qty, unit, upb: upbOf(p), ...extra };
};
const unitsOf = (i) => (i.unit === "caja" ? i.qty * (i.upb ?? 1) : i.qty);
const qtyLabel = (i) =>
  i.unit === "caja" ? `${i.qty} ${i.qty === 1 ? "caja" : "cajas"}${i.upb ? ` (${i.qty * i.upb} uds)` : ""}` : `${i.qty}`;

// Catálogo: por defecto el de config.js; el servidor lo sustituye por el del ERP si lo hay
let CATALOG = PRODUCTS;
export const setCatalog = (products) => {
  if (products?.length) CATALOG = products;
};
export const getCatalog = () => CATALOG;

// Buscador de clientes por nombre y generador del enlace personal: los pone el servidor (o la demo del navegador)
let CUSTOMER_FINDER = () => [];
let LINK_MAKER = () => null;
export const setCustomerFinder = (fn) => (CUSTOMER_FINDER = fn);
export const setLinkMaker = (fn) => (LINK_MAKER = fn);
const last9 = (p) => String(p ?? "").replace(/\D/g, "").slice(-9);
const MAX_ATTEMPTS = 3;
const productTokens = new WeakMap();
const tokensOf = (p) => {
  if (!productTokens.has(p)) productTokens.set(p, tokenize(`${p.name} ${(p.aliases ?? []).join(" ")}`));
  return productTokens.get(p);
};

const WORDS = NUMBER_WORDS;
const STOP = new Set(
  ("de del la el los las y e un una uno unos unas con para por me mas otro otra tambien gracias hola buenas " +
    "quiero quisiera necesito necesitamos ponme pon dame mandame manda pedido favor ud uds unidad unidades " +
    "caja cajas lata latas botella botellas pack packs bandeja bandejas litro litros que a al en lo " +
    // frases de cortesía y verbos de pedir: «buenos días, quería pedirte…», «si puede ser», «apúntame…»
    "buenos dias tardes noches queria queremos quisieramos pedir pedirte pedirles voy puedes puedo podrias podeis traer traeme traenos enviame envia " +
    "apuntame apunta anota sirveme porfa porfavor ademas luego si ser puede ponnos ponedme x eso esto mi nuestro nuestra").split(" ")
);
const UNITS = new Set(["cl", "ml", "l", "gr", "g", "kg", "lt"]);

// ── Atajos del chat: abrir el catálogo, ver el último pedido y ver el histórico ──
const limpia = (t) => t.replace(/[.,!¡¿?]/g, " ").replace(/\s+/g, " ").trim();
const PIDE_REPETIR = /\b(repet\w*|repite|igual|mismo|como siempre|de siempre)\b/;
const OPEN_RE = /^(?:(?:hola|buenas|buenos dias|buenas tardes|por favor|porfa)\s+)*(?:(?:quiero|quisiera|queria|me gustaria|necesito|voy a|vamos a|puedo|podria|puedes|podeis|deseo|toca)\s+)*(?:(?:hacer|realizar|echar|abrir|ver|empezar|iniciar|crear|montar|preparar)\s+)?(?:(?:un|el|mi|tu|su|otro|nuevo)\s+){0,2}(?:nuevo\s+)?(?:pedido|catalogo|carta|tienda|comprar|pedir)(?:\s+nuevo)?(?:\s+(?:ahora|ya|otra vez|por favor|porfa))?$/;
const esUltimo = (t) => !/\d/.test(t) && t.length <= 48 && !PIDE_REPETIR.test(t) && (t === "ultimo" || ["ultimo pedido", "pedido anterior", "ultima compra", "ultima vez", "lo ultimo que pedi", "lo ultimo que compre"].some((p) => t.includes(p)));
const esHistorico = (t) => !/\d/.test(t) && t.length <= 52 && !PIDE_REPETIR.test(t) && ["historico", "historial", "mis pedidos", "pedidos anteriores", "pedidos pasados", "que he pedido", "lo que he pedido", "lo que pedi", "que pedi", "mis compras", "compras anteriores", "ultimos pedidos", "pedidos que he hecho", "anteriores pedidos"].some((p) => t.includes(p));
const esAbrir = (t) => OPEN_RE.test(t);
const cantidadH = (i) => (i.unit === "caja" ? `${i.qty} ${i.qty === 1 ? "caja" : "cajas"}` : udsT(i.qty));

// ¿la palabra del cliente (q) corresponde a la del producto (t)? Acepta plurales y prefijos
const wordMatch = (q, t) => q === t || (q.length >= 3 && t.startsWith(q)) || (t.length >= 4 && q.startsWith(t)) || (q.length >= 5 && t.length >= 5 && lev(q, t) <= 1); // perdona una errata: «cerbeza»

/**
 * Interpreta texto libre ("2 cajas de coca cola zero y 6 verdejo") contra el catálogo.
 * `customer` (opcional) da prioridad a lo que ya ha comprado. Marca `unsure` si hay varias opciones igual de buenas.
 */
// Palabra igual a la del producto (o en plural/singular): «agua» ↔ «aguas», «cervezas» ↔ «cerveza». Sin prefijos: «tal» no es «tallarines».
const wordExact = (q, t) => q === t || q === t + "s" || q === t + "es" || t === q + "s" || t === q + "es";

export function parseItems(rawText, customer = null, opts = {}) {
  const bought = new Set(
    (customer?.orders ?? []).flatMap((o) => o.lines.map((l) => l.productId)).concat((customer?.usual ?? []).map((u) => u.productId))
  );
  const items = new Map();
  for (const segment of numberWords(rawText).split(/\s*(?:,|;|\+|\n|\by\b|\be\b)\s*/)) {
    const words = tokenize(segment);
    let qty = 1;
    const qi = words.findIndex((w, i) => (/^\d+$/.test(w) || w in WORDS) && !UNITS.has(words[i + 1]));
    if (qi >= 0) {
      qty = WORDS[words[qi]] ?? Number(words[qi]);
      words.splice(qi, 1);
    }
    // "2 cajas de coca cola" -> cajas; "12 uds de agua" o sin indicar -> unidades
    const byBox = words.includes("caja") || words.includes("cajas");
    const byUnit = words.some((w) => ["ud", "uds", "unidad", "unidades"].includes(w));
    const unit = byBox && !byUnit ? "caja" : "ud";
    const query = words.filter((w) => !STOP.has(w));
    if (!query.length || qty < 1 || qty > 999) continue;
    // Si pide algo genérico («agua», «cervezas», «vino») y hay varios artículos que encajan, no se elige uno: se le pregunta (opts.ambiguos)
    if (opts.ambiguos) {
      const porNombre = CATALOG.filter((p) => query.every((q) => tokensOf(p).some((t) => wordExact(q, t))));
      // Una sola palabra que es el nombre de una categoría (Aguas, Vinos…): se enseña TODA la categoría, no solo los que llevan la palabra en el nombre
      const porCategoria = query.length === 1 ? CATALOG.filter((p) => tokenize(categorizar(p).catNombre).some((t) => wordExact(query[0], t))) : [];
      const todos = porCategoria.length > 1 ? porCategoria : porNombre;
      if (todos.length > 1) { opts.ambiguos.push({ query: query.join(" "), qty: qi >= 0 ? qty : null, unit, unitStated: byBox || byUnit, productos: todos }); continue; }
    }

    const scored = [];
    for (const p of CATALOG) {
      const pt = tokensOf(p);
      const matched = query.filter((q) => pt.some((t) => wordMatch(q, t))).length;
      if (matched && matched / query.length >= 0.5) scored.push({ p, matched, known: bought.has(p.id) ? 1 : 0, len: pt.length });
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.matched - a.matched || b.known - a.known || a.len - b.len);
    const best = scored[0];
    const unsure = scored.filter((s) => s.matched === best.matched && s.known === best.known).length > 1;
    const key = `${best.p.id}|${unit}`;
    const prev = items.get(key);
    items.set(key, mkItem(best.p, (prev?.qty ?? 0) + qty, unit, { unsure: unsure || prev?.unsure, unitStated: byBox || byUnit || prev?.unitStated }));
  }
  return [...items.values()];
}

const itemsFromLines = (lines) =>
  lines
    .map((l) => {
      const p = CATALOG.find((x) => x.id === l.productId);
      return p && mkItem(p, l.qty);
    })
    .filter(Boolean);

/** Importes como los verá el cliente: precio y descuento suyos, base por línea y TOTAL CON IVA (y recargo de equivalencia si lo tiene). */
function importes(items, customer = CLIENTE) {
  const lines = items.map((i) => { const p = priceLine(i, CATALOG.find((x) => String(x.id) === String(i.id)), customer); return { amount: p.amount, vat: p.vat }; });
  return { lines, ...totals(lines, !!customer?.recargoEquivalencia) };
}
const total = (items, customer) => importes(items, customer).total; // con IVA
const detalleIva = (t) => (t.iva || t.re ? `_(base ${money(t.base)} + IVA ${money(t.iva)}${t.re ? ` + R.E. ${money(t.re)}` : ""})_` : "");
const itemsText = (items) => {
  const t = importes(items);
  return items.map((i, k) => `• ${qtyLabel(i)} × ${i.name} = ${money(t.lines[k].amount)}${i.unsure ? " ⚠️" : ""}${i.note ? `\n   📝 ${i.note}` : ""}`).join("\n") +
    `\n*Total con IVA: ${money(t.total)}*${detalleIva(t) ? `\n${detalleIva(t)}` : ""}` +
    (items.some((i) => i.unsure) ? `\n⚠️ _No estoy seguro de este artículo: escribe la marca o el formato exacto._` : "");
};

const fmtDate = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const fmtDateFull = (iso) => fmtDate(iso) + "/" + iso.slice(0, 4);
const pedidosDe = (customer) => [...(customer?.orders ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));

/** Artículos que el cliente suele comprar, de más a menos habitual, con las unidades de la última vez. */
export function habitualProducts(customer) {
  const stats = new Map();
  for (const o of customer?.orders ?? []) {
    for (const l of o.lines) {
      const st = stats.get(l.productId) ?? { count: 0, lastDate: "", lastQty: l.qty };
      st.count++;
      if (o.date >= st.lastDate) Object.assign(st, { lastDate: o.date, lastQty: l.qty });
      stats.set(l.productId, st);
    }
  }
  for (const u of customer?.usual ?? []) if (!stats.has(u.productId)) stats.set(u.productId, { count: 1, lastDate: "", lastQty: u.qty });
  return [...stats]
    .map(([id, st]) => {
      const p = CATALOG.find((x) => x.id === id);
      return p && { ...p, ...st };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
}

// ---- Mensajes interactivos de WhatsApp (límites: lista 10 filas, botones 3; títulos 24 y 20 caracteres) ----
const PAGE = 9;
const buttons = (...bs) => ({ type: "buttons", buttons: bs.map(([id, title]) => ({ id, title: trunc(title, 20) })) });

function listUi(s, page = 0) {
  const habituales = habitualProducts(s.customer), vistos = new Set(habituales.map((p) => String(p.id)));
  // Primero lo que ya ha pedido y después TODO el catálogo: puede añadir cualquier producto, no solo los de su histórico
  const all = !s.customer || s.unverified ? habituales : [...habituales, ...CATALOG.filter((p) => !vistos.has(String(p.id))).sort((a, c) => a.name.localeCompare(c.name, "es"))];
  const start = page * PAGE;
  const rows = all.slice(start, start + PAGE).map((p) => ({
    id: `p:${p.id}`,
    title: trunc(p.name, 24),
    description: trunc(p.lastQty != null ? `${p.name} · última vez: ${udsT(p.lastQty)}` : `${p.name} · ${moneyP(priceOf(p))}`, 72),
  }));
  if (!rows.length) return undefined;
  if (start + PAGE < all.length) rows.push({ id: `more:${page + 1}`, title: "Ver más artículos", description: `Quedan ${all.length - start - PAGE} por ver` });
  return { type: "list", button: "Ver artículos", section: habituales.length ? "Tu histórico y catálogo" : "Catálogo", rows };
}

const GENERIC_MENU =
  `👋 ¡Hola! Bienvenido a *${BUSINESS.name}*.\n\n` +
  `✍️ *Escribe directamente lo que quieres pedir*, por ejemplo:\n` +
  `_"2 aguas y una cerveza"_\n\n` +
  `O elige:\n` +
  `1️⃣ Ver productos y precios\n` +
  `2️⃣ Horarios y envíos\n` +
  `3️⃣ Hablar con una persona\n\n` +
  `En cualquier momento: *menu* o *cancelar*.`;

const WHO_PROMPT =
  `👋 ¡Hola! Soy el asistente de *${BUSINESS.name}*.\n\n` +
  `Para atenderte, dime el *nombre de tu negocio* tal y como nos compras (por ejemplo: _Bar El Ejemplo_) o tu *código de cliente*.\n\n` +
  `Si eres cliente nuevo, escribe *nuevo*.`;

// Sus productos habituales (los que más y más recientemente compra)
const habitualBlock = (s) => {
  const top = habitualProducts(s.customer).slice(0, 6);
  return top.length
    ? `⭐ *Tu histórico de productos* (según tus últimos pedidos):\n` + top.map((p) => `• ${p.name} — última vez: ${udsT(p.lastQty)}`).join("\n") + `\n\n`
    : `Todavía no tengo pedidos tuyos anteriores.\n\n`;
};
// Tras identificar al cliente por su nombre: confirmación + sus productos habituales
const identifiedIntro = (s) =>
  s.unverified
    ? `✅ ¡Hola, *${s.customer.name}*! Como escribes desde un teléfono que no tenemos registrado, una persona del equipo revisará tu pedido antes de prepararlo.\n\n`
    : `✅ ¡Identificado! Eres *${s.customer.name}* (cód. ${s.customer.id}).\n\n${habitualBlock(s)}`;

const greeting = (s, justIdentified = false) => {
  if (!s.customer) return { reply: s.opts?.identify && s.state === "who" ? WHO_PROMPT : GENERIC_MENU };
  const saludo = `👋 ¡Hola, *${s.customer.name}*! Soy el asistente de *${BUSINESS.name}*.\n\n`;
  // opts.showHabitual: cliente con sesión iniciada: se le saluda y se le muestran sus habituales
  const hi = justIdentified ? identifiedIntro(s) : s.opts?.showHabitual ? saludo + habitualBlock(s) : saludo;
  // Con enlace personal: tarjeta de inicio (hacer pedido y lo que más pide). Sin él: lista y botones dentro del chat
  if (s.link) {
    const ult = pedidosDe(s.customer).map((o) => ({ o, items: itemsFromLines(o.lines) })).find((x) => x.items.length);
    return {
      reply:
        (justIdentified ? identifiedIntro(s).split("\n\n")[0] : `👋 ¡Hola, *${s.customer.name}*!`) +
        `\n\nHacer tu pedido es muy fácil:\n` +
        `• Pulsa *Hacer pedido* y elige tus productos del catálogo, con los precios al día.\n` +
        `• También puedes escribir lo que necesitas, por ejemplo _"6 aguas y 2 cervezas"_.\n` +
        `• Elige el día de entrega, confirma y listo.`,
      ui: {
        type: "link", title: "Hacer pedido", url: s.link, home: true,
        ...(ult ? { last: { date: fmtDateFull(ult.o.date), articulos: ult.items.length, total: Math.round(total(ult.items) * 100) / 100, conIva: true, lineas: ult.items.slice(0, 30).map((i) => `${cantidadH(i)} · ${i.name}`), mas: Math.max(0, ult.items.length - 30), repetir: hashRepetir(ult.items), fecha: ult.o.date } } : {}),
      },
    };
  }
  return {
    reply:
      hi +
      `🛒 Pulsa *Ver artículos* para elegir lo que quieres pedir (te enseño lo que sueles comprar).\n\n` +
      `También puedes escribirlo (_"6 verdejo y 2 coca cola zero"_) o pedir *productos*, *horarios* o *persona*.`,
    ui: listUi(s),
  };
};

const catalog = () => {
  const shown = CATALOG.slice(0, 25);
  return (
    `🛍️ *Productos*\n\n` +
    shown.map((p) => `• ${p.name} — ${moneyP(p.price)}`).join("\n") +
    (CATALOG.length > shown.length ? `\n… y ${CATALOG.length - shown.length} más. Escribe el nombre de lo que buscas.` : "") +
    `\n\n✍️ Escribe lo que quieres, por ejemplo: _"2 aguas y una cerveza"_`
  );
};

export const newSession = (customer = null, link = null, opts = {}) => ({
  // opts: { identify: preguntar quién es el cliente, phone, holdUnverified: retener pedidos de quien se identificó solo por nombre }
  state: !customer && opts.identify ? "who" : "menu",
  opts,
  attempts: 0, // intentos fallidos de identificación
  candidates: null, // varios clientes encajan: se pide el código para distinguirlos
  byName: false, // identificado escribiendo su nombre (no por su teléfono)
  link, // enlace personal a la mini-aplicación de pedido (lo pone el servidor)
  orderText: "",
  items: null, // líneas explícitas; si es null se interpreta orderText
  cart: [], // pedido que el cliente conocido va armando con la lista y los botones
  pick: null, // artículo elegido pendiente de cantidad
  name: customer?.name ?? "",
  address: customer?.address ?? "",
  note: "", // observaciones generales del pedido ("servir el jueves…")
  delivery: null, // día de entrega elegido (AAAA-MM-DD)
  customer,
});

const getItems = (s) => s.items ?? parseItems(s.orderText, s.customer);

const summary = (s) => {
  const items = getItems(s);
  return items.length
    ? `Lo que he entendido:\n${itemsText(items)}\n\nSi falta o sobra algo, nuestro equipo lo revisará contigo.`
    : `Lo he anotado tal cual y nuestro equipo lo revisará contigo.`;
};

const confirmReply = (s) => {
  const items = getItems(s);
  const body =
    `Revisa tu pedido:\n\n${items.length ? itemsText(items) : `_"${s.orderText.replace(/\n/g, " + ")}"_`}\n\n` +
    (BUSINESS.priceNote ? `_${BUSINESS.priceNote}_\n\n` : "") +
    (s.note ? `📝 Observaciones: ${s.note}\n` : "") +
    (s.delivery ? `📅 Entrega: *${longDate(s.delivery)}*\n` : "") +
    `👤 ${s.name}\n📍 Entrega en: ${s.address || "la dirección que tenemos de tu negocio (la confirmaremos contigo)"}\n\n`;
  return s.customer
    ? { reply: body + `Pulsa un botón, o escribe los cambios (por ejemplo _"6 verdejo y 2 coca cola zero"_) y lo rehago.\n\n_¿Alguna observación? Escribe *nota: servir el jueves*, o *nota jamón: pieza grande* para un artículo._`, ui: buttons(["c:ok", "Confirmar"], ["c:more", "Añadir productos"], ["c:cancel", "Cancelar"]) }
    : { reply: body + `1️⃣ Confirmar\n2️⃣ Cancelar` };
};

const showList = (s, page = 0, lead = "Elige un artículo:") => {
  s.state = "menu";
  return { reply: lead, session: s, ui: listUi(s, page) };
};

const showCart = (s, lead = "") => {
  s.state = "cart";
  return {
    reply: `${lead}🛒 *Tu pedido hasta ahora:*\n${itemsText(s.cart)}\n\n¿Qué quieres hacer?`,
    session: s,
    ui: buttons(["act:add", "Añadir otro"], ["act:done", "Finalizar"], ["act:clear", "Vaciar pedido"]),
  };
};

function setCart(s, items) {
  s.cart = items.map((i) => ({ ...i }));
  s.items = s.cart;
  s.orderText = s.cart.map((i) => `${i.qty} ${i.unit === "caja" ? "cajas de " : ""}${i.name}`).join(", ");
}

/**
 * El cliente escribió algo genérico («agua», «2 cervezas», «vino») y hay varios artículos que encajan: no se elige ninguno,
 * se le pregunta qué tipo quiere y se le enseñan TODOS. Si existe una categoría con ese nombre (Aguas, Vinos…) se enseña esa.
 */
function preguntarTipo(s, a, lead = "") {
  const compra = new Set((s.customer?.orders ?? []).flatMap((o) => o.lines.map((l) => String(l.productId))));
  const lista = a.productos.slice()
    .sort((x, y) => (compra.has(String(y.id)) ? 1 : 0) - (compra.has(String(x.id)) ? 1 : 0) || x.name.localeCompare(y.name, "es"));
  const cuantos = lista.length, mostrados = lista.slice(0, 80);
  s.opciones = { query: a.query, qty: a.qty, unit: a.unit, unitStated: a.unitStated, ids: mostrados.map((p) => String(p.id)) };
  s.state = "menu";
  return {
    reply: `${lead}¿Qué tipo de *${a.query}* quieres? Tenemos ${cuantos}${cuantos > mostrados.length ? ` (te enseño los primeros ${mostrados.length}; escribe el nombre para afinar)` : ""}. Elige uno de la lista:${a.qty ? `\n_Pediste ${a.qty}._` : ""}`,
    session: s,
    ui: {
      type: "list", button: trunc(`Ver ${a.query}`, 20), section: trunc(a.query, 24),
      rows: mostrados.map((p) => ({ id: `p:${p.id}`, title: trunc(p.name, 24), description: trunc(`${p.name} · ${moneyP(priceOf(p))}${upbOf(p) ? ` · caja de ${upbOf(p)}` : ""}${compra.has(String(p.id)) ? " · ya lo has pedido" : ""}`, 72) })),
    },
  };
}

/** Todo lo que no sea pedir, último pedido, histórico o repetir: se dice claro y se ofrece hacer un pedido rápido. */
function noEntiendo(s) {
  return {
    reply: "No estoy diseñado para responderte a eso. Te puedo ayudar a hacer un pedido rápido." + (s.cart.length ? `\n\nPor ahora tu pedido lleva:\n${itemsText(s.cart)}` : ""),
    session: s,
    ui: s.link ? { type: "link", title: "Hacer pedido", url: s.link } : buttons(["h:open", "Hacer pedido"]),
  };
}
/** «Hacer pedido»: se abre el catálogo (con enlace) o, sin él, la lista del chat. */
/** Enlace al catálogo con el pedido en marcha ya cargado (#c=código.unidades,…): lo que había se queda y se le suma lo nuevo. */
function catalogoConPedido(s) {
  const items = (s.state === "confirm" ? getItems(s) : s.cart) ?? [];
  const c = items.filter((i) => i.id != null && unitsOf(i) > 0).map((i) => `${encodeURIComponent(String(i.id))}.${unitsOf(i)}`).join(",");
  return c ? `${String(s.link).split("#")[0]}#c=${c}` : s.link;
}
function anadirProductos(s) {
  if (!s.link) return showList(s, 0, "🛒 Elige lo que quieres añadir (tu pedido se mantiene):");
  return { reply: "🛒 *¡Abriendo el catálogo!* Tu pedido se queda como está: añade lo que quieras y finaliza desde allí. Si no se abre solo, pulsa el botón.", session: s, ui: { type: "link", title: "Añadir productos", url: catalogoConPedido(s), open: true } };
}
function openCatalog(s, now = new Date()) {
  // Aviso de «entrega hoy»: la misma regla que la opción «Hoy» del calendario (Medina del Campo, laborable y antes de las 10:00 de Madrid)
  const aviso = s.customer && entregaHoyDisponible(s.customer, now) ? `🚚 ${AVISO_HOY}\n\n` : "";
  if (s.link) {
    return { reply: aviso + "🛒 *¡Abriendo tu catálogo!* Si no se abre solo, pulsa el botón.", session: s, ui: { type: "link", title: "Hacer pedido", url: s.link, open: true } };
  }
  return showList(s, 0, aviso + "🛒 Elige lo que quieres pedir:");
}
/** Lo que va detrás de la dirección del catálogo para abrirlo con un pedido anterior ya puesto («Repetir y revisar»). */
const hashRepetir = (items) => "c=" + items.map((i) => `${encodeURIComponent(String(i.id))}.${Math.min(999, i.unit === "caja" ? i.qty * (i.upb || 1) : i.qty)}`).join(",") + "&r=1";

// ── Asistente: preguntas en lenguaje natural y recomendaciones (ver asistente.js) ──
function asistir(s, rawText, now, ctx) {
  const habituales = new Set(habitualProducts(s.customer).map((p) => String(p.id)));
  const ultimo = pedidosDe(s.customer).map((o) => ({ o, items: itemsFromLines(o.lines) })).find((x) => x.items.length);
  const r = responderAsistente(rawText, {
    catalogo: CATALOG, cliente: s.customer, habituales, ahora: now, ultimo: !!ultimo, recomendados: s.reco ?? [],
    precioOf: priceOf, upbOf,
    fmtPrecio: (p) => `${moneyP(priceOf(p))}${upbOf(p) ? ` · caja de ${upbOf(p)} (${money(priceOf(p) * upbOf(p))})` : ""}`,
    caja: (p) => money(priceOf(p) * upbOf(p)), unidad: (p) => moneyP(priceOf(p)),
  });
  if (!r) return null;
  if (r.tipo === "pedido") return handleMessageInner(s, r.texto, ctx); // lo anota el intérprete de pedidos de siempre
  if (r.tipo === "elegir") return handleMessageInner(s, `p:${s.reco[r.indice]}`, ctx);
  s.reco = r.productos.map((p) => String(p.id));
  let ui;
  if (r.productos.length) {
    ui = { type: "multi", button: "Añadir al pedido", section: "Te recomiendo", rows: r.productos.map((p) => ({ id: `p:${p.id}`, title: trunc(p.name, 24), description: trunc(`${p.name} · ${moneyP(priceOf(p))}${upbOf(p) ? ` · caja de ${upbOf(p)}` : ""}${habituales.has(String(p.id)) ? " · ya lo has pedido" : ""}`, 72) })) };
  } else if (r.accion === "repetir" && ultimo && s.link) {
    ui = { type: "link", title: "Repetir y revisar", url: `${s.link}#${hashRepetir(ultimo.items)}`, open: false };
  } else if (r.accion) {
    ui = s.link ? { type: "link", title: "Hacer pedido", url: s.link } : buttons(["h:open", "Hacer pedido"]);
  }
  return { reply: r.reply, session: s, ...(ui ? { ui } : {}) };
}

// Tabla de un pedido para la web (cantidad · producto · importe); el texto del mensaje sigue siendo el respaldo para WhatsApp
const finito = (n) => (Number.isFinite(n) ? n : null);
function tablaPedido(titulo, items, subtitulo = "", o = null) {
  const g = o?.guardado;
  if (g?.length && g.every((l) => Number.isFinite(l.amount))) { // pedido hecho en la aplicación: se enseñan los precios e importes de ESE día, no los de hoy
    const t = totals(g.map((l) => ({ amount: l.amount, vat: l.vat })), !!o.re);
    return { titulo, subtitulo: "Precios del día del pedido", filas: g.map((l) => ({ cant: `${l.qty} ${l.qty === 1 ? "ud" : "uds"}`, nombre: l.name ?? CATALOG.find((x) => String(x.id) === l.productId)?.name ?? l.productId, importe: l.amount })), total: finito(Math.round(t.total * 100) / 100), conIva: true, ...(o?.doc ? { doc: String(o.doc) } : {}) };
  }
  const imp = importes(items);
  return { // pedido de a3ERP (sin precios guardados): importes con los precios de hoy, sin dejar nunca un hueco en blanco
    titulo, subtitulo: subtitulo || "Precios de hoy (orientativos)",
    filas: items.map((i, k) => ({ cant: cantidadH(i), nombre: i.name, importe: finito(imp.lines[k]?.amount) })),
    total: finito(Math.round(total(items) * 100) / 100), conIva: true, ...(o?.doc ? { doc: String(o.doc) } : {}),
  };
}
/** «Último pedido»: se enseña con botones para ver el histórico o hacer un pedido. */
function showLast(s) {
  const o = pedidosDe(s.customer).find((x) => itemsFromLines(x.lines).length);
  if (!o) return { reply: "Todavía no tengo pedidos tuyos anteriores. ¿Quieres hacer uno?", session: s, ui: s.link ? { type: "link", title: "Hacer pedido", url: s.link } : buttons(["h:open", "Hacer pedido"]) };
  const items = itemsFromLines(o.lines);
  return {
    reply: `🧾 *Tu último pedido* (${fmtDateFull(o.date)})\n\n` + items.map((i, k) => `• ${cantidadH(i)} · ${i.name} = ${money(importes(items).lines[k].amount)}`).join("\n") + `\n*Total con IVA: ${money(total(items))}*\n\n_Precios de hoy._`,
    short: "🧾 *Tu último pedido*",
    cards: [tablaPedido(`Pedido del ${fmtDateFull(o.date)}`, items, "", o)],
    session: s,
    ui: buttons(["h:hist", "Ver histórico"], ["h:open", "Hacer pedido"]),
  };
}
/** «Histórico»: sus últimos pedidos con lo que pidió en cada uno y lo que más compra. */
function showHistory(s) {
  const orders = pedidosDe(s.customer).map((o) => ({ o, items: itemsFromLines(o.lines) })).filter((x) => x.items.length).slice(0, 10);
  if (!orders.length) return { reply: "Todavía no tengo pedidos tuyos anteriores. ¿Quieres hacer uno?", session: s, ui: s.link ? { type: "link", title: "Hacer pedido", url: s.link } : buttons(["h:open", "Hacer pedido"]) };
  const bloque = ({ o, items }) =>
    `📦 *Pedido del ${fmtDateFull(o.date)}* — ${items.length} artículo${items.length === 1 ? "" : "s"} · ${money(total(items))}\n` +
    items.slice(0, 8).map((i) => `• ${cantidadH(i)} · ${i.name}`).join("\n") + (items.length > 8 ? `\n… y ${items.length - 8} más` : "");
  return {
    reply: `📜 *Tu histórico de pedidos*\n\n` + orders.map(bloque).join("\n\n"),
    short: "📜 *Tu histórico de pedidos*",
    cards: orders.map(({ o, items }) => tablaPedido(`Pedido del ${fmtDateFull(o.date)}`, items, "", o)),
    session: s,
    ui: buttons(["h:open", "Hacer pedido"]),
  };
}

function chooseQty(s, n) {
  const p = s.pick;
  s.pick = null;
  const prev = s.cart.find((i) => i.id === p.id);
  const rest = s.cart.filter((i) => i.id !== p.id);
  const item = mkItem(p, n, p.unit ?? "ud", prev?.note ? { note: prev.note } : {});
  if (n > 0) rest.push(item);
  s.cart = rest;
  if (!s.cart.length) return showList(s, 0, "He quitado ese artículo. Elige otro:");
  return showCart(s, n > 0 ? `✅ ${qtyLabel(item)} × ${p.name}\n\n` : "");
}

// Suma una línea al pedido en construcción (mismo artículo y misma unidad: se acumulan)
function addToCart(s, f) {
  const prev = s.cart.find((i) => i.id === f.id && i.unit === f.unit);
  if (prev) prev.qty += f.qty;
  else s.cart.push(f);
}

// El cliente escribió «2 aguas» sin decir cajas o unidades y el artículo se vende en cajas: se le pregunta
function askUnitReply(s, lead = "") {
  s.state = "unitq";
  const f = s.askUnit[0];
  const cajas = `${f.qty} ${f.qty === 1 ? "caja" : "cajas"} (${f.qty * f.upb} uds)`;
  return {
    reply: `${lead}*${f.name}*\nEscribiste ${f.qty}. Este artículo se vende en cajas de ${f.upb} unidades: ¿lo quieres en *cajas* o en *unidades*?`,
    session: s,
    ui: buttons(["ui:caja", cajas], ["ui:ud", udsT(f.qty)], ["ui:no", "No lo quiero"]),
  };
}

// Pregunta la cantidad del artículo elegido, según lo quiera en cajas o en unidades
function askQty(s) {
  const p = s.pick;
  if (p.unit === "caja") {
    return {
      reply: `*${p.name}*\n¿Cuántas *cajas* quieres? Pulsa un botón o escribe el número.`,
      ui: buttons(["q:1", "1 caja"], ["q:2", "2 cajas"], ["q:0", "No lo quiero"]),
    };
  }
  const last = p.lastQty ?? 1;
  return {
    reply: `*${p.name}*\n${moneyP(priceOf(p))} por unidad${p.lastQty ? ` · última vez: ${udsT(last)}` : ""}.\n\n¿Cuántas unidades quieres? Pulsa un botón o escribe el número.`,
    ui: buttons([`q:${last}`, `${udsT(last)} (igual)`], [`q:${last * 2}`, `${udsT(last * 2)} (doble)`], ["q:0", "No lo quiero"]),
  };
}

// ¿Se pregunta el día de entrega al confirmar? (sí; se puede desactivar en pruebas)
let ASK_DELIVERY = true;
export const setAskDelivery = (v) => (ASK_DELIVERY = !!v);

/** Pregunta «¿Cuándo quieres recibirlo?»: lista de días (hoy/mañana/próximos días de servicio) y «Otro día» para escribirlo. */
function askDelivery(s, now, lead = "") {
  s.state = "delivery";
  return {
    reply: `${lead}📅 *¿Cuándo quieres recibirlo?*\nElige un día de la lista, o escríbelo como quieras (por ejemplo _"mañana"_, _"el lunes"_ o _"20 de noviembre"_).`,
    session: s,
    ui: { type: "list", button: "Elegir día", section: "Día de entrega", rows: deliveryRows(now, { hoy: puedeHoy(s.customer) }) },
  };
}

/**
 * Saca el día de entrega de una frase («…para el lunes»). Si se puede servir lo apunta en s.delivery ({ set }); si no, devuelve el aviso
 * ({ notice }). Devuelve siempre el resto de la frase, ya sin la fecha, para interpretar los artículos.
 */
function takeDate(s, rawText, now) {
  const e = extractDelivery(rawText, now, { hoy: puedeHoy(s.customer) });
  if (!e) return { rest: rawText };
  if (e.ambiguous) return { rest: e.rest, notice: '📅 ¿Qué *día* de la semana que viene lo quieres? Por ejemplo _"el martes"_ o _"el 10 de noviembre"_.' };
  const why = explainDelivery(e.date, now, { hoy: puedeHoy(s.customer) });
  if (why) return { rest: e.rest, notice: `📅 ${why}` };
  s.delivery = e.date;
  return { rest: e.rest, set: true };
}

// Artículos del pedido que encajan con unas palabras («las cervezas», «el agua»)
const findLines = (lines, query) => {
  const q = tokenize(query).filter((w) => !STOP.has(w));
  return lines.filter((i) => q.length && q.every((w) => tokensOf(i).some((t) => wordMatch(w, t))));
};

const NEW_CUSTOMER_NOTE =
  "👋 ¡Bienvenido! Como eres cliente nuevo, avisamos a una persona del equipo para darte de alta. Mientras tanto puedes ver productos y dejar tu pedido: lo revisaremos antes de prepararlo.";

const HUMAN_REPLY =
  "👤 Avisamos a una persona del equipo, te responderá en cuanto pueda. Mientras tanto, escribe *menu* si necesitas algo más.";

/**
 * Procesa un mensaje del cliente (texto, o el id de la fila/botón que ha pulsado).
 * Devuelve { reply, ui?, session, order?, handoff? } sin tocar la red ni el disco.
 */
export function handleMessage(session, rawText, ctx = {}) {
  PRICES = session?.customer?.specialPrices ?? null;
  CLIENTE = session?.customer ?? null;
  try {
    return handleMessageInner(session, rawText, ctx);
  } finally {
    PRICES = null;
    CLIENTE = null;
  }
}

function handleMessageInner(session, rawText, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString(); // el reloj se puede fijar en las pruebas
  const text = norm(rawText || "");
  const s = { ...session, cart: [...(session.cart ?? [])] };
  const fresh = () => ({ ...newSession(s.customer, s.link, s.opts), byName: s.byName, unverified: s.unverified });
  // Cierra el pedido: lo devuelve como `order` (con el día de entrega) y reinicia la conversación
  const placeOrder = () => {
    const items = getItems(s);
    const order = {
      customerId: s.customer?.id ?? null,
      name: s.name,
      address: s.address,
      city: s.customer?.city ?? "",
      text: s.orderText.replace(/\n/g, " + "),
      note: s.note || "",
      delivery: s.delivery ?? null,
      items: items.map(({ unsure, upb, unitStated, soloCaja: _sc, ...i }) => i),
      total: items.length ? importes(items).base : null, // base del pedido (la empresa calcula luego el IVA); al cliente se le enseña con IVA
      // Quien se identificó solo por su nombre (el teléfono no es el del cliente) queda retenido hasta que lo revise una persona
      review: items.some((i) => i.unsure) || !items.length || !!(s.opts?.holdUnverified && s.byName && last9(s.opts?.phone) !== last9(s.customer?.phone)),
    };
    return {
      reply: `🎉 ¡Pedido recibido, ${s.name}!\n${s.delivery ? `📅 Entrega: *${longDate(s.delivery)}*\n` : ""}\n${BUSINESS.payment}\n\nEscribe *menu* si necesitas algo más.`,
      session: fresh(),
      order,
    };
  };

  // Comandos globales
  if (["menu", "inicio", "hola", "buenas", "hi", "empezar"].includes(text)) {
    const n = fresh();
    return { ...greeting(n), session: n };
  }
  if (["cancelar", "salir", "c:cancel"].includes(text)) {
    return { reply: "Pedido cancelado. Escribe *menu* cuando quieras volver a empezar.", session: fresh() };
  }
  if (["asesor", "humano", "persona"].includes(text)) {
    return { reply: HUMAN_REPLY, session: s, handoff: true };
  }
  // Botones de «último pedido» e «histórico»
  if (s.customer && text === "h:open") return openCatalog(s, now);
  if (s.customer && text === "h:hist") return showHistory(s);
  // «hacer pedido», «último pedido», «histórico»… (con el carrito vacío; con artículos en el carrito «hacer el pedido» es finalizar)
  if (s.customer && ["menu", "items"].includes(s.state) || s.customer && s.state === "cart" && !s.cart.length) {
    const t1 = limpia(text);
    if (esUltimo(t1)) return showLast(s);
    if (esHistorico(t1)) return showHistory(s);
    if (esAbrir(t1)) return openCatalog(s, now);
  }
  // Día de entrega (se pregunta al confirmar el pedido)
  if (s.state === "delivery") {
    if (text === "d:otro") return { reply: 'Escribe el día que quieras, por ejemplo _"mañana"_, _"el viernes"_ o _"20 de noviembre"_.', session: s };
    let date = /^d:(\d{4}-\d{2}-\d{2})$/.exec(text)?.[1] ?? null, notice = "";
    if (!date) {
      const e = extractDelivery(rawText, now, { hoy: puedeHoy(s.customer) });
      if (e?.date) date = e.date;
      else if (e?.ambiguous) notice = '📅 ¿Qué *día* de la semana que viene lo quieres? Por ejemplo _"el martes"_ o _"el 10 de noviembre"_.\n\n';
    }
    if (date) {
      const why = explainDelivery(date, now, { hoy: puedeHoy(s.customer) });
      if (why) return askDelivery(s, now, `📅 ${why}\n\n`);
      s.delivery = date;
      return placeOrder();
    }
    return askDelivery(s, now, notice || "No he entendido el día 🤔.\n\n");
  }

  // Ya se avisó a una persona del equipo: no se vuelve a pedir el nombre, se espera o se reinicia con «menu»
  if (s.state === "derivado" && text) {
    return { reply: "👤 Ya hemos avisado a una persona del equipo, te responderá en cuanto pueda. Si quieres volver a intentarlo, escribe *menu*.", session: s };
  }

  // Identificación: el cliente dice quién es y se busca en la base de datos de clientes
  if ((s.state === "who" || s.state === "who2") && text) {
    if (text === "nuevo") {
      s.opts = { ...s.opts, identify: false };
      s.state = "menu";
      // Avisamos a la empresa para que lo dé de alta; mientras, puede ver productos y pedir (su pedido queda por revisar)
      return {
        ...greeting(s),
        reply: `${NEW_CUSTOMER_NOTE}\n\n${greeting(s).reply}`,
        session: s,
        handoff: true,
      };
    }
    if (s.state === "who" && isTooGeneric(rawText)) {
      // «bar», «cafetería»…: no es un nombre. Se pide completo y no cuenta como intento fallido
      return { reply: `«${String(rawText).trim().slice(0, 40)}» es demasiado general 🙂. Escribe el *nombre completo* de tu negocio tal y como nos compras (por ejemplo: _Bar El Ejemplo_) o tu *código de cliente*.`, session: s };
    }
    const fail = (msg) => {
      s.attempts = (s.attempts ?? 0) + 1;
      if (s.attempts >= MAX_ATTEMPTS) {
        s.attempts = 0;
        s.state = "derivado"; // ya está avisada una persona: no seguimos pidiendo el nombre
        s.candidates = null;
        return { reply: `No consigo identificarte 😕. Aviso a una persona del equipo para que te atienda.\n\n${HUMAN_REPLY}`, session: s, handoff: true };
      }
      return { reply: msg, session: s };
    };
    let hit;
    const found = CUSTOMER_FINDER(rawText) ?? [];
    if (s.state === "who2") {
      // Varios clientes encajaban con el nombre: solo vale el código de uno de ellos
      hit = found.length === 1 && (s.candidates ?? []).includes(String(found[0].id)) ? found[0] : null;
      if (!hit) return fail("Ese código no corresponde. Escríbelo otra vez, o escribe *menu* para empezar de nuevo.");
    } else if (found.length > 1) {
      s.candidates = found.map((c) => String(c.id));
      s.state = "who2";
      return { reply: "Hay varios clientes con un nombre parecido. Para distinguirte, escribe tu *código de cliente*.", session: s };
    } else if (!found.length) {
      return fail("No encuentro ese nombre 🤔. Escríbelo otra vez como figura en tus facturas, con todas sus palabras (por ejemplo _Bar El Ejemplo_ mejor que solo _Ejemplo_), o escribe tu código de cliente. Si eres cliente nuevo, escribe *nuevo*.");
    } else hit = found[0];
    // Quien se identifica solo por el nombre desde un teléfono que no es el del cliente NO ve su histórico, precios ni dirección:
    // sus pedidos quedan retenidos y los revisa una persona
    const unverified = !!s.opts?.holdUnverified && last9(s.opts?.phone) !== last9(hit.phone);
    const shown = unverified ? { ...hit, orders: [], usual: [], frequent: [], specialPrices: {}, discounts: {}, address: "" } : hit;
    Object.assign(s, { customer: shown, name: hit.name, address: shown.address ?? "", byName: true, unverified, attempts: 0, candidates: null, state: "menu" });
    s.link = LINK_MAKER(hit, s) ?? null;
    return { ...greeting(s, true), session: s };
  }

  // Observaciones: "nota: servir el jueves" (todo el pedido) o "nota jamón: pieza grande" (un artículo)
  const noteCmd = /^\s*(?:nota|notas|observaci[oó]n|observaciones)\b[\s:]*(?:de[l]?\s+)?(.*)$/is.exec(rawText || "");
  if (noteCmd && ["menu", "cart", "items", "confirm"].includes(s.state)) {
    const body = noteCmd[1].trim().slice(0, 200);
    const colon = body.indexOf(":");
    const lines = s.customer ? (s.state === "confirm" ? (s.items ?? s.cart) : s.cart) : [];
    if (!body) return { reply: "Escribe la observación, por ejemplo: *nota: servir el jueves* o *nota jamón: pieza de peso grande*.", session: s };
    let reply;
    if (colon > 0 && lines.length) {
      const q = tokenize(norm(body.slice(0, colon))).filter((w) => !STOP.has(w));
      const hits = lines.filter((i) => q.length && q.every((w) => tokensOf(i).some((t) => wordMatch(w, t))));
      const text = body.slice(colon + 1).trim();
      if (hits.length !== 1 || !text) {
        return { reply: hits.length > 1 ? "Hay varios artículos que coinciden. Escribe una palabra más del nombre." : "No encuentro ese artículo en tu pedido. Prueba con *nota: …* para todo el pedido.", session: s };
      }
      const updated = lines.map((i) => (i === hits[0] ? { ...i, note: text } : i));
      if (s.state === "confirm") setCart(s, updated);
      else s.cart = updated;
      reply = `📝 Anotado para ${hits[0].name}: _${text}_\n\n`;
    } else {
      s.note = (colon > 0 ? body.slice(colon + 1) : body).trim();
      reply = `📝 Observación anotada: _${s.note}_\n\n`;
    }
    if (s.state === "confirm") {
      const c = confirmReply(s);
      return { ...c, reply: reply + c.reply, session: s };
    }
    if (s.cart.length) return showCart(s, reply);
    return { reply: reply + "Ahora dime qué quieres pedir.", session: s };
  }

  // Cuestionario del cliente conocido: lista de artículos y botones
  if (s.customer) {
    // «quita las cervezas», «cambia el agua a 10»
    if (["cart", "confirm"].includes(s.state)) {
      const rm = parseRemove(rawText), ch = rm ? null : parseChangeQty(rawText);
      if (rm || ch) {
        const lines = s.state === "confirm" ? (s.items ?? s.cart) : s.cart;
        const hits = findLines(lines, norm((rm ?? ch).query));
        if (hits.length !== 1) return { reply: hits.length > 1 ? "Hay varios artículos que coinciden. Escribe una palabra más del nombre." : "No encuentro ese artículo en tu pedido.", session: s };
        const updated = rm || ch.qty === 0 ? lines.filter((i) => i !== hits[0]) : lines.map((i) => (i === hits[0] ? { ...i, qty: ch.qty, ...(ch.unit && i.upb ? { unit: ch.unit } : {}) } : i));
        const lead = rm || ch.qty === 0 ? `🗑️ Quitado: ${hits[0].name}\n\n` : `✏️ Cambiado: ${hits[0].name} → ${qtyLabel(updated.find((i) => i.id === hits[0].id && i.unit === (ch.unit && hits[0].upb ? ch.unit : hits[0].unit)) ?? { ...hits[0], qty: ch.qty })}\n\n`;
        if (!updated.length) { s.cart = []; s.items = null; return showList(s, 0, `${lead}Tu pedido se ha quedado vacío. Elige un artículo:`); }
        if (s.state === "confirm") { setCart(s, updated); const c = confirmReply(s); return { ...c, reply: lead + c.reply, session: s }; }
        s.cart = updated;
        return showCart(s, lead);
      }
    }
    // «eso es todo», «ya está», «finalizar»: pasar a confirmar
    if (["menu", "cart"].includes(s.state) && s.cart.length && isDone(rawText)) {
      setCart(s, s.cart);
      s.state = "confirm";
      return { ...confirmReply(s), session: s };
    }
    if (text === "lista" && ["menu", "cart"].includes(s.state)) return showList(s, 0, "Elige un artículo:");
    // varios productos marcados a la vez en las recomendaciones: 1 caja (o 1 unidad si no se vende en cajas) de cada uno
    const varios = /^ps:(.+)$/.exec(text);
    if (varios && ["menu", "cart", "qty"].includes(s.state)) {
      const nombres = [];
      for (const id of varios[1].split(",")) {
        const p = CATALOG.find((x) => String(x.id).toLowerCase() === id);
        if (!p) continue;
        addToCart(s, mkItem(p, 1, upbOf(p) ? "caja" : "ud"));
        nombres.push(p.name);
      }
      if (nombres.length) { s.state = "cart"; return showCart(s, `Anotado ✅ ${nombres.length === 1 ? "1 producto" : nombres.length + " productos"} (1 caja o unidad de cada uno). Puedes cambiar las cantidades en el catálogo.\n\n`); }
    }
    const pick = /^p:(.+)$/.exec(text);
    if (pick && ["menu", "cart", "qty"].includes(s.state)) {
      // el texto llega en minúsculas: los códigos de artículo con letras se comparan sin distinguir mayúsculas
      const sameId = (x) => String(x.id).toLowerCase() === pick[1];
      const p = habitualProducts(s.customer).find(sameId) ?? CATALOG.find(sameId);
      const op = s.opciones; // venía de «¿qué tipo de agua quieres?»: se recuerda la cantidad que ya había dicho
      if (p && op && op.qty && op.ids.some((id) => id.toLowerCase() === pick[1])) {
        s.opciones = null;
        const upb = upbOf(p);
        if (upb && !soloCaja(p) && !op.unitStated) { s.askUnit = [{ ...mkItem(p, op.qty, "ud"), upb }]; return askUnitReply(s); }
        addToCart(s, mkItem(p, op.qty, op.unit, { unitStated: op.unitStated }));
        return showCart(s, "Anotado ✅\n\n");
      }
      if (p) {
        s.opciones = null;
        const last = p.lastQty ?? 1;
        const upb = upbOf(p);
        s.pick = { id: p.id, name: p.name, price: priceOf(p), unitsPerBox: p.unitsPerBox, lastQty: last, unit: soloCaja(p) ? "caja" : upb ? null : "ud" };
        s.state = "qty";
        if (soloCaja(p)) return { ...askQty(s), reply: `*${p.name}*\nSe vende solo por cajas enteras: caja de ${upb} uds (${moneyP(priceOf(p) * upb)}).\n¿Cuántas *cajas* quieres? Pulsa un botón o escribe el número.`, session: s };
        if (upb) {
          // El artículo se vende en cajas: se pregunta cómo lo quiere
          return {
            reply: `*${p.name}*\n${moneyP(priceOf(p))} por unidad · caja de ${upb} uds (${moneyP(priceOf(p) * upb)}).\n\n¿Lo quieres en *cajas* o en *unidades*?`,
            session: s,
            ui: buttons(["u:caja", "Cajas"], ["u:ud", "Unidades"], ["q:0", "No lo quiero"]),
          };
        }
        return { ...askQty(s), session: s };
      }
    }
    const more = /^more:(\d+)$/.exec(text);
    if (more && s.state === "menu") return showList(s, Number(more[1]), "Más artículos:");

    if (s.state === "unitq" && s.askUnit?.length) {
      const m = /^ui:(caja|ud|no)$/.exec(text) ?? (text.startsWith("caja") ? [null, "caja"] : /^(ud|uds|unidad|unidades|suelt[oa]s?|latas?|botellas?|piezas?)\b/.test(text) ? [null, "ud"] : /^no( lo quiero| gracias)?$/.test(text) ? [null, "no"] : null);
      if (!m) return askUnitReply(s, "Pulsa un botón o escribe *cajas* o *unidades* (o *menu* para empezar de nuevo).\n\n");
      const [f, ...rest] = s.askUnit;
      s.askUnit = rest;
      if (m[1] !== "no") addToCart(s, { ...f, unit: m[1] });
      if (rest.length) return askUnitReply(s);
      return showCart(s, m[1] === "no" && !s.cart.length ? "" : "Anotado ✅\n\n");
    }
    if (s.state === "qty" && s.pick) {
      const u = /^u:(caja|ud)$/.exec(text);
      if (u) {
        s.pick = { ...s.pick, unit: u[1] };
        return { ...askQty(s), session: s };
      }
      // "q:3", "3", "3 cajas" o "12 uds"
      const q = /^q:(\d+)$/.exec(text) ?? /^(\d{1,3})\s*(cajas?|uds?|unidades?)?$/.exec(text) ?? (text in WORDS ? [null, String(WORDS[text])] : null);
      if (!q && /^\d{4,}\s*(cajas?|uds?|unidades?)?$/.test(text)) {
        return { reply: "La cantidad máxima por artículo es *999*. Si necesitas más, escribe *persona* y te atiende alguien del equipo.", session: s };
      }
      if (q) {
        const word = q[2];
        if (word) s.pick = { ...s.pick, unit: word.startsWith("caja") ? "caja" : "ud" };
        if (!s.pick.unit && Number(q[1]) > 0) {
          return { reply: "Primero dime si lo quieres en *cajas* o en *unidades*.", session: s, ui: buttons(["u:caja", "Cajas"], ["u:ud", "Unidades"], ["q:0", "No lo quiero"]) };
        }
        return chooseQty(s, Number(q[1]));
      }
      if (/^-\s*\d/.test(text)) return { reply: "La cantidad no puede ser negativa. Escribe un número (por ejemplo 6), o pulsa «No lo quiero» para quitarlo.", session: s };
      return { reply: "No he entendido esa cantidad. Escribe un número entero de 1 a 999 (por ejemplo 6), o «3 cajas» / «12 uds», o pulsa un botón.", session: s };
    }
    if (["menu", "cart"].includes(s.state)) {
      if (text === "act:add") return s.customer ? anadirProductos(s) : showList(s);
      if (text === "act:clear") {
        s.cart = [];
        return showList(s, 0, "He vaciado tu pedido. Elige un artículo:");
      }
      if (text === "act:done") {
        if (!s.cart.length) return showList(s, 0, "Aún no has añadido nada. Elige un artículo:");
        setCart(s, s.cart);
        s.state = "confirm";
        return { ...confirmReply(s), session: s };
      }
    }
    if (s.state === "confirm" && text === "c:more") return anadirProductos(s);
    if (s.state === "confirm" && text === "c:edit") {
      s.items = null;
      return showCart(s, "De acuerdo, cambia lo que quieras.\n\n");
    }
  }

  switch (s.state) {
    case "menu":
    case "cart": {
      if (["productos", "catalogo", "precios"].includes(text)) return { reply: catalog(), session: s };
      if (["horarios", "horario", "envios", "info"].includes(text)) return { reply: `${BUSINESS.info}\n\nEscribe *menu* para volver.`, session: s };
      if (!s.customer) {
        if (text === "1") return { reply: catalog(), session: s };
        if (text === "2") return { reply: `${BUSINESS.info}\n\nEscribe *menu* para volver.`, session: s };
        if (text === "3") return { reply: HUMAN_REPLY, session: s, handoff: true };
      }
      if (!text) return { ...greeting(s), session: s };
      if (s.customer) {
        // Cliente conocido que escribe lo que quiere: se suma al pedido (y, si dice cuándo lo quiere, se apunta el día)
        if (/(?:^|[\s,;+])-\s*\d/.test(rawText)) return { reply: "Las cantidades no pueden ser negativas. Escribe, por ejemplo, _\"3 aguas\"_; para quitar algo usa *Vaciar pedido* o *Cambiar*.", session: s };
        // Un número suelto («1.5», «5»): no es un artículo (antes «1.5» se tomaba por «AGUA MINERAL 1,5 L»)
        if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(rawText) && !/^q:/.test(text)) return { reply: "Me falta el artículo 🙂. Escribe la cantidad y lo que quieres, por ejemplo _\"6 aguas\"_ o _\"2 cajas de cerveza\"_. Las cantidades son números enteros.", session: s };
        if (/(?:^|[\s,;+y])0+\s+[a-zñ]/i.test(norm(rawText))) return { reply: "La cantidad tiene que ser mayor que 0. Escribe, por ejemplo, _\"3 aguas\"_.", session: s };
        if (!s.unverified) { const asistida = asistir(s, rawText, now, ctx); if (asistida) return asistida; } // dudas y recomendaciones en lenguaje natural
        const dd = takeDate(s, rawText, now);
        const amb = [];
        const found = parseItems(dd.rest, s.customer, { ambiguos: amb });
        const lead = (dd.notice ? dd.notice + "\n\n" : "") + (dd.set ? `📅 Entrega apuntada: *${longDate(s.delivery)}*\n\n` : "");
        // Solo se toma como pedido si dice cuántas quiere («6 aguas», «una cerveza»): «qué tal» o «agua» sueltos no se anotan
        const conCantidad = /\d/.test(numberWords(dd.rest));
        // Algo genérico («agua», «2 cervezas», «vino»): no se elige por él, se le pregunta el tipo y se le enseñan todos
        if (amb.length) {
          if (conCantidad) for (const { unitStated, ...f } of found) if (!(f.upb && !unitStated)) addToCart(s, f); // lo claro y con cantidad se anota
          return preguntarTipo(s, amb[0], lead);
        }
        if (found.length && conCantidad) {
          const ask = [];
          for (const { unitStated, ...f } of found) {
            if (f.upb && !unitStated) ask.push(f);
            else addToCart(s, f);
          }
          if (ask.length) {
            s.askUnit = ask;
            return askUnitReply(s, lead + "Anotado ✅\n\n");
          }
          return showCart(s, lead + "Anotado ✅\n\n");
        }
        if (dd.set || dd.notice) return s.cart.length ? showCart(s, lead) : { reply: lead + "Ahora dime qué quieres pedir.", session: s };
        return noEntiendo(s);
      }
      // Cualquier otro texto se toma como el pedido (se conserva tal cual; si dice cuándo lo quiere, además se apunta el día)
      const dd = takeDate(s, rawText, now);
      const lead = (dd.notice ? dd.notice + "\n\n" : "") + (dd.set ? `📅 Entrega apuntada: *${longDate(s.delivery)}*\n\n` : "");
      s.orderText = rawText.trim().slice(0, 500);
      s.items = null;
      s.state = "items";
      return {
        reply: `${lead}📝 Anotado: _"${s.orderText}"_\n\n${summary(s)}\n\nEscribe *1* para continuar, o escribe más cosas para añadirlas.`,
        session: s,
      };
    }

    case "items":
      if (text === "1" || isYes(rawText) || isDone(rawText)) {
        if (s.customer) {
          s.state = "confirm";
          return { ...confirmReply(s), session: s };
        }
        s.state = "name";
        return { reply: "Perfecto. ¿A qué *nombre* pongo el pedido?", session: s };
      }
      const dd = takeDate(s, rawText, now); // «…para el lunes»
      const lead = (dd.notice ? dd.notice + "\n\n" : "") + (dd.set ? `📅 Entrega apuntada: *${longDate(s.delivery)}*\n\n` : "");
      if ((dd.set || dd.notice) && !norm(dd.rest).replace(/[^a-z0-9]/g, "")) return { reply: lead + "Escribe *1* para continuar, o escribe más cosas para añadirlas.", session: s };
      s.orderText = `${s.orderText}\n${rawText.trim()}`.slice(0, 800);
      return {
        reply: `${lead}📝 Pedido actual: _"${s.orderText.replace(/\n/g, " + ")}"_\n\n${summary(s)}\n\nEscribe *1* para continuar, o escribe más cosas para añadirlas.`,
        session: s,
      };

    case "name":
      if (text.length < 2) return { reply: "Escribe tu nombre, por favor.", session: s };
      s.name = rawText.trim().slice(0, 80);
      s.state = "address";
      return { reply: `Gracias, ${s.name}. ¿Cuál es la *dirección de entrega* (o escribe "recoger" si pasarás a buscarlo)?`, session: s };

    case "address":
      if (text.length < 3) return { reply: "Escribe la dirección o \"recoger\".", session: s };
      s.address = rawText.trim().slice(0, 200);
      s.state = "confirm";
      return { ...confirmReply(s), session: s };

    case "confirm": {
      if (text === "1" || text === "c:ok" || isYes(rawText)) {
        // Si aún no ha dicho cuándo lo quiere (o ese día ya no se puede servir), se le pregunta antes de enviar
        if (ASK_DELIVERY && (!s.delivery || !deliveryAllowed(s.delivery, now, { hoy: puedeHoy(s.customer) }))) {
          const why = s.delivery ? explainDelivery(s.delivery, now, { hoy: puedeHoy(s.customer) }) : null;
          s.delivery = null;
          return askDelivery(s, now, why ? `📅 ${why}\n\n` : "");
        }
        return placeOrder();
      }
      if (text === "2" || isNo(rawText)) return { reply: "Pedido cancelado. Escribe *menu* para empezar de nuevo.", session: fresh() };
      if (s.customer && text) {
        // Cliente conocido que cambia cantidades o el día: se rehace el pedido con lo que escribe
        const dd = takeDate(s, rawText, now);
        const found = parseItems(dd.rest, s.customer);
        let unknown = "";
        if (found.length) setCart(s, found);
        else if (!dd.set && !dd.notice) {
          if (getItems(s).length) {
            // No lo he entendido: el pedido se queda como estaba (antes se borraban las líneas y se enviaba un pedido vacío)
            unknown = "No he entendido eso 🤔. Tu pedido sigue igual. Escribe los cambios (por ejemplo _\"6 verdejo\"_), pulsa *Confirmar* o *Cancelar*, o escribe *menu* para volver al inicio.\n\n";
          } else {
            s.orderText = rawText.trim().slice(0, 500);
            s.items = null;
          }
        }
        const c = confirmReply(s);
        return { ...c, reply: unknown + (dd.notice ? dd.notice + "\n\n" : "") + c.reply, session: s };
      }
      return { reply: "Escribe *1* para confirmar o *2* para cancelar.", session: s };
    }

    default:
      return { ...greeting(fresh()), session: fresh() };
  }
}
