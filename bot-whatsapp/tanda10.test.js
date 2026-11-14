// Tanda 10: versión del programa en marcha (para saber qué está publicado), tarjeta del histórico sin cortes y cantidades decimales.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { estadoVersion, commitEnDisco, COMMIT_ARRANQUE } from "./version.js";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
const s = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("versión: se lee el commit del disco (7 caracteres), y si coincide con el del arranque no falta reiniciar", () => {
  const c = commitEnDisco();
  if (c !== null) assert.match(c, /^[0-9a-f]{7}$/);
  const e = estadoVersion(); assert.equal(e.version, COMMIT_ARRANQUE); assert.equal(e.reinicioPendiente, !!(e.version && e.enDisco && e.version !== e.enDisco));
});
test("/health dice la versión en marcha y la del disco; la Ayuda la enseña (chat y catálogo)", () => {
  assert.match(s, /JSON\.stringify\(\{ ok: true, \.\.\.estadoVersion\(\) \}\)/);
  for (const f of [h, p]) { assert.match(f, /Versión del programa: /); assert.match(f, /pendiente de reiniciar/); }
});
test("1. tarjeta de pedido del chat: cada línea en dos filas (nombre arriba; cantidad e importe abajo), sin ancho fijo", () => {
  assert.match(h, /\.tcard tbody tr \{ display:grid; grid-template-columns:auto minmax\(0, 1fr\)/);
  assert.match(h, /\.tcard tbody td\.c-imp \{ grid-column:2; grid-row:2; text-align:right; \}/);
  assert.match(h, /\.tcard tfoot tr \{ display:flex; justify-content:space-between/);
  assert.match(h, /<b>Histórico de pedidos<\/b>/);
});
test("2. cantidad con coma o punto: «1,5» se queda en 1 (nunca pasa a 15) y se avisa", () => {
  assert.match(p, /entero = parseInt\(v\.split\(\/\[\.,\]\/\)\[0\]/);
  assert.match(p, /if \(entero !== null\) \{ const e = entero; entero = null; sep = false;/);
});
