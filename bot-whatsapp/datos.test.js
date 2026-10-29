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
