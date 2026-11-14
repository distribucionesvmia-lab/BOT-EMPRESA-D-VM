// Tanda 8 (accesibilidad y rendimiento): comprobaciones sobre la pantalla del cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");

test("atajos «Último pedido» / «Histórico» con la letra al máximo: no se parte ninguna palabra y, si no caben juntos, pasan uno debajo del otro", () => {
  assert.match(h, /\.quick \{ flex-wrap:wrap; \}/);
  assert.match(h, /\.quick button, \.quick button \{ flex:1 1 auto; min-width:min-content; max-width:100%; \}/);
  assert.match(h, /\.quick \.q-tx b \{ overflow-wrap:normal; word-break:normal; hyphens:none; \}/);
});

const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
test("2. el menú ⋯ y el desplegable «Aa» no se quedan abiertos a la vez (en el chat y en el catálogo)", () => {
  for (const f of [h, p]) { assert.match(f, /dispatchEvent\(new CustomEvent\("vm:abre-panel", \{ detail: "letra" \}\)\)/); assert.match(f, /ev\.detail !== "letra"\) cerrar\(\)/); }
  assert.match(h, /detail: "menu"/); assert.match(h, /e\.detail !== "menu" && !mpop\.hidden/);
});
test("3. catálogo con la letra al máximo: el nombre del artículo ocupa hasta 4 líneas, se ve entero al tocarlo y el buscador no corta su texto", () => {
  assert.match(p, /html\[data-letra-grande\] \.pf-n \{ -webkit-line-clamp:4; \}/);
  assert.match(p, /\.pf-n\.completo \{ -webkit-line-clamp:unset !important/);
  assert.match(p, /n\.addEventListener\("click", \(\) => abrirFicha\(p\)\)/); // tanda 11: tocar el nombre abre la ficha con el nombre entero
  assert.match(p, /\$\("q"\)\.placeholder = g \? "Buscar" : "Buscar productos"/);
});
test("4. «Atrás» cierra primero la ventana abierta: ayuda, preguntas y foto ampliada en el catálogo; ayuda en el chat", () => {
  assert.match(p, /const DINAMICAS = \["ayuda-fondo", "pregunta-fondo", "ficha-fondo", "zoomFoto", "pdf-visor"\]/);
  assert.match(p, /obs\.observe\(document\.body, \{ childList: true \}\)/); assert.match(p, /obs\.observe\(z, \{ attributes: true, attributeFilter: \["style"\] \}\)/);
  assert.match(h, /const ayudaAb = \(\) => \[\.\.\.document\.querySelectorAll\("#ayuda-fondo"\)\]/);
});
test("5. la búsqueda y el punto de la lista se guardan en el historial: «Atrás» sale de la búsqueda y «Adelante» (o recargar) la devuelve", () => {
  for (const t of ["function notaBusqueda()", "history.pushState(estadoBusq(), \"\")", "function restauraDe(s)", "estadoInicial", "sc: $(\"list\").scrollTop", "lim: limite", "$(\"list\").addEventListener(\"scroll\", guardaPos"]) assert.ok(p.includes(t), t);
});
