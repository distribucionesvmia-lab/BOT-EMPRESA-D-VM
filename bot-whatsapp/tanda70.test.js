// Fluidez: memoria por cliente (resultados repetidos, con caducidad corta) y su huella.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { crearMemo, firmaCliente } from "./memo.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("MEMO: calcula una vez, caduca, y se va lo más antiguo al pasarse del máximo", () => {
  let t = 1000, n = 0; const m = crearMemo({ max: 2, ttlMs: 100, ahora: () => t });
  assert.equal(m.get("a", () => ++n), 1); assert.equal(m.get("a", () => ++n), 1); assert.equal(n, 1); // segunda vez: de la memoria
  t += 101; assert.equal(m.get("a", () => ++n), 2); // caducó
  m.get("b", () => ++n); m.get("c", () => ++n); assert.equal(m.tamano, 2); // «a» se fue
  assert.equal(m.get("a", () => ++n), 5); // hubo que recalcular «a»
  assert.throws(() => m.get("x", () => { throw new Error("falla"); })); assert.equal(m.get("x", () => 7), 7); // un fallo no se guarda
  m.borrar(); assert.equal(m.tamano, 0);
});
test("HUELLA: cambia si el cliente hace un pedido, cambia de precio o de descuento; no cambia si nada cambió", () => {
  const base = { id: "9", name: "BAR", municipio: "47085", recargoEquivalencia: false, specialPrices: { 1: 2.5 }, discounts: { 2: 10 }, orders: [{ doc: "A", date: "2026-11-01", lines: [{}, {}] }] };
  const f = firmaCliente(base);
  assert.equal(firmaCliente(JSON.parse(JSON.stringify(base))), f);
  assert.notEqual(firmaCliente({ ...base, orders: [{ doc: "B", date: "2026-11-02", lines: [{}] }, ...base.orders] }), f);
  assert.notEqual(firmaCliente({ ...base, specialPrices: { 1: 2.6 } }), f); assert.notEqual(firmaCliente({ ...base, discounts: { 2: 12 } }), f); assert.notEqual(firmaCliente({ ...base, recargoEquivalencia: true }), f);
  assert.equal(firmaCliente(null), "-");
});
test("MEMO en el servidor: los precios del catálogo y el resumen del mes pasan por la memoria, con la huella del cliente y la versión del catálogo", () => {
  const sv = src("./server.js");
  assert.match(sv, /const memoProductos = crearMemo\(/); assert.match(sv, /function productosDe\(customer\)/); assert.equal((sv.match(/productosDe\(customer\)/g) || []).length >= 3, true);
  assert.match(sv, /memoResumen\.get\(/); assert.match(sv, /firmaCliente\(/);
});
