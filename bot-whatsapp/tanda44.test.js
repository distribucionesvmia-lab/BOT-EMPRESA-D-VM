// Orden de a3ERP: código de familia, código de subfamilia y código de artículo (Excel para a3ERP, pedidos recibidos, histórico y pedido).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { compararFamilias, compararArticulos, ordenarLineas, usarFamilias, nombreFamilia } from "./ordenfamilia.js";
import { openDb } from "./db.js";
import { openCatalogDb } from "./catalogo-db.js";
import { priceOrder } from "./pricing.js";
import { FORMAT } from "./export-format.js";

const NOMBRES = JSON.parse(fs.readFileSync(new URL("./familias-nombres.json", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-fam-"));

test("el orden es el del listado de familias de a3ERP (1.0, 1.1, 1.12, 1.2 … 10.0 … 27.1, 27.10, 27.11, 27.2 … 99.0)", () => {
  const codigos = Object.keys(NOMBRES); // el listado tal como lo manda a3ERP
  const barajado = [...codigos].sort(() => Math.random() - 0.5);
  assert.deepEqual(barajado.sort(compararFamilias), codigos);
  assert.equal(compararFamilias("15.0.", "15.0"), 0, "el punto final de «15.0.» no cuenta");
  assert.ok(compararFamilias("1.12", "1.2") < 0 && compararFamilias("27.10", "27.2") < 0 && compararFamilias("9.5", "10.1") < 0);
  assert.ok(compararFamilias("99.0", "") < 0 && compararFamilias("", "1.0") > 0, "sin familia, al final");
});

test("familia, luego subfamilia y luego código de artículo (los números, como números)", () => {
  const l = [{ id: "110012", family: "1.1" }, { id: "9", family: "10.1" }, { id: "11344", family: "1.1" }, { id: "2207", family: "1.0" }, { id: "5", family: "1.12" }, { id: "77" }];
  assert.deepEqual(l.sort(compararArticulos).map((x) => x.id), ["2207", "11344", "110012", "5", "9", "77"]);
});

test("sin código de familia no se toca el orden (datos aún sin importar de a3ERP)", () => {
  const l = [{ id: "9" }, { id: "1" }, { id: "5" }];
  assert.deepEqual(ordenarLineas(l).map((x) => x.id), ["9", "1", "5"]);
});

test("los pedidos que recibe la empresa y el Excel para a3ERP salen ordenados por familia, subfamilia y artículo", () => {
  const dir = tmp(), cat = openCatalogDb(path.join(dir, "c.sqlite"));
  const prods = [["301", "AGUA", "10.1"], ["202", "LECHE B", "1.2"], ["102", "LECHE A", "1.1"], ["101", "LECHE CAJA", "1.1"], ["555", "SIN FAMILIA", ""]];
  cat.upsertProducts(prods.map(([id, name]) => ({ id, name, price: 1, vat: 10 })));
  cat.setFamilias(prods.map(([id, , f]) => [id, f]));
  usarFamilias((id) => cat.get(id)?.family ?? null);
  try {
    const catalogo = cat.list();
    assert.equal(catalogo.find((p) => p.id === "102").family, "1.1");
    const pedido = priceOrder({ key: "k1", phone: "34600000001", customerId: "C1", name: "Cliente", address: "x", text: "x", review: false, at: "2026-11-15T10:00:00.000Z", items: prods.map(([id, name]) => ({ id, name, qty: 1 })).reverse() }, {}, catalogo);
    assert.deepEqual(pedido.items.map((i) => i.id), ["101", "102", "202", "301", "555"], "al valorar el pedido");
    const db = openDb(path.join(dir, "p.sqlite"));
    db.createOrder(pedido);
    const guardado = db.listOrders({ limit: 5 })[0];
    assert.deepEqual(guardado.items.map((i) => i.id), ["101", "102", "202", "301", "555"], "al leerlo la empresa");
    const { sheets } = FORMAT.build([db.getOrderByRef(guardado.ref)]);
    const texto = JSON.stringify(sheets);
    assert.ok(texto.indexOf("LECHE CAJA") < texto.indexOf("LECHE A") && texto.indexOf("LECHE A") < texto.indexOf("LECHE B") && texto.indexOf("LECHE B") < texto.indexOf("AGUA"), "en el Excel");
  } finally { usarFamilias(null); }
});

test("el histórico de a3ERP del cliente también va por familia, subfamilia y artículo", async () => {
  const { openCustomersDb } = await import("./clientes-db.js");
  usarFamilias((id) => ({ "11": "10.1", "12": "1.1", "13": "1.0" })[id] ?? null);
  try {
    const c = openCustomersDb(path.join(tmp(), "cl.sqlite"));
    c.upsertCustomers([{ id: "C1", name: "Bar", phone: "600000001", orders: [{ doc: "A1", date: "2026-11-01", lines: [{ productId: "11", qty: 1 }, { productId: "12", qty: 2 }, { productId: "13", qty: 3 }] }] }]);
    assert.deepEqual(c.getById("C1").orders[0].lines.map((l) => l.productId), ["13", "12", "11"]);
  } finally { usarFamilias(null); }
});

test("el catálogo guarda el código de familia sin anotarlo como cambio del artículo", () => {
  const cat = openCatalogDb(path.join(tmp(), "c.sqlite"));
  cat.upsertProducts([{ id: "1", name: "A", price: 1, vat: 10 }]);
  assert.equal(cat.setFamilias([["1", "27.3."], ["99", "1.0"]]), 1, "un solo artículo existe");
  assert.equal(cat.get("1").family, "27.3.");
  assert.equal(cat.setFamilias([["1", "27.3."]]), 0, "repetirlo no cambia nada");
});

test("el nombre de la familia sale del listado de a3ERP", () => {
  assert.equal(nombreFamilia("1.0", NOMBRES), "LECHE");
  assert.equal(nombreFamilia("1.1", NOMBRES), "LECHE › PSC BOTEL 1.5 Y HOSTELERIA");
  assert.equal(nombreFamilia("", NOMBRES), "Sin familia");
});

test("pedido.html lleva una copia del orden y da lo mismo que el programa", () => {
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const bloque = /\/\/ ORDEN-FAMILIA-INICIO[\s\S]*?\/\/ ORDEN-FAMILIA-FIN/.exec(html)?.[0];
  assert.ok(bloque, "falta el bloque ORDEN-FAMILIA en pedido.html");
  const f = vm.runInNewContext(`${bloque}\n;({ compararFamilias, compararArticulos, nombreFamilia })`);
  const codigos = Object.keys(NOMBRES);
  for (const a of ["", "1.0", "1.12", "10.5", "27.10", "27.2", "15.0."]) for (const b of codigos.slice(0, 40)) assert.equal(Math.sign(f.compararFamilias(a, b)), Math.sign(compararFamilias(a, b)), `${a} vs ${b}`);
  assert.equal(f.nombreFamilia("1.1", NOMBRES), nombreFamilia("1.1", NOMBRES));
  assert.match(html, /const lines = \(\) =>[^\n]*\.sort\(porFamilia\)/);
});
