// Seguridad contra bots y abusos (seguridad.js): comprobación «no soy un robot», contador de intentos, cabeceras y piezas de la pantalla.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verificarTurnstile, contadorIntentos, cabecerasSeguridad, CSP, turnstileSite, turnstileActivo } from "./seguridad.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sinClaves = () => { delete process.env.TURNSTILE_SITE; delete process.env.TURNSTILE_SECRET; delete process.env.HSTS; };

test("sin claves de Turnstile no se pide nada y no se llama a Cloudflare", async () => {
  sinClaves(); assert.equal(turnstileActivo(), false); assert.equal(turnstileSite(), "");
  let llamado = false;
  assert.equal((await verificarTurnstile(undefined, "1.1.1.1", async () => { llamado = true; })).ok, true);
  assert.equal(llamado, false);
});

test("con claves: sin token no vale; con token se pregunta a Cloudflare y se respeta su respuesta", async () => {
  sinClaves(); process.env.TURNSTILE_SITE = "site"; process.env.TURNSTILE_SECRET = "secreto-de-prueba";
  try {
    assert.equal(turnstileSite(), "site");
    assert.equal((await verificarTurnstile(undefined, "1.1.1.1")).ok, false);
    assert.equal((await verificarTurnstile("corto", "1.1.1.1")).ok, false);
    let pedido;
    const bien = async (url, o) => { pedido = { url, cuerpo: String(o.body) }; return { json: async () => ({ success: true }) }; };
    assert.equal((await verificarTurnstile("x".repeat(40), "2.2.2.2", bien)).ok, true);
    assert.match(pedido.url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
    assert.match(pedido.cuerpo, /secret=secreto-de-prueba/); assert.match(pedido.cuerpo, /remoteip=2\.2\.2\.2/);
    assert.equal((await verificarTurnstile("x".repeat(40), "2.2.2.2", async () => ({ json: async () => ({ success: false }) }))).ok, false);
    // si Cloudflare no contesta, no se deja fuera a los clientes
    const r = await verificarTurnstile("x".repeat(40), "2.2.2.2", async () => { throw new Error("sin red"); });
    assert.equal(r.ok, true); assert.equal(r.sinRespuesta, true);
  } finally { sinClaves(); }
  // solo una de las dos claves = desactivado
  process.env.TURNSTILE_SITE = "site"; assert.equal(turnstileActivo(), false); sinClaves();
});

test("contadorIntentos: pasado el tope se pide la comprobación y cada dirección va aparte", () => {
  const c = contadorIntentos(3, 60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => c.pasado(c.suma("a"))), [false, false, false, true]);
  assert.equal(c.pasado(c.suma("b")), false);
});

test("cabeceras de seguridad: CSP sin permitir dominios ajenos salvo Cloudflare, HSTS solo si se activa", () => {
  sinClaves();
  assert.equal(cabecerasSeguridad()["Strict-Transport-Security"], undefined);
  assert.equal(cabecerasSeguridad()["X-Frame-Options"], "SAMEORIGIN");
  process.env.HSTS = "1"; assert.match(cabecerasSeguridad()["Strict-Transport-Security"], /max-age=31536000/); sinClaves();
  for (const d of ["default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "object-src 'self'", "connect-src 'self'"]) assert.ok(CSP.includes(d), d);
  assert.doesNotMatch(CSP, /\*/); // ningún comodín
  assert.deepEqual([...CSP.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]).filter((v, i, a) => a.indexOf(v) === i), ["https://challenges.cloudflare.com"]);
});

test("pantalla y servidor: campo trampa, Turnstile en el alta y tras muchos intentos de acceso, y límite de pedidos", () => {
  const html = src("./cliente.html"), auth = src("./auth.js"), server = src("./server.js"), seg = src("./seguridad.js");
  assert.match(html, /id="r-web" name="sitio_web" tabindex="-1" autocomplete="off"/); assert.match(html, /\.trampa\{position:absolute;left:-9999px/);
  assert.match(html, /sitio_web: \$\("r-web"\)\.value, cf: tsToken\["ts-alta"\]/); assert.match(html, /j\.necesitaVerificacion/);
  assert.match(auth, /String\(b\.sitio_web \?\? ""\)\.trim\(\)/); assert.match(auth, /verificarRobot\(b\.cf/); assert.match(seg, /verificarTurnstile\(token, ip, fetchFn\)/); assert.match(auth, /CAPTCHA_DESPUES_DE/);
  assert.match(server, /pedidosLimite\(String\(cuentaId\)\)/); assert.match(server, /topePedidos\(account\.id\)/); assert.match(server, /PEDIDOS_LIMIT/); // el tope por hora está dentro de topePedidos (con los de día y en total)
});
