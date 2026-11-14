// Tanda 8 (accesibilidad y rendimiento): comprobaciones sobre la pantalla del cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");

test("atajos «Último pedido» / «Histórico» con la letra al máximo: no se parte ninguna palabra y, si no caben juntos, pasan uno debajo del otro", () => {
  assert.match(h, /\.quick \{ flex-wrap:wrap; \}/);
  assert.match(h, /\.quick button, \.quick button \{ flex:1 1 auto; min-width:min-content; max-width:100%; \}/);
  assert.match(h, /\.quick \.q-tx b \{ overflow-wrap:normal; word-break:normal; hyphens:none; \}/);
});
