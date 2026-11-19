import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { esPorKilo } from "./export-format.js";

const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("ARTÍCULOS AL KILO: la página usa la misma regla que el Excel y dice «kg» en el precio", () => {
  const m = /const esKilo = n => \{[^\n]*\};/.exec(html);
  assert.ok(m, "falta esKilo en pedido.html");
  const esKilo = new Function(m[0] + "; return esKilo;")();
  for (const n of ["JAMON YORK KG", "Queso curado kg.", "Chorizo KG", "LOMO KG (pieza)"]) { assert.equal(esKilo(n), true, n); assert.equal(esPorKilo(n), true, n); }
  for (const n of ["AZUCAR 1KG", "ARROZ 1 KG", "HARINA KG 5", "SAL 25 KG.", "COCA COLA 1,5 L", "PATATAS KGS"]) { assert.equal(esKilo(n), false, n); assert.equal(esPorKilo(n), false, n); }
  assert.match(html, /" \/kg"/); assert.match(html, /Precio por kg/); assert.match(html, /Por kilos/);
});
