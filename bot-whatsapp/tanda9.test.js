// Tanda 9: cierre del pedido (paso de resumen, día preseleccionado, pie compacto, condiciones…).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { condicionesPedido } from "./config.js";
const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const s = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("1. paso de resumen: el pedido se revisa y SOLO desde el resumen se envía, con un texto claro", () => {
  assert.match(p, /id="revisar" type="button">Revisar pedido</);
  assert.match(p, /<section class="screen" id="resumen"/); assert.match(p, /id="confirm" type="button">Enviar pedido a Distribuciones Valentín Martín</);
  for (const id of ["resDia", "resDir", "resNota", "sumBase", "sumIva", "sumTotal", "resCond"]) assert.ok(p.includes(`id="${id}"`), id);
  assert.ok(p.indexOf('id="confirm"') > p.indexOf('id="resumen"')); // el botón de enviar está dentro del resumen, no en el carrito
  assert.match(p, /const CAPAS = \["cart", "resumen"\]/); // «Atrás» y Escape cierran el resumen primero
});
test("2. el primer día de reparto viene marcado (nunca «Hoy» sin querer) y, si no hay día, no se envía", () => {
  assert.match(p, /diaElegido = \(ops\.find\(o => o\.kind !== "hoy"\) \|\| ops\[0\]\)\.date/);
  assert.match(p, /Elige el día de entrega\./); assert.match(p, /es obligatorio para enviar el pedido/);
});
test("3. pie compacto con el total en una línea, sin menú inferior dentro del pedido y cabecera que se encoge", () => {
  assert.match(p, /id="pieTotal"/); assert.match(p, /\.app:has\(#cart:not\(\[hidden\]\)\) \.tabbar/); assert.match(p, /screen\.compacta \.ped-cab/);
});
test("4 y 5. sugerencias en estilo secundario; «Vaciar el pedido» pregunta antes y va separado", () => {
  assert.match(p, /className = "add sec-add"/); assert.match(p, /\.falta \.falta-fila \.add\.sec-add \{ background:var\(--surface\)/);
  assert.match(p, /titulo: "¿Vaciar el pedido\?"/); assert.match(p, /\.vaciar \{ margin-top:var\(--s7\)/);
});
test("6. observaciones con contador (n/200)", () => { assert.match(p, /id="noteCnt"/); assert.match(p, /te quedan/); });
test("7 y 8. toda la fila de dirección se pulsa y los días van en dos filas (cuadrícula de 3 columnas)", () => {
  assert.match(p, /\.addrop span \{ flex:1/); assert.match(p, /\.dchips \{ display:grid; grid-template-columns:repeat\(3/);
});
test("9. dos artículos con el mismo nombre corto se enseñan con el nombre completo", () => { assert.match(p, /function nombreVisible\(p\)/); assert.match(p, /_dupCorto\.get\(p\.nombreCorto\) > 1 \? p\.name/); });
test("10. la última fila del catálogo no queda tapada por «Ver pedido» (margen = altura real de la barra)", () => { assert.match(p, /--pie-h/); assert.match(p, /var\(--pie-h, 88px\) \+ 28px/); });
test("11. cada línea enseña el precio exacto por unidad que se multiplica", () => { assert.match(p, /const precioUdExacto = l =>/); assert.match(p, /× \$\{precioUdExacto\(l\)\} €/); });
test("12. forma de pago, pedido mínimo y portes: solo lo que la empresa haya configurado (nada inventado)", () => {
  const antes = { ...process.env };
  try {
    delete process.env.PEDIDO_MINIMO; delete process.env.PORTES_TEXTO;
    let c = condicionesPedido(); assert.equal(c.minimo, 0); assert.equal(c.portes, ""); assert.match(c.pago, /datos de pago/);
    process.env.PEDIDO_MINIMO = "150,5"; process.env.PORTES_TEXTO = "Portes gratis desde 200 €";
    c = condicionesPedido(); assert.equal(c.minimo, 150.5); assert.equal(c.portes, "Portes gratis desde 200 €");
    process.env.PEDIDO_MINIMO = "abc"; assert.equal(condicionesPedido().minimo, 0);
  } finally { process.env.PEDIDO_MINIMO = antes.PEDIDO_MINIMO ?? ""; process.env.PORTES_TEXTO = antes.PORTES_TEXTO ?? ""; if (antes.PEDIDO_MINIMO === undefined) delete process.env.PEDIDO_MINIMO; if (antes.PORTES_TEXTO === undefined) delete process.env.PORTES_TEXTO; }
  assert.equal((s.match(/condiciones: condicionesPedido\(\)/g) ?? []).length, 2); // las dos rutas de datos del catálogo
  assert.match(p, /El pedido mínimo es de/);
});
test("13. con el calendario abierto, Esc cierra solo el calendario (una capa por pulsación)", () => { assert.match(p, /!e\.defaultPrevented && abiertas\(\)\.length/); assert.match(p, /e\.stopImmediatePropagation\(\); cerrarArriba\(\)/); });
