// Precio por unidad también en las tarjetas de pedido del chat y en la lista de Mi cuenta.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lee = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("PRECIO UNIDAD: bot.js, server.js y cliente.html lo llevan", () => {
  assert.match(lee("./bot.js"), /pud: pudDe\(/);
  assert.match(lee("./server.js"), /uds: l\.qty, pud,/);
  const c = lee("./cliente.html");
  assert.match(c, /f\.pud != null/);
  assert.match(c, /l\.pud != null/);
});
test("MODO OSCURO: la tarjeta verde del Inicio lleva texto oscuro fijo", () => {
  assert.match(lee("./cliente.html"), /\.in-prod\.in-verde \.in-pn[^}]*color:#1D1D1F/);
});
test("PEDIDO: botón «Volver» arriba del pedido y del resumen", () => {
  const p = lee("./pedido.html");
  assert.match(p, /id="cartAtras"/);
  assert.match(p, /id="resAtras"/);
  assert.match(p, /\$\("cartAtras"\)\.onclick = \(\) => showCart\(false\)/);
});
test("HISTÓRICO: las 5 tarjetas verdes llevan margen, franja y puesto", () => {
  assert.match(lee("./pedido.html"), /\.pf\.pf-top::before \{ content:counter\(top5\)/);
});
