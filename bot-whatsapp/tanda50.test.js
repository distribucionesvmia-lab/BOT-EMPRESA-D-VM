// Artículos que no se venden: precio 0 o descuento del 100 % no salen en el catálogo del cliente ni en el chat.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sinCoste, webProducts } from "./weborder.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("sinCoste: precio 0, sin precio o descuento del 100 %", () => {
  for (const [p, e] of [[{ price: 0 }, true], [{ price: null }, true], [{}, true], [{ price: -1 }, true], [{ price: 2, discount: 100 }, true], [{ price: 2, discount: 120 }, true], [{ price: 2, discount: 99.9 }, false], [{ price: 0.01 }, false], [{ price: 2, discount: 0 }, false]]) assert.equal(sinCoste(p), e, JSON.stringify(p));
});

test("webProducts: no saca los artículos de precio 0 ni con descuento del 100 %", () => {
  const catalogo = [
    { id: "1", name: "AGUA BUENA", price: 1, vat: 10 }, { id: "2", name: "MUESTRA GRATIS", price: 0, vat: 10 },
    { id: "3", name: "REGALO PROMO", price: 5, discount: 100, vat: 10 }, { id: "4", name: "CERVEZA CON 50", price: 2, discount: 50, vat: 10 },
  ];
  const lista = webProducts({ id: "C1", orders: [] }, catalogo, () => []);
  assert.deepEqual(lista.map((p) => p.id).sort(), ["1", "4"]);
});

test("el catálogo del programa (chat y pedido) se carga sin esos artículos", () => {
  const sv = src("./server.js");
  assert.equal([...sv.matchAll(/setCatalog\(\(await getCatalog\(\)\)\?\.filter\(\(p\) => !sinCoste\(p\)\) \?\? null\)/g)].length, 2); // al arrancar y al refrescar
  assert.match(src("./weborder.js"), /\.filter\(\(p\) => !sinCoste\(p\)\)/);
});
