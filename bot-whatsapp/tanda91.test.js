// PDF del pedido: logo de la empresa sobre rojo, QR de la web y bloque de marketing (sin NIF ni códigos).
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { pdfPedido } from "./pdf.js";
import { LOGO, QR_WEB, WEB_URL } from "./pdf-recursos.js";

const datos = (n) => ({ empresa: "Distribuciones Valentín Martín", cliente: "Bar Prueba", ref: "VM-2026-000001", fecha: "2026-11-25", entrega: "2026-11-26",
  lineas: Array.from({ length: n }, (_, i) => ({ cant: "1 ud", formato: "Unidades", nombre: "Artículo " + i, precio: 1, dto: 0, importe: 1 })), totales: { base: n, iva: 0, re: 0, total: n } });

test("PDF: lleva el logo (imagen RGB), el enlace a la web y el texto de marketing", () => {
  const b = pdfPedido(datos(3)), t = b.toString("latin1");
  assert.ok(t.startsWith("%PDF-1.4"));
  assert.match(t, /\/Subtype \/Image \/Width 420 \/Height 186 \/ColorSpace \/DeviceRGB/);
  assert.match(t, /\/Im1 \d+ 0 R/); assert.match(t, /\/Im1 Do/);
  assert.ok(t.includes("/URI (" + WEB_URL + ")"));
  assert.ok(t.includes("Repetimos tu pedido") && t.includes("distribucionesvm.es"));
  assert.ok(t.includes("Documento informativo del pedido. No es una factura."));
  assert.equal(zlib.inflateSync(LOGO.datos).length, LOGO.w * LOGO.h * 3, "el logo descomprime al tamaño exacto");
});

test("PDF: el QR es de 29×29, con los tres cuadros de las esquinas y se dibuja entero", () => {
  assert.equal(QR_WEB.length, 29); assert.ok(QR_WEB.every((f) => /^[01]{29}$/.test(f)));
  for (const [r, c] of [[0, 0], [0, 22], [22, 0]]) { assert.equal(QR_WEB[r].slice(c, c + 7), "1111111"); assert.equal(QR_WEB[r + 6].slice(c, c + 7), "1111111"); }
});

test("PDF: con muchas líneas el bloque no se parte ni se sale de la hoja; xref coherente", () => {
  for (const n of [1, 30, 45, 120]) {
    const b = pdfPedido(datos(n)), t = b.toString("latin1");
    const nobj = Number(/\/Size (\d+)/.exec(t)[1]) - 1, off = Number(/startxref\n(\d+)/.exec(t)[1]);
    assert.ok(t.slice(off).startsWith("xref"), "startxref apunta al xref");
    const pos = [...t.slice(off).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.equal(pos.length, nobj);
    pos.forEach((p, i) => assert.ok(t.slice(p).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1} en su sitio`));
    assert.equal((t.match(/\/Subtype \/Link/g) || []).length, 1, "un solo enlace");
  }
});

test("PDF: no lleva NIF ni códigos de cliente/artículo", () => {
  const t = pdfPedido({ ...datos(2), nif: "12345678Z", codigoCliente: "C0099" }).toString("latin1");
  assert.ok(!t.includes("12345678Z") && !t.includes("C0099"));
});
