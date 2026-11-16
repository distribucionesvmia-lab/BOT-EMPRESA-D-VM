// La clave del panel de la empresa: espacios pegados, comillas del archivo de configuración y caracteres especiales.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeAdminCheck } from "./auth.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const req = (auth) => ({ headers: auth === undefined ? {} : { authorization: auth } });
const b64 = (t) => "b64:" + Buffer.from(t, "utf8").toString("base64");

test("clave del panel: vale con espacios pegados delante o detrás y con las comillas que deje el archivo de configuración", () => {
  const ok = makeAdminCheck("clave-segura-123456");
  for (const a of ["Bearer clave-segura-123456", "Bearer   clave-segura-123456  ", "Bearer clave-segura-123456\t"]) assert.equal(ok(req(a)), true, JSON.stringify(a));
  for (const guardada of ['  clave-segura-123456  ', '"clave-segura-123456"', "'clave-segura-123456'", ' "clave-segura-123456" ']) assert.equal(makeAdminCheck(guardada)(req("Bearer clave-segura-123456")), true, guardada);
  assert.equal(ok(req("Bearer clave-segura-12345")), false); assert.equal(ok(req("Bearer clave-segura-1234567")), false); assert.equal(ok(req("Bearer CLAVE-SEGURA-123456")), false, "mayúsculas y minúsculas se distinguen");
  assert.equal(ok(req("Bearer ")), false); assert.equal(ok(req(undefined)), false); assert.equal(ok(req("clave-segura-123456")), false, "sin «Bearer» no vale"); assert.equal(ok(req("Basic clave-segura-123456")), false);
  assert.equal(makeAdminCheck("")(req("Bearer ")), false); assert.equal(makeAdminCheck(undefined)(req("Bearer x")), false, "sin clave configurada nadie es administrador"); assert.equal(makeAdminCheck("   ")(req("Bearer ")), false);
});

test("clave del panel con caracteres especiales («€», «—», «ñ», emojis): se manda en base64 y entra; una clave parecida no", () => {
  const ok = makeAdminCheck("clave€—ñ-prueba-🔑");
  assert.equal(ok(req("Bearer " + b64("clave€—ñ-prueba-🔑"))), true); assert.equal(ok(req("Bearer " + b64("  clave€—ñ-prueba-🔑 "))), true);
  assert.equal(ok(req("Bearer " + b64("clave€—n-prueba-🔑"))), false); assert.equal(ok(req("Bearer b64:@@@no-es-base64@@@")), false); assert.equal(ok(req("Bearer b64:")), false);
  assert.equal(makeAdminCheck("clave-normal-1234")(req("Bearer " + b64("clave-normal-1234"))), true, "una clave normal también vale en base64");
  assert.equal(makeAdminCheck("b64:truco")(req("Bearer b64:truco")), false, "el prefijo no permite colar una clave literal «b64:…»: se decodifica antes de comparar");
});

test("el panel manda la clave siempre con la misma función (sin espacios y a prueba de caracteres raros) en TODOS los sitios", () => {
  const e = leer("./empresa.html");
  assert.equal([...e.matchAll(/"Bearer " \+ clave/g)].length, 0, "ningún sitio manda la clave a pelo");
  assert.ok([...e.matchAll(/cabsAdmin\(/g)].length >= 5, "los envíos pasan todos por cabsAdmin (que usa cabClave y añade el permiso del segundo factor)"); assert.match(e, /Authorization: cabClave\(\)/);
  assert.match(e, /function cabClave\(\)/); assert.match(e, /"b64:" \+ btoa\(/); assert.match(e, /clave = \$\("clave"\)\.value\.trim\(\)/);
  assert.match(leer("./mcp/vm-mcp.js"), /Authorization: "Bearer " \+ token/, "la conexión de Claude sigue mandando la clave normal: el servidor la sigue admitiendo");
});
