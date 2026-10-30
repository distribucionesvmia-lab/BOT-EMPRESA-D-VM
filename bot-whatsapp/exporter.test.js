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
import { madrid, madridDate, FORMAT } from "./export-format.js";

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

test("hoja «Pedidos»: el cartel «PEDIDO …» va combinado en toda la anchura, grande y con la fila más alta", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1", {}));
  db.createOrder(pedido("k2", {}));
  const xml = unzip(fs.readFileSync(runExport(db, { dir }).filePath))["xl/worksheets/sheet1.xml"];
  const merges = [...xml.matchAll(/<mergeCell ref="([A-Z0-9:]+)"/g)].map((m) => m[1]);
  assert.equal(merges.length, 2);
  assert.equal(merges[0], "A1:I1");
  assert.match(xml, /<row r="1" ht="38" customHeight="1"><c r="A1" s="7"/);
  assert.match(xml, new RegExp(`<row r="${merges[1].match(/\d+/)[0]}" ht="38"`)); // el segundo pedido también
});

test("hoja «Pedidos»: cabecera, líneas con cajas/unidades/precio/descuento y pie con totales", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1", { note: "Servir el jueves, los demás días estoy cerrado" }));
  const f = unzip(fs.readFileSync(runExport(db, { dir }).filePath));
  const rows = grid(f["xl/worksheets/sheet1.xml"]);
  assert.deepEqual(rows[0][0], "PEDIDO VM-2026-000001");
  assert.deepEqual(rows[1], ["Nº pedido", "Código cliente", "Nombre comercial", "Fecha recepción", "Hora pedido"]);
  assert.deepEqual(rows[2], ["VM-2026-000001", "C1", "Cliente de prueba", "28/10/2026", "11:00"]);
  assert.deepEqual(rows[3], ["Código artículo", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe", "IVA %", "Observaciones línea"]);
  // 2 cajas × 6 = 12 uds × 1,50 = 18,00 (IVA 21 %)
  assert.deepEqual(rows[4].slice(0, 8), ["00123", "2", "Artículo A &amp; &lt;B&gt;", "12", "1.5", "", "18", "21"]);
  // 1 ud × 3,00 − 10 % = 2,70 (IVA 10 %)
  assert.deepEqual(rows[5].slice(0, 8), ["B1", "", "Artículo B", "1", "3", "10", "2.7", "10"]);
  // pie: base 20,70 · IVA 21 % de 18,00 = 3,78 + 10 % de 2,70 = 0,27 → 4,05 · total 24,75
  assert.deepEqual(rows.slice(6, 10).map((r) => [r[2], r[6]]), [["Total base imponible", "20.7"], ["Total IVA", "4.05"], ["Total R.E.", "0"], ["TOTAL PEDIDO", "24.75"]]);
  assert.deepEqual([rows[10][0], rows[10][2]], ["Observaciones del cliente", "Servir el jueves, los demás días estoy cerrado"]);
});

test("el recargo de equivalencia del cliente aparece en el pie", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1", { re: true })); // 5,2 % de 18,00 = 0,94 · 1,4 % de 2,70 = 0,04
  const f = unzip(fs.readFileSync(runExport(db, { dir }).filePath));
  const rows = grid(f["xl/worksheets/sheet1.xml"]);
  assert.deepEqual(rows.slice(6, 10).map((r) => r[6]), ["20.7", "4.05", "0.98", "25.73"]);
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
  assert.deepEqual(rows[4].slice(0, 7), ["A", "", "A", "3", "2", "", "6"]);
  assert.equal(FORMAT.name, "pedidos-v2");
});

test("madrid(): hora local con cambio de horario", () => {
  assert.equal(madrid("2026-07-01T10:00:00Z"), "2026-07-01 12:00");
  assert.equal(madrid("2026-12-01T10:00:00Z"), "2026-12-01 11:00");
  assert.equal(madridDate("2026-10-28T10:00:00Z"), "28/10/2026");
});
