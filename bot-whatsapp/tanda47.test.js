import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("«Hacer pedido» abre el catálogo en «Lo habitual» si el cliente tiene artículos de los últimos 6 meses", () => {
  const bot = src("./bot.js"), html = src("./cliente.html");
  assert.match(bot, /#tab=hab/);
  assert.match(bot, /s\.customer && !s\.unverified && habitualProducts\(s\.customer\)\.length > 0/); // sin verificar: catálogo normal
  assert.doesNotMatch(html, /ui\.type === "historico"/); // ya no hay lista aparte en el chat
});

test("el catálogo ordena los artículos de cada categoría por familia, subfamilia y artículo (como el histórico)", () => {
  const ped = src("./pedido.html");
  assert.match(ped, /const ord = items\.slice\(\)\.sort\(porFamilia\)/);
});

test("el carrito (catálogo y chat) sigue el orden de a3ERP", () => {
  assert.match(src("./pedido.html"), /const lines = \(\) => .*\.sort\(porFamilia\)/);
  assert.match(src("./bot.js"), /items = ordenarLineas\(\[\.\.\.items\], \(i\) => i\.id\)/);
});
