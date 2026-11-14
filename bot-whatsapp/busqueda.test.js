// El buscador del catálogo (código dentro de pedido.html): plurales, tildes, sinónimos, categorías y orden (producto antes que accesorio)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { catalogoSinDuplicados, webProducts, accesosDe } from "./weborder.js";

const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const trozo = (ini, fin) => { const a = html.indexOf(ini), b = html.indexOf(fin, a); assert.ok(a >= 0 && b > a, ini); return html.slice(a, b); };
const motor = [html.match(/const norm = [^\n]*\n/)[0], html.match(/const dist = [^\n]*\n/)[0], trozo("const PALABRAS_VACIAS_B", "// ── Búsqueda: filtros por marca")].join("");

function buscador(productos, tree) {
  const ctx = vm.createContext({ data: { products: productos, tree } });
  vm.runInContext(motor + "\nthis.buscar = buscarOrden;", ctx);
  return (q) => { const m = ctx.buscar(q); return m ? [...m.keys()] : null; };
}
const P = (id, name, cat, sub, count = 0) => ({ id, name, cat, sub, count });
const productos = [
  P("1", "CUCHARAS DE CAFE INOX", "hosteleria", "menaje"), P("2", "CAFE MOLIDO NATURAL 250 GR", "cafe", "molido"), P("3", "COPAS DE VINO 35 CL", "hosteleria", "menaje"),
  P("4", "VINO TINTO CRIANZA 75 CL", "vinos", "tintos"), P("5", "ESTUCHE CUBIERTOS SERVILLETA", "hosteleria", "menaje"), P("6", "SERVILLETA PAPEL 40X40", "hosteleria", "papel"),
  P("7", "COCA-COLA LATA 33 CL", "bebidas", "refrescos"), P("8", "FANTA NARANJA LATA", "bebidas", "refrescos", 5), P("9", "LEJIA 5 L", "hosteleria", "limpieza"), P("10", "FREGASUELOS PINO", "hosteleria", "limpieza"),
  P("11", "PINZA DE HIELO", "hosteleria", "menaje"), P("12", "HIELO EN CUBITOS 2 KG", "congelados", "hielo"),
];
const tree = [
  { id: "bebidas", nombre: "Bebidas", subs: [{ id: "refrescos", nombre: "Refrescos y tés fríos" }] },
  { id: "hosteleria", nombre: "Hostelería y menaje", subs: [{ id: "limpieza", nombre: "Limpieza" }, { id: "papel", nombre: "Papel y desechables" }, { id: "menaje", nombre: "Menaje" }] },
  { id: "cafe", nombre: "Café", subs: [{ id: "molido", nombre: "Café en grano y molido" }] }, { id: "vinos", nombre: "Vinos", subs: [{ id: "tintos", nombre: "Tintos" }] },
  { id: "congelados", nombre: "Congelados", subs: [{ id: "hielo", nombre: "Hielo" }] },
];

test("búsqueda: plurales, tildes y nombres de categoría («refrescos», «limpieza»)", () => {
  const b = buscador(productos, tree);
  assert.deepEqual(b("refrescos").sort(), ["7", "8"]); // aunque ningún nombre diga «refrescos»: está la categoría «Refrescos y tés fríos»
  assert.deepEqual(b("limpieza").sort(), ["10", "9"]);
  assert.ok(b("servilletas").includes("6")); assert.ok(b("café").includes("2")); assert.ok(b("CAFÉ").includes("2")); // tildes y mayúsculas
  assert.equal(b("zzzzzz").length, 0);
});
test("búsqueda: el producto va antes que el accesorio y lo que el cliente compra, arriba", () => {
  const b = buscador(productos, tree);
  assert.equal(b("café")[0], "2"); assert.ok(b("café").indexOf("2") < b("café").indexOf("1")); // café antes que «cucharas de café»
  assert.ok(b("vino").indexOf("4") < b("vino").indexOf("3")); // vino antes que «copas de vino»
  assert.ok(b("servilleta").indexOf("6") < b("servilleta").indexOf("5")); // servilleta antes que el estuche de cubiertos
  assert.equal(b("hielo")[0], "12"); // hielo antes que la pinza de hielo
  assert.equal(b("refrescos")[0], "8"); // el que ya compra, primero
});
test("catálogo: sin repetidos (mismo código; o mismo nombre, precio y caja), sin tarjetas sin nombre, y los contadores del árbol cuadran", () => {
  const cat = [
    { id: "1", name: "PEDRAS AGUA GAS 750 CC", price: 1.3, unitsPerBox: 12 }, { id: "1", name: "PEDRAS AGUA GAS 750 CC", price: 1.3, unitsPerBox: 12 },
    { id: "2", name: "Pedras agua gas 750 cc", price: 1.3, unitsPerBox: 12 }, { id: "3", name: "PEDRAS AGUA GAS 750 CC", price: 1.4, unitsPerBox: 12 }, { id: "4", name: "   ", price: 1 },
  ];
  assert.deepEqual(catalogoSinDuplicados(cat).map((p) => p.id), ["1", "3"]);
  const web = webProducts({ id: "c", orders: [] }, cat, () => []);
  assert.deepEqual(web.map((p) => p.id).sort(), ["1", "3"]);
});
test("accesos directos: Limpieza, Papel y desechables y Cervezas, solo si existen", () => {
  const a = accesosDe([{ id: "h", nombre: "Hostelería", subs: [{ id: "l", nombre: "Limpieza", count: 100 }, { id: "p", nombre: "Papel y desechables", count: 20 }] }, { id: "b", nombre: "Bebidas", subs: [{ id: "c", nombre: "Cervezas", count: 30 }, { id: "z", nombre: "Zumos", count: 5 }] }]);
  assert.deepEqual(a.map((x) => [x.nombre, x.cat, x.sub]), [["Limpieza", "h", "l"], ["Papel y desechables", "h", "p"], ["Cervezas", "b", "c"]]);
  assert.deepEqual(accesosDe([{ id: "x", nombre: "X", subs: [{ id: "y", nombre: "Otros", count: 1 }] }]), []);
});
