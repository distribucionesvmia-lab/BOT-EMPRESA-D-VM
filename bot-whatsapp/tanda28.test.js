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

import { limpiaError, navegadorCorto, sinPersonales, rutaApi } from "./errores.js";
import { openAccountsDb } from "./cuentas-db.js";
test("Bench 12: errores.js limpia todo lo que llega y la base guarda 30 días con su resumen", () => {
  assert.equal(navegadorCorto("Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"), "Chrome 126 · Android");
  assert.equal(navegadorCorto("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"), "Safari 17 · iOS"); assert.equal(navegadorCorto(""), "Otro · otro sistema");
  assert.equal(sinPersonales("a@b.es 123456789 AAAAAAAAAAAAAAAAAAAAAAAAAAAA fin"), "[correo] [cifras] [clave] fin"); assert.equal(sinPersonales("palabra ".repeat(100)).length, 200); assert.equal(sinPersonales("x".repeat(500)), "[clave]");
  assert.equal(rutaApi("https://vm.es/api/entrar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?x=1#h"), "/api/entrar/:clave");
  assert.equal(limpiaError({ tipo: "otro", mensaje: "x" }), null); assert.equal(limpiaError({ tipo: "js" }), null); assert.equal(limpiaError(null), null); assert.deepEqual(limpiaError({ tipo: "js", mensaje: "m", pantalla: "hack", estado: 9999 }), { tipo: "js", pantalla: "otra", api: "", estado: 0, mensaje: "m" });
  const a = openAccountsDb(":memory:"), hoy = "2026-11-20T10:00:00.000Z";
  a.errorRegistrar({ tipo: "fetch", pantalla: "catalogo", api: "/api/x", estado: 500, mensaje: "m" }, { customerId: "C1", navegador: "Chrome 126 · Android", now: "2026-11-01T10:00:00.000Z" }); // 19 días antes
  a.errorRegistrar({ tipo: "js", pantalla: "cliente", mensaje: "m2" }, { customerId: "C2", now: "2026-11-18T10:00:00.000Z" }); a.errorRegistrar({ tipo: "fetch", pantalla: "cliente", api: "/api/x", estado: 500, mensaje: "m3" }, { customerId: "C1", now: "2026-11-19T10:00:00.000Z" });
  const r = a.erroresResumen({ dias: 7, now: hoy }); assert.equal(r.total, 2); assert.deepEqual(r.porTipo.map((x) => [x.tipo, x.n]).sort(), [["fetch", 1], ["js", 1]]); assert.equal(r.porApi[0].api, "/api/x");
  a.errorRegistrar({ tipo: "js", pantalla: "cliente", mensaje: "nuevo" }, { now: "2026-12-30T10:00:00.000Z" }); assert.equal(a.erroresResumen({ dias: 30, now: "2026-12-30T11:00:00.000Z" }).total, 1); // lo de hace más de 30 días se borra
});
test("Bench 12: las dos pantallas mandan los fallos (fetch, onerror, unhandledrejection) con máximo por sesión, sin red no se manda y nunca bloquea", () => {
  for (const f of ["./cliente.html", "./pedido.html"]) {
    const h = leer(f); assert.match(h, /MAX = 8/); assert.match(h, /navigator\.onLine === false/); assert.match(h, /navigator\.sendBeacon\("\/api\/log-error"/); assert.match(h, /addEventListener\("unhandledrejection"/); assert.match(h, /addEventListener\("error"/);
    assert.match(h, /res\.status >= 500/); assert.match(h, /AbortError/); assert.match(h, /setTimeout\(function \(\) \{/); // aparte, sin esperar
    assert.ok(h.indexOf("window.vmLogError") < h.indexOf("<title>")); // antes que el resto de scripts
  }
  const s = leer("./server.js"); assert.match(s, /p === "\/api\/log-error" && req\.method === "POST"/); assert.match(s, /\.writeHead\(204\)\.end\(\)/); assert.match(s, /content-length"\] \?\? 0\) > 4096/);
  const e = leer("./empresa.html"); assert.match(e, /Errores de la app \(últimos 7 días\)/); assert.match(e, /async function erroresApp\(\)/);
});
