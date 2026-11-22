// Crea el Excel de fotos que lee «Datos y Excel → Fotos de productos (ZIP o Excel)»: una foto por fila, con el CÓDIGO o el NOMBRE del artículo al lado.
// Sin dependencias. Uso:   node crear-excel-fotos.js <carpeta con las fotos> <salida.xlsx> [lista.csv]
//  · Sin lista: el nombre de cada archivo (sin la extensión) es el código o el nombre del artículo («11098.jpg», «Agua bezoya 1,5 L.png»).
//  · Con lista (CSV con «;» o «,»): cada línea «archivo;código o nombre del artículo» (p. ej. «foto1.png;11098»).
// Solo JPG y PNG (Excel no admite WebP). El dibujo se escribe con el prefijo «xdr:» como lo hace Excel: así lo leen TAMBIÉN las versiones anteriores del programa.
import fs from "node:fs";
import path from "node:path";
import { zip } from "./zip.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const EXT = new Set([".png", ".jpg", ".jpeg"]);
const medida = (b) => { // ancho y alto de un PNG o JPG (para no deformar la foto en la hoja)
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; }
  return { w: 1, h: 1 };
};

/** items: [{ texto, ext ("png"|"jpg"), data: Buffer }] → Buffer .xlsx (fila 1 = títulos, fotos desde la fila 2). */
export function excelDeFotos(items) {
  const LADO = 1_428_750; // 150 px en EMU
  const filas = [`<row r="1"><c r="A1" t="inlineStr"><is><t>Artículo</t></is></c><c r="B1" t="inlineStr"><is><t>Foto</t></is></c></row>`];
  const anclas = [], relsDib = [], media = {};
  items.forEach((it, i) => {
    const n = i + 1, fila = i + 2, ext = it.ext === "jpeg" ? "jpg" : it.ext, { w, h } = medida(it.data), k = Math.min(1, w && h ? 1 : 1);
    const cx = w >= h ? LADO : Math.round((LADO * w) / h), cy = w >= h ? Math.round((LADO * h) / w) : LADO;
    filas.push(`<row r="${fila}" ht="118" customHeight="1"><c r="A${fila}" t="inlineStr"><is><t>${esc(it.texto)}</t></is></c></row>`);
    anclas.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fila - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n + 1}" name="Foto ${n}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    relsDib.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.${ext}"/>`);
    media[`xl/media/image${n}.${ext}`] = it.data;
  });
  const NS = `xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fotos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="44" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/></cols><sheetData>${filas.join("")}</sheetData><drawing r:id="rId1"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    "xl/drawings/drawing1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr ${NS}>${anclas.join("")}</xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsDib.join("")}</Relationships>`,
    ...media,
  });
}

/** Lee la carpeta (y la lista opcional) y devuelve los items; los archivos que no valen se cuentan en `omitidos`. */
export function itemsDeCarpeta(carpeta, listaCsv) {
  const omitidos = [], items = [];
  const lista = new Map();
  if (listaCsv) for (const l of fs.readFileSync(listaCsv, "utf8").replace(/^﻿/, "").split(/\r?\n/)) { const m = /^\s*([^;,]+?)\s*[;,]\s*(.+?)\s*$/.exec(l); if (m) lista.set(m[1].toLowerCase(), m[2]); }
  for (const f of fs.readdirSync(carpeta).sort((a, b) => a.localeCompare(b, "es", { numeric: true }))) {
    const ext = path.extname(f).toLowerCase(); if (!fs.statSync(path.join(carpeta, f)).isFile()) continue;
    if (!EXT.has(ext)) { omitidos.push(`${f}: solo valen JPG y PNG`); continue; }
    const texto = lista.size ? lista.get(f.toLowerCase()) ?? lista.get(path.basename(f, ext).toLowerCase()) : path.basename(f, ext);
    if (!texto) { omitidos.push(`${f}: no está en la lista`); continue; }
    items.push({ texto, ext: ext.slice(1), data: fs.readFileSync(path.join(carpeta, f)) });
  }
  return { items, omitidos };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [carpeta, salida, csv] = process.argv.slice(2);
  if (!carpeta || !salida) { console.log("Uso: node crear-excel-fotos.js <carpeta con las fotos> <salida.xlsx> [lista.csv]"); process.exit(1); }
  const { items, omitidos } = itemsDeCarpeta(carpeta, csv);
  if (!items.length) { console.log("No hay ninguna foto válida en la carpeta."); omitidos.forEach((o) => console.log(" -", o)); process.exit(1); }
  fs.writeFileSync(salida, excelDeFotos(items));
  console.log(`Hecho: ${items.length} fotos en ${salida}.`); omitidos.forEach((o) => console.log(" - omitido:", o));
}
