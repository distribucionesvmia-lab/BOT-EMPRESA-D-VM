import { BUSINESS, PRODUCTS } from "./config.js";

const money = (n) => `${n.toFixed(2)}${BUSINESS.currency}`;
const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const tokenize = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

// Una línea de pedido: { id, name, price, qty, unit: "ud" | "caja", upb (unidades por caja, si se conoce), note? }
// El cliente puede pedir en unidades o en cajas; las unidades de una caja salen de la ficha del artículo (unitsPerBox).
const upbOf = (p) => (Number.isInteger(p?.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null);
const mkItem = (p, qty, unit = "ud", extra = {}) => ({ id: p.id, name: p.name, price: p.price, qty, unit, upb: upbOf(p), ...extra });
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

const WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, veinte: 20, treinta: 30 };
const STOP = new Set(
  ("de del la el los las y e un una uno unos unas con para por me mas otro otra tambien gracias hola buenas " +
    "quiero quisiera necesito necesitamos ponme pon dame mandame manda pedido favor ud uds unidad unidades " +
    "caja cajas lata latas botella botellas pack packs bandeja bandejas litro litros que a al en lo").split(" ")
);
const UNITS = new Set(["cl", "ml", "l", "gr", "g", "kg", "lt"]);
const REPEAT_PHRASES = ["como siempre", "lo de siempre", "lo habitual", "lo mismo", "repetir", "repetir pedido", "ultimo", "ultimo pedido"];

// ¿la palabra del cliente (q) corresponde a la del producto (t)? Acepta plurales y prefijos
const wordMatch = (q, t) => q === t || (q.length >= 3 && t.startsWith(q)) || (t.length >= 4 && q.startsWith(t));

/**
 * Interpreta texto libre ("2 cajas de coca cola zero y 6 verdejo") contra el catálogo.
 * `customer` (opcional) da prioridad a lo que ya ha comprado. Marca `unsure` si hay varias opciones igual de buenas.
 */
export function parseItems(rawText, customer = null) {
  const bought = new Set(
    (customer?.orders ?? []).flatMap((o) => o.lines.map((l) => l.productId)).concat((customer?.usual ?? []).map((u) => u.productId))
  );
  const items = new Map();
  for (const segment of norm(rawText).split(/\s*(?:,|;|\+|\n|\by\b|\be\b)\s*/)) {
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

const total = (items) => items.reduce((t, i) => t + unitsOf(i) * i.price, 0);
const itemsText = (items) =>
  items.map((i) => `• ${qtyLabel(i)} × ${i.name} = ${money(unitsOf(i) * i.price)}${i.unsure ? " ⚠️" : ""}${i.note ? `\n   📝 ${i.note}` : ""}`).join("\n") +
  `\n*Total: ${money(total(items))}*` +
  (items.some((i) => i.unsure) ? `\n⚠️ _No estoy seguro de este artículo: escribe la marca o el formato exacto._` : "");

const fmtDate = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

/** Pedidos que el cliente puede repetir: lo habitual (si hay) y sus últimos pedidos. */
export function repeatOptions(customer) {
  const options = [];
  const habitual = itemsFromLines(customer?.frequent ?? customer?.usual ?? []);
  if (habitual.length) options.push({ label: `Lo que sueles pedir (${habitual.length} artículos)`, items: habitual });
  for (const o of (customer?.orders ?? []).slice(0, 3)) {
    const items = itemsFromLines(o.lines);
    if (items.length) options.push({ label: `Pedido del ${fmtDate(o.date)} (${items.length} artículos · ${money(total(items))})`, items });
  }
  return options.slice(0, 5);
}

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
  const all = habitualProducts(s.customer);
  const start = page * PAGE;
  const rows = all.slice(start, start + PAGE).map((p) => ({
    id: `p:${p.id}`,
    title: trunc(p.name, 24),
    description: trunc(`${p.name} · última vez: ${p.lastQty} uds`, 72),
  }));
  if (!rows.length) return undefined;
  if (start + PAGE < all.length) rows.push({ id: `more:${page + 1}`, title: "Ver más artículos", description: `Quedan ${all.length - start - PAGE} por ver` });
  return { type: "list", button: "Ver artículos", section: "Tus artículos habituales", rows };
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
    ? `⭐ *Tus productos habituales* (según tus últimos pedidos):\n` + top.map((p) => `• ${p.name} — última vez: ${p.lastQty} uds`).join("\n") + `\n\n`
    : `Todavía no tengo pedidos tuyos anteriores.\n\n`;
};
// Tras identificar al cliente por su nombre: confirmación + sus productos habituales
const identifiedIntro = (s) => `✅ ¡Identificado! Eres *${s.customer.name}* (cód. ${s.customer.id}).\n\n${habitualBlock(s)}`;

const greeting = (s, justIdentified = false) => {
  if (!s.customer) return { reply: s.opts?.identify && s.state === "who" ? WHO_PROMPT : GENERIC_MENU };
  const saludo = `👋 ¡Hola, *${s.customer.name}*! Soy el asistente de *${BUSINESS.name}*.\n\n`;
  // opts.showHabitual: cliente con sesión iniciada: se le saluda y se le muestran sus habituales
  const hi = justIdentified ? identifiedIntro(s) : s.opts?.showHabitual ? saludo + habitualBlock(s) : saludo;
  // Con enlace personal: se abre el catálogo de pedido. Sin él: lista y botones dentro del chat
  if (s.link) {
    return {
      reply:
        hi +
        `🛒 Pulsa *Hacer pedido* para abrir tu catálogo con tus artículos habituales, elegir las unidades y confirmar.\n\n` +
        `También puedes escribirlo aquí (_"6 verdejo y 2 coca cola zero"_), decir *repetir* para repetir tu último pedido, ` +
        `*lista* para elegir en el chat, o pedir *horarios* o *persona*.`,
      ui: { type: "link", title: "Hacer pedido", url: s.link },
    };
  }
  return {
    reply:
      hi +
      `🛒 Pulsa *Ver artículos* para elegir lo que quieres pedir (te enseño lo que sueles comprar).\n\n` +
      `También puedes escribirlo (_"6 verdejo y 2 coca cola zero"_), decir *repetir* para repetir tu último pedido, ` +
      `o pedir *productos*, *horarios* o *persona*.`,
    ui: listUi(s),
  };
};

const catalog = () => {
  const shown = CATALOG.slice(0, 25);
  return (
    `🛍️ *Productos*\n\n` +
    shown.map((p) => `• ${p.name} — ${money(p.price)}`).join("\n") +
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
    `👤 ${s.name}\n📍 Entrega en: ${s.address}\n\n`;
  return s.customer
    ? { reply: body + `Pulsa un botón, o escribe los cambios (por ejemplo _"6 verdejo y 2 coca cola zero"_) y lo rehago.\n\n_¿Alguna observación? Escribe *nota: servir el jueves*, o *nota jamón: pieza grande* para un artículo._`, ui: buttons(["c:ok", "Confirmar"], ["c:edit", "Cambiar"], ["c:cancel", "Cancelar"]) }
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

function repeatOrder(s, option) {
  if (!option) {
    return { reply: "No encuentro pedidos anteriores tuyos. Escribe lo que quieres pedir, por ejemplo _\"2 aguas y una cerveza\"_.", session: s };
  }
  setCart(s, option.items);
  s.state = "confirm";
  return { ...confirmReply(s), session: s };
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
    ui: buttons(["ui:caja", cajas], ["ui:ud", `${f.qty} uds`], ["ui:no", "No lo quiero"]),
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
    reply: `*${p.name}*\n${money(p.price)} por unidad${p.lastQty ? ` · última vez: ${last} uds` : ""}.\n\n¿Cuántas unidades quieres? Pulsa un botón o escribe el número.`,
    ui: buttons([`q:${last}`, `${last} uds (igual)`], [`q:${last * 2}`, `${last * 2} uds (doble)`], ["q:0", "No lo quiero"]),
  };
}

const HUMAN_REPLY =
  "👤 Avisamos a una persona del equipo, te responderá en cuanto pueda. Mientras tanto, escribe *menu* si necesitas algo más.";

/**
 * Procesa un mensaje del cliente (texto, o el id de la fila/botón que ha pulsado).
 * Devuelve { reply, ui?, session, order?, handoff? } sin tocar la red ni el disco.
 */
export function handleMessage(session, rawText) {
  const text = norm(rawText || "");
  const s = { ...session, cart: [...(session.cart ?? [])] };
  const fresh = () => ({ ...newSession(s.customer, s.link, s.opts), byName: s.byName });

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
  if (s.customer && REPEAT_PHRASES.includes(text) && ["menu", "items", "cart"].includes(s.state)) {
    return repeatOrder(s, repeatOptions(s.customer)[0]);
  }

  // Identificación: el cliente dice quién es y se busca en la base de datos de clientes
  if ((s.state === "who" || s.state === "who2") && text) {
    if (text === "nuevo") {
      s.opts = { ...s.opts, identify: false };
      s.state = "menu";
      return { ...greeting(s), session: s };
    }
    const fail = (msg) => {
      s.attempts = (s.attempts ?? 0) + 1;
      if (s.attempts >= MAX_ATTEMPTS) {
        s.attempts = 0;
        s.state = "who";
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
      return fail("No encuentro ese nombre 🤔. Escríbelo otra vez como figura en tus facturas, o escribe tu código de cliente. Si eres cliente nuevo, escribe *nuevo*.");
    } else hit = found[0];
    Object.assign(s, { customer: hit, name: hit.name, address: hit.address ?? "", byName: true, attempts: 0, candidates: null, state: "menu" });
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
    if (text === "lista" && ["menu", "cart"].includes(s.state)) return showList(s, 0, "Elige un artículo:");
    const pick = /^p:(.+)$/.exec(text);
    if (pick && ["menu", "cart", "qty"].includes(s.state)) {
      // el texto llega en minúsculas: los códigos de artículo con letras se comparan sin distinguir mayúsculas
      const sameId = (x) => String(x.id).toLowerCase() === pick[1];
      const p = habitualProducts(s.customer).find(sameId) ?? CATALOG.find(sameId);
      if (p) {
        const last = p.lastQty ?? 1;
        const upb = upbOf(p);
        s.pick = { id: p.id, name: p.name, price: p.price, unitsPerBox: p.unitsPerBox, lastQty: last, unit: upb ? null : "ud" };
        s.state = "qty";
        if (upb) {
          // El artículo se vende en cajas: se pregunta cómo lo quiere
          return {
            reply: `*${p.name}*\n${money(p.price)} por unidad · caja de ${upb} uds (${money(p.price * upb)}).\n\n¿Lo quieres en *cajas* o en *unidades*?`,
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
      const m = /^ui:(caja|ud|no)$/.exec(text) ?? (text.startsWith("caja") ? [null, "caja"] : /^(ud|uds|unidad|unidades)$/.test(text) ? [null, "ud"] : null);
      if (!m) return askUnitReply(s, "Pulsa un botón o escribe *cajas* o *unidades*.\n\n");
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
      const q = /^q:(\d+)$/.exec(text) ?? /^(\d{1,3})\s*(cajas?|uds?|unidades?)?$/.exec(text);
      if (q) {
        const word = q[2];
        if (word) s.pick = { ...s.pick, unit: word.startsWith("caja") ? "caja" : "ud" };
        if (!s.pick.unit && Number(q[1]) > 0) {
          return { reply: "Primero dime si lo quieres en *cajas* o en *unidades*.", session: s, ui: buttons(["u:caja", "Cajas"], ["u:ud", "Unidades"], ["q:0", "No lo quiero"]) };
        }
        return chooseQty(s, Number(q[1]));
      }
      return { reply: "Escribe solo el número (por ejemplo 6), o «3 cajas» / «12 uds», o pulsa un botón.", session: s };
    }
    if (["menu", "cart"].includes(s.state)) {
      if (text === "act:add") return showList(s);
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
        // Cliente conocido que escribe lo que quiere: se suma al pedido
        const found = parseItems(rawText, s.customer);
        if (found.length) {
          const ask = [];
          for (const { unitStated, ...f } of found) {
            if (f.upb && !unitStated) ask.push(f);
            else addToCart(s, f);
          }
          if (ask.length) {
            s.askUnit = ask;
            return askUnitReply(s, "Anotado ✅\n\n");
          }
          return showCart(s, "Anotado ✅\n\n");
        }
        return showList(s, 0, "No he reconocido ese artículo. Elige de la lista, o escríbelo de otra forma (por ejemplo _\"6 verdejo\"_):");
      }
      // Cualquier otro texto se toma como el pedido
      s.orderText = rawText.trim().slice(0, 500);
      s.items = null;
      s.state = "items";
      return {
        reply: `📝 Anotado: _"${s.orderText}"_\n\n${summary(s)}\n\nEscribe *1* para continuar, o escribe más cosas para añadirlas.`,
        session: s,
      };
    }

    case "items":
      if (text === "1") {
        if (s.customer) {
          s.state = "confirm";
          return { ...confirmReply(s), session: s };
        }
        s.state = "name";
        return { reply: "Perfecto. ¿A qué *nombre* pongo el pedido?", session: s };
      }
      s.orderText = `${s.orderText}\n${rawText.trim()}`.slice(0, 800);
      return {
        reply: `📝 Pedido actual: _"${s.orderText.replace(/\n/g, " + ")}"_\n\n${summary(s)}\n\nEscribe *1* para continuar, o escribe más cosas para añadirlas.`,
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

    case "confirm":
      if (text === "1" || text === "c:ok") {
        const items = getItems(s);
        const order = {
          customerId: s.customer?.id ?? null,
          name: s.name,
          address: s.address,
          text: s.orderText.replace(/\n/g, " + "),
          note: s.note || "",
          items: items.map(({ unsure, upb, unitStated, ...i }) => i),
          total: items.length ? total(items) : null,
          // Quien se identificó solo por su nombre (el teléfono no es el del cliente) queda retenido hasta que lo revise una persona
          review: items.some((i) => i.unsure) || !items.length || !!(s.opts?.holdUnverified && s.byName && last9(s.opts?.phone) !== last9(s.customer?.phone)),
        };
        return {
          reply: `🎉 ¡Pedido recibido, ${s.name}!\n\n${BUSINESS.payment}\n\nEscribe *menu* si necesitas algo más.`,
          session: fresh(),
          order,
        };
      }
      if (text === "2") return { reply: "Pedido cancelado. Escribe *menu* para empezar de nuevo.", session: fresh() };
      if (s.customer && text) {
        // Cliente conocido que cambia cantidades: se rehace el pedido con lo que escribe
        const found = parseItems(rawText, s.customer);
        if (found.length) setCart(s, found);
        else {
          s.orderText = rawText.trim().slice(0, 500);
          s.items = null;
        }
        return { ...confirmReply(s), session: s };
      }
      return { reply: "Escribe *1* para confirmar o *2* para cancelar.", session: s };

    default:
      return { ...greeting(fresh()), session: fresh() };
  }
}
