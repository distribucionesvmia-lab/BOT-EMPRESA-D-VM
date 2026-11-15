import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("«Hacer pedido» enseña el histórico de artículos con cajas/unidades y «Enviar al carrito», encima del acceso al catálogo", () => {
  const bot = src("./bot.js"), html = src("./cliente.html");
  assert.match(bot, /type: "historico"/);
  assert.match(bot, /habitualProducts\(s\.customer\)/);
  assert.match(bot, /s\.customer && !s\.unverified/); // sin verificar: nada de histórico
  assert.match(html, /ui\.type === "historico"/);
  assert.match(html, /Enviar al carrito/);
  assert.match(html, /"#c=" \+ l\.join\(","\) \+ "&a=1"/); // suma al carrito del catálogo
  assert.ok(html.indexOf('envia.classList.add("primary")') < html.indexOf("ui.catalogo.title"), "el botón del catálogo va debajo");
});

test("el catálogo ordena los artículos de cada categoría por familia, subfamilia y artículo (como el histórico)", () => {
  const ped = src("./pedido.html");
  assert.match(ped, /const ord = items\.slice\(\)\.sort\(porFamilia\)/);
});

test("el carrito (catálogo y chat) sigue el orden de a3ERP", () => {
  assert.match(src("./pedido.html"), /const lines = \(\) => .*\.sort\(porFamilia\)/);
  assert.match(src("./bot.js"), /items = ordenarLineas\(\[\.\.\.items\], \(i\) => i\.id\)/);
});
