import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("licores: no salen a los clientes salvo SECCION_LICORES=1, y el panel los sigue viendo", () => {
  const sv = src("./server.js");
  assert.match(sv, /const esLicor = /);
  assert.match(sv, /conLicores \|\| !esLicor\(p\)/);
  assert.match(src("./CLAUDE.md".replace("./", "../")), /SECCION_LICORES/);
});

test("cada familia y subfamilia lleva la foto de su artículo más vendido y el servidor la manda en tree", () => {
  const sv = src("./server.js");
  assert.equal([...sv.matchAll(/tree: arbolConTop\(/g)].length, 2);
  assert.match(sv, /customerDirectory\.ventas/);
  assert.match(src("./clientes-db.js"), /unidadesPorArticulo/);
  assert.match(src("./erp.js"), /ventas: \(\) =>/);
});

test("pedido.html: tarjeta de categoría con foto del más vendido y «N artículos»", () => {
  const h = src("./pedido.html");
  assert.match(h, /c\.top/);
  assert.match(h, /" artículos"/);
  assert.match(h, /s\.top/);
  assert.doesNotMatch(h, /" productos"\)/);
});
