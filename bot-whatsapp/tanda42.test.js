// Excel con una foto por fila (flotante o dentro de la celda) → se empareja por código o por nombre en la tarjeta de fotos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zip } from "./zip.js";
import { openCatalogDb } from "./catalogo-db.js";
import { crearActualizador, detectarTipo } from "./actualizar-datos.js";
import { filasConFoto } from "./xlsx-read.js";

const png = (n) => { const b = Buffer.alloc(400, n); Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 1, 0]).copy(b, 0); return b; };
const celdas = (filas) => filas.map((f, i) => `<row r="${i + 1}">${f.map((t, j) => t === null ? "" : `<c r="${"ABC"[j]}${i + 1}" t="inlineStr"><is><t>${t}</t></is></c>`).join("")}</row>`).join("");
const base = (hoja) => ({
  "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
  "xl/worksheets/sheet1.xml": hoja,
  "xl/media/image1.png": png(1), "xl/media/image2.png": png(2),
});
// A) fotos flotantes (Insertar → Imagen)
const flotante = () => zip({
  ...base(`<worksheet><sheetData>${celdas([["Nombre", "Foto"], ["AGUA BEZOYA PET 1,5L", null], ["32", null]])}</sheetData></worksheet>`),
  "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>`,
  "xl/drawings/drawing1.xml": `<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><a:blip r:embed="rId1"/></xdr:pic></xdr:twoCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:pic><a:blip r:embed="rId2"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
  "xl/drawings/_rels/drawing1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../media/image1.png"/><Relationship Id="rId2" Target="../media/image2.png"/></Relationships>`,
});
// B) fotos dentro de la celda (Excel 365)
const enCelda = () => zip({
  ...base(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nombre</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>AGUA BEZOYA PET 1,5L</t></is></c><c r="B2" t="e" vm="1"><v>#VALUE!</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>32</t></is></c><c r="B3" t="e" vm="2"><v>#VALUE!</v></c></row></sheetData></worksheet>`),
  "xl/richData/rdrichvalue.xml": `<rvData><rv s="0"><v>0</v><v>5</v></rv><rv s="0"><v>1</v><v>5</v></rv></rvData>`,
  "xl/richData/rdrichvaluestructure.xml": `<rvStructures><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`,
  "xl/richData/richValueRel.xml": `<richValueRels><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>`,
  "xl/richData/_rels/richValueRel.xml.rels": `<Relationships><Relationship Id="rId1" Target="../media/image1.png"/><Relationship Id="rId2" Target="../media/image2.png"/></Relationships>`,
});
const montar = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fx-")), cat = openCatalogDb(path.join(d, "c.sqlite"));
  cat.upsertProducts([{ id: "31", name: "AGUA BEZOYA PET 1,5L (R6)", price: 1, vat: 10 }, { id: "32", name: "AGUA BEZOYA 33 CL", price: 1, vat: 10 }]);
  const img = path.join(d, "img") + path.sep; fs.mkdirSync(img);
  return { a: crearActualizador({ catalogDb: cat, customersDb: null, accountsDb: null, imgDir: img }), img };
};

for (const [nombre, hacer] of [["flotantes", flotante], ["dentro de la celda", enCelda]]) test(`Excel con fotos ${nombre}: nombre → artículo y código → artículo`, () => {
  const x = Buffer.from(hacer()); assert.equal(filasConFoto(x).length, 2); assert.equal(detectarTipo(x), "fotos");
  const { a, img } = montar(), p = a.vistaPrevia("fotos", x);
  assert.equal(p.resumen.fotosNuevas, 2, JSON.stringify(p.resumen)); assert.equal(p.resumen.ignoradas, 0);
  assert.equal(a.aplicar("fotos", x).fotosGuardadas, 2);
  assert.ok(fs.existsSync(path.join(img, "31.png")) && fs.existsSync(path.join(img, "32.png")), "una por nombre (31) y otra por código (32)");
});
test("un Excel de fotos subido en la tarjeta de productos avisa en vez de decir «0 cambios»", () => {
  const { a } = montar(); assert.throws(() => a.vistaPrevia("productos", Buffer.from(flotante())), /Fotos de productos/);
});

test("Excel con fotos hecho por otros programas (LibreOffice, openpyxl…): el dibujo viene sin el prefijo «xdr:» y se lee igual", () => {
  const buf = zip({
    ...base(`<worksheet><sheetData>${celdas([["Nombre", "Foto"], ["AGUA BEZOYA PET 1,5L", null]])}</sheetData></worksheet>`),
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>`,
    "xl/drawings/drawing1.xml": `<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><oneCellAnchor><from><col>1</col><colOff>0</colOff><row>1</row><rowOff>0</rowOff></from><pic><blipFill><blip xmlns:r="x" r:embed="rId1"/></blipFill></pic></oneCellAnchor></wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>`,
  });
  const r = filasConFoto(buf); assert.equal(r.length, 1); assert.equal(r[0].fila, 2); assert.deepEqual(r[0].textos, ["AGUA BEZOYA PET 1,5L"]); assert.equal(r[0].ext, "png");
});
