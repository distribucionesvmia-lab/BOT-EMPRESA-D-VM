// Árbol del catálogo con familias y subfamilias de a3ERP (solo cuando los artículos ya traen su código de familia).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { conArbolA3erp, bonito } from "./arbol-a3erp.js";
import { arbolCategorias } from "./categorias.js";
const J = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const nombres = J("./familias-nombres.json"), mapa = J("./familias-categorias.json");
const art = (id, family, name = "X") => ({ id, name, price: 1, vat: 21, family });

test("A3ERP: nombres bonitos sin perder siglas ni lo ya escrito en minúsculas", () => {
  assert.equal(bonito("VINO Y BEBIDAS ALCOHOL"), "Vino y Bebidas Alcohol"); assert.equal(bonito("Pedras"), "Pedras"); assert.equal(bonito(""), "");
});
test("A3ERP: con familia en los artículos, categoría = familia y subcategoría = subfamilia, con sus nombres del PDF", () => {
  const items = [art("1", "10.1"), art("2", "11.2"), art("3", "11.1"), art("4", "22.21"), art("5", "22.0")];
  const r = conArbolA3erp(items, nombres, mapa), arbol = arbolCategorias(r);
  const c10 = arbol.find((c) => c.nombre === "Agua"), c11 = arbol.find((c) => c.nombre === "Zumos"), c22 = arbol.find((c) => c.nombre === "Cerveza");
  assert.ok(c10 && c11 && c22);
  assert.deepEqual(c11.subs.map((s) => s.nombre).sort(), ["Zmosol Br", "Zumo Box"]); // 11.1 y 11.2 son subcategorías de la familia 11 (Zumos)
  assert.ok(c10.subs.some((s) => s.nombre === "Bezoya Pet"));
  assert.ok(c22.subs.some((s) => s.nombre === "Lata 5*") && c22.subs.some((s) => s.nombre === "General")); // 22.21 y la familia 22.0 sin subfamilia
  assert.equal(items[0].category, undefined); // no toca los originales
});
test("A3ERP: si casi ningún artículo trae familia, el catálogo se queda como estaba (categorías de la web)", () => {
  const items = [art("1", "10.1"), art("2"), art("3"), art("4"), art("5")];
  assert.equal(conArbolA3erp(items, nombres, mapa), items);
});
test("A3ERP: un artículo con familia desconocida o rara conserva su categoría de siempre", () => {
  const items = [art("1", "10.1"), { ...art("2", "999.1"), category: "Café" }, art("3", "10.2"), art("4", "10.3"), art("5", "10.4"), art("6", "10.5"), art("7", "10.6"), art("8", "10.7"), art("9", "10.8"), art("10", "10.1")];
  const r = conArbolA3erp(items, nombres, mapa);
  assert.equal(r[1].category, "Café"); assert.equal(r[0].category, "Agua");
});
test("A3ERP: server.js lo aplica al cargar el catálogo y se puede apagar con ARBOL_A3ERP=0", () => {
  const sv = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sv, /function catalogoParaClientes/); assert.match(sv, /ARBOL_A3ERP !== "0"/); assert.equal((sv.match(/setCatalog\(catalogoParaClientes\(/g) || []).length, 2);
});
