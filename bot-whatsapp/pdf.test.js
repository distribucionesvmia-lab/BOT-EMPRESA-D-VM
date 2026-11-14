import test from "node:test";
import assert from "node:assert/strict";
import { pdfPedido } from "./pdf.js";

const base = { empresa: "DistribucionesVM", cliente: "Bar Ñandú", ref: "VM-2026-000007", fecha: "2026-11-14T10:00:00Z", entrega: "2026-11-16", direccion: "Calle (1)", nota: "", conRe: false, totales: { base: 10, iva: 2.1, re: 0, total: 12.1 } };
test("PDF del pedido: estructura válida, acentos y € en WinAnsi, paréntesis escapados y varias páginas si hay muchas líneas", () => {
  const poco = pdfPedido({ ...base, lineas: [{ cant: "2 ud", nombre: "Café (molido) 250 g", precio: 1.5, importe: 3 }] });
  const t = poco.toString("latin1");
  assert.equal(t.slice(0, 8), "%PDF-1.4"); assert.match(t, /%%EOF\n$/); assert.equal((t.match(/\/Type \/Page /g) || []).length, 1);
  assert.ok(poco.includes(Buffer.from([0xd1]))); assert.ok(poco.includes(Buffer.from([0x80]))); // Ñ y €
  assert.ok(t.includes("Caf\xe9 \\(molido\\) 250 g"));
  const xr = Number(/startxref\n(\d+)/.exec(t)[1]); assert.equal(t.slice(xr, xr + 4), "xref"); // el índice apunta donde debe
  const muchas = pdfPedido({ ...base, lineas: Array.from({ length: 80 }, (_, i) => ({ cant: "1 ud", nombre: "Artículo " + i, precio: 1, importe: 1 })) });
  assert.ok((muchas.toString("latin1").match(/\/Type \/Page /g) || []).length >= 2);
  const re = pdfPedido({ ...base, conRe: true, totales: { ...base.totales, re: 0.52, total: 12.62 }, lineas: [{ cant: "1 ud", nombre: "X", precio: 10, importe: 10 }] });
  assert.ok(re.toString("latin1").includes("Recargo de equivalencia"));
});
