import test from "node:test";
import assert from "node:assert/strict";
import { priceLine, priceOrder, totals } from "./pricing.js";

const catalogo = [
  { id: "111921", name: "AGUA GAS LIMON", price: 3.46, unitsPerBox: 6, vat: 21 },
  { id: "11192", name: "AGUA GAS VERDE", price: 5.461, unitsPerBox: 4, vat: 10 },
  { id: "111923", name: "AGUA GAS ROJOS", price: 3.46, unitsPerBox: 6, vat: 21 },
  { id: "55191", name: "COPA GINGER", price: 2.19, unitsPerBox: 6, vat: 21 },
  { id: "X1", name: "SIN FICHA DE CAJAS", price: 1 },
];

test("reproduce los totales de un pedido real de a3ERP (base 84,12 · IVA 15,26 · total 99,38)", () => {
  // Líneas de la captura: 2 cajas (12 uds), 1 caja (4 uds), 1 caja (6 uds) y 2 cajas (12 uds) con descuento 100 %
  const pedido = priceOrder(
    { items: [{ id: "111921", qty: 2, unit: "caja" }, { id: "11192", qty: 1, unit: "caja" }, { id: "111923", qty: 1, unit: "caja" }, { id: "55191", qty: 2, unit: "caja" }] },
    { discounts: { 55191: 100 } },
    catalogo,
  );
  assert.deepEqual(pedido.items.map((i) => [i.boxes, i.units, i.amount]), [[2, 12, 41.52], [1, 4, 21.84], [1, 6, 20.76], [2, 12, 0]]);
  const t = totals(pedido.items);
  assert.equal(t.base, 84.12);
  assert.equal(t.iva, 15.26);
  assert.equal(t.re, 0);
  assert.equal(t.total, 99.38);
  assert.deepEqual(t.groups.map((g) => [g.vat, g.base, g.iva]), [[21, 62.28, 13.08], [10, 21.84, 2.18]]);
});

test("precio especial del cliente y descuento personalizado ganan a los de la ficha del artículo", () => {
  const p = { id: "A", price: 10, discount: 5, unitsPerBox: 12 };
  assert.deepEqual(priceLine({ id: "A", qty: 3 }, p, null).amount, 28.5); // 3 × 10 − 5 %
  const c = { specialPrices: { A: 8 }, discounts: { A: 10 } };
  assert.equal(priceLine({ id: "A", qty: 3 }, p, c).amount, 21.6); // 3 × 8 − 10 %
  assert.equal(priceLine({ id: "A", qty: 3 }, p, { discounts: { A: 0 } }).amount, 30); // un 0 % personalizado anula el general
});

test("cajas × unidades por caja; si piden unidades, se respetan", () => {
  const p = { id: "A", price: 1, unitsPerBox: 6 };
  const caja = priceLine({ id: "A", qty: 2, unit: "caja" }, p, null);
  assert.deepEqual([caja.boxes, caja.units], [2, 12]);
  const ud = priceLine({ id: "A", qty: 5 }, p, null);
  assert.deepEqual([ud.boxes, ud.units], [null, 5]);
});

test("si piden cajas y no sabemos las unidades por caja, el pedido se marca para revisar", () => {
  const o = priceOrder({ items: [{ id: "X1", qty: 2, unit: "caja" }], review: false }, null, catalogo);
  assert.equal(o.review, true);
});

test("recargo de equivalencia según el tipo de IVA", () => {
  const items = [{ vat: 21, amount: 100 }, { vat: 10, amount: 50 }];
  const t = totals(items, true);
  assert.deepEqual([t.base, t.iva, t.re, t.total], [150, 26, 5.9, 181.9]); // 21 + 5 de IVA… 26; R.E. 5,20 + 0,70
  assert.equal(totals(items, false).re, 0);
});
