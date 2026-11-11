// Demo del sistema que funciona entera en el navegador: mismo bot, mismos cálculos y mismo Excel que el servidor,
// con clientes y artículos FICTICIOS. Dos vistas (cliente y distribuidor) comparten las bases de datos de productos,
// clientes, pedidos y exportaciones, que se guardan y se actualizan (base compartida de Claude, o el navegador).
import { handleMessage, newSession, setCatalog, setCustomerFinder, setLinkMaker, getCatalog, habitualProducts } from "../bot.js";
import { priceOrder, totals } from "../pricing.js";
import { webProducts, webHistory, webTree, webOrderFromBody, withOwnOrders, conHistorial } from "../weborder.js";
import { deliveryOptions, deliveryInfo, deliveryCalendarFrom, madridDay, puedeHoy } from "../delivery.js";
import { findCustomers } from "../identify.js";
import { FORMAT, madrid, madridTime } from "../export-format.js";
import { workbookFiles, estiloCss, estiloDecimales } from "../xlsx-files.js";
import { zipStore } from "./zip-browser.js";
import { BUSINESS } from "../config.js";
import { seedDocs, DEMO_ACCOUNTS } from "./seeds.js";
import { sha256hex } from "./sha256.js";
import { makeDbBackend, makeLocalBackend } from "./backend.js";
import data from "../ejemplo/historial-ficticio.json";
import { demoNifMatches, demoCodeKey, unirClavesNif } from "./nif-demo.js";
import { nifClean } from "../nif-codes.js";
import { nifCodes } from "../nif-codes.js";
import { crearActualizador } from "../actualizar-datos.js";
import { privacidadHtml } from "../privacidad.js";

const PHONE = "34600999999"; // el móvil de prueba no está en ninguna ficha: el bot pregunta quién es
const COLLS = ["products", "customers", "orders", "exports", "registrations", "accounts"];
const uid = () => Math.random().toString(36).slice(2, 8);

let backend, mode = "local", perms = { canWrite: true, isAdmin: true };
let rawProducts = [];
const cache = { products: [], customers: [], orders: [], exports: [], registrations: [], accounts: [] };
const listeners = new Set();
const errorListeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
const report = (e) => { console.error(e); errorListeners.forEach((f) => f(e)); };
const sessions = new Map();
const favsDemo = new Map(); // favoritos de la demo (solo en memoria)
const links = new Map();

const activeCatalog = () =>
  [...cache.products].filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name, price: p.price, ...(p.unitsPerBox ? { unitsPerBox: p.unitsPerBox } : {}), vat: p.vat, discount: p.discount, ...(p.category ? { category: p.category } : {}), ...(p.subcategory ? { subcategory: p.subcategory } : {}) }));

function onData(coll, rows) {
  if (coll === "customers") {
    // El documento «_nifindex» guarda las huellas de los 6 primeros dígitos del DNI de cada cliente (no es un cliente)
    const idx = rows.find((d) => d.id === "_nifindex")?.keys ?? {};
    rows = rows.filter((d) => d.id !== "_nifindex").map((c) => ({ ...c, nifKeys: unirClavesNif(c, idx, globalThis.__VM_NIF__) })); // huellas propias + índice de la base + las preparadas al compilar
  }
  if (coll === "products") rawProducts = rows; // lo que hay de verdad en la base, antes de la vista previa con la tarifa
  // Vista previa con la tarifa real: si la página trae una (build con TARIFA_JSON), sustituye a los productos de ejemplo (solo lectura)
  if (coll === "products" && globalThis.__VM_TARIFA__ && rows.length < 200) rows = // solo mientras la base tenga los productos de ejemplo: cuando se cargan los reales (#cargar-datos) mandan los de la base
    globalThis.__VM_TARIFA__.map((p) => ({ ...p, unitsPerBox: p.unitsPerBox ?? null, discount: p.discount ?? 0, updatedAt: null, changes: [] }));
  if (coll === "products" && globalThis.__VM_TARIFA__ && rows.length >= 200) { // base ya con los productos reales: las categorías por tipo de producto de esta vista mandan sobre las guardadas
    const cats = new Map(globalThis.__VM_TARIFA__.map((p) => [String(p.id), p]));
    rows = rows.map((r) => { const c = cats.get(String(r.id)); return c?.category ? { ...r, category: c.category, subcategory: c.subcategory } : r; });
  }
  if (coll === "customers" && globalThis.__VM_HISTORIAL__) rows = conHistorial(rows, globalThis.__VM_HISTORIAL__); // histórico puesto a mano a clientes concretos (p. ej. un cliente de prueba)
  if (coll === "customers" && globalThis.__VM_PRUEBA__) rows = [...rows, ...globalThis.__VM_PRUEBA__.filter((p) => !rows.some((c) => c.id === p.id))]; // clientes falsos de prueba (solo en la vista)
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
const nifFails = { n: 0, until: 0 }; // fallos de NIF (en la demo, solo en este navegador)
const attempts = new Map(); // intentos fallidos por teléfono (en la demo, solo en este navegador)
// Cuentas de clientes habituales: ya existen para todos los clientes activos (id "n"+código); entran con el NIF y no se guardan
const nifAccount = (customer) => ({ id: "n" + customer.id, customerId: customer.id, phone: phonesOf(customer)[0] ?? PHONE, status: "active", verified: true });
const currentAccount = () => {
  const id = store.get("vm:acc");
  if (id?.startsWith("n")) { const c = cache.customers.find((x) => x.id === id.slice(1) && x.active !== false); return c ? nifAccount(c) : null; }
  return cache.accounts.find((a) => a.id === id && a.status === "active") ?? null;
};
// El cliente con su historial MÁS lo que ha pedido en la demo (para «histórico» y «último pedido»)
const propios = (id) => [...cache.orders].filter((o) => o.customer_id === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 10)
  .map((o) => ({ doc: o.id, date: String(o.created_at).slice(0, 10), lines: o.items.map((i) => ({ productId: String(i.id), qty: i.units ?? i.qty })).filter((l) => l.qty > 0) }));
const customerOf = (acc) => { const c = acc ? cache.customers.find((x) => x.id === acc.customerId) ?? null : null; return c && withOwnOrders(c, propios(c.id)); };
const phonesOf = (c) => (c.phones?.length ? c.phones : [phone9(c.phone)].filter(Boolean));
// Compara una solicitud con la base de clientes. Acceso automático solo si hay UN cliente cuyo nombre (comercial o razón social)
// coincide Y cuyo teléfono o correo guardados coinciden con los enviados.
function matchRegistration({ phone, email, business }) {
  const k = phone9(phone) ?? "", mail = String(email ?? "").trim().toLowerCase();
  const byName = findCustomers(cache.customers, business);
  const hasPhone = (c) => !!k && phonesOf(c).includes(k);
  const hasEmail = (c) => !!mail && (c.emails ?? []).includes(mail);
  const hits = byName.filter((c) => hasPhone(c) || hasEmail(c));
  const ids = new Set([...byName.map((c) => c.id), ...cache.customers.filter((c) => c.active !== false && (hasPhone(c) || hasEmail(c))).map((c) => c.id)]);
  const suggestions = [...ids].map((id) => { const c = cache.customers.find((x) => x.id === id); return { id, name: c.name, motivo: [byName.some((b) => b.id === id) ? "nombre" : null, hasPhone(c) ? "teléfono" : null, hasEmail(c) ? "correo" : null].filter(Boolean).join(" + ") }; });
  if (hits.length === 1) return { customer: hits[0], matched: { phone: hasPhone(hits[0]), email: hasEmail(hits[0]) }, suggestions };
  return { customer: null, reason: hits.length > 1 ? "ambiguo" : byName.length ? "contacto" : "nombre", suggestions };
}
const MOTIVOS = { ambiguo: "Hay varios clientes que encajan", contacto: "El nombre coincide pero no el teléfono ni el correo", nombre: "No hay ningún cliente con ese nombre" };
const SIN_CONFIRMAR = "Cuenta de alta automática sin confirmar: comprueba que es el cliente antes de exportar";

// Cuenta de alta automática sin confirmar: puede pedir, pero sus pedidos se retienen hasta que la empresa los revise
const holdIfUnconfirmed = (acc, order) => (acc && acc.verified === false ? { ...order, review: true, reason: SIN_CONFIRMAR } : order);

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
    customer_id: o.customerId ?? null, phone: o.phone, name: o.name, address: o.address, city: o.city || null, text: o.text, note: o.note || null, delivery_date: o.delivery ?? null,
    total: o.total, review: !!o.review, reason: o.reason ?? null, re: !!o.re, export_status: "pending", export_id: null, created_at: o.at,
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


// ---- Actualizar datos desde Excel (el mismo actualizador del programa real, sobre los datos de la demo) ----
// Las lecturas salen de la memoria y las escrituras se encolan: tras aplicar se esperan todas.
const pendientes = [];
const escribe = (p) => { pendientes.push(p); return p; };
const adaptCatalogo = {
  list: () => cache.products.map((p) => ({ ...p, active: p.active !== false })),
  upsertProducts(lista, { deactivateMissing = false } = {}) {
    const hoy = new Map(cache.products.map((p) => [String(p.id), p])), vistos = new Set(), r = { added: 0, updated: 0, unchanged: 0, deactivated: 0 };
    const salida = new Map(); // id → documento que debe quedar
    for (const n of lista) {
      const id = String(n.id), a = hoy.get(id); vistos.add(id);
      const nuevo = { ...(a ?? { discount: 0, changes: [], updatedAt: null }), ...n, id, active: true };
      if (!a) r.added++; else if (JSON.stringify({ ...a, active: a.active !== false }) !== JSON.stringify(nuevo)) r.updated++; else { r.unchanged++; continue; }
      salida.set(id, { ...nuevo, updatedAt: new Date().toISOString() });
    }
    if (deactivateMissing) for (const a of cache.products) if (a.active !== false && !vistos.has(String(a.id))) { r.deactivated++; salida.set(String(a.id), { ...a, active: false }); }
    // Mientras la página enseña la tarifa de ejemplo en vez de lo que hay en la base, la primera vez se guardan TODOS los productos (y se retiran los de ejemplo)
    if (globalThis.__VM_TARIFA__ && rawProducts.length < 200) {
      for (const a of cache.products) if (!salida.has(String(a.id))) salida.set(String(a.id), { ...a });
      for (const d of rawProducts) if (!salida.has(String(d.id))) escribe(backend.remove("products", String(d.id)));
    }
    for (const [id, doc] of salida) escribe(backend.set("products", id, doc));
    return r;
  },
};
const adaptClientes = {
  count: () => cache.customers.length,
  getById: (id) => { const c = cache.customers.find((x) => x.id === String(id)); return c ? { ...c, address: c.address ?? "", legalName: c.legalName ?? "", phone: c.phone ?? "", phones: c.phones ?? [], emails: c.emails ?? [], active: c.active !== false, orders: c.orders ?? [] } : null; },
  list: () => cache.customers.map((c) => ({ id: c.id, name: c.name, active: c.active !== false })),
  upsertCustomers(lista) {
    const r = { added: 0, updated: 0 };
    for (const n of lista) {
      const a = cache.customers.find((x) => x.id === n.id), { nifKeys: _k, ...resto } = n; // las huellas de NIF no se tocan en la demo
      const clean = Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && !v.length)));
      if (a) { r.updated++; escribe(backend.set("customers", a.id, { ...a, ...clean })); } else { r.added++; escribe(backend.set("customers", n.id, { specialPrices: {}, discounts: {}, orders: [], ...resto, nifKeys: [] })); }
    }
    return r;
  },
  setPurchases(porCliente) {
    const r = { clientes: 0, lineas: 0, desconocidos: 0 };
    for (const [cid, pedidos] of porCliente) {
      if (!cache.customers.some((x) => x.id === String(cid))) { r.desconocidos++; continue; }
      escribe(backend.set("customers", String(cid), { ...cache.customers.find((x) => x.id === String(cid)), orders: pedidos })); r.clientes++; r.lineas += pedidos.reduce((n, o) => n + o.lines.length, 0);
    }
    return r;
  },
};
const actualizador = crearActualizador({ catalogDb: adaptCatalogo, customersDb: adaptClientes, accountsDb: { ensureMany: () => 0 } });
document.querySelectorAll("[data-privacidad]").forEach((n) => { n.outerHTML = privacidadHtml({ email: "" }); }); // información de privacidad en el acceso y en la solicitud de alta
window.VM = {
  estiloCss, estiloDecimales, // para pintar la vista previa del Excel con sus estilos reales
  business: BUSINESS.name,
  phone: PHONE,
  ready: () => ready,
  info: () => ({ mode, ...perms }),
  onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  onError: (fn) => (errorListeners.add(fn), () => errorListeners.delete(fn)),

  // ---- Vista del cliente: el chat ----
  demoAccounts: DEMO_ACCOUNTS.map((a) => ({ phone: a.phone, pin: a.pin, customerId: a.customerId })),

  // ---- Vista del cliente: acceso con teléfono + PIN y chat ----
  /**
   * El cliente se da de alta con empresa, teléfono, correo y un PIN que elige. El sistema lo comprueba contra la base de clientes:
   * si coinciden el nombre y el teléfono (o el correo) de UN cliente, la cuenta queda activa al momento (sin confirmar); si no,
   * pasa a «Solicitudes de alta» para que la revise la empresa.
   */
  async requestAccess({ phone, email, business, pin, nif }) {
    const p = phone9(phone), biz = String(business ?? "").trim().replace(/\s+/g, " "), mail = String(email ?? "").trim();
    if (biz.length < 2 || biz.length > 80) return { error: "Escribe el nombre de tu empresa." };
    if (!p) return { error: "El teléfono no es válido." };
    if (!validEmail(mail)) return { error: "El correo no es válido." };
    if (!/^[A-Z0-9]{6}$/.test(nifClean(pin))) return { error: "Elige una contraseña de 6 letras o números." };
    const dni = nifClean(nif);
    if (!/^[A-Z0-9]{8,10}$/.test(dni) || dni.replace(/\D/g, "").length < 6) return { error: "Escribe tu DNI, NIE o CIF (por ejemplo 12345678Z o B12345678)." };
    if (!perms.canWrite) return { error: "Solo lectura: no se pueden enviar solicitudes con este acceso." };
    const now = new Date().toISOString();
    const m = matchRegistration({ phone: p, email: mail, business: biz });
    if (m.customer) {
      if (cache.accounts.some((a) => a.phone === p)) return { error: "Este teléfono ya tiene acceso. Entra con tu PIN." };
      const id = `a${Date.now().toString(36)}${uid()}`;
      await backend.set("accounts", id, { id, customerId: m.customer.id, phone: p, email: mail, pinHash: pinHash(p, pin), status: "active", verified: false, createdAt: now });
      const rid = `r${Date.now().toString(36)}${uid()}`;
      await backend.set("registrations", rid, { id: rid, phone: p, email: mail, business: biz, status: "auto", customerId: m.customer.id, matched: `nombre + ${[m.matched.phone ? "teléfono" : null, m.matched.email ? "correo" : null].filter(Boolean).join(" y ")}`, createdAt: now });
      return { ok: true, estado: "activa", mensaje: "Listo: ya tienes acceso. Entra con tu teléfono, el nombre de tu empresa y tu contraseña." };
    }
    const open = cache.registrations.find((r) => r.phone === p && r.status === "pending");
    const id = open?.id ?? `r${Date.now().toString(36)}${uid()}`;
    const doc = { id, phone: p, email: mail, business: biz, status: "pending", pinHash: pinHash(p, pin), nif: dni, matched: MOTIVOS[m.reason], createdAt: now };
    await (open ? backend.update("registrations", id, doc) : backend.set("registrations", id, doc));
    return { ok: true, estado: "pendiente", mensaje: "Hemos recibido tu solicitud. En un plazo de 24 a 48 horas nos pondremos en contacto contigo y se aceptará tu cuenta para que puedas hacer pedidos." };
  },
  /** Teléfono + nombre de la empresa + PIN. La respuesta es la misma si algo falla (no se revela qué). */
  login(phone, business, pin) {
    const p = phone9(phone) ?? "";
    if (String(business ?? "").trim().length < 2) return { ok: false, error: "Escribe el nombre de tu empresa." };
    const st = attempts.get(p) ?? { fails: 0, until: 0 };
    if (st.until > Date.now()) return { ok: false, error: "Cuenta bloqueada temporalmente. Inténtalo más tarde o llama a la empresa." };
    let acc = cache.accounts.find((a) => a.phone === p && a.status === "active");
    if (!acc && !cache.accounts.some((a) => a.phone === p)) { // cliente habitual: teléfono de la lista de clientes + la contraseña personal que eligió dentro
      const delTel = cache.customers.filter((c) => c.active !== false && phonesOf(c).includes(p));
      const c = delTel.length === 1 ? delTel[0] : null, propia = c && cache.accounts.find((a) => a.customerId === c.id && a.codeKey);
      if (propia && propia.status === "active" && propia.codeKey === demoCodeKey(pin)) acc = { ...nifAccount(c), codeKey: propia.codeKey };
    }
    if (cache.accounts.some((a) => a.status === "deleted" && (a.phone === p || phonesOf(cache.customers.find((c) => c.id === a.customerId) ?? {}).includes(p)))) return { ok: false, error: "Esta cuenta se eliminó. Si quieres volver a usar la aplicación, llámanos o solicita el alta de nuevo." };
    const customer = customerOf(acc);
    const nombreOk = !!customer && findCustomers([customer], business).length > 0; // el nombre se compara con la base de clientes
    if (!acc || !nombreOk || !/^[A-Z0-9]{6}$/.test(nifClean(pin)) || (acc.id.startsWith("n") ? acc.codeKey !== demoCodeKey(pin) : acc.pinHash !== pinHash(p, nifClean(pin)))) {
      st.fails += 1;
      if (st.fails >= 5) { st.fails = 0; st.until = Date.now() + 15 * 60_000; }
      attempts.set(p, st);
      return { ok: false, error: "Teléfono, contraseña o nombre de la empresa incorrectos. Usa el teléfono con el que sueles contactar con nosotros." };
    }
    attempts.delete(p);
    store.set("vm:acc", acc.id);
    return { ok: true, nombre: customer.name };
  },
  /** Cliente habitual: solo los 6 primeros dígitos del DNI/CIF. El nombre, si se envía, estrecha la búsqueda. */
  loginNif(nif, business) {
    if (!nifCodes(nif).length && !/^[A-Z0-9]{6}$/.test(nifClean(nif))) return { ok: false, error: "Escribe los 6 primeros dígitos de tu DNI o CIF." }; // o el PIN personal
    const now = Date.now();
    if (nifFails.until > now) return { ok: false, error: "Demasiados intentos. Prueba más tarde o llama a la empresa." };
    // ¿Es el código personal que el cliente eligió en lugar del NIF?
    const own = /^[A-Z0-9]{6}$/.test(nifClean(nif)) && cache.accounts.find((a) => a.codeKey === demoCodeKey(nif) && a.status === "active");
    if (own) { store.set("vm:acc", own.id); return { ok: true, nombre: customerOf(own)?.name ?? "" }; }
    const names = String(business ?? "").trim().length >= 2 ? new Set(findCustomers(cache.customers, business, { lenient: true }).map((c) => c.id)) : null;
    if (cache.customers.some((c) => cache.accounts.some((a) => a.customerId === c.id && a.status === "deleted") && demoNifMatches(c.id, nif, c.nifKeys))) return { ok: false, error: "Esta cuenta se eliminó. Si quieres volver a usar la aplicación, llámanos o solicita el alta de nuevo." };
    const hits = cache.customers.filter((c) => c.active !== false && (!names || names.has(c.id)) && !cache.accounts.some((a) => a.customerId === c.id && a.codeKey) && demoNifMatches(c.id, nif, c.nifKeys)); // con código personal, el NIF ya no vale
    if (hits.length > 1 && !names) return { ok: false, necesitaNombre: true, error: "Hay varios negocios con ese NIF. Escribe también el nombre de tu empresa." };
    if (hits.length !== 1) {
      if (!hits.length && ++nifFails.n >= 15) { nifFails.n = 0; nifFails.until = now + 60 * 60_000; } // como el servidor: pocos fallos por hora entre todos
      return { ok: false, error: hits.length > 1 ? "NIF incorrecto. Si te sigue fallando, llama a la empresa." : "Ese NIF no consta entre los clientes habituales. Si eres un cliente nuevo, solicita el alta (más abajo); si ya lo eres, llámanos." };
    }
    store.set("vm:acc", "n" + hits[0].id);
    return { ok: true, nombre: hits[0].name };
  },
  logout() { store.set("vm:acc", null); sessions.clear(); },
  /** Cliente con sesión iniciada (o null). */
  me() { const a = currentAccount(), c = customerOf(a); return c ? { nombre: c.name, codigoPropio: !!cache.accounts.find((x) => x.id === a.id)?.codeKey } : null; },
  /** El cliente cambia los 6 del NIF por un PIN personal (6 letras o números), único entre todos los clientes. */
  async changeCode(nuevo) {
    const a = currentAccount();
    if (!a || !a.id.startsWith("n")) return { ok: false, error: "Entra primero con los 6 primeros dígitos de tu DNI." };
    if (!/^[A-Z0-9]{6}$/.test(nifClean(nuevo))) return { ok: false, error: "La contraseña debe tener exactamente 6 letras o números." };
    if (cache.customers.some((c) => demoNifMatches(c.id, nuevo, c.nifKeys)) || cache.accounts.some((x) => x.codeKey === demoCodeKey(nuevo) && x.id !== a.id)) return { ok: false, error: "Ese código no está disponible. Elige otro." };
    if (!perms.canWrite) return { ok: false, error: "En modo solo lectura no se puede cambiar el PIN." };
    const cur = cache.accounts.find((x) => x.id === a.id);
    await backend.set("accounts", a.id, { ...(cur ?? { id: a.id, customerId: a.customerId, status: "active", verified: true, createdAt: new Date().toISOString() }), codeKey: demoCodeKey(nuevo) });
    return { ok: true };
  },
  /** Derecho de acceso y portabilidad: todo lo que la demo guarda del cliente de la sesión (sin DNI ni contraseña). */
  misDatos() {
    const a = currentAccount(), c = customerOf(a);
    if (!c) return null;
    return {
      aviso: "Estos son los datos que Distribuciones Valentín Martín guarda sobre ti. No guardamos tu DNI/CIF ni tu contraseña en claro.", generado: new Date().toISOString(),
      cuenta: { telefono: a.phone ?? null, correo: cache.accounts.find((x) => x.id === a.id)?.email ?? null, estado: a.status },
      cliente: { codigo: c.id, nombre: c.name, razon_social: c.legalName ?? "", poblacion: c.city ?? "", direccion: c.address ?? "", telefonos: c.phones ?? [], correos: c.emails ?? [] },
      historial_de_compras: (c.orders ?? []).map((o) => ({ documento: o.doc, fecha: o.date, lineas: o.lines })),
      pedidos_hechos_en_la_aplicacion: cache.orders.filter((o) => o.customer_id === c.id).map((o) => ({ referencia: o.ref ?? o.id, fecha: o.created_at, entrega: o.delivery_date ?? null, nota: o.note ?? null, lineas: o.items })),
      favoritos: [...(favsDemo.get(c.id) ?? [])],
    };
  },
  /** Corregir / limitar / oponerse: llega a la empresa (en la demo se guarda en memoria). */
  async derechos(tipo, texto) {
    const a = currentAccount();
    if (!a) return { ok: false, error: "No has iniciado sesión." };
    if (!["corregir", "limitar", "oponerme", "otra"].includes(tipo)) return { ok: false, error: "Elige qué quieres pedir." };
    const t = String(texto ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
    if (t.length < 3) return { ok: false, error: "Cuéntanos qué necesitas (unas palabras bastan)." };
    const id = "d" + Date.now().toString(36) + uid();
    await backend.set("registrations", id, { id, status: "derecho", customerId: a.customerId, tipo, texto: t, estado: "pendiente", creada: new Date().toISOString() }); // (en la demo, junto a las solicitudes, con su propio estado)
    return { ok: true, mensaje: "Recibido. La empresa te contestará en el plazo máximo de un mes." };
  },
  /** Supresión: se borran acceso, contactos y favoritos; la cuenta queda marcada como eliminada y se deja constancia. */
  async eliminarCuenta(confirmo) {
    const a = currentAccount();
    if (!a) return { ok: false, error: "No has iniciado sesión." };
    if (String(confirmo ?? "").trim().toUpperCase() !== "ELIMINAR") return { ok: false, error: "Para eliminar la cuenta escribe ELIMINAR." };
    if (!perms.canWrite) return { ok: false, error: "En modo solo lectura no se puede eliminar la cuenta." };
    const ahora = new Date().toISOString();
    for (const x of cache.accounts.filter((x) => x.customerId === a.customerId)) await backend.update("accounts", x.id, { status: "deleted", phone: null, email: null, pinHash: null, codeKey: null, deletedAt: ahora });
    if (!cache.accounts.some((x) => x.customerId === a.customerId)) await backend.set("accounts", "x" + a.customerId, { id: "x" + a.customerId, customerId: a.customerId, status: "deleted", phone: null, email: null, deletedAt: ahora, createdAt: ahora });
    favsDemo.delete(a.customerId);
    const id = "d" + Date.now().toString(36) + uid();
    await backend.set("registrations", id, { id, status: "derecho", customerId: a.customerId, tipo: "supresion", texto: "El cliente eliminó su cuenta desde la aplicación (acceso, contactos y favoritos borrados; pedidos conservados por obligación legal).", estado: "atendida", creada: ahora });
    store.set("vm:acc", null); sessions.clear();
    return { ok: true, mensaje: "Tu cuenta se ha eliminado." };
  },
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
    if (out.order) saved = saveOrder({ at: new Date().toISOString(), phone: acc.phone, key: `demo:${uid()}`, ...holdIfUnconfirmed(acc, out.order) }, customer);
    return { reply: out.reply, ui: out.ui, handoff: !!out.handoff, saved, cards: out.cards ?? null, short: out.short ?? null };
  },

  // ---- Mini-aplicación de pedido (lo que abre «Hacer pedido») ----
  miniOpen() {
    const id = uid();
    links.set(id, { customer: customerOf(currentAccount()), used: false });
    return id;
  },
  miniFav(link, body) {
    const customer = links.get(link)?.customer;
    if (!customer) return { status: 410, json: { error: "Enlace no válido o caducado" } };
    const id = String(body?.id ?? "");
    if (!getCatalog().some((p) => String(p.id) === id)) return { status: 400, json: { error: "Producto no válido" } };
    const set = favsDemo.get(customer.id) ?? new Set(); favsDemo.set(customer.id, set);
    if (body?.on === false) set.delete(id); else set.add(id);
    return { status: 200, json: { ok: true, favs: [...set] } };
  },
  miniData(link) {
    const customer = links.get(link)?.customer;
    if (!customer) return { error: "Enlace no válido o caducado" };
    return { business: BUSINESS.name, priceNote: BUSINESS.priceNote, customer: { name: customer.name, address: customer.address, re: !!customer.recargoEquivalencia }, used: links.get(link).used, favs: [...(favsDemo.get(customer.id) ?? [])], products: webProducts(customer, getCatalog(), habitualProducts, (id) => globalThis.__VM_FOTOS__?.[id] ?? null, (id) => !!globalThis.__VM_FOTOS_IA__?.includes(id)), history: webHistory(customer, getCatalog()), tree: webTree(getCatalog()), delivery: deliveryOptions(undefined, { hoy: puedeHoy(customer) }), today: madridDay(), minDate: deliveryCalendarFrom(undefined, { hoy: puedeHoy(customer) }) };
  },
  miniSubmit(link, body) {
    const customer = links.get(link)?.customer;
    if (!customer) return { status: 410, json: { error: "Enlace no válido o caducado" } };
    if (links.get(link).used) return { status: 409, json: { error: "Este pedido ya se envió" } };
    const built = webOrderFromBody(body, customer, { key: `web:${link}`, phone: currentAccount()?.phone ?? PHONE }, getCatalog());
    if (built.error) return { status: 400, json: { error: built.error } };
    links.get(link).used = true;
    const priced = priceOrder(built.order, customer, getCatalog());
    saveOrder(holdIfUnconfirmed(currentAccount(), built.order), customer);
    return { status: 200, json: { ok: true, message: `🎉 ¡Pedido recibido, ${customer.name}! ${priced.items.length} artículos, total aprox. ${priced.total.toFixed(2).replace(".", ",")} ${BUSINESS.currency.trim()}.\n\n${BUSINESS.payment}` } };
  },

  // ---- Vista del distribuidor ----
  products: () => [...cache.products].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map((p) => ({ id: p.id, name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, vat: p.vat, updatedAt: p.updatedAt, last: p.changes?.[0] ?? null })),
  customers: () => cache.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, recargoEquivalencia: !!c.recargoEquivalencia, orders: c.orders.length, lastOrder: c.orders[0]?.date ?? null })),
  orders: () =>
    withRefs().reverse().map((o) => ({
      id: o.id, ref: o.ref, hora: madridTime(o.created_at), cliente: o.name, codigo: o.customer_id, lineas: o.items.length,
      nota: o.note || "",
      entrega: deliveryInfo(o.delivery_date, o.created_at),
      resumen: o.items.map((i) => `${i.boxes ?? i.units} ${i.boxes ? "caja" + (i.boxes > 1 ? "s" : "") : "ud"} ${i.name}`).join(" · "),
      total: rowTotals(o).total, estado: o.export_status === "exported" ? "exportado" : o.review || !o.customer_id ? "retenido" : "pendiente",
      motivo: !o.customer_id ? "Cliente sin código de ERP" : o.review ? o.reason || "Interpretación dudosa" : "",
    })),
  exports: () => [...cache.exports].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),

  /** Avisos del panel: solicitudes pendientes y pedidos por exportar. */
  summary() {
    const rows = withRefs().filter((o) => o.export_status === "pending");
    const ready = rows.filter(isReady).length;
    return { solicitudes: cache.registrations.filter((r) => r.status === "pending").length, cuentasSinConfirmar: cache.accounts.filter((a) => a.verified === false).length, pedidosPendientes: ready, pedidosRetenidos: rows.length - ready };
  },
  registrations: () => cache.registrations.filter((r) => r.status === "pending").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).map((r) => ({ ...r, sugerencias: matchRegistration({ phone: r.phone, email: r.email, business: r.business }).suggestions })),
  searchCustomers: (q) => cache.customers.filter((c) => !q || c.name.toLowerCase().includes(String(q).toLowerCase()) || c.id === q).slice(0, 15).map((c) => ({ id: c.id, name: c.name })),
  /** La empresa aprueba una solicitud: liga el teléfono al cliente elegido. Vale el PIN que eligió el cliente. */
  async approve(regId, customerId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para aprobar solicitudes.");
    const r = cache.registrations.find((x) => x.id === regId && x.status === "pending");
    const c = cache.customers.find((x) => x.id === String(customerId));
    if (!r) throw new Error("La solicitud ya se resolvió.");
    if (!c) throw new Error("Elige un cliente de la lista.");
    if (cache.accounts.some((a) => a.phone === r.phone)) throw new Error("Ese teléfono ya tiene una cuenta.");
    const now = new Date().toISOString(), id = `a${Date.now().toString(36)}${uid()}`;
    await backend.set("accounts", id, { id, customerId: c.id, phone: r.phone, email: r.email, pinHash: r.pinHash, status: "active", verified: true, createdAt: now });
    await backend.update("registrations", r.id, { status: "approved", customerId: c.id, decidedAt: now });
    return { cliente: c.name, telefono: r.phone };
  },
  async reject(regId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    await backend.update("registrations", regId, { status: "rejected", decidedAt: new Date().toISOString() });
  },
  accounts: () => cache.accounts.map((a) => ({ id: a.id, cliente: customerOf(a)?.name ?? a.customerId, phone: a.phone, email: a.email ?? "", status: a.status, verified: a.verified !== false })),
  /** La empresa confirma una cuenta automática: sus pedidos dejan de retenerse. */
  async confirmAccount(accId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    await backend.update("accounts", accId, { verified: true });
  },
  /** Lista de clientes con búsqueda y páginas de 50 (la base completa está en memoria). */
  customersPage(q = "", page = 0) {
    const t = String(q).trim().toLowerCase();
    const conCuenta = new Set(cache.accounts.map((a) => a.customerId));
    const all = cache.customers.filter((c) => !t || [c.name, c.legalName, c.id, c.city, ...(c.phones ?? []), ...(c.emails ?? [])].some((v) => String(v ?? "").toLowerCase().includes(t))).sort((a, b) => a.name.localeCompare(b.name));
    return { total: all.length, page, perPage: 50, rows: all.slice(page * 50, page * 50 + 50).map((c) => ({ id: c.id, name: c.name, legalName: c.legalName ?? "", city: c.city ?? "", phones: phonesOf(c), emails: c.emails ?? [], active: c.active !== false, cuenta: conCuenta.has(c.id) })) };
  },
  /** Clientes con su historial (los que tienen compras primero): lista paginada para la pestaña «Historial de clientes». */
  historialPage(q = "", page = 0) {
    const t = String(q).trim().toLowerCase();
    const all = cache.customers.filter((c) => !t || [c.name, c.legalName, c.id].some((v) => String(v ?? "").toLowerCase().includes(t)))
      .map((c) => { const o = c.orders ?? []; return { id: c.id, name: c.name, pedidos: o.length, ultimo: o.map((x) => x.date).sort().pop() ?? "" }; })
      .sort((a, b) => (b.pedidos > 0) - (a.pedidos > 0) || a.name.localeCompare(b.name));
    return { total: all.length, page, perPage: 50, rows: all.slice(page * 50, page * 50 + 50) };
  },
  /** Pedidos de un cliente con el nombre de cada producto. */
  historialDe(id) {
    const c = cache.customers.find((x) => x.id === String(id)); if (!c) return null;
    const nombre = new Map(cache.products.map((p) => [String(p.id), p.name]));
    return { id: c.id, name: c.name, pedidos: [...(c.orders ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)).map((o) => ({ doc: o.doc, date: o.date, lineas: o.lines.map((l) => ({ id: l.productId, nombre: nombre.get(String(l.productId)) ?? "(producto que ya no está en el catálogo)", qty: l.qty })) })) };
  },
  /** La empresa da por revisado un pedido retenido. */
  async approveOrder(orderId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    await backend.update("orders", orderId, { review: false });
  },
  async resetPin(accId) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor.");
    const a = cache.accounts.find((x) => x.id === accId);
    if (!a) throw new Error("No existe la cuenta.");
    if (!a.phone) { await backend.update("accounts", a.id, { codeKey: null }); return { pin: "—", cliente: customerOf(a)?.name ?? "", telefono: "sin teléfono: vuelve a valer el NIF" }; } // cuenta de código personal: se restablece al NIF
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
  /** Exporta los pedidos pendientes listos (todos, o solo los de `ids` si la empresa los ha elegido). */
  async exportNow(ids = null) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para exportar.");
    const all = withRefs();
    const pending = all.filter((o) => o.export_status === "pending");
    const rows = pending.filter(isReady).filter((o) => !ids || ids.includes(o.id));
    const held = pending.length - pending.filter(isReady).length;
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
  /** Excel (productos, clientes o histórico) → { resumen, detalle, aviso, aplicable }. No escribe nada. */
  vistaPrevia(tipo, bytes) { return actualizador.vistaPrevia(tipo, Buffer.from(bytes)); },
  /** Aplica solo las diferencias del Excel. */
  async aplicarDatos(tipo, bytes, fichero, confirmo = false) {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para actualizar los datos.");
    const r = actualizador.aplicar(tipo, Buffer.from(bytes), { fichero, confirmo });
    await Promise.all(pendientes.splice(0));
    return r;
  },
  /** Borra SOLO los pedidos y las exportaciones (los de prueba): no toca clientes, productos, cuentas ni solicitudes. La numeración de pedidos vuelve a empezar. */
  async clearOrders() {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para borrar los pedidos.");
    const pedidos = [...cache.orders], exportaciones = [...cache.exports];
    for (const r of pedidos) await backend.remove("orders", r.id);
    for (const r of exportaciones) await backend.remove("exports", r.id);
    return { pedidos: pedidos.length, exportaciones: exportaciones.length };
  },
  /** Borra pedidos y exportaciones y restaura los datos de ejemplo. */
  async resetData() {
    if (!perms.isAdmin) throw new Error("Necesitas acceso de Editor para restaurar los datos.");
    sessions.clear();
    await backend.reset(seedDocs(data));
  },
};
