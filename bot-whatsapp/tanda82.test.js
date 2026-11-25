// Inicio: dos botones (pedido nuevo en verde, añadir al carrito el último pedido en rojo) y sin «Categorías».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const srv = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("INICIO: botón verde «Hacer pedido de productos habituales» al Histórico; sin botón rojo", () => {
  assert.match(html, /const TARJETA_SIEMPRE = false/);
  assert.match(html, /"Hacer pedido de productos habituales"; hacer\.onclick = \(\) => \{ location\.href = cat \+ "#tab=hab"; \}/);
  assert.doesNotMatch(html, /Añadir al carrito desde mi histórico/);
  assert.match(html, /\.in-nuevo \{ background:var\(--ok\)/);
});
test("INICIO: «Los 5 artículos que más consumes» (tarjetas verdes) y «Mis artículos»", () => {
  assert.match(html, /"Los 5 artículos que más consumes"/);
  assert.match(html, /"Mis artículos"/);
  assert.match(html, /\.in-prod\.in-verde \{ background:var\(--ok-bg\); border:2px solid var\(--ok\)/);
  assert.match(html, /t\.classList\.add\("in-verde"\)/);
  assert.match(srv, /\.slice\(0, 5\)\.sort\(\(a, b\) => compararFamilias/);
});
test("HISTÓRICO: todo en orden de familias (sin grupo de 5) y al final «¿Quieres añadir algún producto nuevo del catálogo?» Sí/No", () => {
  const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(p, /"Otros artículos de los últimos 6 meses"/);
  assert.match(p, /¿Quieres añadir algún producto nuevo del catálogo\?/);
  assert.match(p, /si\.textContent = "Sí"; si\.onclick = \(\) => cambiarTab\("all"\)/);
  assert.match(p, /no\.textContent = "No"/);
  assert.match(p, /\.pf\.pf-top \{ border:2px solid var\(--ok\)/);
});
test("INICIO: el último pedido sigue disponible aunque se haya borrado o editado «Tu pedido de siempre»", () => {
  assert.match(srv, /const ultimoRepetir = ui\.last\?\.repetir/);
  assert.equal((srv.match(/ultimoRepetir, siempre/g) || []).length, 4);
});
test("INICIO: sin la sección «Categorías»", () => {
  assert.doesNotMatch(html, /setAttribute\("aria-label", "Categorías"\)/);
  assert.doesNotMatch(html, /el\("div", "in-chips"\)/);
});
