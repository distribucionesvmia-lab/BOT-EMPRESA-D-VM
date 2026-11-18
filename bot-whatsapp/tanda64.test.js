// Fluidez: las fotos se sirven sin bloquear el programa y con ETag (304 si no cambiaron).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const sv = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("FLUIDEZ: /img/ no lee la foto con readFileSync y manda ETag, 304 y el archivo en flujo", () => {
  const i = sv.indexOf('p.startsWith("/img/")'), bloque = sv.slice(i, i + 1800);
  assert.ok(i > 0);
  assert.doesNotMatch(bloque, /readFileSync/);
  assert.match(bloque, /fs\.promises\.stat/); assert.match(bloque, /if-none-match/); assert.match(bloque, /writeHead\(304/); assert.match(bloque, /createReadStream/);
  assert.match(bloque, /Sesión caducada/); // sigue exigiendo sesión
});

test("FLUIDEZ: la foto con ?v=<fecha> no se vuelve a pedir nunca (immutable); sin ?v= vale un día", () => {
  const i = sv.indexOf('p.startsWith("/img/")'), b = sv.slice(i, i + 1900);
  assert.match(b, /url\.searchParams\.has\("v"\) \? "private, max-age=31536000, immutable" : "private, max-age=86400"/);
  assert.match(sv, /\/img\/\$\{encodeURIComponent\(id\)\}\?v=\$\{imgVer\.get\(id\) \?\? 0\}/); // todas las fotos que se enseñan llevan ?v=: cambia si cambia la foto
});
test("FLUIDEZ: las miniaturas del carrito, de las sugerencias y de la lista decodifican la foto aparte (decoding async)", () => {
  const h = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok((h.match(/\.decoding = "async"/g) || []).length >= 4);
});
