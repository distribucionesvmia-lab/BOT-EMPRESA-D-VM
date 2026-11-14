// Bench 6: rendimiento y fiabilidad.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { empaquetar, estatico } from "./estaticos.js";
import { hoyMadrid } from "./pricing.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("1. empaquetar saca CSS, JS grande y logo a estáticos con huella; las páginas fuente no cambian", () => {
  for (const [f, n] of [["./pedido.html", "pedido"], ["./cliente.html", "cliente"]]) {
    const src = leer(f), out = empaquetar(src, n);
    assert.ok(Buffer.byteLength(out) < 40 * 1024, f + " empaquetada < 40 KB: " + Buffer.byteLength(out));
    assert.equal(/<style>/.test(out), false); assert.equal(/base64,[A-Za-z0-9+/=]{400,}/.test(out), false);
    assert.equal(empaquetar(src, n), out, "misma entrada, misma salida (con huella estable)");
    // lo que se saca vuelve a juntarse igual: nada se pierde ni se cambia
    const css = [...out.matchAll(/href="(\/estatico\/[^"]+\.css)"/g)].map((m) => estatico(m[1]).cuerpo.toString()).join("");
    assert.equal(css, [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join(""));
    for (const m of out.matchAll(/<script src="(\/estatico\/[^"]+)"/g)) assert.ok(estatico(m[1]), m[1]);
    assert.ok(src.includes("<style>") && src.includes("base64,")); // el fuente sigue siendo un solo archivo (las pruebas y la edición no cambian)
  }
  const png = [...empaquetar(leer("./cliente.html"), "cliente").matchAll(/(\/estatico\/[\w-]+\/cliente-imagen\.png)/g)][0][1];
  assert.equal(estatico(png).cuerpo.subarray(1, 4).toString(), "PNG");
  assert.equal(estatico("/estatico/000000000000/x.css"), null);
});
test("2. /api/inicio y el catálogo ya no tardan por recalcular la fecha y las categorías cada vez", () => {
  const p = leer("./pricing.js"), c = leer("./categorias.js");
  assert.match(p, /const FORMATO_MADRID = new Intl\.DateTimeFormat/); assert.doesNotMatch(p, /export const hoyMadrid = \(\) => new Date\(\)\.toLocaleDateString/);
  assert.match(c, /const normCache = new Map\(\)/);
  assert.match(hoyMadrid(), /^\d{4}-\d{2}-\d{2}$/);
  const s = leer("./server.js"); assert.match(s, /const sendJsonEtag = /); assert.match(s, /arbolInicio = webTree\(catalogNow\(\)\)/); assert.equal((s.match(/webTree\(catalogNow\(\)\)/g) ?? []).length, 3); // una vez por petición (antes, dos en cada una)
});
test("3. página «Sin conexión» en el service worker: marca, Reintentar y «tu pedido sigue guardado»", () => {
  const sw = leer("./pwa/sw.js");
  for (const t of ["Distribuciones Valentín Martín", "Sin conexión", "Tu pedido sigue guardado en este móvil", ">Reintentar<", "location.reload()", "prefers-color-scheme:dark"]) assert.ok(sw.includes(t), t);
  assert.match(sw, /if \(e\.request\.mode !== "navigate"\) return;/); // lo demás sigue su camino: sigue sin guardar precios ni pedidos en caché
});
test("4. lo que no carga se dice y se ofrece «Reintentar» (nada de .catch(() => {}) mudos en datos)", () => {
  const c = leer("./cliente.html"), p = leer("./pedido.html");
  for (const t of ["No hemos podido comprobar si hoy hay entrega.", "No hemos podido cargar tu pedido fijo.", "No hemos podido cargar el teléfono de ayuda.", "No hemos podido recuperar tu último pedido."]) assert.ok(c.includes(t), t);
  for (const t of ["No hemos podido cargar tu pedido fijo.", "No hemos podido calcular hasta cuándo podrás modificarlo."]) assert.ok(p.includes(t), t);
  assert.match(c, /function falloCarga\(caja, texto, reintentar\)/); assert.match(p, /function falloCarga\(caja, texto, reintentar\)/);
  const mudos = (c.match(/catch\(\(\) => \{\}\)/g) ?? []).length + (p.match(/catch\(\(\) => \{\}\)/g) ?? []).length;
  assert.ok(mudos <= 3, "solo quedan los que no tienen nada que enseñar (telemetría, instalar app, service worker): " + mudos);
});
test("5. las fotos de las listas llevan width y height fijos (la lista no salta)", () => {
  const p = leer("./pedido.html"), c = leer("./cliente.html");
  assert.match(p, /im\.loading = "lazy"; im\.width = 72; im\.height = 72;/); assert.match(p, /im\.width = 52; im\.height = 52;/); assert.match(c, /i\.width = 148; i\.height = 148;/);
});
