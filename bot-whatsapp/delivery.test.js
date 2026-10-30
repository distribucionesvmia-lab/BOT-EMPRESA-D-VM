import test from "node:test";
import assert from "node:assert/strict";
import { deliveryOptions, deliveryInfo, deliveryAllowed, longDate, madridDay } from "./delivery.js";
import { webOrderFromBody } from "./weborder.js";

test("opciones de entrega: hoy, mañana y los días laborables siguientes, con fecha (sin fines de semana)", () => {
  // jueves 29 de octubre de 2026
  const o = deliveryOptions("2026-10-29T09:00:00Z");
  assert.deepEqual(o.map((x) => [x.kind, x.label, x.date]), [
    ["hoy", "Hoy", "2026-10-29"], ["manana", "Mañana", "2026-10-30"],
    ["dia", "Lunes 2 de noviembre", "2026-11-02"], ["dia", "Martes 3 de noviembre", "2026-11-03"], ["dia", "Miércoles 4 de noviembre", "2026-11-04"],
  ]); // siempre 5 días de servicio
  assert.equal(o[0].detail, "jueves 29 de octubre");
  assert.equal(o[1].detail, "viernes 30 de octubre");
  // viernes: «mañana» es sábado, no se ofrece; siguen 5 días de servicio
  assert.deepEqual(deliveryOptions("2026-10-30T09:00:00Z").map((x) => x.label), ["Hoy", "Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre"]);
  // sábado: sin «hoy» ni «mañana»; de lunes a viernes
  assert.deepEqual(deliveryOptions("2026-10-31T09:00:00Z").map((x) => x.label), ["Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre", "Viernes 6 de noviembre"]);
  // siempre 5 y nunca fin de semana, ningún día del año
  for (let d = 0; d < 366; d++) {
    const o = deliveryOptions(new Date(Date.UTC(2026, 0, 1 + d, 12)).toISOString());
    assert.equal(o.length, 5);
    assert.ok(o.every((x) => ![0, 6].includes(new Date(x.date + "T12:00:00Z").getUTCDay())));
  }
});

test("la fecha es la de Madrid, no la UTC", () => {
  assert.equal(madridDay("2026-10-29T23:30:00Z"), "2026-10-30"); // ya es el día siguiente en Madrid (CET = UTC+1 desde el 25/10... y UTC+2 antes)
  assert.equal(longDate("2026-11-02"), "lunes 2 de noviembre");
});

test("deliveryInfo: rojo si es hoy, amarillo si es mañana, verde si pasa de 24 horas; texto en mayúsculas con la fecha", () => {
  const at = "2026-10-29T09:00:00Z";
  assert.deepEqual(deliveryInfo("2026-10-29", at), { texto: "ENTREGA: HOY, JUEVES 29 DE OCTUBRE", nivel: "hoy", color: "rojo", date: "2026-10-29" });
  assert.deepEqual(deliveryInfo("2026-10-30", at), { texto: "ENTREGA: MAÑANA, VIERNES 30 DE OCTUBRE", nivel: "manana", color: "amarillo", date: "2026-10-30" });
  assert.deepEqual(deliveryInfo("2026-11-02", at), { texto: "ENTREGA: LUNES 2 DE NOVIEMBRE", nivel: "dia", color: "verde", date: "2026-11-02" });
  assert.equal(deliveryInfo(null, at), null);
  assert.equal(deliveryInfo("mañana", at), null);
});

test("el pedido web admite los días ofrecidos y cualquier día del calendario, pero no pasados ni inválidos", () => {
  const cat = [{ id: 1, name: "AGUA", price: 1 }], c = { id: "C", name: "Bar", address: "x" };
  const body = (delivery) => ({ lines: [{ id: 1, qty: 2 }], delivery });
  const at = "2026-10-29T09:00:00Z";
  const ok = webOrderFromBody(body("2026-11-02"), c, { key: "k", phone: "1", at }, cat);
  assert.equal(ok.order.delivery, "2026-11-02");
  assert.equal(webOrderFromBody(body("2026-12-15"), c, { key: "k", phone: "1", at }, cat).order.delivery, "2026-12-15"); // «otro día» del calendario
  assert.match(webOrderFromBody(body("2020-01-01"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/); // pasado
  assert.match(webOrderFromBody(body("2027-06-01"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/); // demasiado lejos
  assert.equal(webOrderFromBody({ lines: [{ id: 1, qty: 1 }] }, c, { key: "k", phone: "1", at }, cat).order.delivery, null); // sin día: se admite
});

test("deliveryAllowed: de hoy a 90 días, fechas reales", () => {
  const at = "2026-10-29T09:00:00Z";
  assert.equal(deliveryAllowed("2026-10-29", at), true);
  assert.equal(deliveryAllowed("2026-10-28", at), false);
  assert.equal(deliveryAllowed("2027-01-27", at), true); // +90
  assert.equal(deliveryAllowed("2027-01-28", at), false);
  assert.equal(deliveryAllowed("2026-11-31", at), false); // no existe
  assert.equal(deliveryAllowed("mañana", at), false);
  assert.equal(deliveryAllowed(undefined, at), false);
});
