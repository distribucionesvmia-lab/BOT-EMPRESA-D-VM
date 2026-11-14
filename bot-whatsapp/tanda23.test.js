// Pendientes: A «Sin resultados» útil, B sinónimos y abreviaturas, C Mis favoritos, D pedido mínimo, E CSS.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html");
const trozo = (ini, fin) => { const a = p.indexOf(ini), b = p.indexOf(fin, a); assert.ok(a >= 0 && b > a, ini); return p.slice(a, b); };
const motor = [p.match(/const norm = [^\n]*\n/)[0], p.match(/const dist = [^\n]*\n/)[0], trozo("const PALABRAS_VACIAS_B", "// ── Búsqueda: filtros por marca")].join("");
const P = (id, name, cat, sub, count = 0) => ({ id, name, cat, sub, count });
const tree = [{ id: "beb", nombre: "Bebidas", subs: [{ id: "ref", nombre: "Refrescos y tés fríos" }, { id: "cer", nombre: "Cervezas" }] }, { id: "lac", nombre: "Lácteos", subs: [{ id: "leche", nombre: "Leche" }] }, { id: "lim", nombre: "Limpieza", subs: [{ id: "lej", nombre: "Lejías" }] }];
const productos = [P("1", "COCA-COLA LATA 33 CL", "beb", "ref"), P("2", "COCA-COLA ZERO 33 CL", "beb", "ref"), P("3", "LECHE ENTERA PASCUAL 1 L", "lac", "leche"), P("4", "CERVEZA ESTRELLA GALICIA 33 CL", "beb", "cer"), P("5", "LEJIA CONCHITA 5 L", "lim", "lej"),
  P("6", "SERVILLETAS BLANCAS 40X40 PACK 100", "lim", "lej"), P("7", "CAFE DESCAFEINADO SOLUBLE 200 G", "lac", "leche"), P("8", "AGUA MINERAL CAJA 24 UNIDADES", "beb", "ref"), P("9", "COLA CAO 383 G", "lac", "leche")];
const ctx = () => { const c = vm.createContext({ data: { products: productos, tree } }); vm.runInContext(motor + "\nthis.buscar = buscarOrden; this.parecidos = parecidosBusqueda;", c); return c; };
const ids = (q) => { const m = ctx().buscar(q); return m ? [...m.keys()] : []; };

test("A. «Sin resultados» útil: 3 artículos parecidos (distancia ≤ 2) y secciones con nombre parecido", () => {
  const c = ctx();
  const r = c.parecidos("coka cola");
  assert.ok(r.articulos.length >= 1 && r.articulos.length <= 3); assert.ok(r.articulos.some((x) => /COCA-COLA/.test(x.name)));
  const s = c.parecidos("refresquos");
  assert.ok(s.secciones.some((x) => x.nombre === "Refrescos y tés fríos" && x.cat === "beb" && x.sub === "ref"));
  assert.equal(c.parecidos("zzzzzz").articulos.length + c.parecidos("zzzzzz").secciones.length + c.parecidos("  ").articulos.length, 0);
  assert.match(p, /¿Buscabas \$\{s\.nombre\}\?/); assert.match(p, /"Lo más parecido"/); assert.match(p, /¿No lo encuentras\? Habla con una persona/); // el enlace a hablar con una persona se queda
});
