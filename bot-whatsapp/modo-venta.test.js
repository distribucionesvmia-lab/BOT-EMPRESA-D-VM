import test from "node:test";
import assert from "node:assert/strict";
import { parseProductos, modoDeVenta } from "./productos-import.js";
import { compararProductos, aplicarProductos } from "./productos-diff.js";
import { openCatalogDb } from "./catalogo-db.js";
import { soloCaja, priceOrder } from "./pricing.js";
import { webProducts, webOrderFromBody } from "./weborder.js";
import { setCatalog, handleMessage, newSession, getCatalog } from "./bot.js";

const CAB = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado", "MODO DE VENTA"];
const filas = [
  CAB,
  [1, "CUBO DE BASURA", 4, "ORD21", 1, "No", "No", 2], // solo caja, 1 por caja: se pide por unidades
  [2, "LECHE ENTERA 1L", 0.9, "SRE", 6, "No", "No", 2], // solo caja de verdad (6 por caja)
  [3, "MERMELADA FRESA 340", 2.5, "RED10", 8, "No", "No", 3], // caja o unidad
  [4, "ARTICULO RETIRADO", 3, "ORD21", 4, "si", "si", null], // bloqueado: se quita
];

test("el Excel de a3ERP trae el «MODO DE VENTA»: 2 = solo caja, 3 = caja o unidad; los bloqueados no se importan como activos", () => {
  assert.equal(modoDeVenta(2), "caja"); assert.equal(modoDeVenta("2-SOLO CAJA"), "caja"); assert.equal(modoDeVenta(3), "ambos"); assert.equal(modoDeVenta("3-CAJA ó UNID"), "ambos"); assert.equal(modoDeVenta(""), null);
  const { products } = parseProductos(filas);
  const por = Object.fromEntries(products.map((p) => [p.id, p]));
  assert.equal(por["1"].saleMode, "caja"); assert.equal(por["2"].saleMode, "caja"); assert.equal(por["3"].saleMode, "ambos"); assert.equal(por["4"].saleMode, undefined);
  assert.equal(por["4"].active, false); assert.equal(por["2"].active, true);
});

test("la comparación y la aplicación del Excel recogen el modo de venta, y quitan los bloqueados", () => {
  const { products } = parseProductos(filas);
  const actual = [{ id: "1", name: "CUBO DE BASURA", price: 4, unitsPerBox: 1 }, { id: "2", name: "LECHE ENTERA 1L", price: 0.9, unitsPerBox: 6 }, { id: "4", name: "ARTICULO RETIRADO", price: 3, unitsPerBox: 4 }];
  const c = compararProductos(actual, products);
  assert.deepEqual(c.quitados.map((p) => p.id), ["4"]); // el bloqueado sale del catálogo
  assert.deepEqual(c.anadidos.map((p) => p.id), ["3"]);
  assert.ok(c.modificados.find((m) => m.id === "2").cambios.some((x) => x.campo === "saleMode" && x.despues === "caja"));
  const nueva = aplicarProductos(actual, products);
  assert.deepEqual(nueva.map((p) => [p.id, p.saleMode]), [["1", "caja"], ["2", "caja"], ["3", "ambos"]]);
});

test("el catálogo en la base de datos guarda el modo de venta y lo conserva en las actualizaciones parciales", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts([{ id: "2", name: "LECHE", price: 0.9, unitsPerBox: 6, saleMode: "caja" }, { id: "3", name: "MERMELADA", price: 2.5, unitsPerBox: 8, saleMode: "ambos" }, { id: "9", name: "SIN DATO", price: 1, unitsPerBox: 4 }]);
  const lista = Object.fromEntries(db.list().map((p) => [p.id, p.saleMode]));
  assert.deepEqual(lista, { "2": "caja", "3": "ambos", "9": undefined });
  db.upsertProducts([{ id: "2", name: "LECHE", price: 0.95 }], { partial: true }); // un Excel sin la columna no borra el modo
  assert.equal(db.list().find((p) => p.id === "2").saleMode, "caja");
});

test("solo caja = más de 1 unidad por caja y modo «caja»; en la tienda no hay «Uds» y lo que llegue en unidades se pasa a cajas enteras", () => {
  const leche = { id: "2", name: "LECHE", price: 1, unitsPerBox: 6, saleMode: "caja" }, merm = { id: "3", name: "MERMELADA", price: 2, unitsPerBox: 8, saleMode: "ambos" }, cubo = { id: "1", name: "CUBO", price: 4, unitsPerBox: 1, saleMode: "caja" };
  assert.equal(soloCaja(leche), true); assert.equal(soloCaja(merm), false); assert.equal(soloCaja(cubo), false); assert.equal(soloCaja({ id: "x", unitsPerBox: 6 }), false);
  const web = webProducts({}, [leche, merm, cubo], () => []);
  assert.equal(web.find((p) => p.id === "2").soloCaja, true); assert.equal(web.find((p) => p.id === "3").soloCaja, undefined); assert.equal(web.find((p) => p.id === "1").unitsPerBox, null);
  const ctx = { key: "k", phone: "1" }, cli = { id: "C", name: "Bar", address: "Calle 1" };
  const r = (lines) => webOrderFromBody({ lines }, cli, ctx, [leche, merm, cubo]).order.items.map((i) => `${i.id}:${i.qty}${i.unit}`);
  assert.deepEqual(r([{ id: "2", qty: 13, unit: "ud" }]), ["2:3caja"]); // 13 uds de leche → 3 cajas (nunca sueltas)
  assert.deepEqual(r([{ id: "2", qty: 2, unit: "caja" }]), ["2:2caja"]);
  assert.deepEqual(r([{ id: "3", qty: 5, unit: "ud" }]), ["3:5ud"]); // la mermelada sí se puede pedir suelta
  assert.deepEqual(r([{ id: "1", qty: 3, unit: "ud" }]), ["1:3ud"]); // cubo (1 por caja): unidades
  const priced = priceOrder({ ...webOrderFromBody({ lines: [{ id: "2", qty: 2, unit: "ud" }] }, cli, ctx, [leche]).order }, cli, [leche]);
  assert.equal(priced.items[0].units, 6); assert.equal(priced.items[0].amount, 6); // 1 caja de 6 uds a 1 € = 6 €
});

test("chat: un artículo de solo caja no pregunta «¿cajas o unidades?» y «2 leches» son 2 cajas", () => {
  const antes = getCatalog();
  setCatalog([{ id: "L1", name: "Leche entera 1L", price: 1, unitsPerBox: 6, vat: 4, saleMode: "caja", aliases: ["leche"] }, { id: "M1", name: "Mermelada fresa", price: 2, unitsPerBox: 8, vat: 10, saleMode: "ambos", aliases: ["mermelada"] }]);
  try {
    let r = handleMessage(newSession(), "2 leches");
    assert.doesNotMatch(r.reply, /¿Lo quieres en|cajas\* o en \*unidades/i);
    assert.match(r.reply, /2 cajas \(12 uds\) × Leche entera 1L = 12,00 €/); // «2 leches» = 2 cajas de 6
    r = handleMessage(newSession(), "12 unidades de leche"); // dice unidades a las claras: 12 uds = 2 cajas enteras
    assert.match(r.reply, /2 cajas \(12 uds\)/);
    r = handleMessage(newSession(), "5 unidades de leche"); // 5 uds no son una caja entera: se pasa a 1 caja
    assert.match(r.reply, /1 caja \(6 uds\)/);
    r = handleMessage(newSession(), "2 mermeladas"); // la que se vende suelta (caja o unidad) sigue como antes: 2 unidades, no 2 cajas
    assert.match(r.reply, /• 2 × Mermelada fresa = 4,00 €/);
  } finally { setCatalog(antes); }
});
