// La página que se sirve pesa lo mismo con saltos de línea de Windows (CRLF) que con los normales: si no, en la oficina la prueba del tamaño de /cliente
// fallaba y «VM Actualizar» rechazaba la versión nueva (pasó con 41.134 bytes contra un límite de 40.960).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { empaquetar, compactaHtml } from "./estaticos.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("PÁGINA SERVIDA: sin CRLF ni sangría sobrante, pero <pre>, <textarea> y los scripts quedan como estaban", () => {
  const t = "<div>\r\n    <p>hola</p>\r\n\r\n    <pre>  a\r\n    b</pre>\r\n    <textarea>\r\n   x</textarea>\r\n</div>\r\n<script>\r\n  let a = `x\r\n   y`;\r\n</script>\r\n";
  assert.equal(compactaHtml(t), "<div>\n<p>hola</p>\n<pre>  a\n    b</pre>\n<textarea>\n   x</textarea>\n</div>\n<script>\n  let a = `x\n   y`;\n</script>\n");
  assert.ok(!compactaHtml(t).includes("\r"));
});

test("PÁGINA SERVIDA: cliente.html y pedido.html salen con el mismo tamaño en LF y en CRLF, y /cliente cabe con holgura en 40 KB", () => {
  for (const f of ["./cliente.html", "./pedido.html"]) {
    const lf = leer(f), crlf = lf.replace(/\n/g, "\r\n");
    const a = empaquetar(lf, "t77-" + f, {}), b = empaquetar(crlf, "t77c-" + f, {});
    assert.ok(!b.includes("\r"), f);
    assert.ok(Math.abs(Buffer.byteLength(a) - Buffer.byteLength(b)) <= 40, `${f}: LF ${Buffer.byteLength(a)} · CRLF ${Buffer.byteLength(b)}`);
  }
  assert.ok(Buffer.byteLength(empaquetar(leer("./cliente.html").replace(/\n/g, "\r\n"), "t77x", {})) < 38 * 1024); // margen sobre el límite de 40 KB de server.test.js
});
