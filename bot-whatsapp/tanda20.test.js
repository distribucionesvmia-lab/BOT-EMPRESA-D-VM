// Bench 5: facilidad de compra II.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pdfPedido, datosPdf } from "./pdf.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html");

test("1. «La última vez: N» con su unidad, y el primer «+» pone justo eso (solo-cajas, siempre cajas)", () => {
  assert.match(p, /function ultimaVez\(p\)/); assert.match(p, /p\.soloCaja \|\| L % k === 0/); assert.match(p, /b\.onclick = \(\) => primerMas\(p\)/);
  assert.match(p, /"La última vez: " \+ uv\.texto/); assert.match(p, /tab === "hab" \? ultimaVez\(p\)/);
  assert.match(c, /"La última vez: " \+ ultimaTxt\(p\)/); assert.match(c, /p\.ultima > 0 \? Math\.min\(999, p\.ultima\) : 1\) \+ "&a=1"/);
  assert.match(c, /eur\(Math\.round\(p\.price \* p\.unitsPerBox \* 100\) \/ 100\) \+ " \/caja"/); // solo-cajas: el precio va por caja también en el Inicio
});
test("2-3. saltar esta semana, Mi pedido fijo desde Mi cuenta y aviso de retirados con parecidos antes de abrir el fijo", () => {
  assert.match(c, /"Saltar esta semana"/); assert.match(c, /\/api\/pedido-fijo\/saltar/); assert.match(c, /nodo\("button", "Mi pedido fijo", "vm-btn ghost"\)/);
  assert.match(c, /Hay 1 artículo de tu pedido fijo que ya no está:/); assert.match(c, /Al abrir el pedido te dejamos cambiarlos por uno parecido\./);
  assert.match(leer("./server.js"), /function parecidosA\(/);
});
test("4. «¿Algún problema con este pedido?» abre WhatsApp con pedido, tipo de problema y artículo (no se envía solo)", () => {
  assert.match(c, /id="m-problema" hidden/); assert.match(c, /¿Algún problema con este pedido\?/); assert.match(c, /Hola, tengo un problema con mi pedido \$\{o\.doc\}: \$\{\$\("p-tipo"\)\.value\}\./);
  assert.match(c, /a\.whatsappHref \+ "\?text=" \+ encodeURIComponent\(msg\(\)\)/); assert.match(c, /No se envía nada hasta que tú lo mandes/);
});
test("5-6. Mi cuenta: total con IVA, «Próximos» arriba con Modificar y estado en 4 pasos; PDF con la fecha de entrega en letra", () => {
  assert.match(c, /nodo\("h4", "Próximos", "cu-mes"\)/); assert.match(c, /PASOS = \["Recibido", "En preparación", "En reparto", "Entregado"\]/); assert.match(c, /"Total con IVA aprox\.: " : "Total con IVA: "/);
  const o = { ref: "VM-2026-000009", created_at: "2026-11-14T10:00:00Z", delivery_date: "2026-11-17", address: "x", note: "", re: 0, items: [{ product_id: "1", name: "AGUA", unit: "ud", qty: 6, units: 6, price: 1, vat: 21, amount: 6 }] };
  const t = pdfPedido(datosPdf(o, { empresa: "VM", cliente: "BAR" })).toString("latin1");
  assert.ok(t.includes("martes 17 de noviembre de 2026"), "fecha de entrega en letra"); assert.equal(t.includes("17/11/2026"), false);
});
