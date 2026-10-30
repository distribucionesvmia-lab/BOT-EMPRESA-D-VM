import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, newSession, setCatalog, setAskDelivery } from "./bot.js";

// El reloj se fija: jueves 29 de octubre de 2026, 08:00 en Madrid (antes de las 10:00)
const NOW = "2026-10-29T07:00:00Z", TARDE = "2026-10-29T09:30:00Z";
setAskDelivery(true);
setCatalog([
  { id: "A1", name: "AGUA MINERAL 1,5 L", price: 1, unitsPerBox: 6 },
  { id: "C1", name: "CERVEZA RUBIA LATA 33 CL", price: 0.6 },
  { id: "V1", name: "VINO TINTO CRIANZA 75 CL", price: 5 },
  { id: "H1", name: "HUEVOS DOCENA", price: 3 },
]);
const cliente = { id: "9001", name: "BAR UNO", address: "Calle Uno 1", phone: "600000001", municipio: "47085", orders: [{ doc: "A", date: "2026-10-20", lines: [{ productId: "C1", qty: 24 }, { productId: "A1", qty: 12 }] }] };
const hablar = (...frases) => {
  let r = { session: newSession(cliente, null, {}) };
  const out = [];
  for (const f of frases) { r = handleMessage(r.session, f, { now: r.now ?? NOW }); out.push(r); }
  return out;
};
const ultimo = (...f) => hablar(...f).at(-1);
const lineas = (r) => (r.session.cart ?? []).map((i) => `${i.qty}${i.unit === "caja" ? "c" : ""}×${i.id}`).join(",");

test("frase normal con todo: artículos con números en palabras y día de entrega", () => {
  const r = ultimo("Buenos días, ponme media docena de cerveza y dos cajas de agua para el lunes");
  assert.equal(lineas(r), "6×C1,2c×A1");
  assert.equal(r.session.delivery, "2026-11-02");
  assert.match(r.reply, /Entrega apuntada: \*lunes 2 de noviembre\*/);
  assert.ok(!/lunes/i.test(r.session.cart.map((i) => i.name).join(""))); // «lunes» no se toma por un artículo
});

test("«eso es todo» → resumen con el día → «vale» envía el pedido con la fecha, sin volver a preguntar", () => {
  const rs = hablar("ponme 6 cervezas para mañana", "eso es todo", "vale");
  assert.match(rs[1].reply, /Revisa tu pedido/);
  assert.match(rs[1].reply, /Entrega: \*viernes 30 de octubre\*/);
  const fin = rs[2];
  assert.ok(fin.order, "se envía el pedido");
  assert.equal(fin.order.delivery, "2026-10-30");
  assert.deepEqual(fin.order.items.map((i) => [i.id, i.qty]), [["C1", 6]]);
  assert.match(fin.reply, /Pedido recibido.*viernes 30 de octubre/s);
});

test("sin decir el día: al confirmar pregunta «¿cuándo quieres recibirlo?» con lista; se puede elegir o escribirlo", () => {
  const rs = hablar("3 cervezas", "listo", "sí");
  assert.equal(rs[2].session.state, "delivery");
  assert.match(rs[2].reply, /Cuándo quieres recibirlo/);
  assert.equal(rs[2].ui.type, "list");
  assert.deepEqual(rs[2].ui.rows.map((r) => r.id), ["d:2026-10-29", "d:2026-10-30", "d:2026-11-02", "d:2026-11-03", "d:2026-11-04", "d:otro"]);
  // eligiendo de la lista
  let r = handleMessage(rs[2].session, "d:2026-11-03", { now: NOW });
  assert.equal(r.order.delivery, "2026-11-03");
  // escribiéndolo
  r = handleMessage(rs[2].session, "pues mejor el martes por favor", { now: NOW });
  assert.equal(r.order.delivery, "2026-11-03");
  // un día que no se sirve: se explica y se vuelve a preguntar (sin enviar nada)
  r = handleMessage(rs[2].session, "pues mejor pasado mañana", { now: NOW }); // sábado 31
  assert.equal(r.order, undefined);
  assert.match(r.reply, /sábados y domingos/);
  assert.equal(r.session.state, "delivery");
  // algo que no es un día: lo dice y vuelve a enseñar la lista
  r = handleMessage(rs[2].session, "no sé", { now: NOW });
  assert.match(r.reply, /No he entendido el día/);
  assert.equal(r.ui.type, "list");
});

test("«hoy» solo antes de las 10:00: después se avisa y se propone mañana", () => {
  let r = handleMessage(newSession(cliente, null, {}), "ponme 6 cervezas para hoy", { now: TARDE });
  assert.equal(r.session.delivery, null);
  assert.match(r.reply, /antes de las 10:00.*viernes 30 de octubre/);
  // antes de las 10 sí
  r = handleMessage(newSession(cliente, null, {}), "ponme 6 cervezas para hoy", { now: NOW });
  assert.equal(r.session.delivery, "2026-10-29");
  // la lista de días ya no incluye «hoy» después de las 10
  const rs = [];
  let s = newSession(cliente, null, {});
  for (const f of ["6 cervezas", "listo", "ok"]) { const x = handleMessage(s, f, { now: TARDE }); rs.push(x); s = x.session; }
  assert.equal(rs[2].ui.rows[0].id, "d:2026-10-30");
});

test("fin de semana: se explica y se ofrece el siguiente día de servicio", () => {
  const r = handleMessage(newSession(cliente, null, {}), "6 cervezas para el sábado", { now: NOW });
  assert.equal(r.session.delivery, null);
  assert.match(r.reply, /sábados y domingos/);
  assert.equal(r.session.cart.length, 1); // los artículos sí se anotan
});

test("la semana que viene (sin concretar) pregunta qué día", () => {
  const r = handleMessage(newSession(cliente, null, {}), "6 cervezas para la semana que viene", { now: NOW });
  assert.match(r.reply, /Qué \*día\* de la semana que viene/);
  assert.equal(r.session.cart.length, 1);
});

test("quitar y cambiar con frases normales", () => {
  let rs = hablar("6 cervezas y 2 cajas de agua", "cambia las cervezas a 10", "quita el agua");
  assert.match(rs[1].reply, /Cambiado/);
  assert.equal(lineas(rs[1]), "10×C1,2c×A1");
  assert.match(rs[2].reply, /Quitado: AGUA/);
  assert.equal(lineas(rs[2]), "10×C1");
  rs = hablar("6 cervezas", "quita los huevos");
  assert.match(rs[1].reply, /No encuentro ese artículo/);
  rs = hablar("6 cervezas", "quita las cervezas");
  assert.match(rs[1].reply, /vacío/);
  // también desde la pantalla de confirmar
  rs = hablar("6 cervezas y 4 vinos", "listo", "quita el vino");
  assert.match(rs[2].reply, /Revisa tu pedido/);
  assert.ok(!/VINO/.test(rs[2].reply.split("Revisa tu pedido")[1]));
});

test("erratas y frases con relleno", () => {
  assert.equal(lineas(ultimo("hola buenas, quería pedirte 6 cerbeza y un par de vinos por favor")), "6×C1,2×V1");
  assert.equal(lineas(ultimo("necesito treinta y cinco cervezas")), "35×C1");
  assert.equal(lineas(ultimo("apúntame una docena de huevos")), "12×H1");
  assert.equal(lineas(ultimo("12x cerveza")), "12×C1");
});

test("«lo de siempre para el viernes» repite el último pedido con el día", () => {
  const r = ultimo("lo de siempre para el viernes");
  assert.match(r.reply, /Revisa tu pedido/);
  assert.equal(r.session.delivery, "2026-10-30");
  assert.match(r.reply, /Entrega: \*viernes 30 de octubre\*/);
});

test("cambiar el día desde la pantalla de confirmar, cancelar con «no», y que «no» con más texto no cancele", () => {
  let rs = hablar("6 cervezas para el lunes", "eso es todo", "mejor el martes");
  assert.equal(rs[2].session.delivery, "2026-11-03");
  assert.match(rs[2].reply, /martes 3 de noviembre/);
  assert.equal(rs[2].session.state, "confirm");
  rs = hablar("6 cervezas", "eso es todo", "no");
  assert.match(rs[2].reply, /cancelado/);
  rs = hablar("6 cervezas", "eso es todo", "no, mejor 10 cervezas");
  assert.notEqual(rs[2].session.state, "menu");
  assert.equal(lineas(rs[2]), "10×C1");
});

test("cliente sin identificar: texto libre, «sí» y día de entrega", () => {
  let s = newSession(null, null, {}), r;
  const decir = (t) => { r = handleMessage(s, t, { now: NOW }); s = r.session; return r; };
  decir("2 aguas y una cerveza para el lunes");
  assert.equal(s.delivery, "2026-11-02");
  decir("sí");
  assert.match(r.reply, /nombre/);
  decir("Ana");
  decir("recoger");
  decir("vale");
  assert.equal(r.order.delivery, "2026-11-02");
  assert.equal(r.order.name, "Ana");
});

test("los clientes de otro municipio nunca ven «hoy»: ni en la lista, ni diciéndolo, ni con «cuanto antes»", () => {
  const otro = { ...cliente, id: "9002", name: "BAR DOS", municipio: "47186" };
  // lista de días
  let s = newSession(otro, null, {}), rs = [];
  for (const f of ["3 cervezas", "listo", "sí"]) { const x = handleMessage(s, f, { now: NOW }); rs.push(x); s = x.session; }
  assert.equal(rs[2].ui.rows[0].id, "d:2026-10-30");
  assert.ok(!rs[2].ui.rows.some((r) => r.id === "d:2026-10-29" || /^Hoy/.test(r.title)));
  // pedirlo escribiendo «hoy»
  let r = handleMessage(newSession(otro, null, {}), "3 cervezas para hoy", { now: NOW });
  assert.equal(r.session.delivery, null);
  assert.match(r.reply, /Para tu zona no hay entrega en el mismo día/);
  r = handleMessage(rs[2].session, "hoy", { now: NOW });
  assert.equal(r.order, undefined);
  assert.match(r.reply, /Para tu zona no hay entrega en el mismo día/);
  // «cuanto antes» → mañana
  r = handleMessage(newSession(otro, null, {}), "3 cervezas cuanto antes", { now: NOW });
  assert.equal(r.session.delivery, "2026-10-30");
  // sin cliente identificado tampoco
  r = handleMessage(newSession(null, null, {}), "3 cervezas para hoy", { now: NOW });
  assert.equal(r.session.delivery, null);
  // el de Medina sí
  r = handleMessage(newSession(cliente, null, {}), "3 cervezas para hoy", { now: NOW });
  assert.equal(r.session.delivery, "2026-10-29");
});
