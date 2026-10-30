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

test("webHistory: últimos pedidos del más reciente al más antiguo, solo con artículos que siguen en catálogo", async () => {
  const { webHistory } = await import("./weborder.js");
  const cat = [{ id: 1, name: "AGUA" }, { id: 2, name: "COLA" }];
  const customer = { orders: [
    { doc: "A", date: "2026-01-01", lines: [{ productId: "1", qty: 6 }] },
    { doc: "B", date: "2026-03-01", lines: [{ productId: "1", qty: 12 }, { productId: "2", qty: 24 }, { productId: "99", qty: 5 }] },
    { doc: "C", date: "2026-02-01", lines: [{ productId: "99", qty: 5 }] }, // artículo descatalogado: el pedido se omite
  ] };
  const h = webHistory(customer, cat);
  assert.deepEqual(h.map((o) => o.doc), ["B", "A"]);
  assert.deepEqual(h[0].lines, [{ id: "1", name: "AGUA", qty: 12 }, { id: "2", name: "COLA", qty: 24 }]);
  assert.equal(webHistory(customer, cat, 1).length, 1);
});
