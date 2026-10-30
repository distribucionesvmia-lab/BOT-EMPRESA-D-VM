import test from "node:test";
import assert from "node:assert/strict";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { importData } from "./seed.js";

const productos = () => [
  { id: "1001", name: "AGUA 1,5 L", price: 0.42, unitsPerBox: 6, vat: 10 },
  { id: "1002", name: "COLA LATA", price: 0.55, unitsPerBox: 24, vat: 21 },
  { id: "1010", name: "AZUCAR 1 KG", price: 1.15 },
];

test("catálogo: alta, actualización parcial y registro de cambios", () => {
  const db = openCatalogDb(":memory:");
  assert.deepEqual(db.upsertProducts(productos()), { added: 3, updated: 0, unchanged: 0, deactivated: 0 });
  assert.equal(db.get("1010").unitsPerBox, undefined);
  const r = db.upsertProducts([{ ...productos()[0], price: 0.45 }, productos()[1]], { now: "2026-11-01T10:00:00Z" });
  assert.deepEqual([r.updated, r.unchanged], [1, 1]);
  assert.equal(db.get("1001").price, 0.45);
  assert.deepEqual({ ...db.history("1001")[0] }, { field: "price", oldValue: "0.42", newValue: "0.45", changedAt: "2026-11-01T10:00:00Z" });
  assert.equal(db.update("1002", { price: 0.6, unitsPerBox: 12 }), "updated");
  assert.equal(db.update("1002", { price: 0.6 }), "unchanged");
  assert.deepEqual([db.get("1002").price, db.get("1002").unitsPerBox], [0.6, 12]);
  assert.throws(() => db.update("9999", { price: 1 }), /No existe/);
});

test("catálogo: los datos no válidos no se guardan y no queda nada a medias", () => {
  const db = openCatalogDb(":memory:");
  assert.throws(() => db.upsertProducts([productos()[0], { id: "X", name: "Malo", price: -1 }]), /Precio no válido/);
  assert.equal(db.count(), 0);
  assert.throws(() => db.upsertProducts([{ id: "Y", name: "Malo", price: 1, unitsPerBox: 0 }]), /Unidades por caja/);
  assert.throws(() => db.upsertProducts([{ id: "Z", name: "Malo", price: 1, discount: 150 }]), /descuento/);
});

test("catálogo: los que faltan en una sincronización completa se dan de baja y no salen en el catálogo del bot", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts(productos());
  const r = db.upsertProducts(productos().slice(0, 2), { deactivateMissing: true });
  assert.equal(r.deactivated, 1);
  assert.deepEqual(db.list().map((p) => p.id).sort(), ["1001", "1002"]);
  assert.equal(db.list({ activeOnly: false }).length, 3);
  db.upsertProducts(productos()); // vuelve a venir: se reactiva
  assert.equal(db.list().length, 3);
});

test("catálogo: la versión cambia cuando hay cambios (el bot recarga precios)", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts(productos(), { now: "2026-11-01T10:00:00Z" });
  const v1 = db.version();
  db.upsertProducts(productos(), { now: "2026-11-02T10:00:00Z" }); // sin cambios: misma versión
  assert.equal(db.version(), v1);
  db.update("1001", { price: 9 }, "2026-11-03T10:00:00Z");
  assert.notEqual(db.version(), v1);
});

const clientes = () => [
  {
    id: "9001", name: "Bar El Ejemplo", phone: "+34 600 000 001", address: "Calle 1", recargoEquivalencia: true,
    specialPrices: { 1002: 0.5 }, discounts: { 1001: 5 },
    orders: [
      { doc: "F1", date: "2026-10-01", lines: [{ productId: "1001", qty: 12 }] },
      { doc: "F2", date: "2026-10-20", lines: [{ productId: "1002", qty: 24 }, { productId: "1001", qty: 6 }] },
    ],
  },
  { id: "9002", name: "Tienda Ficticia", phone: "+34 600 000 002", orders: [] },
  { id: "9003", name: "Otra Tienda", phone: "600000002" }, // comparte teléfono con 9002
];

test("clientes: ficha completa con historial (último pedido primero), precios y descuentos", () => {
  const db = openCustomersDb(":memory:");
  assert.deepEqual(db.upsertCustomers(clientes()), { added: 3, updated: 0 });
  const c = db.getById("9001");
  assert.deepEqual(c.orders.map((o) => o.doc), ["F2", "F1"]);
  assert.deepEqual(c.orders[0].lines, [{ productId: "1002", qty: 24 }, { productId: "1001", qty: 6 }]);
  assert.deepEqual([c.specialPrices, c.discounts, c.recargoEquivalencia], [{ 1002: 0.5 }, { 1001: 5 }, true]);
  assert.equal(db.getById("0000"), null);
});

test("clientes: por teléfono (9 últimos dígitos); si lo comparten varios, no se identifica por teléfono", () => {
  const db = openCustomersDb(":memory:");
  db.upsertCustomers(clientes());
  assert.equal(db.getByPhone("34600000001").id, "9001");
  assert.equal(db.getByPhone("+34 600 000 001").id, "9001");
  assert.equal(db.getByPhone("34600000002"), null); // lo comparten 9002 y 9003
  assert.equal(db.getByPhone("123"), null);
});

test("clientes: búsqueda por nombre o código", () => {
  const db = openCustomersDb(":memory:");
  db.upsertCustomers(clientes());
  assert.deepEqual(db.find("bar el ejemplo").map((c) => c.id), ["9001"]);
  assert.deepEqual(db.find("9002").map((c) => c.id), ["9002"]);
  assert.deepEqual(db.find("tienda"), []); // demasiado genérico
});

test("clientes: actualizar sustituye el historial si viene, y lo conserva si no viene", () => {
  const db = openCustomersDb(":memory:");
  db.upsertCustomers(clientes());
  const r = db.upsertCustomers([{ id: "9001", name: "Bar El Ejemplo SL", phone: "+34 600 000 001", orders: [{ doc: "F9", date: "2026-11-02", lines: [{ productId: "1001", qty: 1 }] }] }]);
  assert.deepEqual(r, { added: 0, updated: 1 });
  let c = db.getById("9001");
  assert.deepEqual([c.name, c.orders.map((o) => o.doc)], ["Bar El Ejemplo SL", ["F9"]]);
  assert.deepEqual(c.specialPrices, { 1002: 0.5 }); // no venían: se conservan
  db.upsertCustomers([{ id: "9001", name: "Bar El Ejemplo SL" }]);
  assert.equal(db.getById("9001").orders.length, 1);
});

test("clientes: sin código o nombre no se guarda nada; los dados de baja no se identifican", () => {
  const db = openCustomersDb(":memory:");
  assert.throws(() => db.upsertCustomers([clientes()[0], { id: "", name: "X" }]), /código/);
  assert.equal(db.count(), 0);
  db.upsertCustomers([{ id: "1", name: "Mesón Antiguo", phone: "600111222", active: false }]);
  assert.deepEqual(db.find("Mesón Antiguo"), []);
  assert.equal(db.getByPhone("600111222"), null);
});

test("importData carga productos y clientes en sus dos bases", () => {
  const cat = openCatalogDb(":memory:"), cus = openCustomersDb(":memory:");
  const out = importData({ products: productos(), customers: clientes() }, cat, cus);
  assert.deepEqual([out.products.added, out.customers.added], [3, 3]);
});

// ---- Teléfonos y correos múltiples, razón social y comprobación de solicitudes de alta ----
const lista = () => [
  { id: "0004", name: "TIENDA FICTICIA", legalName: "TIENDA FICTICIA SL", city: "MEDINA", phones: ["674088618", "983812329"], emails: ["tienda@ejemplo.es"] },
  { id: "493", name: "BAR EL EJEMPLO", legalName: "JUAN PEREZ GARCIA", phones: ["600111222"] },
  { id: "954", name: "BAR EL CRUCE", phones: ["600111222"], emails: ["cruce@ejemplo.es"] }, // comparte teléfono con 493
  { id: "955", name: "MESON CERRADO", phones: ["611000111"], active: false },
  { id: "956", name: "SIN CONTACTO" },
];
const db = () => { const d = openCustomersDb(":memory:"); d.upsertCustomers(lista()); return d; };

test("clientes: guarda y devuelve varios teléfonos y correos, razón social y población", () => {
  const c = db().getById("0004");
  assert.deepEqual([c.phones, c.emails, c.legalName, c.city], [["674088618", "983812329"], ["tienda@ejemplo.es"], "TIENDA FICTICIA SL", "MEDINA"]);
  assert.equal(db().getByPhone("+34 983 81 23 29").id, "0004"); // vale cualquiera de sus teléfonos
  assert.equal(db().getByPhone("600111222"), null); // lo comparten dos clientes
});

test("matchRegistration: acceso automático solo si coincide el nombre Y el teléfono o el correo", () => {
  const d = db();
  const a = d.matchRegistration({ business: "Tienda Ficticia", phone: "983 81 23 29", email: "otro@x.es" });
  assert.deepEqual([a.customer.id, a.matched], ["0004", { name: true, phone: true, email: false }]);
  const b = d.matchRegistration({ business: "tienda ficticia sl", phone: "699999999", email: "TIENDA@ejemplo.es" });
  assert.deepEqual([b.customer.id, b.matched.email, b.matched.phone], ["0004", true, false]); // correo en mayúsculas, razón social
  assert.equal(d.matchRegistration({ business: "Tienda Ficticia", phone: "699999999", email: "otro@x.es" }).customer, null); // nombre sí, contacto no
  const c = d.matchRegistration({ business: "Otra Tienda", phone: "674088618", email: "" });
  assert.equal(c.customer, null); // teléfono sí, nombre no
  assert.equal(c.suggestions[0].id, "0004");
  assert.match(c.suggestions[0].motivo, /teléfono/);
});

test("matchRegistration: teléfono compartido por dos clientes se resuelve por el nombre; si no, es ambiguo", () => {
  const d = db();
  assert.equal(d.matchRegistration({ business: "Bar El Ejemplo", phone: "600111222", email: "" }).customer.id, "493");
  assert.equal(d.matchRegistration({ business: "Bar El Cruce", phone: "600111222", email: "" }).customer.id, "954");
  d.upsertCustomers([{ id: "957", name: "BAR EL CRUCE", phones: ["600111222"] }]); // dos clientes con el mismo nombre y teléfono
  const r = d.matchRegistration({ business: "Bar El Cruce", phone: "600111222", email: "" });
  assert.deepEqual([r.customer, r.reason], [null, "ambiguo"]);
});

test("matchRegistration: un cliente de baja o sin datos de contacto nunca entra solo", () => {
  const d = db();
  assert.equal(d.matchRegistration({ business: "Meson Cerrado", phone: "611000111", email: "" }).customer, null);
  assert.equal(d.matchRegistration({ business: "Sin Contacto", phone: "600000000", email: "a@b.es" }).customer, null);
});

test("clientes: importar de nuevo actualiza sin perder el historial ni los precios", () => {
  const d = openCustomersDb(":memory:");
  d.upsertCustomers([{ id: "9", name: "VIEJO", phones: ["600000009"], orders: [{ doc: "F1", date: "2026-10-01", lines: [{ productId: "1", qty: 2 }] }], specialPrices: { 1: 0.5 } }]);
  d.upsertCustomers([{ id: "9", name: "NUEVO NOMBRE", legalName: "RAZON SL", phones: ["611000009"], emails: ["a@b.es"] }]);
  const c = d.getById("9");
  assert.deepEqual([c.name, c.legalName, c.phones, c.emails, c.orders.length, c.specialPrices], ["NUEVO NOMBRE", "RAZON SL", ["611000009"], ["a@b.es"], 1, { 1: 0.5 }]);
});

test("clientes: búsqueda paginada por nombre, código, población, teléfono o correo", () => {
  const d = db();
  assert.equal(d.search({}).total, 5);
  assert.deepEqual(d.search({ q: "bar el" }).rows.map((r) => r.id).sort(), ["493", "954"]);
  assert.deepEqual(d.search({ q: "medina" }).rows.map((r) => r.id), ["0004"]);
  assert.deepEqual(d.search({ q: "983812329" }).rows.map((r) => r.id), ["0004"]);
  assert.deepEqual(d.search({ q: "cruce@" }).rows.map((r) => r.id), ["954"]);
  assert.equal(d.search({ limit: 2 }).rows.length, 2);
  assert.equal(d.search({ offset: 4, limit: 2 }).rows.length, 1);
});
