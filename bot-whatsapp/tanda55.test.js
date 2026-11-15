import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { cspEstricta, manejadoresEnLinea, conexionHttps, CSP } from "./seguridad.js";

const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const huella = (js) => `'sha256-${crypto.createHash("sha256").update(js, "utf8").digest("base64")}'`;

test("CSP estricta: sin 'unsafe-inline' en scripts y con la huella de cada script en línea de la página", () => {
  const a = "window.a = 1;", b = "\n  console.log('b');\n";
  const html = `<html><script>${a}</script><script src="/estatico/x/app.js"></script><script type="text/javascript">${b}</script><script>   </script></html>`;
  const csp = cspEstricta(html), sc = csp.match(/script-src[^;]*/)[0];
  assert.ok(!sc.includes("unsafe-inline"), sc);
  assert.ok(sc.includes(huella(a)) && sc.includes(huella(b)), sc);
  assert.equal([...sc.matchAll(/sha256-/g)].length, 2, "el script con src y el vacío no cuentan");
  assert.ok(sc.includes("'self'") && sc.includes("https://challenges.cloudflare.com"));
  for (const d of ["default-src 'self'", "frame-ancestors 'self'", "object-src 'self'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) assert.ok(csp.includes(d), d);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/, "los estilos en línea se mantienen");
  assert.doesNotMatch(csp, /\*/);
});

test("CSP estricta: un script que NO estaba en la página no tiene huella; CSP_ESTRICTA=0 vuelve a la antigua", () => {
  const csp = cspEstricta("<script>ok()</script>");
  assert.ok(!csp.includes(huella("alert(document.cookie)")), "un script inyectado no coincide con ninguna huella");
  process.env.CSP_ESTRICTA = "0";
  try { assert.equal(cspEstricta("<script>ok()</script>"), CSP); } finally { delete process.env.CSP_ESTRICTA; }
});

test("las pantallas reales no llevan manejadores en línea (onclick=…) que la política estricta bloquearía", () => {
  for (const f of ["cliente.html", "pedido.html", "empresa.html"]) assert.deepEqual(manejadoresEnLinea(leer(f)), [], f);
  assert.equal(manejadoresEnLinea('<img onerror="x()"> <a onclick=\'y()\'>').length, 2, "el detector sí ve los manejadores en línea");
});

test("server.js sirve las tres páginas con la política por página", () => {
  const s = leer("server.js");
  assert.equal([...s.matchAll(/cspEstricta\(/g)].length >= 2, true); assert.match(s, /htmlCsp\(cuerpo\)/g);
  assert.ok(!/enviar\(res, 200, HTML,/.test(s), "ninguna página se sirve ya con la política vieja");
});

test("cookie de sesión: Secure también si llegó por HTTPS tras un túnel de confianza, aunque falte PUBLIC_URL", () => {
  const r = (h) => ({ headers: h });
  assert.equal(conexionHttps(r({}), { seguro: true }), true);
  assert.equal(conexionHttps(r({ "cf-visitor": '{"scheme":"https"}' }), { confiarProxy: true }), true);
  assert.equal(conexionHttps(r({ "x-forwarded-proto": "https, http" }), { confiarProxy: true }), true);
  assert.equal(conexionHttps(r({ "x-forwarded-proto": "http" }), { confiarProxy: true }), false);
  assert.equal(conexionHttps(r({ "x-forwarded-proto": "https" }), { confiarProxy: false }), false, "sin proxy de confianza, esa cabecera la puede falsear cualquiera");
  assert.equal(conexionHttps(null, { confiarProxy: true }), false);
});

test("el registro no lleva teléfonos enteros", () => {
  assert.doesNotMatch(leer("server.js"), /ATENCIÓN HUMANA solicitada por \+\$\{from\}/);
});
