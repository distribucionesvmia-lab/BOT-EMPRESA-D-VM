// Herramienta para crear el Excel de fotos (crear-excel-fotos.js): lo que sale se lee con el lector del programa (y con el dibujo en formato Excel, con prefijo «xdr:»).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { excelDeFotos, itemsDeCarpeta } from "./crear-excel-fotos.js";
import { filasConFoto } from "./xlsx-read.js";
import { unzip } from "./xlsx-read.js";

const png = (w, h, n) => { const b = Buffer.alloc(300, n); Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(b, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

test("EXCEL DE FOTOS: cada foto en su fila con su nombre/código; se lee con el lector del programa y el dibujo lleva el prefijo xdr:", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ef-")); fs.writeFileSync(path.join(d, "11098.png"), png(515, 515, 1)); fs.writeFileSync(path.join(d, "Agua bezoya 1,5 L.png"), png(300, 600, 2)); fs.writeFileSync(path.join(d, "raro.webp"), Buffer.from("x"));
  const { items, omitidos } = itemsDeCarpeta(d); assert.equal(items.length, 2); assert.match(omitidos.join(), /raro\.webp: solo valen JPG y PNG/);
  const buf = excelDeFotos(items), r = filasConFoto(buf);
  assert.deepEqual(r.map((x) => [x.fila, x.textos[0], x.ext, x.data.length]), [[2, "11098", "png", 300], [3, "Agua bezoya 1,5 L", "png", 300]]);
  assert.match(String(unzip(buf, (n) => n === "xl/drawings/drawing1.xml")["xl/drawings/drawing1.xml"]), /<xdr:oneCellAnchor>/); // formato de Excel: lo leen también las versiones anteriores
});

test("EXCEL DE FOTOS: con una lista «archivo;artículo» se usa el nombre de la lista y lo que no está en ella se omite", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ef-")); fs.writeFileSync(path.join(d, "a.png"), png(100, 100, 1)); fs.writeFileSync(path.join(d, "b.png"), png(100, 100, 2));
  const csv = path.join(d, "lista.csv"); fs.writeFileSync(csv, "a.png;Seleccion essential uva vidrio\n");
  const { items, omitidos } = itemsDeCarpeta(d, csv); assert.deepEqual(items.map((i) => i.texto), ["Seleccion essential uva vidrio"]); assert.match(omitidos.join(), /b\.png: no está en la lista/);
});
