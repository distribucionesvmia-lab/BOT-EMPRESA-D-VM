// Bench 4: facilidad de compra I.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { plazoModificacion, puedeEditarPedido } from "./delivery.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html");

test("1. franja «Ya tienes un pedido para el…» con «Añadir a ese pedido» (usa modificar) y aviso al elegir un día con pedido", () => {
  assert.match(p, /id="abierto"[^>]*hidden/); assert.match(p, /id="abierto2"[^>]*hidden/); assert.match(p, /id="diaAviso"/);
  assert.match(p, /Ya tienes un pedido para el \$\{/); assert.match(p, /"Añadir a ese pedido"/);
  assert.match(p, /function anadirAPedido\(ref\)[\s\S]{0,200}return modificar\(ref\)\.then/); // sustituye al abierto y NO pierde lo que ya llevaba en el carrito
  assert.match(p, /Ya tienes un pedido para ese día \(\$\{ab\.ref\}\)\. Si envías este, serán dos pedidos/);
  assert.match(p, /pintarAviso\(\); pintarAbierto\(\);/);
});
test("2. hora límite en cada ficha de día y en #plazo, calculada por el servidor", () => {
  assert.match(p, /"Cambios hasta " \+ lim/); assert.match(p, /data\.plazos\?\.\[o\.date\]\?\.corto/);
  assert.match(p, /\$\("plazo"\)\.textContent = pz \? pz\.texto/); assert.match(p, /fetch\("\/catalogo\/plazo\?dia="/);
  assert.match(leer("./server.js"), /plazoModificacion\(o\.date\)/);
});
test("plazoModificacion es la misma regla que puedeEditarPedido", () => {
  const lunes = "2026-11-16T08:00:00Z"; // lunes 16
  assert.deepEqual(plazoModificacion("2026-11-17", lunes, lunes), { dia: "2026-11-16", texto: "Puedes modificarlo hasta las 10:00 de hoy", corto: "hoy 10:00" });
  assert.equal(plazoModificacion("2026-11-23", lunes, lunes).texto, "Puedes modificarlo hasta las 10:00 del viernes");
  assert.equal(plazoModificacion("2026-11-23", lunes, lunes).corto, "vie 10:00");
  assert.equal(plazoModificacion(null), null);
  const o = { status: "ok", export_status: "pending", delivery_date: "2026-11-23", created_at: lunes };
  assert.equal(puedeEditarPedido(o, lunes).texto, plazoModificacion(o.delivery_date, lunes, lunes).texto);
});

const c = leer("./cliente.html"), a = leer("./auth.js");
test("3. entrar con 2 campos: el nombre de empresa solo si el servidor devuelve necesitaNombre; no se borra lo escrito salvo el código incorrecto", () => {
  assert.match(c, /<label id="l-emp" hidden>/); assert.match(a, /necesitaNombre: true, error: "Escribe también el nombre de tu empresa\."/);
  assert.match(c, /\.\.\.\(!\$\("l-emp"\)\.hidden && \{ empresa: \$\("a-emp"\)\.value \}\), pin:/);
  assert.match(c, /if \(conPin\) \{ \$\("a-pin"\)\.value = ""; \$\("a-pin"\)\.focus\(\); \} return;/);
  assert.doesNotMatch(c, /\$\("a-pin"\)\.value = ""; \$\("a-nif"\)\.value = ""/);
});
test("4. código olvidado, contacto en la portada, sin autocomplete=off en el acceso y oferta de código personal", () => {
  assert.match(c, /id="olvido">¿No recuerdas tu código de entrada\? Llámanos y lo solucionamos/); assert.match(c, /function pintaContactoAcceso\(\)/); assert.match(c, /id="acc-contacto" hidden/);
  assert.doesNotMatch(c.match(/<form class="vm-card" id="f-acceso"[^>]*>/)[0], /autocomplete/);
  assert.match(c, /class="in-codigo"|"in-codigo"/); assert.match(c, /Entra más rápido y más seguro: elige un código personal/); assert.match(c, /vm:codigo-no/);
});

test("todos los <script> de cliente.html y pedido.html son JavaScript válido (un error de sintaxis deja la página en blanco)", () => {
  for (const f of ["./cliente.html", "./pedido.html"]) {
    const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0;
    while ((m = re.exec(leer(f)))) { n++; assert.doesNotThrow(() => new Function(m[1]), `${f}, script ${n}`); }
    assert.ok(n >= 1);
  }
});
