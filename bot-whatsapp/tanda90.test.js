// Correo de confirmación de pedido «más bonito»: versión HTML (con el texto sencillo de respaldo), todo escapado y sin códigos. Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import { correoPedido } from "./correo-cliente.js";
import { buildMessage } from "./mailer.js";

const o = { ref: "VM-2026-000123", created_at: "2026-11-25T11:24:00.000Z", delivery_date: "2026-11-27", address: "Cl Ejemplo 1", note: "Dejar <b>aquí</b> & luego", re: false,
  items: [{ name: "AGUA <X> 500ML", unit: "caja", boxes: 2, qty: 48, units: 48, price: 0.2, discount: 0, vat_rate: 10, code: "9999" }, { name: "CERVEZA LATA", unit: "ud", qty: 1, units: 1, price: 9.5, discount: 0, vat_rate: 21 }] };

test("el correo lleva HTML con cabecera, artículos, total y todo escapado; el texto de respaldo sigue", () => {
  const m = correoPedido(o, { nombre: "Bar <Ejemplo>", telefono: "635 09 80 44", adjunto: true });
  assert.ok(m.html && m.text);
  assert.match(m.html, /¡Pedido recibido!/); assert.match(m.html, /VM-2026-000123/); assert.match(m.html, /Total con IVA/); assert.match(m.html, /2 cajas/); assert.match(m.html, /1 ud</);
  assert.match(m.html, /AGUA &lt;X&gt; 500ML/); assert.match(m.html, /Dejar &lt;b&gt;aquí&lt;\/b&gt; &amp; luego/); assert.match(m.html, /Bar &lt;Ejemplo&gt;/);
  assert.doesNotMatch(m.html, /<b>aquí<\/b>|<X>|9999/); // nada sin escapar y nunca el código del artículo
  assert.match(m.text, /Total con IVA/);
});

test("buildMessage con html: multipart/alternative (texto + HTML), también con PDF adjunto", () => {
  const sin = buildMessage({ from: "a@x.es", to: "b@y.es", subject: "S", text: "Hola", html: "<p>Hola</p>" });
  assert.match(sin, /multipart\/alternative/); assert.match(sin, /text\/plain/); assert.match(sin, /text\/html/);
  const con = buildMessage({ from: "a@x.es", to: "b@y.es", subject: "S", text: "Hola", html: "<p>Hola</p>", attachments: [{ filename: "p.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1") }] });
  assert.match(con, /multipart\/mixed/); assert.match(con, /multipart\/alternative/); assert.match(con, /application\/pdf/);
  assert.doesNotMatch(buildMessage({ from: "a@x.es", to: "b@y.es", subject: "S", text: "Hola" }), /multipart|text\/html/); // sin html, igual que siempre
});
