import { test } from "node:test";
import assert from "node:assert/strict";
import { crearEscudo, RUTA_DE_ESCANER } from "./seguridad.js";

test("escudo: la inundación desde una dirección se corta y se libera pasado el castigo", () => {
  let t = 1_000_000; const e = crearEscudo({ porMinuto: 5, ahora: () => t });
  for (let i = 0; i < 5; i++) assert.equal(e.revisa("203.0.113.9", "/api/yo"), null);
  const c = e.revisa("203.0.113.9", "/api/yo");
  assert.equal(c.motivo, "inundacion-de-peticiones"); assert.equal(c.espera, 600);
  assert.equal(e.revisa("198.51.100.1", "/api/yo"), null, "otra dirección no se ve afectada");
  t += 5 * 60_000; assert.ok(e.revisa("203.0.113.9", "/api/yo"), "sigue bloqueada");
  t += 6 * 60_000; assert.equal(e.revisa("203.0.113.9", "/api/yo"), null, "pasados 10 min vuelve");
});

test("escudo: reincidir duplica el castigo y lo estático tiene tope aparte", () => {
  let t = 0; const e = crearEscudo({ porMinuto: 1, estaticoPorMinuto: 3, ahora: () => t });
  e.revisa("203.0.113.5", "/x"); assert.equal(e.revisa("203.0.113.5", "/x").espera, 600);
  t += 11 * 60_000; e.revisa("203.0.113.5", "/x"); assert.equal(e.revisa("203.0.113.5", "/x").espera, 1200);
  for (let i = 0; i < 3; i++) assert.equal(e.revisa("203.0.113.6", "/img/1001"), null);
  assert.equal(e.revisa("203.0.113.6", "/img/1001").motivo, "inundacion-de-peticiones");
});

test("escudo: los escáneres de rutas de ataque se bloquean a la primera; las rutas normales no", () => {
  const e = crearEscudo();
  for (const r of ["/.env", "/.git/config", "/wp-login.php", "/phpmyadmin/", "/a/../../etc/passwd", "/backup.sql", "/cgi-bin/x"]) assert.ok(RUTA_DE_ESCANER.test(r), r);
  for (const r of ["/cliente", "/catalogo/datos", "/api/yo", "/img/1001", "/estatico/abc/app.js", "/entrar/abc", "/baja/abc", "/manifest.webmanifest"]) assert.ok(!RUTA_DE_ESCANER.test(r), r);
  assert.equal(e.revisa("203.0.113.7", "/.env").motivo, "busca-rutas-de-ataque");
  assert.ok(e.revisa("203.0.113.7", "/cliente"), "ya bloqueada también para lo normal");
});

test("escudo: la propia máquina (127.0.0.1) y direcciones desconocidas nunca se bloquean", () => {
  const e = crearEscudo({ porMinuto: 1 });
  for (let i = 0; i < 20; i++) { assert.equal(e.revisa("127.0.0.1", "/.env"), null); assert.equal(e.revisa("?", "/x"), null); }
});

test("server.js no se cae si el catálogo está vacío (getCatalog() devuelve null)", async () => {
  const { readFileSync } = await import("node:fs");
  const s = readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!/\(await getCatalog\(\)\)\.filter/.test(s), "usar ?. con el catálogo: puede ser null");
});
