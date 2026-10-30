import test from "node:test";
import assert from "node:assert/strict";
import { categorizar, arbolCategorias, CATEGORIAS } from "./categorias.js";

const k = (name, extra = {}) => { const r = categorizar({ name, ...extra }); return `${r.cat}/${r.sub}`; };

test("clasificación por el nombre, con las categorías y subcategorías de la web", () => {
  assert.equal(k("AGUA MINERAL 1,5 L"), "aguas/otros");
  assert.equal(k("Bezoya 50 cl"), "aguas/bezoya");
  assert.equal(k("S.PELLEGRINO 75 CL"), "aguas/pellegrino");
  assert.equal(k("VINO TINTO CRIANZA 75 CL (CAJA 6)"), "vinos/otros");
  assert.equal(k("Palacio de Bornos Verdejo"), "vinos/bornos");
  assert.equal(k("Leche Pascual Classic semidesnatada 10 L"), "lacteos/leche");
  assert.equal(k("Vivesoy Barista"), "lacteos/vegetales"); // «barista» aquí es de Pascual, no de café
  assert.equal(k("Yogur natural vaso"), "lacteos/yogures");
  assert.equal(k("ZUMO NARANJA 1 L"), "lacteos/zumos");
  assert.equal(k("Café Mocay Maestro 1 kg"), "cafe/maestro");
  assert.equal(k("Infusión Mocay pirámide"), "cafe/infusiones");
  assert.equal(k("Atún claro Calvo en aceite de oliva"), "conservas/aceites");
  assert.equal(k("Kétchup Helios 3 kg"), "conservas/salsas");
  assert.equal(k("Chorizo Campofrío"), "refrigerados/charcuteria");
  assert.equal(k("Queso Reny Picot"), "refrigerados/quesos");
  assert.equal(k("Croissant mantequilla congelado Panamar"), "congelados/croissants");
  assert.equal(k("Copa de cristal 33 cl"), "menaje/cristaleria");
  assert.equal(k("REFRESCO COLA LATA 33 CL"), "otros/refrescos");
  assert.equal(k("CERVEZA RUBIA LATA 33 CL"), "otros/cervezas");
  assert.equal(k("PATATAS FRITAS 150 GR"), "otros/snacks");
  assert.equal(k("ARTÍCULO RARO"), "otros/otros");
});

test("la categoría de la ficha manda; si es de a3ERP y no de la web, se crea aparte", () => {
  assert.equal(k("LO QUE SEA", { category: "Vinos", subcategory: "Pazos de Baró" }), "vinos/pazos");
  assert.equal(k("LO QUE SEA", { category: "Aguas" }), "aguas/otros"); // sin subcategoría: la de «otros»
  const r = categorizar({ name: "X", category: "Droguería", subcategory: "Limpieza" });
  assert.deepEqual([r.cat, r.sub, r.catNombre, r.subNombre], ["f-drogueria", "limpieza", "Droguería", "Limpieza"]);
  assert.equal(k("x", { category: "Droguería" }), "f-drogueria/general");
});

test("árbol: orden de la web, solo con productos, con sus cuentas", () => {
  const t = arbolCategorias([{ name: "AGUA MINERAL" }, { name: "Bezoya 1,5 L" }, { name: "CERVEZA RUBIA" }, { name: "Vino tinto" }, { name: "x", category: "Droguería", subcategory: "Limpieza" }]);
  assert.deepEqual(t.map((c) => [c.id, c.count]), [["vinos", 1], ["aguas", 2], ["otros", 1], ["f-drogueria", 1]]);
  assert.deepEqual(t[1].subs.map((s) => [s.id, s.count]), [["bezoya", 1], ["otros", 1]]); // en el orden de la web
  assert.equal(CATEGORIAS.length, 9);
});
