import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.js";

const pedido = (key, extra = {}) => ({
  key, phone: "34600000001", customerId: "C1", name: "Cliente de prueba", address: "Calle Falsa 1",
  text: "2 A + 1 B", total: 5, review: false, at: "2026-10-28T10:00:00.000Z",
  items: [{ id: "A1", name: "Artículo A", price: 1, qty: 2 }, { id: "B1", name: "Artículo B", price: 3, qty: 1 }],
  ...extra,
});

test("guarda el pedido con referencia única, líneas y estado pendiente de exportar", () => {
  const db = openDb(":memory:");
  const { order, duplicate } = db.createOrder(pedido("k1"));
  assert.equal(duplicate, false);
  assert.match(order.ref, /^VM-2026-\d{6}$/);
  assert.equal(order.status, "confirmed");
  assert.equal(order.export_status, "pending");
  assert.deepEqual(order.items.map((i) => [i.id, i.qty]), [["A1", 2], ["B1", 1]]);
  const otro = db.createOrder(pedido("k2")).order;
  assert.notEqual(otro.ref, order.ref);
});

test("la misma clave no crea un segundo pedido (idempotencia)", () => {
  const db = openDb(":memory:");
  const a = db.createOrder(pedido("k1"));
  const b = db.createOrder(pedido("k1", { items: [{ id: "Z", qty: 99 }] }));
  assert.equal(b.duplicate, true);
  assert.equal(b.order.ref, a.order.ref);
  assert.equal(db.listOrders().length, 1);
  assert.equal(b.order.items.length, 2); // se devuelve el original, no el reintento
});

test("sin clave no se guarda; si falla una línea no queda un pedido a medias", () => {
  const db = openDb(":memory:");
  assert.throws(() => db.createOrder(pedido(undefined)));
  assert.throws(() => db.createOrder(pedido("k1", { items: [{ id: "A1", qty: null }] })));
  assert.equal(db.listOrders().length, 0);
  assert.equal(db.hasOrderKey("k1"), false);
  assert.equal(db.createOrder(pedido("k1")).duplicate, false); // y la clave sigue libre
});

test("un mensaje de WhatsApp reenviado se detecta como ya procesado", () => {
  const db = openDb(":memory:");
  assert.equal(db.markMessage("wamid.1"), true);
  assert.equal(db.markMessage("wamid.1"), false);
  assert.equal(db.markMessage("wamid.2"), true);
});

test("los pedidos sobreviven al reabrir la base de datos", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = `${fs.mkdtempSync(`${os.tmpdir()}/vm-`)}/t.sqlite`;
  const db1 = openDb(path);
  db1.createOrder(pedido("k1"));
  db1.markMessage("wamid.1");
  db1.close();
  const db2 = openDb(path);
  assert.equal(db2.hasOrderKey("k1"), true);
  assert.equal(db2.markMessage("wamid.1"), false);
  assert.equal(db2.createOrder(pedido("k1")).duplicate, true);
  db2.close();
});
