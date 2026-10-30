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
import { seedDocs, DEMO_ACCOUNTS } from "./seeds.js";
import { sha256hex } from "./sha256.js";
import { makeDbBackend, makeLocalBackend } from "./backend.js";
import data from "../ejemplo/historial-ficticio.json";

const PHONE = "34600999999"; // el móvil de prueba no está en ninguna ficha: el bot pregunta quién es
const COLLS = ["products", "customers", "orders", "exports", "registrations", "accounts"];
const uid = () => Math.random().toString(36).slice(2, 8);

let backend, mode = "local", perms = { canWrite: true, isAdmin: true };
const cache = { products: [], customers: [], orders: [], exports: [], registrations: [], accounts: [] };
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

// ---- Cuentas de clientes: el cliente pide acceso, la empresa lo aprueba y le da un PIN ----
const phone9 = (p) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 && d.length <= 15 ? d.slice(-9) : null; };
const validEmail = (e) => typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const pinHash = (phone, pin) => sha256hex(`${phone}:${pin}`); // en la demo se guarda el hash, nunca el PIN
const newPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} } };
const attempts = new Map(); // intentos fallidos por teléfono (en la demo, solo en este navegador)
const currentAccount = () => { const id = store.get("vm:acc"); return cache.accounts.find((a) => a.id === id && a.status === "active") ?? null; };
const customerOf = (acc) => (acc ? cache.customers.find((c) => c.id === acc.customerId) ?? null : null);
const suggest = (r) => {
  const out = new Map();
  for (const c of findCustomers(cache.customers, r.business)) out.set(c.id, { id: c.id, name: c.name, motivo: "nombre" });
  for (const c of cache.customers) if (phone9(c.phone) === r.phone) out.set(c.id, { id: c.id, name: c.name, motivo: out.has(c.id) ? "nombre y teléfono" : "teléfono" });
  return [...out.values()];
};

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
  demoAccounts: DEMO_ACCOUNTS.map((a) => ({ phone: a.phone, pin: a.pin, customerId: a.customerId })),

  // ---- Vista del cliente: acceso con teléfono + PIN y chat ----
  /** El cliente pide acceso: la empresa lo verá en «Solicitudes de alta». */
  async requestAccess({ phone, email, business }) {
    const p = phone9(phone), biz = String(business ?? "").trim().replace(/\s+/g, " ");
    if (!p) return { error: "El teléfono no es válido." };
    if (!validEmail(String(email ?? "").trim())) return { error: "El correo no es válido." };
    if (biz.length < 2 || biz.length > 80) return { error: "Escribe el nombre de tu empresa." };
    if (!perms.canWrite) return { error: "Solo lectura: no se pueden enviar solicitudes con este acceso." };
    const open = cache.registrations.find((r) => r.phone === p && r.status === "pending");
    const id = open?.id ?? `r${Date.now().toString(36)}${uid()}`;
    const doc = { id, phone: p, email: String(email).trim(), business: biz, status: "pending", createdAt: new Date().toISOString() };
    await (open ? backend.update("registrations", id, doc) : backend.set("registrations", id, doc));
    return { ok: true };
  },
  /** Teléfono + PIN. La respuesta es la misma si el teléfono no existe o el PIN falla. */
  login(phone, pin) {
    const p = phone9(phone) ?? "";
    const st = attempts.get(p) ?? { fails: 0, until: 0 };
    if (st.until > Date.now()) return { ok: false, error: "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." };
    const acc = cache.accounts.find((a) => a.phone === p && a.status === "active");
    if (!acc || !/^\d{6}$/.test(String(pin)) || acc.pinHash !== pinHash(p, pin)) {
      st.fails += 1;
      if (st.fails >= 5) { st.fails = 0; st.until = Date.now() + 15 * 60_000; }
      attempts.set(p, st);
      return { ok: false, error: "Teléfono o PIN incorrectos." };
    }
    attempts.delete(p);
    store.set("vm:acc", acc.id);
    return { ok: true, nombre: customerOf(acc)?.name ?? "" };
  },
  logout() { store.set("vm:acc", null); sessions.clear(); },
  /** Cliente con sesión iniciada (o null). */
  me() { const c = customerOf(currentAccount()); return c ? { nombre: c.name } : null; },
  resetChat: () => sessions.clear(),
  /** Un mensaje del cliente al bot (texto libre o id de botón/fila). El cliente sale SIEMPRE de la cuenta con sesión. */
  send(text) {
    const acc = currentAccount(), customer = customerOf(acc);
    if (!customer) return { reply: "Tu sesión ha caducado. Entra de nuevo.", ui: null, needLogin: true };
    let cur = sessions.get(acc.id) ?? newSession(customer, "#mini", { phone: acc.phone, holdUnverified: false, showHabitual: true });
    cur = { ...cur, customer };
    const out = handleMessage(cur, String(text ?? "").slice(0, 1000));
    sessions.set(acc.id, out.session);
    let saved = null;
    if (out.order) saved = saveOrder({ at: new Date().toISOString(), phone: acc.phone, key: `demo:${uid()}`, ...out.order }, customer);
    return { reply: out.reply, ui: out.ui, handoff: !!out.handoff, saved };
  },

  // ---- Mini-aplicación de pedido (lo que abre «Hacer pedido») ----
  miniOpen() {
    const id = uid();
    links.set(id, { customer: customerOf(currentAccount()), used: false });
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
    const built = webOrderFromBody(body, customer, { key: `web:${link}`, phone: currentAccount()?.phone ?? PHONE }, getCatalog());
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

  /** Avisos del panel: solicitudes pendientes y pedidos por exportar. */
  summary() {
    const rows = withRefs().filter((o) => o.export_status === "pending");
    const ready = rows.filter(isReady).length;
    return { solicitudes: cache.registrations.filter((r) => r.status === "pending").length, pedidosPendientes: ready, pedidosRetenidos: rows.length - ready };
  },
  registrations: () => cache.registrations.filter((r) => r.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((r) => ({ ...r, sugerencias: suggest(r) })),
  searchCustomers: (q) => cache.customers.filter((c) => !q || c.name.toLowerCase().includes(String(q).toLowerCase()) || c.id === q).slice(0, 15).map((c) => ({ id: c.id, name: c.name })),
  /** La empresa aprueba: liga el teléfono al cliente y genera el PIN (se devuelve una sola vez). */
  async approve(regId, customerId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para aprobar solicitudes.");
    const r = cache.registrations.find((x) => x.id === regId && x.status === "pending");
    const c = cache.customers.find((x) => x.id === String(customerId));
    if (!r) throw new Error("La solicitud ya se resolvió.");
    if (!c) throw new Error("Elige un cliente de la lista.");
    if (cache.accounts.some((a) => a.phone === r.phone)) throw new Error("Ese teléfono ya tiene una cuenta.");
    const pin = newPin(), now = new Date().toISOString(), id = `a${Date.now().toString(36)}${uid()}`;
    await backend.set("accounts", id, { id, customerId: c.id, phone: r.phone, email: r.email, pinHash: pinHash(r.phone, pin), status: "active", createdAt: now });
    await backend.update("registrations", r.id, { status: "approved", customerId: c.id, decidedAt: now });
    return { pin, cliente: c.name, telefono: r.phone };
  },
  async reject(regId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    await backend.update("registrations", regId, { status: "rejected", decidedAt: new Date().toISOString() });
  },
  accounts: () => cache.accounts.map((a) => ({ id: a.id, cliente: customerOf(a)?.name ?? a.customerId, phone: a.phone, email: a.email ?? "", status: a.status })),
  async resetPin(accId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    const a = cache.accounts.find((x) => x.id === accId);
    if (!a) throw new Error("No existe la cuenta.");
    const pin = newPin();
    await backend.update("accounts", a.id, { pinHash: pinHash(a.phone, pin), status: "active" });
    return { pin, cliente: customerOf(a)?.name ?? "", telefono: a.phone };
  },
  async setBlocked(accId, blocked) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    await backend.update("accounts", accId, { status: blocked ? "blocked" : "active" });
  },

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
