// Tanda 12: pedido semanal real de un bar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("1. «Repetir y revisar» con un pedido ya empezado: nunca se mezcla sin preguntar (sustituir / añadir / cancelar), enseñando antes cómo cambia el total", () => {
  assert.match(p, /async function precargar\(\)/); assert.match(p, /function elegirAnterior\(ops, aplicar\)/);
  assert.match(p, /if \(ops\.length && qty\.size && !sumar\) \{/); assert.match(p, /await elegirAnterior\(ops, aplicar\)/);
  for (const t of ["Sustituir el pedido actual", "Añadir al pedido actual", "Si lo sustituyes", "Si lo añades", "Tu pedido ahora"]) assert.ok(p.includes(t), t);
  assert.doesNotMatch(p, /confirm\("Tienes un pedido sin terminar/); // ya no se usa el aviso del navegador
});
test("1b. si el resultado supera los 3.000 € se pregunta «¿Seguro?» (como con una cantidad enorme) y, si no, se deshace", () => {
  assert.match(p, /calc\(\)\.total > LIM_IMPORTE && !\(await preguntar\(\{ titulo: "¿Seguro\?"/); assert.match(p, /Ojo: si lo añades, el pedido pasa de/);
});
test("1c. la orden del enlace (#c=…) se usa una sola vez: al recargar no se vuelve a sumar", () => { assert.match(p, /history\.replaceState\(history\.state, "", location\.pathname \+ location\.search\)/); });

import vm from "node:vm";
const trozo = (ini, fin) => { const a = p.indexOf(ini), b = p.indexOf(fin, a); assert.ok(a >= 0 && b > a, ini); return p.slice(a, b); };
const motor = [p.match(/const norm = [^\n]*\n/)[0], p.match(/const dist = [^\n]*\n/)[0], trozo("const PALABRAS_VACIAS_B", "// ── Búsqueda: filtros por marca")].join("");
function buscador(productos, tree) {
  const ctx = vm.createContext({ data: { products: productos, tree } });
  vm.runInContext(motor + "\nthis.buscar = buscarOrden; this.aviso = () => busquedaAviso;", ctx);
  return (q) => { const m = ctx.buscar(q); return { ids: m ? [...m.keys()] : [], aviso: ctx.aviso() }; };
}
test("2. buscador del sector: «cocacola» pegado, «tercios», «hielo bolsa» (sin la palabra de formato) y «barril» (no se vende: se dice)", () => {
  const P = (id, name, cat, sub) => ({ id, name, cat, sub, count: 0 });
  const productos = [P("1", "COCA-COLA LATA 33 CL", "b", "r"), P("2", "CERVEZA MAHOU CINCO ESTRELLAS 33 CL VIDRIO", "b", "c"), P("3", "HIELO EN CUBITOS 2 KG", "c", "h"), P("4", "BOLSA PAPEL KRAFT 30X40 CM", "e", "bo")];
  const tree = [{ id: "b", nombre: "Bebidas", subs: [{ id: "r", nombre: "Refrescos" }, { id: "c", nombre: "Cervezas" }] }, { id: "c", nombre: "Congelados", subs: [{ id: "h", nombre: "Hielo" }] }, { id: "e", nombre: "Embalaje", subs: [{ id: "bo", nombre: "Bolsas" }] }];
  const q = buscador(productos, tree);
  assert.deepEqual(q("cocacola").ids, ["1"]); assert.deepEqual(q("coca cola").ids, ["1"]);
  assert.ok(q("tercios").ids.includes("2")); assert.ok(q("caña").ids.includes("2"));
  const h = q("hielo bolsa"); assert.equal(h.ids[0], "3"); assert.match(h.aviso, /tal cual/);
  const b = q("barril"); assert.match(b.aviso, /No vendemos barril/); assert.match(b.aviso, /pregunta a tu comercial/);
  assert.deepEqual(q("xyzzy").ids, []);
  assert.match(p, /puede que no lo tengamos: pregunta a tu comercial/);
});

test("3. «Lo que sueles pedir» (Inicio): nombre entero (hasta 4 líneas) y el formato", () => {
  const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(h, /\.vm-inicio \.in-pn \{ -webkit-line-clamp:4;/); assert.match(h, /el\("small", "in-fmt", "Caja de " \+ p\.unitsPerBox\)/);
});
test("4. el aviso («Quitado…») va encima de la barra inferior y de «Ver pedido», no sobre la rejilla, y los avisos sin «Deshacer» se quitan con un toque", () => {
  assert.match(p, /t\.style\.bottom = \$\("cart"\)\.hidden \? \(\(tb && tb\.offsetHeight\) \+ \(pie && !pie\.hidden \? pie\.offsetHeight : 0\) \+ 8\) \+ "px" : ""/);
  assert.match(p, /t\.onclick = deshacer \? null : \(\) => \{ t\.hidden = true;/);
});
