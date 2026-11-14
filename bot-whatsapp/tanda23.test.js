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

test("B. sinónimos y abreviaturas: psc, cj, uds, coca, birra, descafe, servilletas, lejía, cocacola/colacao", () => {
  const nombres = (q) => ids(q).map((i) => productos.find((x) => x.id === i).name);
  assert.ok(nombres("psc").some((n) => /PASCUAL/.test(n))); assert.ok(nombres("pasc leche").some((n) => /PASCUAL/.test(n)));
  assert.ok(nombres("cj 24").some((n) => /CAJA 24/.test(n))); assert.ok(nombres("24 uds").some((n) => /24 UNIDADES/.test(n))); assert.ok(nombres("24 und").some((n) => /24 UNIDADES/.test(n)));
  assert.ok(nombres("coca").some((n) => /COCA-COLA/.test(n))); assert.ok(nombres("cocacola").some((n) => /COCA-COLA/.test(n))); assert.ok(nombres("coca cola").some((n) => /COCA-COLA/.test(n))); assert.ok(nombres("coca-cola").some((n) => /COCA-COLA/.test(n)));
  assert.ok(nombres("colacao").some((n) => /COLA CAO/.test(n))); assert.ok(nombres("cola-cao").some((n) => /COLA CAO/.test(n)));
  assert.ok(nombres("birra").some((n) => /CERVEZA/.test(n))); assert.ok(nombres("descafe").some((n) => /DESCAFEINADO/.test(n))); assert.ok(nombres("descafeinado").some((n) => /DESCAFEINADO/.test(n)));
  assert.ok(nombres("servilleta").some((n) => /SERVILLETAS/.test(n))); assert.ok(nombres("servilletas").some((n) => /SERVILLETAS/.test(n)));
  assert.ok(nombres("lejía").some((n) => /LEJIA/.test(n))); assert.ok(nombres("lejia").some((n) => /LEJIA/.test(n)));
  assert.ok(nombres("refrescos").some((n) => /COCA-COLA/.test(n)) && nombres("refresco").length === nombres("refrescos").length); // por el nombre de la categoría/subcategoría
  assert.ok(nombres("un lejia").length > 0); // «un» se ignora como artículo
  assert.match(p, /const ABREV = /); assert.match(p, /buscarOrden\(\$\("q"\)\.value\.trim\(\)\)/); assert.match(p, /orden = q \? buscarOrden\(query\.trim\(\)\) : null/); // sugerencias y lista usan el MISMO motor
});

test("C. «Mis favoritos»: acceso destacado arriba del catálogo y vista con solo los favoritos (entra en el historial como una sección)", () => {
  assert.match(p, /const FAVS = "__favoritos";/); assert.match(p, /function renderFavoritos\(list\)/);
  assert.match(p, /if \(nav\.cat === FAVS\) \{ renderFavoritos\(list\); return entrada\(list, "\.pf"\); \}/);
  assert.match(p, /fb\.className = "fav-acceso"/); assert.match(p, /fb\.onclick = \(\) => irA\(FAVS, "\*"\)/); assert.match(p, /data\.products\.filter\(p => favs\.has\(p\.id\)\)\.sort\(cmpNombre\)/);
  assert.match(p, /"Aún no tienes favoritos"/); assert.match(p, /\.fav-acceso \{[^}]*min-height:60px/);
});

test("D. pedido mínimo: si existe, se ve siempre en el carrito (faltan X, o «ya lo has alcanzado»); sin mínimo no sale nada", () => {
  assert.match(p, /am\.hidden = !cd\.minimo;/); assert.match(p, /Pedido mínimo: \$\{eur\(cd\.minimo\)\} sin IVA\. Ya lo has alcanzado\./);
  assert.match(p, /El pedido mínimo es de \$\{eur\(cd\.minimo\)\} sin IVA\. Te faltan/); assert.match(p, /fila\("Pedido mínimo"/); // y en el resumen, como antes
  assert.match(leer("./config.js"), /minimo: Number\.isFinite\(min\) && min > 0 \? min : 0/); // sin PEDIDO_MINIMO, minimo = 0 → no se enseña
});

import { limpiaCss, limpiaJs } from "./minificar.js";
test("E. minificar: quita comentarios y junta reglas repetidas SOLO cuando es seguro (la cascada no cambia)", () => {
  const css = limpiaCss("/* c */ .a { color: red; } .b { margin: 0 } .a { padding: 1px; } @media (prefers-reduced-motion: reduce) { .a { transition: none } } .c { color: blue } @media (prefers-reduced-motion: reduce) { .c { animation: none } }");
  assert.equal(css.includes("/*"), false);
  assert.equal((css.match(/^\.a\{/gm) ?? []).length, 1); assert.ok(css.includes(".a{color: red;padding: 1px}")); // juntas: nada entre medias toca color ni padding
  assert.equal((css.match(/@media \(prefers-reduced-motion: reduce\)\{/g) ?? []).length, 1); // los dos @media iguales se juntan (entre medias solo hay «color»)
  // NO se juntan si entre medias hay otra regla con la misma propiedad (el orden decidiría el color)
  const no = limpiaCss(".a{color:red} .b{color:blue} .a{color:green;margin:0}");
  assert.equal((no.match(/^\.a\{/gm) ?? []).length, 2);
  // propiedades «parientes» (margin / margin-top) también cuentan
  const par = limpiaCss(".a{margin:0} .x{margin-top:5px} .a{padding:0}"); assert.equal((par.match(/^\.a\{/gm) ?? []).length, 2);
  // los respaldos «height:100vh; height:100dvh» se quedan los dos, en orden
  assert.ok(limpiaCss(".a{height:100vh;height:100dvh}").includes("height:100vh;height:100dvh"));
  // cadenas con /* dentro, url(data:...;...) y @keyframes no se rompen
  assert.ok(limpiaCss('.a{content:"/* no */";background:url(data:image/png;base64,AAAA)}').includes('"/* no */"')); assert.ok(limpiaCss("@keyframes k{from{opacity:0}to{opacity:1}}").includes("@keyframes k{from{opacity:0}to{opacity:1}}"));
  assert.equal(limpiaCss(".a{color:red"), ".a{color:red"); // CSS roto: se devuelve tal cual
});
test("E. minificar JavaScript: quita comentarios sin tocar cadenas, plantillas ni expresiones regulares; si algo no cuadra, devuelve el original", () => {
  const js = limpiaJs('// hola\nconst a = "http://x.com/*no*/"; /* c */ const b = `l1\n\n  // no es comentario ${a /* sí */ + 1}\n`; // fin\nconst r = /\\/\\//.test(a) ? 1 : 2; const d = 4 / 2; // 4/2\n');
  assert.equal(js.includes("hola"), false); assert.equal(js.includes("// fin"), false); assert.equal(js.includes("sí"), false);
  assert.ok(js.includes('"http://x.com/*no*/"')); assert.ok(js.includes("l1\n\n  // no es comentario")); assert.ok(js.includes("/\\/\\//.test(a)")); assert.ok(js.includes("4 / 2"));
  assert.doesNotThrow(() => new Function(js));
  const roto = "const a = 'sin cerrar;\n// x"; assert.equal(limpiaJs(roto), roto);
  // los scripts REALES de las dos páginas siguen compilando después de limpiarlos
  for (const f of ["./pedido.html", "./cliente.html"]) for (const m of leer(f).matchAll(/<script>([\s\S]*?)<\/script>/g)) { const o = limpiaJs(m[1]); assert.ok(o.length <= m[1].length); assert.doesNotThrow(() => new Function(o), f); }
});
