// Bench 11 (documentos por mes), 12 (registro de errores) y 13 (sin cobertura).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const c = leer("./cliente.html"), s = leer("./server.js");

test("Bench 11: Mi cuenta «Documentos» agrupados por mes con total, «Descargar todo el mes» y «Enviar a mi gestor» (solo si hay PDF)", () => {
  assert.match(c, /nodo\("h3", "Documentos", "cu-tit"\)/); assert.match(c, /Total del mes: \$\{eur\(r\.total\)\} con IVA\$\{r\.aprox \? " \(aprox\.\)" : ""\}/);
  assert.match(c, /if \(r\.docs\.length\) \{/); // sin documentos, sin botones
  assert.match(c, /"Descargar todo el mes"/); assert.match(c, /dl\.href = "\/api\/documentos\/mes\/" \+ mes/); assert.match(c, /"Enviar a mi gestor"/);
  assert.match(c, /navigator\.canShare && navigator\.canShare\(\{ files \}\)/); assert.match(c, /navigator\.share\(\{ files, title:/); assert.match(c, /se ha descargado el ZIP del mes/); // sin share: descarga, sin servidor de correo
  assert.match(c, /e\.name === "AbortError" \? ""/); // cancelar el menú de compartir no es un error
  assert.match(c, /if \(!palabras\.length && r\)/); // con una búsqueda por producto no se enseñan totales del mes
  assert.ok(s.includes("documentos\\/mes")); assert.match(s, /function pdfDePedidoApp\(account, ref\)/); assert.match(s, /function pdfDeHistorial\(account, doc\)/);
});
