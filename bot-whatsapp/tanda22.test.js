// Bench 7: pulido final.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { withOwnOrders, webHistory, HISTORIAL_MAX, HISTORIAL_VER_MAS, claveOrdenNombre } from "./weborder.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html");

test("1. un solo nombre de marca: «Distribuciones Valentín Martín» (títulos, botón, alt del logo, push, mail, manifest, privacidad)", () => {
  const N = "Distribuciones Valentín Martín";
  for (const f of ["./cliente.html", "./pedido.html", "./pwa/sw.js", "./notificaciones.js", "./config.js", "./privacidad.js", "./pwa/manifest.webmanifest"]) {
    const t = leer(f);
    assert.equal(/Distribuciones VM|DistribucionesVM/.test(t), false, f + " sigue con «Distribuciones VM»");
    assert.equal(/Distribuciones Valentín(?! Martín)/.test(t), false, f + " sigue con «Distribuciones Valentín» a secas");
  }
  assert.ok(p.includes(`Enviar pedido a ${N}`)); assert.ok(leer("./pwa/sw.js").includes(`d.title || "${N}"`)); assert.ok(leer("./config.js").includes(`name: "${N}"`));
});
const motor = () => { // limpiarNombre y SIGLAS tal como están en la página
  const ctx = vm.createContext({});
  vm.runInContext(p.match(/const SIGLAS = [^\n]*\n/)[0] + p.slice(p.indexOf("function limpiarNombre"), p.indexOf("function nombreVisible")) + "\nthis.l = limpiarNombre;", ctx);
  return ctx.l;
};
test("2. nombres de tarifa limpios: sin comillas ni «´25», «0.33 ml» → «0,33 L»; el orden ignora comillas; el original no se toca", () => {
  const l = motor();
  assert.equal(l('CERVEZA "ESTRELLA" 0.33 ML'), "Cerveza estrella 0,33 L"); assert.equal(l("COCA COLA ´25 0,33 ML"), "Coca cola 0,33 L");
  assert.equal(l("VINO RIOJA ´19 75 CL"), "Vino rioja 75 cl"); assert.equal(l("AGUA 1.5 LT"), "Agua 1,5 L"); assert.equal(l("ACEITE 5 L"), "Aceite 5 L");
  assert.equal(l("REFRESCO 330 ML"), "Refresco 330 ml"); // mililitros de verdad se quedan
  assert.equal(l("LECHE 1L"), "Leche 1 L");
  assert.equal(claveOrdenNombre('"ZUMO" naranja'), claveOrdenNombre("Zumo naranja")); assert.ok(claveOrdenNombre("´Aceite") < claveOrdenNombre("Bolsa")); // las comillas no mandan al principio de la lista
  assert.match(p, /const cmpNombre = /); assert.match(p, /items = items\.slice\(\)\.sort\(cmpNombre\)/);
  assert.match(p, /n\.title = p\.name/); // el nombre original sigue para buscar y en el tooltip
});
test("3. carrito recuperado de más de 24 h: «Hemos recuperado tu pedido sin terminar del <día>; los precios son los de hoy»", () => {
  assert.match(p, /Date\.now\(\) - g\.t > 24 \* 3600e3/); assert.match(p, /Hemos recuperado tu pedido sin terminar del \$\{window\.__carritoViejo\}; los precios son los de hoy\./);
  assert.match(p, /id="recuperado" role="status"/); assert.match(p, /id="recuperado2" role="status"/); assert.match(p, /"Entendido"/);
  assert.match(p, /aviso\("Hemos recuperado tu pedido sin terminar\."\)/); // el aviso corto de siempre se queda para lo reciente
});
test("4. Mi cuenta: «Ver más» (hasta 30) en vez de «Aquí salen tus 10 últimos pedidos»; sin botón de PDF vacío", () => {
  assert.equal(c.includes("Aquí salen tus 10 últimos pedidos"), false); assert.match(c, /"Ver más pedidos"/); assert.match(c, /abrirCuenta\(true, true\)/); assert.match(c, /"\/api\/mi-cuenta" \+ \(mas \? "\?mas=1" : ""\)/);
  assert.match(c, /if \(o\.pdf !== false && o\.doc\) \{ const pdf = nodo/);
  assert.match(leer("./server.js"), /const sinDocumento = /);
  const linea = [{ productId: "1", qty: 1 }], muchos = Array.from({ length: 40 }, (_, i) => ({ doc: `A${i + 1}`, date: `2026-09-${String(i + 1).padStart(2, "0")}`.replace(/-(3[1-9]|[4-9]\d)$/, "-28"), lines: linea })).map((o, i) => ({ ...o, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10) }));
  const cat = [{ id: "1", name: "AGUA" }];
  assert.equal(HISTORIAL_MAX, 10); assert.equal(HISTORIAL_VER_MAS, 30);
  assert.equal(webHistory(withOwnOrders({ id: "C", orders: muchos }, []), cat).length, 10); // por defecto, los 10 últimos
  assert.equal(webHistory(withOwnOrders({ id: "C", orders: muchos }, [], 30), cat, 30).length, 30); // «Ver más»
});
test("5. ojo para ver el código en todos los campos de contraseña (44 px, se oculta al enviar)", () => {
  assert.match(c, /class = "pw-ojo"|b\.className = "pw-ojo"/); assert.match(c, /"Mostrar el código"/); assert.match(c, /"Ocultar el código"/);
  assert.match(c, /for \(const inp of document\.querySelectorAll\('input\[type="password"\]'\)\)/); assert.match(c, /\.pw \.pw-ojo \{[^}]*width:44px; height:44px;/);
  assert.match(c, /inp\.form\?\.addEventListener\("submit", \(\) => pon\(false\)\)/);
});
test("6. letra al 100, 115 y 130 %: la barra inferior no crece más del 115 % (Catálogo no se parte) y los nombres siguen en 3-4 líneas", () => {
  assert.match(p, /\.tb-t \{ font-size:calc\(12\.5px \/ max\(var\(--k,1\), \.87\)\);/);
  assert.match(p, /data-letra-grande/); // con la letra grande el nombre ocupa hasta 4 líneas (Tanda 8)
});
