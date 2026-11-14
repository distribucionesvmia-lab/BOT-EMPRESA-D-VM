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
