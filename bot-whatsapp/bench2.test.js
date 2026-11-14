// Bench 2: diseño visual I (que se lea).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html");
const parse = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = (a) => { const f = (x) => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(a[0]) + .7152 * f(a[1]) + .0722 * f(a[2]); };
const razon = (a, b) => { const [x, y] = [lum(parse(a)), lum(parse(b))].sort((m, n) => n - m); return (x + .05) / (y + .05); };

test("1. «Ampliar foto»: colores con variables (claro y oscuro), nada de estilos en línea de color, y por encima de la ficha", () => {
  assert.match(p, /#zoomFoto \.zcaja \{ background:var\(--surface\); color:var\(--text\);/); assert.match(p, /#zoomFoto \.zx \{[^}]*background:var\(--surface\); color:var\(--text\);/);
  assert.match(p, /#zoomFoto \.znom \{[^}]*color:var\(--text\);/); assert.match(p, /#zoomFoto \.zia \{ color:var\(--text-2\);/);
  const verFoto = p.slice(p.indexOf("function verFoto(p)"), p.indexOf("function row(p)", p.indexOf("function verFoto(p)")));
  assert.doesNotMatch(verFoto, /style="[^"]*(background|color)/); assert.doesNotMatch(verFoto, /cssText/);
  assert.match(p, /#zoomFoto \{ position:fixed; inset:0; z-index:120;/);
});
test("2. fila de producto en móvil en dos niveles: nombre arriba (hasta 3 líneas, con casi todo el ancho) y corazón, selector y «+» debajo", () => {
  assert.match(p, /grid-template-columns:64px minmax\(0, 1fr\) auto; grid-template-areas:"av info info" "fav seg slot"/); assert.match(p, /\.pf-n \{ -webkit-line-clamp:3; \}/);
  assert.match(p, /html\[data-letra-grande\] \.pf-n \{ -webkit-line-clamp:4; \}/); // con la letra al 130 %
});
test("3. barra inferior: etiquetas de 12,5 px (12 en pantallas muy estrechas) y sin mayúsculas", () => {
  assert.match(p, /\.tb-t \{ font-size:calc\(12\.5px \/ var\(--k,1\)\); text-transform:none;/); assert.match(p, /@media \(max-width:359px\) \{ \.tb-t \{ font-size:calc\(12px \/ var\(--k,1\)\);/);
});
test("4. contrastes: --tab-off y el texto «Imagen orientativa» ≥ 4,5:1 sobre los fondos donde se usan", () => {
  for (const h of [p, c]) assert.match(h, /--tab-off:#6E6E73/);
  for (const fondo of ["#FFFFFF", "#F5F5F7"]) assert.ok(razon("#6E6E73", fondo) >= 4.5, fondo);
  assert.ok(razon("#636366", "#FFFFFF") >= 4.5); // --text-2 (lo que usa .zia) en claro; en oscuro #A8A8B0 sobre #1C1C1E ya se comprueba en tanda15
});
test("5. tarjeta en pantalla ancha: caja de foto de 96 px y sin cuadrado vacío cuando no hay foto", () => {
  assert.match(p, /@media \(min-width:1024px\) \{ \.pf-av \{ aspect-ratio:auto; width:96px; height:96px;/); assert.match(p, /\.pf\.sin-foto \.pf-av \{ display:none; \}/);
  assert.match(p, /\(p\.img \? "" : " sin-foto"\)/);
});
