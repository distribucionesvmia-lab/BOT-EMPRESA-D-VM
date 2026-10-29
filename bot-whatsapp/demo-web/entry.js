// Demo del sistema que funciona entera en el navegador: mismo bot, mismos cálculos y mismo Excel que el servidor,
// con clientes y artículos FICTICIOS. No hay servidor ni base de datos: los pedidos viven en memoria.
import { handleMessage, newSession, setCatalog, getCatalog, habitualProducts } from "../bot.js";
import { priceOrder, totals } from "../pricing.js";
import { webProducts, webOrderFromBody } from "../weborder.js";
import { FORMAT, madrid, madridDate, madridTime } from "../export-format.js";
import { workbookFiles } from "../xlsx-files.js";
import { zipStore } from "./zip-browser.js";
import { BUSINESS } from "../config.js";
import data from "../ejemplo/historial-ficticio.json";

setCatalog(data.products);
const UNKNOWN = { name: "Número desconocido (cliente nuevo)", phone: "34699000000" };
const last9 = (p) => String(p).replace(/\D/g, "").slice(-9);
const customerByPhone = (phone) => data.customers.find((c) => last9(c.phone) === last9(phone)) ?? null;

let sessions, orders, exports_, nextId, usedLinks;
const reset = () => {
  sessions = new Map();
  orders = [];
  exports_ = [];
  nextId = 1;
  usedLinks = new Set();
};
reset();

const uid = () => Math.random().toString(36).slice(2, 10);

// Guarda un pedido igual que lo hace db.js: referencia correlativa, líneas valoradas, pendiente de exportar
function saveOrder(order, customer) {
  const o = priceOrder(order, customer, getCatalog());
  const id = nextId++;
  const row = {
    id,
    ref: `VM-${o.at.slice(0, 4)}-${String(id).padStart(6, "0")}`,
    customer_id: o.customerId ?? null,
    phone: o.phone,
    name: o.name,
    address: o.address,
    text: o.text,
    note: o.note || null,
    total: o.total,
    review: !!o.review,
    re: !!o.re,
    export_status: "pending",
    created_at: o.at,
    items: o.items.map((i) => ({
      id: String(i.id), name: i.name, price: i.price, qty: i.qty, unit: i.unit ?? "ud", boxes: i.boxes ?? null,
      units: i.units ?? i.qty, discount: i.discount ?? 0, vat_rate: i.vat ?? null, amount: i.amount ?? null, note: i.note ?? null,
    })),
  };
  orders.push(row);
  return row;
}

const rowTotals = (o) => totals(o.items.map((i) => ({ ...i, vat: i.vat_rate })), o.re);

window.VMDemo = {
  business: BUSINESS.name,
  customers: () => [...data.customers.map((c) => ({ name: c.name, phone: c.phone.replace(/\D/g, "") })), UNKNOWN],
  reset,
  resetChat: (phone) => sessions.delete(String(phone)),

  /** Un mensaje del cliente al bot (texto libre o id de botón/fila). */
  send(phone, text) {
    phone = String(phone);
    let cur = sessions.get(phone);
    if (!cur) {
      const customer = customerByPhone(phone);
      cur = newSession(customer, customer ? "#mini" : null);
    }
    const out = handleMessage(cur, String(text ?? "").slice(0, 1000));
    sessions.set(phone, out.session);
    if (out.order) saveOrder({ at: new Date().toISOString(), phone, key: `demo:${uid()}`, ...out.order }, cur.customer ?? null);
    return { reply: out.reply, ui: out.ui, handoff: !!out.handoff };
  },

  // ---- Mini-aplicación de pedido (lo que abre «Hacer pedido») ----
  miniOpen: () => uid(),
  miniData(phone, link) {
    const customer = customerByPhone(phone);
    if (!customer) return { error: "Enlace no válido o caducado" };
    return {
      business: BUSINESS.name,
      priceNote: BUSINESS.priceNote,
      customer: { name: customer.name, address: customer.address },
      used: usedLinks.has(link),
      products: webProducts(customer, getCatalog(), habitualProducts),
    };
  },
  miniSubmit(phone, link, body) {
    const customer = customerByPhone(phone);
    if (!customer) return { status: 410, json: { error: "Enlace no válido o caducado" } };
    if (usedLinks.has(link)) return { status: 409, json: { error: "Este pedido ya se envió" } };
    const built = webOrderFromBody(body, customer, { key: `web:${link}`, phone: String(phone).replace(/\D/g, "") }, getCatalog());
    if (built.error) return { status: 400, json: { error: built.error } };
    usedLinks.add(link);
    const row = saveOrder(built.order, customer);
    const message = `🎉 ¡Pedido recibido, ${customer.name}! ${row.items.length} artículos, total aprox. ${row.total.toFixed(2)}${BUSINESS.currency}.\n\n${BUSINESS.payment}`;
    return { status: 200, json: { ok: true, message } };
  },

  // ---- Panel de la empresa ----
  orders: () =>
    orders.map((o) => ({
      ref: o.ref, hora: madridTime(o.created_at), cliente: o.name, codigo: o.customer_id, lineas: o.items.length,
      resumen: o.items.map((i) => `${i.boxes ?? i.units} ${i.boxes ? "caja" + (i.boxes > 1 ? "s" : "") : "ud"} ${i.name}`).join(" · "),
      total: rowTotals(o).total, estado: o.export_status === "exported" ? "exportado" : o.review || !o.customer_id ? "retenido" : "pendiente",
      motivo: !o.customer_id ? "Cliente sin código de ERP" : o.review ? "Interpretación dudosa" : "",
    })),

  /** Exporta los pedidos pendientes (todo o nada) y devuelve el Excel generado. */
  exportNow() {
    const pending = orders.filter((o) => o.export_status === "pending");
    const ready = pending.filter((o) => !o.review && o.customer_id && o.items.length);
    const held = pending.length - ready.length;
    if (!ready.length) return { export: null, held };
    const { sheets, lineCount } = FORMAT.build(ready);
    const bytes = zipStore(workbookFiles(sheets));
    const stamp = madrid(new Date().toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
    const exp = { id: exports_.length + 1, fileName: `pedidos-${stamp}.xlsx`, orderCount: ready.length, lineCount, bytes, sheets };
    for (const o of ready) o.export_status = "exported";
    exports_.push(exp);
    return { export: exp, held };
  },
  madridDate,
};
