// Tanda 18 de fallos (asistente, día de reparto, barra que tapa, nombres cortados y texto grande) y Bench 9.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html"), b = leer("./bot.js"), s = leer("./server.js");

test("18.1 «¿cuánto llevo?» lee el carrito real del móvil (se manda con el mensaje, solo lectura)", () => {
  assert.match(c, /async function carritoDelCatalogo\(\)/); assert.match(c, /carrito: await carritoDelCatalogo\(\)/); assert.match(c, /Date\.now\(\) - g\.t > 168 \* 3600e3/);
  assert.match(b, /export function itemsDeCarrito\(lineas\)/); assert.match(b, /ctx\.carritoExterno\?\.length/); assert.match(b, /Llevas esto en tu pedido del catálogo/);
  assert.match(s, /handleMessage\(cur, text, \{ carritoExterno: itemsDeCarrito\(carrito\) \}\)/);
  assert.doesNotMatch(b.slice(b.indexOf("ctx.carritoExterno?.length"), b.indexOf("ctx.carritoExterno?.length") + 600), /s\.cart\s*=|setItems|order:/); // no se pasa al chat ni se confirma
});
test("18.2 día de reparto: el resumen explica el pedido abierto de otro día y pregunta (añadir a ese o hacer uno nuevo)", () => {
  assert.match(p, /id="resAbierto"/); assert.match(p, /Ya tienes un pedido el \$\{corto\(ab\.entrega\)\}\. ¿Lo añado a ese o hago uno nuevo para el \$\{corto\(diaElegido\)\}\?/);
  assert.match(p, /Añadir al del \$\{corto\(ab\.entrega\)\}/); assert.match(p, /Hacer uno nuevo para el \$\{corto\(diaElegido\)\}/); assert.match(p, /Se enviará como pedido nuevo para el/);
  assert.match(p, /pintarResAbierto\(\);\n\s*\$\("resDia"\)/); // se pinta al abrir el resumen
});
test("18.3 la barra del pedido no tapa la última fila: padding igual a su alto y, al salir la barra con la lista abajo del todo, la lista baja", () => {
  assert.match(p, /padding-bottom:calc\(var\(--tb-h\) \+ var\(--pie-h, 88px\) \+ 28px\)/); assert.match(p, /new ResizeObserver\(medP\)\.observe\(pie\)/);
  assert.match(p, /aparece = n > 0 && !!document\.querySelector\("footer"\)\.hidden/); assert.match(p, /if \(aparece && alFinal\) requestAnimationFrame/);
});
test("18.4 sugerencias de búsqueda: nombre en 2 líneas (no cortado en una) y el formato debajo", () => {
  assert.match(p, /\.sug-tx b \{[^}]*-webkit-line-clamp:2;/); assert.doesNotMatch(p, /\.sug-tx b \{[^}]*white-space:nowrap/);
  assert.match(p, /n\.textContent = nombreVisible\(p\); n\.title = p\.name;/); assert.match(p, /\[fmtS, \.\.\.medS\]\.join\(" · "\)/);
});
test("18.5 texto grande: el panel «Aa» se titula, explica A+ / A− y dice «normal / grande / muy grande»", () => {
  for (const h of [p, c]) { assert.match(h, /tit\.textContent = "Tamaño de la letra"/); assert.match(h, /Pulsa A\+ para ver todo más grande, o A− para más pequeño\./); assert.match(h, /e < 1\.07 \? "normal" : e < 1\.22 \? "grande" : "muy grande"/); assert.match(h, /"Letra más grande"/); }
});

import { openAccountsDb } from "./cuentas-db.js";
test("Bench 9.1 alta: correo opcional en la solicitud y en el alta automática, menos texto y botón «Enviando…»", () => {
  const a = openAccountsDb(":memory:");
  const r = a.requestRegistration({ phone: "655121212", email: "", business: "Taberna Nueva", pin: "Ab12Cd", nif: "87654321X" }); assert.ok(r.id, JSON.stringify(r));
  assert.equal(a.requestRegistration({ phone: "655121213", email: "mal", business: "Taberna", pin: "Ab12Cd", nif: "87654321X" }).error, "El correo no es válido."); // si se escribe, tiene que valer
  assert.equal(a.registerAuto({ phone: "655121214", email: undefined, business: "Taberna Dos", pin: "Ab12Cd", customerId: "C1", matched: "x" }).error, undefined);
  assert.match(c, /<label>Correo electrónico <small class="pista">\(opcional\)<\/small><input id="r-mail"/); assert.match(c, /<label>Dirección de entrega <small class="pista">\(opcional\)/);
  assert.doesNotMatch(c, /Cuéntanos quién eres y elige un código de entrada/); assert.match(c, /Rellena estos datos y te damos de alta\./);
  assert.match(c, /return enviando\(\$\("f-registro"\)/); assert.match(c, /Enviando…/);
});
test("Bench 9.2 tras enviar: «Recibido. Te llamamos en 24-48 h laborables» con teléfono y WhatsApp solo si la empresa los ha configurado", () => {
  assert.match(c, /id="alta-ok" hidden role="status"/); assert.match(c, /"Te llamamos en 24-48 h laborables para darte de alta\."/); assert.match(c, /function altaHecha\(activa\)/);
  assert.match(c, /if \(!activa && a && \(a\.telHref \|\| a\.whatsappHref\)\)/); assert.match(c, /if \(a\.telHref\) \{ const l = nodo\("a", "Llamar"/); assert.match(c, /if \(a\.whatsappHref\) \{ const l = nodo\("a", "WhatsApp"/); // sin datos, no se inventa ningún número
  assert.doesNotMatch(c.slice(c.indexOf("function altaHecha"), c.indexOf('$("alta-ok-v").onclick')), /\b9\d{2} ?\d{3} ?\d{3}\b/);
});
test("Bench 9.3-4 bienvenida de 3 pasos con los textos reales, «Entendido» para siempre por cliente y la oferta de poner código dentro", () => {
  for (const t of ["Busca un artículo o mira «Lo que sueles pedir».", "Marca las cantidades con el «+».", "Pulsa «Revisar pedido», elige el día de entrega y envíalo."]) assert.ok(c.includes(t), t);
  assert.match(c, /post\("\/api\/bienvenida\/vista", \{\}\)/); assert.match(c, /y\?\.codigoPropio === false/); assert.match(c, /"Poner mi código"/); assert.match(c, /\$\("cambiar"\)\.click\(\)/); // abre el modal m-codigo que ya existe
  assert.match(s, /\/api\/bienvenida/); assert.match(s, /ordersOf\(account\.customerId, 1\)\.length > 0/); // no se enseña a quien ya ha pedido por la app
  assert.match(leer("./cuentas-db.js"), /DELETE FROM bienvenida_vista WHERE customer_id/); // se borra con la cuenta
});
