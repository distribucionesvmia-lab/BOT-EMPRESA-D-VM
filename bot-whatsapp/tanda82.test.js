// Inicio: dos botones (pedido nuevo en verde, añadir al carrito el último pedido en rojo) y sin «Categorías».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const srv = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("INICIO: «Hacer pedido nuevo» (verde) lleva al catálogo y el rojo al Histórico", () => {
  assert.match(html, /const TARJETA_SIEMPRE = false/);
  assert.match(html, /"Hacer pedido nuevo"; hacer\.onclick = \(\) => \{ location\.href = cat; \}/);
  assert.match(html, /"Añadir al carrito desde mi histórico"/);
  assert.match(html, /location\.href = cat \+ "#tab=hab"/);
  assert.match(html, /\.in-nuevo \{ background:var\(--ok\)/);
});
test("INICIO: el último pedido sigue disponible aunque se haya borrado o editado «Tu pedido de siempre»", () => {
  assert.match(srv, /const ultimoRepetir = ui\.last\?\.repetir/);
  assert.equal((srv.match(/ultimoRepetir, siempre/g) || []).length, 4);
});
test("INICIO: sin la sección «Categorías»", () => {
  assert.doesNotMatch(html, /setAttribute\("aria-label", "Categorías"\)/);
  assert.doesNotMatch(html, /el\("div", "in-chips"\)/);
});
