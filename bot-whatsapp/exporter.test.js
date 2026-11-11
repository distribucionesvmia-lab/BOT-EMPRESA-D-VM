import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { openDb } from "./db.js";
import { runExport } from "./exporter.js";
import { buildXlsx, buildWorkbook } from "./xlsx.js";
import { priceOrder } from "./pricing.js";
import { madrid, madridDate, FORMAT, pieDeHoja } from "./export-format.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-exp-"));
const catalogo = [
  { id: "00123", name: "Artículo A & <B>", price: 1.5, unitsPerBox: 6, vat: 21 },
  { id: "B1", name: "Artículo B", price: 3, unitsPerBox: 4, vat: 10 },
];
// Pedido ya valorado (precio, cajas/unidades, descuento, IVA), tal como lo guarda el servidor
const pedido = (key, extra = {}) =>
  priceOrder(
    {
      key, phone: "34600000001", customerId: "C1", name: "Cliente de prueba", address: "Calle Falsa 1", text: "x", review: false,
      at: "2026-10-28T10:00:00.000Z", note: "",
      items: [{ id: "00123", name: "Artículo A & <B>", qty: 2, unit: "caja" }, { id: "B1", name: "Artículo B", qty: 1 }],
      ...extra,
    },
    { discounts: { B1: 10 }, recargoEquivalencia: !!extra.re },
    catalogo,
  );

// Lector mínimo de zip para comprobar el contenido del .xlsx
function unzip(buf) {
  const out = {};
  const eocd = buf.length - 22;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString();
    p += 46 + nl;
  }
  return out;
}
// Texto de las celdas de una hoja: filas densas (columna A = posición 0; las vacías son "")
const colIndex = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const grid = (xml) =>
  [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((r) => {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>)/g)) row[colIndex(c[1])] = c[2] ?? c[3] ?? "";
    return Array.from(row, (v) => v ?? "");
  });

test("xlsx: estructura válida, texto escapado, ceros conservados y reproducible", () => {
  const rows = [["Código", "Texto", "Cantidad"], ["00123", "A & <B> \u0001", 2.5], ["x", null, 1]];
  const a = buildXlsx(rows, { sheetName: "Pedidos" });
  assert.deepEqual(a, buildXlsx(rows, { sheetName: "Pedidos" }));
  const f = unzip(a);
  assert.ok(f["[Content_Types].xml"] && f["xl/workbook.xml"] && f["xl/worksheets/sheet1.xml"]);
  const sheet = f["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<t xml:space="preserve">00123<\/t>/);
  assert.match(sheet, /A &amp; &lt;B&gt; <\/t>/);
  assert.match(sheet, /<c r="C2"[^>]*><v>2.5<\/v><\/c>/);
});

test("xlsx: varias hojas con estilos por celda", () => {
  const f = unzip(buildWorkbook([{ name: "Uno", rows: [[{ v: "a", s: 4 }]] }, { name: "Dos", rows: [[{ v: 1.5, s: 2 }]] }]));
  assert.match(f["xl/workbook.xml"], /name="Uno"[\s\S]*name="Dos"/);
  assert.match(f["xl/worksheets/sheet1.xml"], /<c r="A1" s="4"/);
  assert.match(f["xl/worksheets/sheet2.xml"], /<c r="A1" s="2"><v>1.5<\/v>/);
});

test("exporta los pedidos pendientes una sola vez y guarda el historial", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1"));
  db.createOrder(pedido("k2"));
  const r = runExport(db, { dir });
  assert.equal(r.export.order_count, 2);
  assert.equal(r.export.line_count, 4);
  const buf = fs.readFileSync(r.filePath);
  assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), r.export.sha256);
  assert.equal(db.listOrders({ exportStatus: "pending" }).length, 0);
  assert.equal(db.exportedOrders(r.export.id).length, 2);
  const again = runExport(db, { dir });
  assert.equal(again.export, null);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(db.listExports().length, 1);
  db.createOrder(pedido("k3"));
  const next = runExport(db, { dir, now: new Date(Date.now() + 1000) });
  assert.equal(next.export.order_count, 1);
  assert.equal(db.listExports().length, 2);
});

test("exportar solo los pedidos elegidos: los demás siguen pendientes y se pueden exportar después", () => {
  const db = openDb(":memory:"), dir = tmp();
  const refs = ["a", "b", "c"].map((k) => db.createOrder(pedido(k, {})).order.ref);
  const r1 = runExport(db, { dir, refs: [refs[0], refs[2]] });
  assert.equal(r1.export.order_count, 2);
  const f = unzip(fs.readFileSync(r1.filePath));
  const hojas = [...f["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hojas.length, 3); // una hoja por pedido exportado (2) + la hoja plana «Líneas»
  assert.equal(hojas[2], "Líneas");
  assert.deepEqual(db.listOrders().map((o) => [o.ref, o.export_status]).sort(), [[refs[0], "exported"], [refs[1], "pending"], [refs[2], "exported"]]);
  // una referencia que no existe o ya exportada no exporta nada
  assert.equal(runExport(db, { dir, refs: [refs[0], "VM-2026-999999"] }).export, null);
  // el pedido que quedó se exporta después
  assert.equal(runExport(db, { dir }).export.order_count, 1);
});

// Estilos de una celda ya escrita: { negrita, color, relleno, alineado } leídos de styles.xml
const estiloDe = (files, xml, ref) => {
  const s = Number(new RegExp(`<c r="${ref}" s="(\\d+)"`).exec(xml)?.[1] ?? 0);
  const st = files["xl/styles.xml"];
  const xf = [...st.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1].matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/gs)][s][0];
  const fontId = Number(/fontId="(\d+)"/.exec(xf)[1]), fillId = Number(/fillId="(\d+)"/.exec(xf)[1]);
  const font = [...st.match(/<fonts[^>]*>(.*?)<\/fonts>/s)[1].matchAll(/<font>.*?<\/font>/gs)][fontId][0];
  return { s, negrita: font.includes("<b/>"), color: /<color rgb="FF(\w+)"/.exec(font)?.[1] ?? null, relleno: fillId > 1, alineado: /horizontal="(\w+)"/.exec(xf)?.[1] ?? null };
};
const exportar = (pedidos) => {
  const db = openDb(":memory:"), dir = tmp();
  for (const p of pedidos) db.createOrder(p);
  return unzip(fs.readFileSync(runExport(db, { dir }).filePath));
};

test("hoja de pedido: cartel azul «Cliente 5900 · NOMBRE» y debajo la población, con la fila más alta", () => {
  const f = exportar([pedido("k1", { city: "MEDINA DEL CAMPO" })]);
  const xml = f["xl/worksheets/sheet1.xml"], rows = grid(xml);
  assert.equal(rows[0][0], "Cliente C1 · Cliente de prueba");
  assert.equal(rows[1][0], "MEDINA DEL CAMPO"); // la población, justo debajo del nombre
  assert.match(xml, /<row r="1" ht="38" customHeight="1"><c r="A1"/);
  assert.ok(xml.includes('<mergeCell ref="A1:H1"/>') && xml.includes('<mergeCell ref="A2:H2"/>'));
  // sin población, no hay fila vacía
  const sin = grid(exportar([pedido("k2", {})])["xl/worksheets/sheet1.xml"]);
  assert.equal(sin[1][0], "Nº pedido");
});

test("hoja de pedido: cabecera sin código ni nombre de cliente, líneas con ☐, sin IVA ni observaciones de línea, y totales", () => {
  const f = exportar([pedido("k1", {})]);
  const rows = grid(f["xl/worksheets/sheet1.xml"]);
  const todo = JSON.stringify(rows);
  for (const fuera of ["Código cliente", "Nombre comercial", "IVA %", "Observaciones línea"]) assert.equal(todo.includes(fuera), false, fuera + " ya no va en la hoja de pedido");
  assert.deepEqual(rows[1].slice(0, 5), ["Nº pedido", "", "", "Fecha recepción", "Hora pedido"]);
  assert.deepEqual([rows[2][0], rows[2][3], rows[2][4]], ["VM-2026-000001", "28/10/2026", "11:00"]); // el código de cliente solo sale en el cartel
  assert.deepEqual(rows[3], ["Prep.", "Código artículo", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe"]);
  // 2 cajas × 6 = 12 uds × 1,50 = 18,00 · 1 ud × 3,00 − 10 % = 2,70
  assert.deepEqual(rows[4], ["☐", "00123", "2", "Artículo A &amp; &lt;B&gt;", "12", "1.5", "", "18"]);
  assert.deepEqual(rows[5], ["☐", "B1", "", "Artículo B", "1", "3", "10", "2.7"]);
  // totales: base 20,70 · IVA 21 % de 18,00 = 3,78 + 10 % de 2,70 = 0,27 → 4,05 · total 24,75
  assert.deepEqual(rows.filter((r) => /^Total|^TOTAL/.test(r[0])).map((r) => [r[0], r[7]]), [["Total base imponible", "20.7"], ["Total IVA", "4.05"], ["Total R.E.", "0"], ["TOTAL PEDIDO", "24.75"]]);
});

test("hoja de pedido: formato de las líneas (alto 17, filas alternas, cajas en negrita, cantidades y precios en gris, sin cajas → unidades en negrita y negro, todo centrado)", () => {
  const f = exportar([pedido("k1", {})]);
  const xml = f["xl/worksheets/sheet1.xml"];
  assert.equal([...xml.matchAll(/<row r="\d+" ht="17" customHeight="1">/g)].length, 2); // las dos líneas, filas de 17
  const caja = (ref) => estiloDe(f, xml, ref);
  assert.equal(caja("C5").negrita, true); // valor de cajas en negrita
  assert.equal(caja("E5").color, "808080"); assert.equal(caja("E5").negrita, false); // con cajas: unidades en gris
  for (const c of ["F5", "G5", "H5"]) assert.equal(caja(c).color, "808080", c); // precio, dto. e importe en gris
  assert.deepEqual([caja("E6").negrita, caja("E6").color], [true, "000000"]); // sin cajas: unidades en negrita y negro
  assert.notEqual(caja("B5").relleno, caja("B6").relleno); // una fila blanca y otra gris claro
  for (const c of ["A5", "B5", "C5", "D5", "E5", "F5", "G5", "H5"]) assert.equal(caja(c).alineado, "center", c); // todo centrado en horizontal
  assert.equal(estiloDe(f, xml, "B4").alineado, "center"); // títulos de columna al medio
  assert.match(f["xl/styles.xml"], /<bottom style="thin"/); // separador fino entre líneas
});

test("hoja de pedido: pie final = entrega (con color) → observaciones del cliente (cuadro, texto en rojo si hay) → totales", () => {
  const casos = [["2026-10-28", "ENTREGA: HOY, MIÉRCOLES 28 DE OCTUBRE", 8], ["2026-10-29", "ENTREGA: MAÑANA, JUEVES 29 DE OCTUBRE", 9], ["2026-11-02", "ENTREGA: LUNES 2 DE NOVIEMBRE", 10]];
  for (const [fecha, texto, estilo] of casos) {
    const f = exportar([pedido("k", { note: "Llamar antes", delivery: fecha })]);
    const xml = f["xl/worksheets/sheet1.xml"], rows = grid(xml);
    const e = rows.findIndex((r) => r[0] === texto), o = rows.findIndex((r) => r[0] === "Observaciones del cliente"), t = rows.findIndex((r) => r[0] === "Total base imponible");
    assert.ok(e > 0 && o === e + 1 && rows[o + 1][0] === "Llamar antes" && t > o + 1, "orden: entrega, observaciones, cuadro de texto, totales");
    assert.match(xml, new RegExp(`<c r="A${e + 1}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${texto}`));
    assert.equal(estiloDe(f, xml, `A${o + 2}`).color, "C00000"); // el texto de la observación, en rojo
    assert.ok(xml.includes(`<mergeCell ref="A${o + 2}:H${o + 2}"/>`)); // el cuadro ocupa todo el ancho
  }
  // sin observación: cuadro vacío; sin día de entrega: lo dice
  const f = exportar([pedido("k", {})]), rows = grid(f["xl/worksheets/sheet1.xml"]);
  const o = rows.findIndex((r) => r[0] === "Observaciones del cliente");
  assert.equal(rows[o - 1][0], "ENTREGA: SIN DÍA ELEGIDO");
  assert.equal(rows[o + 1][0], "");
});

test("impresión: A4 vertical ajustado al ancho, márgenes reducidos, área de impresión automática y páginas «1/3» abajo a la derecha", () => {
  const f = exportar([pedido("k1", {}), pedido("k2", {})]);
  for (const n of [1, 2, 3]) {
    const xml = f[`xl/worksheets/sheet${n}.xml`];
    assert.match(xml, /<pageSetUpPr fitToPage="1"\/>/);
    assert.match(xml, /<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"\/>/); // A4 vertical, 1 página de ancho
    assert.match(xml, /<pageMargins left="0\.25" right="0\.25"/); // márgenes reducidos
    assert.match(xml, /&amp;R&amp;9&amp;P\/&amp;N<\/oddFooter>/); // «página/total» a la derecha del pie
  }
  const wb = f["xl/workbook.xml"];
  const filas = grid(f["xl/worksheets/sheet1.xml"]).length;
  assert.ok(wb.includes(`<definedName name="_xlnm.Print_Area" localSheetId="0">'C1 · 000001'!$A$1:$H$${filas}</definedName>`)); // área de impresión = todo lo escrito
  assert.equal([...wb.matchAll(/_xlnm\.Print_Area/g)].length, 3);
});

test("pie de hoja: las observaciones de línea (identificando la línea) o nada", () => {
  const sin = exportar([pedido("k1", {})])["xl/worksheets/sheet1.xml"];
  assert.match(sin, /<oddFooter>&amp;L&amp;8&amp;R&amp;9&amp;P\/&amp;N<\/oddFooter>/); // sin observaciones: parte izquierda totalmente en blanco
  const con = exportar([pedido("k2", { items: [{ id: "00123", name: "Artículo A & <B>", qty: 2, unit: "caja" }, { id: "B1", name: "Artículo B", qty: 1, note: "sin hielo & bien frío" }] })])["xl/worksheets/sheet1.xml"];
  assert.match(con, /<oddFooter>&amp;L&amp;8Línea 2 · B1 Artículo B: sin hielo &amp;&amp; bien frío&amp;R/); // línea 2, su código y su observación (el & se duplica en los pies de Excel)
  const p = pieDeHoja(Array.from({ length: 30 }, (_, k) => ({ id: "X" + k, name: "NOMBRE LARGO DEL ARTÍCULO " + k, note: "observación bastante larga número " + k })));
  assert.ok(p.text.length <= 300 && p.text.endsWith("«Líneas»)"), "si no caben, se corta y remite a la hoja «Líneas»");
  assert.deepEqual(pieDeHoja([{ id: "A", name: "A", note: "  " }]), { text: "", renglones: 0 });
});

test("hojas: nombre «código · nº», sin repetirse aunque el cliente tenga dos pedidos", () => {
  const f = exportar([pedido("k1", {}), pedido("k2", {})]);
  assert.deepEqual([...f["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]), ["C1 · 000001", "C1 · 000002", "Líneas"]);
});

test("el recargo de equivalencia del cliente aparece en los totales", () => {
  const f = exportar([pedido("k1", { re: true })]); // 5,2 % de 18,00 = 0,94 · 1,4 % de 2,70 = 0,04
  const rows = grid(f["xl/worksheets/sheet1.xml"]);
  assert.deepEqual(rows.filter((r) => /^Total|^TOTAL/.test(r[0])).map((r) => r[7]), ["20.7", "4.05", "0.98", "25.73"]);
});

test("hoja «Líneas»: una fila por línea con los datos del pedido", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1"));
  const f = unzip(fs.readFileSync(runExport(db, { dir }).filePath));
  const rows = grid(f["xl/worksheets/sheet2.xml"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], "Nº pedido");
  assert.deepEqual(rows[1].slice(0, 7), ["VM-2026-000001", "C1", "Cliente de prueba", "28/10/2026", "11:00", "00123", "2"]);
});

test("retiene pedidos dudosos o de cliente desconocido hasta que se revisen", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("ok"));
  const dudoso = db.createOrder(pedido("dudoso", { review: true })).order;
  db.createOrder(pedido("nuevo", { customerId: null }));
  const r = runExport(db, { dir });
  assert.equal(r.export.order_count, 1);
  assert.equal(r.held, 2);
  assert.equal(db.approveOrder(dudoso.ref), true);
  const r2 = runExport(db, { dir, now: new Date(Date.now() + 1000) });
  assert.equal(r2.export.order_count, 1);
  assert.equal(r2.held, 1);
});

test("si falla la generación, los pedidos siguen pendientes y no queda fichero", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1"));
  assert.throws(() => runExport(db, { dir, format: { name: "roto", build() { throw new Error("formato roto"); } } }), /formato roto/);
  assert.equal(db.listOrders({ exportStatus: "pending" }).length, 1);
  assert.equal(db.listExports().length, 0);
  assert.equal(fs.readdirSync(dir).length, 0);
  assert.equal(runExport(db, { dir }).export.order_count, 1);
});

test("si falla anotar la exportación, se revierte y se descarta el fichero", () => {
  const db = openDb(":memory:");
  db.createOrder(pedido("k1"));
  let descartado = false;
  const build = (name) => () => ({ format: "t", fileName: name, sha256: "x", lineCount: 1, discard: () => (descartado = true) });
  db.exportPending(build("a.xlsx"));
  db.createOrder(pedido("k2"));
  assert.throws(() => db.exportPending(build("a.xlsx")));
  assert.equal(descartado, true);
  assert.equal(db.listOrders({ exportStatus: "pending" }).length, 1);
  assert.equal(db.listExports().length, 1);
});

test("un pedido guardado antes del cálculo de precios también se exporta", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder({ key: "viejo", phone: "1", customerId: "C1", name: "X", at: "2026-10-28T10:00:00Z", items: [{ id: "A", name: "A", price: 2, qty: 3 }] });
  const f = unzip(fs.readFileSync(runExport(db, { dir }).filePath));
  const rows = grid(f["xl/worksheets/sheet1.xml"]);
  assert.deepEqual(rows[4], ["☐", "A", "", "A", "3", "2", "", "6"]);
  assert.equal(FORMAT.name, "pedidos-v3");
});

test("madrid(): hora local con cambio de horario", () => {
  assert.equal(madrid("2026-07-01T10:00:00Z"), "2026-07-01 12:00");
  assert.equal(madrid("2026-12-01T10:00:00Z"), "2026-12-01 11:00");
  assert.equal(madridDate("2026-10-28T10:00:00Z"), "28/10/2026");
});
