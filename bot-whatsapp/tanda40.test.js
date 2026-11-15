// Importar fotos por nombre: solo parejas claras, nunca empeora una foto, la anterior se archiva.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emparejar, fichaNombre } from "./fotos-emparejar.js";
import { importar, informeCsv } from "./importar-fotos.js";

// WebP mínimo (cabecera VP8X) con el tamaño que se pida
const webp = (w, h) => { const b = Buffer.alloc(40); b.write("RIFF", 0); b.writeUInt32LE(32, 4); b.write("WEBP", 8); b.write("VP8X", 12); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };
const ARTS = [
  { id: "1001", name: "AGUA BEZOYA PET 1,5L (R6)" }, { id: "1002", name: "AGUA BEZOYA 33 CL" },
  { id: "1003", name: "BORGES SIROPE CARAMELO 1 KG" }, { id: "1004", name: "BORGES SIROPE CHOCOLATE 1 KG" },
  { id: "1005", name: "MOCAY MAESTRO COLOMBIA 1Kg" }, { id: "1006", name: "LECHE ENTERA 1 L" },
];

test("las medidas tienen que coincidir y lo dudoso no se empareja", () => {
  const r = emparejar([{ nombre: "Bezoya · 1,5 L" }, { nombre: "Bezoya" }, { nombre: "Cosa que no existe 7 kg" }], ARTS);
  assert.equal(r.parejas.length, 1); assert.equal(r.parejas[0].id, "1001");
  assert.equal(r.dudosas.length + r.sin.length, 2, "«Bezoya» a secas puede ser dos artículos: no se adivina");
  assert.deepEqual(fichaNombre("Agua 1,5 litros").medidas, ["1.5l"]);
});
test("dos fotos para el mismo artículo → ninguna se da por buena", () => {
  const r = emparejar([{ nombre: "Sirope de caramelo · 1 kg" }, { nombre: "Borges Sirope caramelo 1 kg" }], ARTS);
  assert.equal(r.parejas.length, 0);
});
test("importar: simula, aplica, no empeora y archiva la anterior", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-")), src = path.join(d, "web", "Aguas"), img = path.join(d, "imagenes");
  fs.mkdirSync(src, { recursive: true }); fs.mkdirSync(img);
  fs.writeFileSync(path.join(src, "Bezoya · 1,5 L.webp"), webp(800, 800));
  fs.writeFileSync(path.join(src, "Borges · Siropes · Sirope de caramelo · 1 kg.webp"), webp(300, 300));
  fs.writeFileSync(path.join(src, "Mocay · Maestro Colombia · 1 kg.webp"), webp(400, 400));
  fs.writeFileSync(path.join(img, "1001.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]), Buffer.from([0, 0, 0, 100, 0, 0, 0, 100]), Buffer.alloc(20)])); // 100×100
  fs.writeFileSync(path.join(img, "1005.webp"), webp(900, 900)); // ya tiene una mejor
  const base = { carpeta: path.join(d, "web"), articulos: ARTS, imgDir: img };
  const sim = importar(base); assert.equal(sim.resumen.cambiadas, 1); assert.equal(sim.resumen.nuevas, 1); assert.equal(sim.resumen.yaMejores, 1);
  assert.ok(fs.existsSync(path.join(img, "1001.png")), "simular no cambia nada"); assert.ok(!fs.existsSync(path.join(img, "1003.webp")));
  importar({ ...base, aplicar: true, ahora: new Date("2026-11-15T10:30:00Z") });
  assert.ok(fs.existsSync(path.join(img, "1001.webp")) && !fs.existsSync(path.join(img, "1001.png")));
  assert.ok(fs.readdirSync(path.join(img, "anteriores")).some((f) => /^1001-20261115-1030\.png$/.test(f)), "la anterior se archiva");
  assert.ok(fs.existsSync(path.join(img, "1003.webp")));
  assert.equal(fs.readFileSync(path.join(img, "1005.webp")).length, 40, "no se toca una foto que ya era mayor");
  assert.match(informeCsv(sim.filas), /foto mejor/);
});
