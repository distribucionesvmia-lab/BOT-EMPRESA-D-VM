// «Tu resumen del mes»: compras, lo más pedido y ahorro frente a la tarifa.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resumenMensual, nombreMes, mesAnterior } from "./resumen-mensual.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ped = (fecha, total, lineas, aprox = false) => ({ fecha, total, aprox, lineas });
const datos = [
  ped("2026-11-03", 100, [{ nombre: "Agua", unidades: 12, ahorro: 1.5 }, { nombre: "Café", unidades: 2, ahorro: 0 }]),
  ped("2026-11-10", 50, [{ nombre: "Agua", unidades: 6, ahorro: 0.5 }]),
  ped("2026-10-20", 80, [{ nombre: "Leche", unidades: 6, ahorro: 0 }], true),
];
test("RESUMEN: suma pedidos, gasto y ahorro del mes y ordena lo más pedido", () => {
  const r = resumenMensual({ pedidos: datos, mes: "2026-11", hoy: "2026-11-17" });
  assert.equal(r.hay, true); assert.equal(r.pedidos, 2); assert.equal(r.total, 150); assert.equal(r.ahorro, 2); assert.equal(r.aprox, false);
  assert.deepEqual(r.masPedidos, [{ nombre: "Agua", unidades: 18 }, { nombre: "Café", unidades: 2 }]);
  assert.equal(r.titulo, "noviembre de 2026"); assert.deepEqual(r.meses.map((m) => m.mes), ["2026-11", "2026-10"]);
});
test("RESUMEN: compara con el mes anterior y avisa si el anterior es aproximado", () => {
  const r = resumenMensual({ pedidos: datos, mes: "2026-11" });
  assert.equal(r.anterior.total, 80); assert.equal(r.anterior.pedidos, 1); assert.equal(r.variacion, 88); // 150 frente a 80
  const o = resumenMensual({ pedidos: datos, mes: "2026-10" }); assert.equal(o.aprox, true); assert.equal(o.variacion, null); // sin septiembre, no hay comparación
});
test("RESUMEN: sin pedidos no inventa nada; un mes sin pedidos cae en el último con pedidos; no enseña meses futuros", () => {
  assert.deepEqual(resumenMensual({ pedidos: [] }), { hay: false, meses: [] });
  assert.equal(resumenMensual({ pedidos: datos, mes: "2025-01" }).mes, "2026-11");
  assert.equal(resumenMensual({ pedidos: [ped("2027-02-01", 10, [])], hoy: "2026-11-17" }).hay, false);
  assert.equal(resumenMensual({ pedidos: [ped("basura", 10, [])] }).hay, false);
});
test("RESUMEN: ayudantes de fechas (enero/diciembre)", () => {
  assert.equal(mesAnterior("2026-01"), "2025-12"); assert.equal(mesAnterior("2026-03"), "2026-02"); assert.equal(nombreMes("2026-12"), "diciembre de 2026");
});
test("RESUMEN: el servidor lo da solo con sesión y de SU cliente; la pantalla lo pone al principio de Mi cuenta", () => {
  const sv = src("./server.js"), i = sv.indexOf('p === "/api/mi-resumen"'), b = sv.slice(i, i + 2400);
  assert.ok(i > 0); assert.match(b, /Sesión caducada/); assert.match(b, /clienteConPedidos\(account\.customerId/); assert.match(b, /customer_id === String\(account\.customerId\)/); // solo sus pedidos
  assert.match(b, /precios guardados del día/); assert.match(b, /aprox = true/);
  const h = src("./cliente.html"); assert.match(h, /async function pintarResumen\(caja, mes\)/); assert.ok(h.indexOf("pintarResumen(resumenCaja") < h.indexOf('nodo("h3", "Mis datos"'));
  assert.doesNotMatch(h.slice(h.indexOf("async function pintarResumen"), h.indexOf("async function abrirCuenta")), /innerHTML/); // texto siempre con textContent
});
