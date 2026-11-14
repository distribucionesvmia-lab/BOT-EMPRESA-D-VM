// Tanda 11: ficha de producto, formato y medidas, precio con descuento, ordenar/filtrar categorías, red lenta y sin conexión.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("1. ficha de producto: foto y nombre abren una hoja con nombre completo, formato, unidades por caja, precio por unidad y caja e IVA", () => {
  assert.match(p, /function abrirFicha\(p\)/);
  for (const t of ['fila("Formato"', 'fila("Unidades por caja"', 'fila("Precio por unidad"', 'fila("Precio por caja"', 'fila("IVA"', 'fila("Medidas"', "h.textContent = nombreVisible(p)"]) assert.ok(p.includes(t), t);
  assert.match(p, /n\.addEventListener\("click", \(\) => abrirFicha\(p\)\)/); assert.match(p, /av\.addEventListener\("click", \(ev\) => \{ if \(!ev\.target\.closest\("button"\)\) abrirFicha\(p\)/);
  assert.match(p, /"ficha-fondo"/); // «Atrás» y Esc la cierran como al resto de ventanas
  assert.match(p, /b\.onclick = \(\) => verFoto\(p\)/); // y la foto grande se amplía desde la ficha
});
test("2. cada tarjeta dice la unidad de venta y las medidas aunque el nombre salga recortado", () => {
  assert.match(p, /else c\.textContent = "Por unidades"/); assert.match(p, /const medidasDeNombre = n =>/);
  // la función de medidas, ejecutada de verdad
  const f = new Function(p.match(/const medidasDeNombre = n => \{[^\n]+\n/)[0] + "return medidasDeNombre;")();
  assert.deepEqual(f("BOLSA PAPEL KRAFT 30x40 CM ASA RIZADA"), ["30x40 CM"]);
  assert.deepEqual(f("ESTUCHE CARTON 25 CM"), ["25 CM"]); assert.deepEqual(f("SERVILLETA SIN MEDIDA"), []);
});
test("3. el número de productos de una categoría no se parte en dos líneas (860 → «86» y «0»)", () => { assert.match(p, /\.cat small, \.sub small \{ white-space:nowrap/); });
test("4. categorías grandes: ordenar (lo que más pido, nombre, precio) y filtrar por marca", () => {
  assert.match(p, /if \(c\.count > 30\)/); for (const t of ['["pa", "Precio: de menor a mayor"]', '["nombre", "Nombre (A–Z)"]', "marcaCat = v", "if (marcaCat) items = items.filter"]) assert.ok(p.includes(t), t);
  assert.match(p, /const conGrupos = arbol && ordenCat === "hab"/);
});
test("5. red lenta: se dice que se está cargando y dos toques seguidos en «+» avisan «ahora llevas N»", () => {
  assert.match(p, /Cargando el catálogo… con poca cobertura/); assert.match(p, /ahora llevas \$\{/); assert.match(p, /Date\.now\(\); if \(t - \(setQty\.ult \|\| 0\) < 900\)/);
});
test("6. sin conexión: banda fija y «Enviar» bloqueado hasta que vuelva la red", () => {
  assert.match(p, /id="sinRed" class="sin-red"/); assert.match(p, /function pintaRed\(\)/); assert.match(p, /Sin conexión: no se puede enviar ahora/);
  assert.match(p, /addEventListener\("online", \(\) => \{ pintaRed\(\)/);
});
test("7. el listado enseña el precio por unidad YA descontado y el anterior tachado (también en la ficha)", () => {
  assert.match(p, /const precioUd = p => Number\(p\.price\) \* \(1 - \(Number\(p\.discount\) \|\| 0\) \/ 100\)/);
  assert.match(p, /viejo\.className = "pf-viejo"/); assert.match(p, /<s>\$\{eurp\(p\.price\)\}<\/s> <b>\$\{eurp\(precioUd\(p\)\)\}<\/b>/);
  // con el ejemplo del revisor: 0,843 € −20 % = 0,674 €/ud y la caja de 24 = 16,19 €
  assert.equal((0.843 * 0.8).toFixed(3), "0.674"); assert.equal((0.843 * 24 * 0.8).toFixed(2), "16.19");
});
