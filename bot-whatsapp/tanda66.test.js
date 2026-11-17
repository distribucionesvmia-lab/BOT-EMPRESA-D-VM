// «Pedir en 10 segundos»: vista previa del pedido de siempre y botón «Enviar ya» (siempre con confirmación).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { previaPedidoRapido, diaPropuesto } from "./pedido-rapido.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const catalogo = [{ id: "1", name: "AGUA 1.5L", price: 0.5, vat: 10, unitsPerBox: 6 }, { id: "2", name: "CAFE 1KG", price: 10, vat: 10 }, { id: "3", name: "LECHE", price: 0.8, vat: 4, unitsPerBox: 6, saleMode: "caja" }];
const cliente = { id: "9", name: "BAR PRUEBA", address: "Calle Falsa 1", city: "Medina" };
const opciones = [{ kind: "hoy", date: "2026-11-17", label: "Hoy", detail: "" }, { kind: "manana", date: "2026-11-18", label: "Mañana", detail: "miércoles" }, { kind: "dia", date: "2026-11-19", label: "Jueves", detail: "" }];

test("RÁPIDO: propone el primer día que no sea «hoy» (como el carrito), o «hoy» si es el único", () => {
  assert.equal(diaPropuesto(opciones), "2026-11-18"); assert.equal(diaPropuesto([opciones[0]]), "2026-11-17"); assert.equal(diaPropuesto([]), null);
});
test("RÁPIDO: la vista previa da líneas, total con IVA, dirección y días; quita lo que ya no está en el catálogo", () => {
  const r = previaPedidoRapido({ fuente: [{ id: "1", qty: 2, unit: "caja" }, { id: "2", qty: 3, unit: "ud" }, { id: "999", qty: 1, unit: "ud" }], catalogo, customer: cliente, opciones });
  assert.equal(r.posible, true); assert.equal(r.articulos, 2); assert.equal(r.quitados, 1);
  // 2 cajas × 6 uds × 0,50 = 6,00 + 3 × 10 = 30,00 → base 36,00 al 10 % = 39,60
  assert.equal(r.base, 36); assert.equal(r.total, 39.6); assert.equal(r.direccion, "Calle Falsa 1"); assert.equal(r.porDefecto, "2026-11-18");
  assert.deepEqual(r.lineas.map((l) => [l.id, l.qty, l.unit]), [["1", 2, "caja"], ["2", 3, "ud"]]);
});
test("RÁPIDO: el recargo de equivalencia entra en el total (la misma cuenta que el pedido)", () => {
  const r = previaPedidoRapido({ fuente: [{ id: "2", qty: 1, unit: "ud" }], catalogo, customer: { ...cliente, recargoEquivalencia: true }, opciones });
  assert.equal(r.total, 11 + 0.14); // 10 € + 1 € de IVA + 0,14 € de R.E. (1,4 % sobre el 10 %)
});
test("RÁPIDO: un artículo de solo caja que llegó en unidades se pasa a cajas (igual que al enviar)", () => {
  const r = previaPedidoRapido({ fuente: [{ id: "3", qty: 7, unit: "ud" }], catalogo, customer: cliente, opciones });
  assert.deepEqual(r.lineas.map((l) => [l.qty, l.unit]), [[2, "caja"]]);
});
test("RÁPIDO: sin pedido anterior, sin dirección o sin días de reparto no se ofrece (y dice por qué)", () => {
  assert.equal(previaPedidoRapido({ fuente: [], catalogo, customer: cliente, opciones }).posible, false);
  assert.equal(previaPedidoRapido({ fuente: [{ id: "999", qty: 1 }], catalogo, customer: cliente, opciones }).posible, false);
  assert.match(previaPedidoRapido({ fuente: [{ id: "1", qty: 1 }], catalogo, customer: { ...cliente, address: "" }, opciones }).motivo, /dirección/);
  assert.match(previaPedidoRapido({ fuente: [{ id: "1", qty: 1 }], catalogo, customer: cliente, opciones: [] }).motivo, /reparto/);
});
test("RÁPIDO: el servidor expone la vista previa solo con sesión, sin enviar nada; y «solo ver» no la ofrece", () => {
  const sv = src("./server.js"), i = sv.indexOf('p === "/api/pedido-rapido"'), b = sv.slice(i, i + 1100);
  assert.ok(i > 0); assert.match(b, /Sesión caducada/); assert.match(b, /account\.soloVer/); assert.match(b, /previaPedidoRapido\(/); assert.doesNotMatch(b, /createOrder|webOrderFromBody/);
});
test("RÁPIDO: la pantalla pide confirmar (ventana con día, dirección y total) y envía por POST /catalogo con clave única", () => {
  const h = src("./cliente.html"), i = h.indexOf("async function abrirRapido"), f = h.slice(i, i + 4200);
  assert.ok(i > 0); assert.match(h, /id="m-rapido"/); assert.match(h, /abrirRapido\(ui\)/); // el botón solo abre la ventana
  assert.match(f, /fetch\("\/catalogo", \{ method: "POST"/); assert.match(f, /key = "rapido-"/); assert.match(f, /"Enviar pedido · "/); assert.match(f, /Revisar antes de enviar/);
  assert.doesNotMatch(h.slice(h.indexOf('const rap = el("button"'), h.indexOf('const rap = el("button"') + 900), /\/catalogo/); // el botón de la portada NO envía por sí solo
});
