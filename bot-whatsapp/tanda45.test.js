// El histórico del cliente («Lo habitual») = los artículos que ha pedido AL MENOS UNA VEZ en los últimos 6 meses.
process.env.VM_HOY = "2026-11-15"; // fecha fija para la prueba
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setCatalog, habitualProducts } from "./bot.js";
import { parseHistorial, hace } from "./historial-import.js";

test("hace 6 meses desde el 15/11/2026 es el 15/05/2026", () => {
  assert.equal(hace(6), "2026-05-15");
  assert.equal(hace(6, new Date("2026-03-31T12:00:00Z")), "2025-10-01".replace("10-01", "10-01")); // 31/03 menos 6 meses: octubre
});

test("habitual = lo pedido al menos una vez en los últimos 6 meses (aunque no sea en los 10 últimos pedidos)", () => {
  setCatalog([1, 2, 3, 4].map((id) => ({ id: String(id), name: `ARTICULO ${id}`, price: 1, vat: 10 })));
  const cliente = { orders: [
    { doc: "N", date: "2026-11-10", lines: [{ productId: "1", qty: 1 }] },
    { doc: "M", date: "2026-05-15", lines: [{ productId: "2", qty: 3 }] }, // justo hace 6 meses: entra
    { doc: "L", date: "2026-05-14", lines: [{ productId: "3", qty: 2 }] }, // un día antes: fuera
    { doc: "K", date: "2025-11-30", lines: [{ productId: "4", qty: 9 }] }, // hace casi un año: fuera
    ...Array.from({ length: 12 }, (_, i) => ({ doc: `W${i}`, date: `2026-0${(i % 9) + 1}-20`, lines: [{ productId: "1", qty: 1 }] })), // muchos pedidos: ya no mandan los «10 últimos»
  ] };
  const ids = habitualProducts(cliente).map((p) => p.id).sort();
  assert.deepEqual(ids, ["1", "2"]);
  assert.equal(habitualProducts(cliente).find((p) => p.id === "2").lastQty, 3);
  // con otra fecha de hoy cambia la ventana
  assert.deepEqual(habitualProducts(cliente, { hoy: new Date("2026-06-01T12:00:00Z") }).map((p) => p.id).sort(), ["1", "2", "3"]);
});

test("el pedido de siempre guardado por el cliente sigue contando aunque no tenga fecha", () => {
  setCatalog([{ id: "7", name: "ARTICULO 7", price: 1, vat: 10 }]);
  assert.deepEqual(habitualProducts({ orders: [], usual: [{ productId: "7", qty: 2 }] }).map((p) => p.id), ["7"]);
});

test("al importar el historial se guardan TODOS los pedidos de los últimos 6 meses (y como mínimo los 10 últimos)", () => {
  const cab = ["Cód. cliente", "Fecha", "Documento", "Cód. artículo", "Cantidad"];
  const filas = [cab];
  for (let i = 0; i < 30; i++) filas.push(["C1", `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, `D${i}`, "1", 1]); // 30 pedidos recientes
  for (let i = 0; i < 12; i++) filas.push(["C2", `2025-0${(i % 9) + 1}-10`, `E${i}`, "1", 1]); // 12 pedidos muy antiguos
  const { byCustomer } = parseHistorial(filas);
  assert.equal(byCustomer.get("C1").length, 30, "todos los de los últimos 6 meses");
  assert.equal(byCustomer.get("C2").length, 10, "sin pedidos recientes: solo los 10 últimos");
});

test("la página enseña de qué sale «Lo habitual»", () => {
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(html, /Lo que has pedido al menos una vez en los últimos 6 meses/);
  assert.match(html, /al menos una vez en los últimos 6 meses\. Cuando hagas un pedido/);
});
