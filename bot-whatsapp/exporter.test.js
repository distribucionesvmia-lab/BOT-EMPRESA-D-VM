import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { openDb } from "./db.js";
import { runExport } from "./exporter.js";
import { buildXlsx } from "./xlsx.js";
import { madrid } from "./export-format.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-exp-"));
const pedido = (key, extra = {}) => ({
  key, phone: "34600000001", customerId: "C1", name: "Cliente de prueba", address: "Calle Falsa 1", text: "x", total: 5, review: false,
  at: "2026-10-28T10:00:00.000Z", note: "",
  items: [{ id: "00123", name: "Artículo A & <B>", price: 1.5, qty: 2 }, { id: "B1", name: "Artículo B", price: 3, qty: 1 }],
  ...extra,
});

// Lector mínimo de zip para comprobar el contenido del .xlsx
function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
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
  // segunda ejecución: nada que exportar, no se crea otro fichero
  const again = runExport(db, { dir });
  assert.equal(again.export, null);
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(db.listExports().length, 1);
  // un pedido nuevo entra en la siguiente exportación, sin repetir los anteriores
  db.createOrder(pedido("k3"));
  const next = runExport(db, { dir, now: new Date(Date.now() + 1000) });
  assert.equal(next.export.order_count, 1);
  assert.equal(db.listExports().length, 2);
});

test("el Excel contiene una fila por línea con los códigos exactos", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1"));
  const r = runExport(db, { dir });
  const sheet = unzip(fs.readFileSync(r.filePath))["xl/worksheets/sheet1.xml"];
  assert.match(sheet, />00123</);
  assert.match(sheet, />VM-2026-000001</);
  assert.match(sheet, />2026-10-28 11:00</); // 10:00 UTC = 11:00 en Madrid (ya en horario de invierno)
  assert.equal((sheet.match(/<row /g) ?? []).length, 3); // cabecera + 2 líneas
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
  assert.equal(r2.held, 1); // el de cliente desconocido sigue retenido: no tiene código de ERP
});

test("si falla la generación, los pedidos siguen pendientes y no queda fichero", () => {
  const db = openDb(":memory:"), dir = tmp();
  db.createOrder(pedido("k1"));
  assert.throws(() => runExport(db, { dir, format: { name: "roto", sheetName: "x", columns: [{ header: "h", value: () => { throw new Error("formato roto"); } }] } }), /formato roto/);
  assert.equal(db.listOrders({ exportStatus: "pending" }).length, 1);
  assert.equal(db.listExports().length, 0);
  assert.equal(fs.readdirSync(dir).length, 0);
  assert.equal(runExport(db, { dir }).export.order_count, 1); // y se puede reintentar
});

test("si falla anotar la exportación, se revierte y se descarta el fichero", () => {
  const db = openDb(":memory:");
  db.createOrder(pedido("k1"));
  let descartado = false;
  const build = (name) => () => ({ format: "t", fileName: name, sha256: "x", lineCount: 1, discard: () => (descartado = true) });
  db.exportPending(build("a.xlsx"));
  db.createOrder(pedido("k2"));
  assert.throws(() => db.exportPending(build("a.xlsx"))); // nombre repetido: la anotación falla
  assert.equal(descartado, true);
  assert.equal(db.listOrders({ exportStatus: "pending" }).length, 1); // k2 sigue pendiente
  assert.equal(db.listExports().length, 1);
});

test("madrid(): hora local con cambio de horario", () => {
  assert.equal(madrid("2026-07-01T10:00:00Z"), "2026-07-01 12:00");
  assert.equal(madrid("2026-12-01T10:00:00Z"), "2026-12-01 11:00");
});
