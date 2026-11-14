// Marca de autoría y aviso de propiedad intelectual: «Creado por Pablo Martín Castañeda», en la app de clientes, el catálogo, el PDF y el panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pdfPedido } from "./pdf.js";
import { avisoLegalHtml } from "./privacidad.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MARCA = "Creado por <b>Pablo Martín Castañeda</b> · © 2026 · Todos los derechos reservados";

test("las tres pantallas llevan la marca, el texto de derechos de uso y los metadatos de autoría", () => {
  for (const f of ["./cliente.html", "./pedido.html", "./empresa.html"]) {
    const h = leer(f);
    assert.ok(h.includes('<meta name="author" content="Pablo Martín Castañeda">'), f); assert.ok(h.includes("© 2026 Pablo Martín Castañeda. Todos los derechos reservados."), f);
    assert.ok(h.includes("<!-- Programa creado por Pablo Martín Castañeda. © 2026."), f); // también en el código fuente que se descarga
    assert.ok(h.includes("Propiedad y derechos de uso"), f); assert.ok(h.includes("Real Decreto Legislativo 1/1996"), f); assert.ok(h.includes("Queda prohibido, sin autorización previa y por escrito del titular, copiar, reproducir, distribuir"), f);
    assert.ok(h.includes("arts. 138 y siguientes de la Ley de Propiedad Intelectual y arts. 270 y siguientes del Código Penal"), f);
    assert.ok(h.includes("«Distribuciones Valentín Martín» pertenecen a sus titulares"), f); // la marca de la empresa y los datos de clientes no se reclaman
  }
  assert.ok(leer("./empresa.html").includes(`<footer class="autor"><span>${MARCA}</span>`));
  const c = leer("./cliente.html"), p = leer("./pedido.html");
  for (const h of [c, p]) { assert.ok(h.includes(MARCA)); assert.match(h, /c\.appendChild\(pieAutor\(\)\);\n\s*const x = document\.createElement\("button"\); x\.type = "button"; x\.className = "ayuda-cerrar"/); } // en la Ayuda de las dos apps
  assert.match(c, /id="autor-acceso"/); assert.match(c, /pa\.replaceWith\(pieAutor\(\)\)/); assert.match(c, /cargaFijo\(\);\n  c\.appendChild\(pieAutor\(\)\);/); // acceso e Inicio
});
test("el aviso legal del cliente y el PDF del pedido también llevan la autoría", () => {
  const a = avisoLegalHtml({}); assert.match(a, /Propiedad intelectual del programa:.*Pablo Martín Castañeda.*Real Decreto Legislativo 1\/1996/); assert.match(a, /acciones civiles y penales/);
  const base = { empresa: "DistribucionesVM", cliente: "Bar", ref: "VM-2026-000007", fecha: "2026-11-14T10:00:00Z", entrega: "2026-11-16", direccion: "Calle 1", nota: "", conRe: false, totales: { base: 10, iva: 2.1, re: 0, total: 12.1 }, lineas: [{ cant: "1 ud", nombre: "X", precio: 10, importe: 10 }] };
  const t = pdfPedido(base).toString("latin1"); assert.ok(t.includes("Programa creado por Pablo Mart\xedn Casta\xf1eda \xb7 \xa9 2026 \xb7 Todos los derechos reservados"));
});
test("licencia propietaria en el repositorio: todos los derechos reservados, sin licencia concedida", () => {
  const l = fs.readFileSync(new URL("../LICENSE", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(l, /TODOS LOS DERECHOS RESERVADOS/); assert.match(l, /Copyright © 2026 Pablo Martín Castañeda/); assert.match(l, /NO se concede ninguna licencia/); assert.match(l, /ALL RIGHTS RESERVED/);
  const p = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8").replace(/\r\n/g, "\n")); assert.equal(p.license, "UNLICENSED"); assert.equal(p.author, "Pablo Martín Castañeda");
});
test("el Excel para a3ERP NO lleva ninguna marca (se importa tal cual): ni el exportador ni su formato mencionan al autor", () => {
  for (const f of ["./exporter.js", "./export-format.js", "./xlsx-files.js"]) assert.equal(/Pablo Mart/.test(leer(f)), false, f);
});
