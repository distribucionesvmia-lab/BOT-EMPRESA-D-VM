import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("cabecera de categoría baja: botón y chips de 36 px, buscador opaco y sin franja transparente", () => {
  assert.match(h, /\.cab-cat \.subchip \{ min-height:36px; height:36px;/);
  assert.match(h, /\.cab-cat \.migas button \{ min-height:36px; height:36px;/);
  assert.match(h, /\.buscar \{ background:var\(--bg\); position:relative; z-index:5; \}/);
  assert.match(h, /\.cab-cat \{ box-shadow:0 -12px 0 var\(--bg\); border-bottom:0; \}/);
});

test("«Ordenar» y «Marca» ya no van dentro de la barra fija: se van al bajar", () => {
  assert.match(h, /w\.ordenar = ct;/);
  assert.match(h, /list\.appendChild\(w\); if \(w\.ordenar\) list\.appendChild\(w\.ordenar\);/);
});
