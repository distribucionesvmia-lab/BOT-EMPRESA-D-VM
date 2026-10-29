// Demo del sistema que funciona entera en el navegador: mismo bot, mismos cálculos y mismo Excel que el servidor,
// con clientes y artículos FICTICIOS. Dos vistas (cliente y distribuidor) comparten las bases de datos de productos,
// clientes, pedidos y exportaciones, que se guardan y se actualizan (base compartida de Claude, o el navegador).
import { handleMessage, newSession, setCatalog, setCustomerFinder, setLinkMaker, getCatalog, habitualProducts } from "../bot.js";
import { priceOrder, totals } from "../pricing.js";
import { webProducts, webOrderFromBody } from "../weborder.js";
import { findCustomers } from "../identify.js";
import { FORMAT, madrid, madridTime } from "../export-format.js";
import { workbookFiles } from "../xlsx-files.js";
import { zipStore } from "./zip-browser.js";
import { BUSINESS } from "../config.js";
import { seedDocs } from "./seeds.js";
import { makeDbBackend, makeLocalBackend } from "./backend.js";
import data from "../ejemplo/historial-ficticio.json";

const PHONE = "34600999999"; // el móvil de prueba no está en ninguna ficha: el bot pregunta quién es
const COLLS = ["products", "customers", "orders", "exports"];
const uid = () => Math.random().toString(36).slice(2, 8);

let backend, mode = "local", perms = { canWrite: true, isAdmin: true };
const cache = { products: [], customers: [], orders: [], exports: [] };
const listeners = new Set();
const errorListeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
const report = (e) => { console.error(e); errorListeners.forEach((f) => f(e)); };
const sessions = new Map();
const links = new Map();

const activeCatalog = () =>
  [...cache.products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name, price: p.price, ...(p.unitsPerBox ? { unitsPerBox: p.unitsPerBox } : {}), vat: p.vat, discount: p.discount }));

function onData(coll, rows) {
  cache[coll] = rows;
  if (coll === "products" && rows.length) setCatalog(activeCatalog()); // el bot usa el precio nuevo al instante
  emit();
}
setCustomerFinder((query) => findCustomers(cache.customers, query));
setLinkMaker(() => "#mini");

async function init() {
  let db = null, user = null;
  try { db = await window.claude?.use?.("db"); } catch {}
  if (db) {
    try { user = await window.claude?.use?.("user"); } catch {}
    mode = "shared";
    backend = makeDbBackend(db);
    let canWrite = null, isAdmin = false;
    try { canWrite = await user?.can?.("data.write"); isAdmin = !!(await user?.canEdit?.()); } catch {}
    perms = { canWrite: canWrite !== false, isAdmin };
  } else {
    backend = makeLocalBackend(seedDocs(data));
  }
  const firsts = COLLS.map(
    (coll) => new Promise((res) => {
      let first = true;
      const done = () => first && ((first = false), res());
      backend.subscribe(coll, (rows) => { onData(coll, rows); done(); }, (e) => { report(e); done(); });
    }),
  );
  await Promise.race([Promise.all(firsts), new Promise((r) => setTimeout(r, 6000))]);
}
const ready = init();

// ---- Pedidos ----
const byDate = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
// Referencia correlativa según el orden de llegada (VM-2026-000001…)
const withRefs = () => [...cache.orders].sort(byDate).map((o, i) => ({ ...o, ref: `VM-${o.created_at.slice(0, 4)}-${String(i + 1).padStart(6, "0")}` }));
const rowTotals = (o) => totals(o.items.map((i) => ({ ...i, vat: i.vat_rate })), o.re);
const isReady = (o) => o.export_status === "pending" && !o.review && o.customer_id && o.items.length;

function newOrderRow(order, customer) {
  const o = priceOrder(order, customer, getCatalog());
  return {
    id: `o${Date.now().toString(36)}${uid()}`,
    customer_id: o.customerId ?? null, phone: o.phone, name: o.name, address: o.address, text: o.text, note: o.note || null,
    total: o.total, review: !!o.review, re: !!o.re, export_status: "pending", export_id: null, created_at: o.at,
    items: o.items.map((i) => ({
      id: String(i.id), name: i.name, price: i.price, qty: i.qty, unit: i.unit ?? "ud", boxes: i.boxes ?? null, units: i.units ?? i.qty,
      discount: i.discount ?? 0, vat_rate: i.vat ?? null, amount: i.amount ?? null, note: i.note ?? null,
    })),
  };
}
// Guarda el pedido en la base de datos (si este usuario puede escribir). Devuelve true si se guarda.
function saveOrder(order, customer) {
  if (!perms.canWrite) return false;
  const row = newOrderRow(order, customer);
  backend.set("orders", row.id, row).catch(report);
  return true;
}

function buildExport(rows, fileName, extra = {}) {
  const { sheets, lineCount } = FORMAT.build(rows);
  return { fileName, orderCount: rows.length, lineCount, bytes: zipStore(workbookFiles(sheets)), sheets, ...extra };
}
const stampName = () => `pedidos-${madrid(new Date().toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-")}.xlsx`;

window.VM = {
  business: BUSINESS.name,
  phone: PHONE,
  ready: () => ready,
  info: () => ({ mode, ...perms }),
  onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  onError: (fn) => (errorListeners.add(fn), () => errorListeners.delete(fn)),

  // ---- Vista del cliente: el chat ----
  resetChat: () => sessions.delete(PHONE),
  /** Un mensaje del cliente al bot (texto libre o id de botón/fila). */
  send(text) {
    let cur = sessions.get(PHONE);
    if (!cur) cur = newSession(null, null, { identify: true, phone: PHONE, holdUnverified: false });
    const out = handleMessage(cur, String(text ?? "").slice(0, 1000));
    sessions.set(PHONE, out.session);
    let saved = null;
    if (out.order) saved = saveOrder({ at: new Date().toISOString(), phone: PHONE, key: `demo:${uid()}`, ...out.order }, cur.customer ?? null);
    return { reply: out.reply, ui: out.ui, handoff: !!out.handoff, saved };
  },

  // ---- Mini-aplicación de pedido (lo que abre «Hacer pedido») ----
  miniOpen() {
    const id = uid();
    links.set(id, { customer: sessions.get(PHONE)?.customer ?? null, used: false });
    return id;
  },
  miniData(link) {
    const customer = links.get(link)?.customer;
    if (!customer) return { error: "Enlace no válido o caducado" };
    return { business: BUSINESS.name, priceNote: BUSINESS.priceNote, customer: { name: customer.name, address: customer.address }, used: links.get(link).used, products: webProducts(customer, getCatalog(), habitualProducts) };
  },
  miniSubmit(link, body) {
    const customer = links.get(link)?.customer;
    if (!customer) return { status: 410, json: { error: "Enlace no válido o caducado" } };
    if (links.get(link).used) return { status: 409, json: { error: "Este pedido ya se envió" } };
    const built = webOrderFromBody(body, customer, { key: `web:${link}`, phone: PHONE }, getCatalog());
    if (built.error) return { status: 400, json: { error: built.error } };
    links.get(link).used = true;
    const priced = priceOrder(built.order, customer, getCatalog());
    saveOrder(built.order, customer);
    return { status: 200, json: { ok: true, message: `🎉 ¡Pedido recibido, ${customer.name}! ${priced.items.length} artículos, total aprox. ${priced.total.toFixed(2)}${BUSINESS.currency}.\n\n${BUSINESS.payment}` } };
  },

  // ---- Vista del distribuidor ----
  products: () => [...cache.products].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map((p) => ({ id: p.id, name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, vat: p.vat, updatedAt: p.updatedAt, last: p.changes?.[0] ?? null })),
  customers: () => cache.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, recargoEquivalencia: !!c.recargoEquivalencia, orders: c.orders.length, lastOrder: c.orders[0]?.date ?? null })),
  orders: () =>
    withRefs().reverse().map((o) => ({
      id: o.id, ref: o.ref, hora: madridTime(o.created_at), cliente: o.name, codigo: o.customer_id, lineas: o.items.length,
      resumen: o.items.map((i) => `${i.boxes ?? i.units} ${i.boxes ? "caja" + (i.boxes > 1 ? "s" : "") : "ud"} ${i.name}`).join(" · "),
      total: rowTotals(o).total, estado: o.export_status === "exported" ? "exportado" : o.review || !o.customer_id ? "retenido" : "pendiente",
      motivo: !o.customer_id ? "Cliente sin código de ERP" : o.review ? "Interpretación dudosa" : "",
    })),
  exports: () => [...cache.exports].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),

  /** Cambia el precio (u otro campo) de un producto: queda registrado y el bot lo usa al instante. */
  async updateProduct(id, fields) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para cambiar precios.");
    const p = cache.products.find((x) => x.id === String(id));
    if (!p) throw new Error(`No existe el producto ${id}`);
    const now = new Date().toISOString();
    const changes = Object.entries(fields).filter(([k, v]) => p[k] !== v).map(([field, to]) => ({ field, from: p[field] ?? null, to, at: now }));
    if (!changes.length) return false;
    await backend.update("products", p.id, { ...Object.fromEntries(changes.map((c) => [c.field, c.to])), updatedAt: now, changes: [...changes, ...(p.changes ?? [])].slice(0, 20) });
    return true;
  },

  /** Exporta a Excel los pedidos pendientes (los marca como exportados y guarda el historial). */
  async exportNow() {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para exportar.");
    const all = withRefs();
    const pending = all.filter((o) => o.export_status === "pending");
    const rows = pending.filter(isReady);
    const held = pending.length - rows.length;
    if (!rows.length) return { export: null, held };
    const id = `e${Date.now().toString(36)}${uid()}`;
    const exp = buildExport(rows, stampName(), { id });
    await backend.set("exports", id, { fileName: exp.fileName, createdAt: new Date().toISOString(), orderCount: exp.orderCount, lineCount: exp.lineCount, orderIds: rows.map((r) => r.id) });
    for (const r of rows) await backend.update("orders", r.id, { export_status: "exported", export_id: id });
    return { export: exp, held };
  },
  /** Vuelve a generar un Excel ya exportado (mismos pedidos, mismos datos). */
  regenerate(id) {
    const e = cache.exports.find((x) => x.id === id);
    if (!e) return null;
    const ids = new Set(e.orderIds);
    return buildExport(withRefs().filter((o) => ids.has(o.id)), e.fileName, { id });
  },
  /** Borra pedidos y exportaciones y restaura los datos de ejemplo. */
  async resetData() {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para restaurar los datos.");
    sessions.clear();
    await backend.reset(seedDocs(data));
  },
};
