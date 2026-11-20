import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("«Hacer pedido» abre el catálogo en «Lo habitual» si el cliente tiene artículos de los últimos 6 meses", () => {
  const bot = src("./bot.js"), html = src("./cliente.html");
  assert.match(bot, /#tab=hab/);
  assert.match(bot, /s\.customer && !s\.unverified && habitualProducts\(s\.customer\)\.length > 0/); // sin verificar: catálogo normal
  assert.doesNotMatch(html, /ui\.type === "historico"/); // ya no hay lista aparte en el chat
});

test("el catálogo ordena los artículos de cada categoría por familia, subfamilia y artículo (como el histórico)", () => {
  const ped = src("./pedido.html");
  assert.match(ped, /rs\(x\) - rs\(y\) \|\| porFamilia\(x, y\) \|\| cmpNombre\(x, y\)/); // subcategoría, familia a3ERP, artículo y, sin familia, nombre
});

test("el carrito (catálogo y chat) sigue el orden de a3ERP", () => {
  assert.match(src("./pedido.html"), /const lines = \(\) => .*\.sort\(porFamilia\)/);
  assert.match(src("./bot.js"), /items = ordenarLineas\(\[\.\.\.items\], \(i\) => i\.id\)/);
});

test("categorías y subcategorías del catálogo siguen el orden de a3ERP (menor código de familia primero; sin código, al final)", () => {
  const ped = src("./pedido.html");
  assert.match(ped, /function ordenarArbol\(d\)/); assert.match(ped, /ordenarArbol\(data\); data\.products\.forEach/); assert.match(ped, /data = nuevo; ordenarArbol\(data\)/);
  // la lógica, ejecutada de verdad con familias de prueba
  const cod = ped.slice(ped.indexOf("const limpiaFam"), ped.indexOf("// ORDEN-FAMILIA-FIN")), fn = ped.slice(ped.indexOf("function ordenarArbol"), ped.indexOf("const productoPorId"));
  const d = { tree: [{ id: "a", subs: [{ id: "x" }, { id: "y" }] }, { id: "b", subs: [] }, { id: "c", subs: [] }], products: [{ cat: "a", sub: "x", fam: "10.2" }, { cat: "a", sub: "y", fam: "2.1" }, { cat: "b", sub: "z", fam: "1.1" }, { cat: "c", sub: "w" }] };
  new Function("d", cod + fn + "ordenarArbol(d);")(d);
  assert.deepEqual(d.tree.map(c => c.id), ["b", "a", "c"]); // 1.1 < 2.1 < 10.2; «c» sin familia, al final
  assert.deepEqual(d.tree[1].subs.map(s => s.id), ["y", "x"]); // 2.1 antes que 10.2
});

test("sin código de familia en los artículos, categorías y subcategorías siguen el orden de a3ERP con el mapa del servidor (data.famOrden)", () => {
  const ped = src("./pedido.html"), sv = src("./server.js");
  assert.match(sv, /const FAM_ORDEN = /); assert.equal((sv.match(/famOrden: FAM_ORDEN/g) || []).length, 2); // catálogo normal y por enlace
  const cod = ped.slice(ped.indexOf("const limpiaFam"), ped.indexOf("// ORDEN-FAMILIA-FIN")), fn = ped.slice(ped.indexOf("function ordenarArbol"), ped.indexOf("const productoPorId"));
  const d = { famOrden: { Cafe: "33.5", Pascual: "1.1", Aguas: "10.0", "Pascual/Yogures": "1.9", "Pascual/Leche": "1.1" },
    tree: [{ id: "c", nombre: "Cafe", subs: [] }, { id: "p", nombre: "Pascual", subs: [{ id: "y", nombre: "Yogures" }, { id: "l", nombre: "Leche" }] }, { id: "a", nombre: "Aguas", subs: [] }], products: [{ cat: "c", sub: "x" }] };
  new Function("d", cod + fn + "ordenarArbol(d);")(d);
  assert.deepEqual(d.tree.map(c => c.id), ["p", "a", "c"]); assert.deepEqual(d.tree[0].subs.map(s => s.id), ["l", "y"]);
});

test("INICIO: «Lo habitual» = lo que más se repite en los 6 meses (por veces pedido); «Histórico» = todo lo pedido alguna vez en 6 meses", async () => {
  const fs = await import("node:fs"), leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(leer("./server.js"), /const habituales = todos\.filter\(\(x\) => x\.count > 0\)\.slice\(0, 10\)/); // `todos` ya viene ordenado por count (veces pedido)
  assert.match(leer("./weborder.js"), /\.sort\(\(a, b\) => b\.count - a\.count/);
  assert.match(leer("./cliente.html"), /j\.tieneHistorial \? "Lo habitual"/);
  assert.match(leer("./pedido.html"), /class="tb-t">Histórico</);
});

test("HISTÓRICO: los artículos salen en orden a3ERP pero SIN títulos de familia entre medias", async () => {
  const p = (await import("node:fs")).readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(p, /items = items\.slice\(\)\.sort\(\(x, y\) => rs\(x\) - rs\(y\) \|\| porFamilia\(x, y\)/); // sigue ordenado
  assert.ok(!/tab === "hab" && !q && items\.some\(x => grupoFam\(x\)\)/.test(p)); // sin cabeceras de familia
});
