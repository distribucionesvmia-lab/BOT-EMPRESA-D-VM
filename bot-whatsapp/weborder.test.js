import test from "node:test";
import assert from "node:assert/strict";
import { webOrderFromBody, webProducts } from "./weborder.js";

const catalogo = [
  { id: "A", name: "AGUA", price: 2, unitsPerBox: 6 },
  { id: "B", name: "ZUMO", price: 1 },
];
const cliente = { id: "C1", name: "Bar", address: "Calle 1" };
const ctx = { key: "web:x", phone: "34600000001", at: "2026-10-29T10:00:00Z" };

test("las cajas solo valen para artículos que se venden en cajas; lo demás se toma como unidades", () => {
  const { order } = webOrderFromBody({ lines: [{ id: "A", qty: 2, unit: "caja" }, { id: "B", qty: 3, unit: "caja" }] }, cliente, ctx, catalogo);
  assert.deepEqual(order.items.map((i) => [i.id, i.qty, i.unit]), [["A", 2, "caja"], ["B", 3, "ud"]]);
  assert.match(order.text, /2 cajas de AGUA/);
});

test("valida cantidades, artículos desconocidos y notas", () => {
  assert.deepEqual(webOrderFromBody({ lines: [{ id: "Z", qty: 1 }, { id: "A", qty: 0 }, { id: "A", qty: 1000 }] }, cliente, ctx, catalogo), { error: "El pedido está vacío" });
  const { order } = webOrderFromBody({ lines: [{ id: "A", qty: 1, note: "  grande  " }], note: "jueves" }, cliente, ctx, catalogo);
  assert.equal(order.items[0].note, "grande");
  assert.equal(order.note, "jueves");
});

test("el catálogo web trae unidades por caja y ordena por lo habitual", () => {
  const habituales = () => [{ id: "B", lastQty: 4, count: 3 }];
  const p = webProducts(cliente, catalogo, habituales);
  assert.deepEqual(p.map((x) => [x.id, x.unitsPerBox, x.lastQty]), [["B", null, 4], ["A", 6, null]]);
});
