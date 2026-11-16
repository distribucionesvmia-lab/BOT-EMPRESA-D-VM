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
