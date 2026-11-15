// Fotos desde un ZIP en el panel: revisar (no cambia nada) → aplicar solo lo marcado.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openCatalogDb } from "./catalogo-db.js";
import { crearFotos } from "./fotos-articulos.js";
import { crearImportadorZip } from "./fotos-zip.js";

const webp = (w, h, extra = 0) => { const b = Buffer.alloc(40 + extra); b.write("RIFF", 0); b.writeUInt32LE(32 + extra, 4); b.write("WEBP", 8); b.write("VP8X", 12); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };
function zipBin(files) { // zip con buffers binarios
  const parts = [], central = []; let off = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nb = Buffer.from(name), data = zlib.deflateRawSync(raw), crc = zlib.crc32 ? zlib.crc32(raw) : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); central.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const c = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(c.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, c, e]);
}

function entorno() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fz-")), img = path.join(d, "img"); fs.mkdirSync(img);
  const cat = openCatalogDb(path.join(d, "c.sqlite"));
  cat.upsertProducts([{ id: "1001", name: "AGUA BEZOYA PET 1,5L (R6)", price: 1, vat: 10 }, { id: "1003", name: "BORGES SIROPE CARAMELO 1 KG", price: 3, vat: 10 }, { id: "1005", name: "MOCAY MAESTRO COLOMBIA 1Kg", price: 9, vat: 10 }]);
  const fotos = crearFotos(img); fs.writeFileSync(path.join(img, "1005.webp"), webp(900, 900));
  return { img, imp: crearImportadorZip({ catalogDb: cat, fotos }) };
}
const ZIP = () => zipBin({ "Aguas/Bezoya · 1,5 L.webp": webp(800, 800), "Despensa/Borges · Siropes · Sirope de caramelo · 1 kg.webp": webp(300, 300), "Café Mocay/Mocay · Maestro Colombia · 1 kg.webp": webp(400, 400), "__MACOSX/Aguas/._Bezoya.webp": webp(100, 100), "Aguas/notas.txt": Buffer.from("hola"), "Aguas/Falsa.webp": Buffer.from("no soy una foto") });

test("revisar no cambia nada y enseña qué iría a qué artículo", () => {
  const { img, imp } = entorno(), v = imp.vista(ZIP());
  assert.equal(v.filas.length, 3); assert.equal(v.total, 3 + 1 - 1 + 0, "cuenta las fotos válidas"); // 3 válidas (la falsa se ignora)
  assert.equal(v.ignoradas.length, 1);
  assert.deepEqual(Object.fromEntries(v.filas.map((f) => [f.id, f.estado])), { 1001: "nueva", 1003: "nueva", 1005: "ya_mejor" });
  assert.ok(!fs.existsSync(path.join(img, "1001.webp")), "no se ha escrito nada");
});
test("aplicar solo lo marcado, sin empeorar salvo que se pida", () => {
  const { img, imp } = entorno(); const v = imp.vista(ZIP());
  let r = imp.aplicar(v.token, ["1001", "1005"]); assert.equal(r.hechas, 1); assert.equal(r.saltadas.length, 1);
  assert.ok(fs.existsSync(path.join(img, "1001.webp"))); assert.ok(!fs.existsSync(path.join(img, "1003.webp")), "lo no marcado no se pone");
  assert.equal(fs.readFileSync(path.join(img, "1005.webp")).length, 40);
  assert.equal(imp.aplicar(v.token, ["1003"]).error?.includes("caducado"), true, "el token se gasta");
  const v2 = imp.vista(ZIP()); r = imp.aplicar(v2.token, ["1005"], { forzar: true }); assert.equal(r.hechas, 1);
  assert.ok(fs.readdirSync(path.join(img, "anteriores")).some((f) => f.startsWith("1005-")), "la anterior se archiva");
});
test("un archivo que no es zip da un error claro", () => {
  const { imp } = entorno(); assert.match(imp.vista(Buffer.from("hola")).error, /zip/i);
  assert.match(imp.vista(zipBin({ "a.txt": Buffer.from("x") })).error, /ninguna foto/);
});
test("el panel tiene la tarjeta y las rutas piden confirmación", () => {
  const h = fs.readFileSync("empresa.html", "utf8").replace(/\r\n/g, "\n"), a = fs.readFileSync("admin.js", "utf8").replace(/\r\n/g, "\n");
  for (const id of ["fz-fichero", "fz-revisar", "fz-aplicar", "fz-forzar", "fz-lista"]) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(a, /\/api\/admin\/fotos\/zip\/aplicar[\s\S]{0,200}confirmo !== true/);
});
