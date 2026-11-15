// Nitidez de las fotos: ninguna se enseña más grande de lo que la pantalla puede mostrar sin verse borrosa.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("FOTOS NÍTIDAS: al cargar una foto se limita su tamaño a píxeles de foto ≈ píxeles de pantalla, en el catálogo y en el chat", () => {
  for (const f of ["./pedido.html", "./cliente.html"]) {
    const h = leer(f);
    assert.match(h, /function nitida\(img\)/, f); assert.match(h, /devicePixelRatio/, f);
    if (f === "./pedido.html") { assert.match(h, /naturalWidth \/ dpr \* k/, f); assert.match(h, /k = ficha \? 1\.6 : 2\.5/, f); assert.match(h, /closest\("\.ficha-foto"\)/, f); } // la foto de la ficha también se limita (con algo más de margen)
    else { assert.match(h, /naturalWidth \/ dpr \* 2\.5/, f); assert.match(h, /min\(100%, \$\{Math\.max\(24, Math\.round\(img\.naturalWidth/, f); } // nunca por encima del 100 % de la baldosa
    assert.match(h, /\{ nitida\(e\.target\); e\.target\.classList\.add\("cargada"\); \}/, f); // se aplica en el mismo punto donde aparece la foto
    assert.match(h, /\.av, \.pf-av, \.tl-av, \.falta-av, \.sug-im/, f); // solo fotos de producto, no el logo
  }
});

test("FOTOS NÍTIDAS: la cuenta es la correcta (misma fórmula que el navegador) para fotos pequeñas y grandes", () => {
  const crisp = (natural, dpr) => Math.max(24, Math.round(natural / dpr * 2.5));
  assert.equal(crisp(100, 1), 250); assert.equal(crisp(100, 2), 125); assert.equal(crisp(100, 3), 83); // una foto de 100 px no se estira
  assert.equal(crisp(800, 3), 667); assert.ok(crisp(800, 3) > 100); // una foto grande no se limita: llena su baldosa
  assert.equal(crisp(10, 3), 24); // mínimo: nunca desaparece
});
