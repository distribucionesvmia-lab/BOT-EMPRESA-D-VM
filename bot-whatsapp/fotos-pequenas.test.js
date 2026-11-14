import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tamanoImagen, informe } from "./fotos-pequenas.js";

// PNG mínimo con el tamaño que se pida (solo cabecera)
const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

test("fotos pequeñas: lee el tamaño de PNG y JPEG y lista solo las de 200 px o menos, sin tocar ninguna", () => {
  assert.deepEqual(tamanoImagen(png(120, 90)), { w: 120, h: 90 });
  assert.deepEqual(tamanoImagen(jpg(640, 480)), { w: 640, h: 480 });
  assert.equal(tamanoImagen(Buffer.from("no es una foto")), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-"));
  fs.writeFileSync(path.join(d, "1001.png"), png(150, 150)); fs.writeFileSync(path.join(d, "1002.png"), png(800, 800)); fs.writeFileSync(path.join(d, "1003.jpg"), jpg(200, 120)); fs.writeFileSync(path.join(d, "notas.txt"), "x");
  const antes = fs.readdirSync(d).sort().join();
  const r = informe(d, [{ id: "1001", name: "AGUA MINERAL 1,5 L" }, { id: "1003", name: "CAFE MOLIDO 250 GR" }]);
  assert.deepEqual(r.map((x) => [x.codigo, x.tamano]), [["1001", "150x150"], ["1003", "200x120"]]);
  assert.ok(r[0].categoria.length > 0);
  assert.equal(fs.readdirSync(d).sort().join(), antes); // no cambia ni borra nada
});
