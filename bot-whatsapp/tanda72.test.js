// Abrir el catálogo al instante con la copia local (stale-while-revalidate), SOLO si la copia es del cliente que entró en ese móvil.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("COPIA LOCAL: el chat deja al entrar la marca de QUIÉN ha entrado y la borra al cerrar sesión", () => {
  const c = leer("./cliente.html");
  assert.match(c, /function entrar\(nombre\) \{ yoCache = null; cargaYo\(\)\.then\(\(y\) => \{ try \{ if \(y && y\.carrito\) localStorage\.setItem\("vm:quien", y\.carrito\)/);
  assert.match(c, /async function cerrarSesion\(\) \{ try \{ indexedDB\.deleteDatabase\("vm-catalogo"\); localStorage\.removeItem\("vm:quien"\)/);
});
test("COPIA LOCAL: el catálogo solo usa la copia si es de ese cliente, reciente, de la página normal y sin pedido ya enviado; si no, espera a la red", () => {
  const p = leer("./pedido.html"), i = p.indexOf("const pedido = fetch(location.pathname"), f = p.slice(i, i + 1600);
  assert.ok(i > 0);
  assert.match(f, /location\.pathname !== "\/catalogo"\) return null/); // las páginas de enlace (/pedido/<token>) no usan copia
  assert.match(f, /quien === "vm_carrito_c_" \+ c\.data\.customer\.codigo/); // SOLO la copia del cliente que entró en este móvil
  assert.match(f, /Date\.now\(\) - \(c\.guardado \|\| 0\) < 12 \* 3600e3/); assert.match(f, /!c\.data\.used/);
  assert.match(f, /r = suave \? \{ ok: true, status: 200, json: async \(\) => suave\.data \} : await pedido/);
  // con la copia no se vuelve a guardar hasta que lleguen los datos de verdad, ni se dice «precios al día» antes de tiempo
  assert.match(p, /else if \(!suave\) \{ data\.__cargado = Date\.now\(\); setTimeout\(guardarCopia, 1500\); \}/); assert.match(p, /if \(!copia && !suave && pendienteGuardado\(\)\)/);
  // cuando llega la red: sustituye (sin perder el pedido), 401 → sin copia y recarga, fallo de red → se sigue con la copia avisando
  const g = p.slice(p.indexOf("if (suave) { // los datos de verdad llegan detrás"), p.indexOf("if (suave) { // los datos de verdad llegan detrás") + 1500);
  assert.match(g, /aplicarDatos\(nuevo\)/); assert.match(g, /rr\.status === 401\) \{ copiaCat\.borrar\(\)[^}]*location\.reload\(\)/); assert.match(g, /data\.__copia = suave\.guardado; huboCorte = true; pintarCopia\(\)/);
});
