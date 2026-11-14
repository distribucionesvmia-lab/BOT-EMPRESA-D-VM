// Tanda 19 de fallos: barra que tapa en todas las listas, móvil apaisado y filtros del histórico.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html");

test("19.1 el relleno de abajo y el «baja con la barra» valen para TODAS las listas (es el mismo #list y el mismo refresh)", () => {
  assert.match(p, /main, \.app\.sin-carrito main \{ padding-bottom:calc\(var\(--tb-h\) \+ var\(--pie-h, 88px\) \+ 28px\); \}/);
  assert.match(p, /aparece = n > 0 && !!document\.querySelector\("footer"\)\.hidden/); // sale de refresh(), que usan categorías, búsqueda, favoritos y «Lo habitual»
  assert.match(p, /nav\.cat === FAVS\) \{ renderFavoritos\(list\); return entrada\(list, "\.pf"\); \}/); // favoritos pinta en el mismo contenedor
});
test("19.2 móvil apaisado (780×360): la lista vuelve a poder bajar hasta el final y no se esconde bajo la navegación", () => {
  assert.match(p, /@media \(min-width:768px\) and \(max-width:1023px\) and \(orientation:landscape\) and \(max-height:520px\) \{[^}]*\.app \{ align-items:stretch; justify-items:stretch; \}[^}]*\.app > #list[^}]*align-self:stretch;/);
  assert.match(p, /\.paso, \.guia, \.titulo-bloque \{ display:none; \}/); // el título grande ya no se come 80-115 px de los 360 que hay
});
test("19.3 histórico de pedidos (Mi cuenta): filtro por mes y búsqueda por producto, sin tildes y con todas las palabras", () => {
  assert.match(c, /selMes\.setAttribute\("aria-label", "Filtrar los pedidos por mes"\)/); assert.match(c, /"Todos los meses"/); assert.match(c, /"Buscar un producto en tus pedidos"/);
  assert.match(c, /palabras\.every\(\(w\) => o\.lineas\.some\(\(l\) => sinTildes\(l\.nombre\)\.includes\(w\)\)\)/); assert.match(c, /Ningún pedido coincide con lo que has elegido/);
  assert.match(c, /selMes\.onchange = pintaPedidos; buscaP\.oninput = pintaPedidos;/); assert.match(c, /\.cu-filtros select, \.cu-filtros input \{ width:100%; min-height:48px; \}/);
});
test("19.2b apaisado: la cabecera de la categoría no queda fija (se llevaba casi toda la pantalla)", () => {
  assert.match(p, /@media \(orientation:landscape\) and \(max-height:520px\) \{ \.cab-cat \{ position:static; \}/);
});
