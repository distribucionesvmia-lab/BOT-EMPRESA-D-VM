import test from "node:test";
import assert from "node:assert/strict";
import { deliveryOptions, deliveryInfo, longDate, madridDay } from "./delivery.js";
import { webOrderFromBody } from "./weborder.js";

test("opciones de entrega: hoy, mañana y los días laborables siguientes, con fecha (sin fines de semana)", () => {
  // jueves 29 de octubre de 2026
  const o = deliveryOptions("2026-10-29T09:00:00Z");
  assert.deepEqual(o.map((x) => [x.kind, x.label, x.date]), [
    ["hoy", "Hoy", "2026-10-29"], ["manana", "Mañana", "2026-10-30"],
    ["dia", "Lunes 2 de noviembre", "2026-11-02"], ["dia", "Martes 3 de noviembre", "2026-11-03"], ["dia", "Miércoles 4 de noviembre", "2026-11-04"], ["dia", "Jueves 5 de noviembre", "2026-11-05"], ["dia", "Viernes 6 de noviembre", "2026-11-06"],
  ]);
  assert.equal(o[0].detail, "jueves 29 de octubre");
  assert.equal(o[1].detail, "viernes 30 de octubre");
  // viernes: mañana es sábado, no se ofrece
  assert.deepEqual(deliveryOptions("2026-10-30T09:00:00Z").map((x) => x.kind), ["hoy", "dia", "dia", "dia", "dia", "dia"]);
  // sábado: no hay «hoy» ni «mañana» (domingo)
  assert.equal(deliveryOptions("2026-10-31T09:00:00Z")[0].label, "Lunes 2 de noviembre");
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

test("el pedido web solo admite uno de los días ofrecidos", () => {
  const cat = [{ id: 1, name: "AGUA", price: 1 }], c = { id: "C", name: "Bar", address: "x" };
  const body = (delivery) => ({ lines: [{ id: 1, qty: 2 }], delivery });
  const at = "2026-10-29T09:00:00Z";
  const ok = webOrderFromBody(body("2026-11-02"), c, { key: "k", phone: "1", at }, cat);
  assert.equal(ok.order.delivery, "2026-11-02");
  assert.match(webOrderFromBody(body("2026-11-07"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/); // sábado: no ofrecido
  assert.match(webOrderFromBody(body("2020-01-01"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/);
  assert.equal(webOrderFromBody({ lines: [{ id: 1, qty: 1 }] }, c, { key: "k", phone: "1", at }, cat).order.delivery, null); // sin día: se admite
});
