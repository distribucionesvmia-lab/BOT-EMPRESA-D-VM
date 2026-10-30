import test from "node:test";
import assert from "node:assert/strict";
import { deliveryOptions, deliveryInfo, deliveryAllowed, deliveryMin, deliveryCalendarFrom, longDate, madridDay } from "./delivery.js";
import { webOrderFromBody } from "./weborder.js";

const H = { hoy: true }; // cliente de un municipio con entrega en el día

test("opciones de entrega: hoy, mañana y los días laborables siguientes, con fecha (sin fines de semana)", () => {
  // jueves 29 de octubre de 2026
  const o = deliveryOptions("2026-10-29T07:00:00Z", H); // 08:00 en Madrid: antes de las 10
  assert.deepEqual(o.map((x) => [x.kind, x.label, x.date]), [
    ["hoy", "Hoy", "2026-10-29"], ["manana", "Mañana", "2026-10-30"],
    ["dia", "Lunes 2 de noviembre", "2026-11-02"], ["dia", "Martes 3 de noviembre", "2026-11-03"], ["dia", "Miércoles 4 de noviembre", "2026-11-04"],
  ]); // siempre 5 días de servicio
  assert.equal(o[0].detail, "jueves 29 de octubre");
  assert.equal(o[1].detail, "viernes 30 de octubre");
  // viernes: «mañana» es sábado, no se ofrece; siguen 5 días de servicio
  assert.deepEqual(deliveryOptions("2026-10-30T07:00:00Z", H).map((x) => x.label), ["Hoy", "Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre"]);
  // sábado: sin «hoy» ni «mañana»; de lunes a viernes
  assert.deepEqual(deliveryOptions("2026-10-31T07:00:00Z", H).map((x) => x.label), ["Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre", "Viernes 6 de noviembre"]);
  // siempre 5 y nunca fin de semana, ningún día del año
  for (let d = 0; d < 366; d++) {
    const o = deliveryOptions(new Date(Date.UTC(2026, 0, 1 + d, 12)).toISOString(), H);
    assert.equal(o.length, 5);
    assert.ok(o.every((x) => ![0, 6].includes(new Date(x.date + "T12:00:00Z").getUTCDay())));
  }
});

test("«hoy» solo antes de las 10:00 (hora de Madrid); después, lo más pronto es mañana", () => {
  // jueves 29 de octubre (CET, UTC+1): 08:59 y 09:00 en Madrid
  assert.equal(deliveryMin("2026-10-29T07:59:00Z", H), "2026-10-29");
  assert.equal(deliveryMin("2026-10-29T08:59:00Z", H), "2026-10-29"); // 09:59
  assert.equal(deliveryMin("2026-10-29T09:00:00Z", H), "2026-10-30"); // 10:00
  const tarde = deliveryOptions("2026-10-29T09:00:00Z", H);
  assert.deepEqual(tarde.map((x) => x.label), ["Mañana", "Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre"]); // siguen siendo 5
  assert.equal(deliveryAllowed("2026-10-29", "2026-10-29T08:59:00Z", H), true);
  assert.equal(deliveryAllowed("2026-10-29", "2026-10-29T09:00:00Z", H), false);
  assert.equal(deliveryAllowed("2026-10-30", "2026-10-29T09:00:00Z", H), true);
  // el calendario («otro día») empieza donde acaban los botones: nunca los contradice
  const vie = "2026-10-30T18:00:00Z"; // viernes por la tarde: botones del lunes 2 al viernes 6
  assert.equal(deliveryCalendarFrom(vie, H), "2026-11-09"); // el sábado 7 y el domingo 8 no se sirven
  assert.equal(deliveryAllowed("2026-11-06", vie, H), true); // último botón
  assert.equal(deliveryAllowed("2026-11-07", vie, H), false); // sábado
  assert.equal(deliveryAllowed("2026-11-08", vie, H), false); // domingo
  assert.equal(deliveryAllowed("2026-11-09", vie, H), true); // primer día del calendario
  assert.equal(deliveryAllowed("2026-11-14", vie, H), false); // otro sábado más adelante
  assert.equal(deliveryAllowed("2026-10-31", vie, H), false); // antes de los botones
  // jueves por la mañana: botones jueves 29, viernes 30, lunes 2, martes 3, miércoles 4; el fin de semana de en medio no se puede elegir
  const jue = "2026-10-29T07:00:00Z";
  assert.equal(deliveryCalendarFrom(jue, H), "2026-11-05");
  assert.equal(deliveryAllowed("2026-10-31", jue, H), false);
  assert.equal(deliveryAllowed("2026-11-05", jue, H), true);
  for (let d = 0; d < 366; d++) for (const h of [6, 12]) {
    const now = new Date(Date.UTC(2026, 0, 1 + d, h)).toISOString();
    const o = deliveryOptions(now, H);
    assert.ok(deliveryCalendarFrom(now, H) > o[o.length - 1].date);
    assert.equal(deliveryMin(now, H), o[0].date);
    assert.equal(deliveryAllowed(deliveryCalendarFrom(now, H), now, H), true);
    assert.ok(![0, 6].includes(new Date(deliveryCalendarFrom(now, H) + "T12:00:00Z").getUTCDay()));
  }
  // en horario de verano (UTC+2) el corte sigue siendo a las 10:00 de Madrid
  assert.equal(deliveryMin("2026-07-15T07:59:00Z", H), "2026-07-15");
  assert.equal(deliveryMin("2026-07-15T08:00:00Z", H), "2026-07-16");
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
  const cat = [{ id: 1, name: "AGUA", price: 1 }], c = { id: "C", name: "Bar", address: "x", municipio: "47085" };
  const body = (delivery) => ({ lines: [{ id: 1, qty: 2 }], delivery });
  const at = "2026-10-29T09:00:00Z";
  const ok = webOrderFromBody(body("2026-11-02"), c, { key: "k", phone: "1", at }, cat);
  assert.equal(ok.order.delivery, "2026-11-02");
  assert.equal(webOrderFromBody(body("2026-12-15"), c, { key: "k", phone: "1", at }, cat).order.delivery, "2026-12-15"); // «otro día» del calendario
  assert.match(webOrderFromBody(body("2026-10-29"), c, { key: "k", phone: "1", at }, cat).error, /antes de las 10:00/); // a las 10:00 ya no se puede pedir para hoy
  assert.equal(webOrderFromBody(body("2026-10-29"), c, { key: "k", phone: "1", at: "2026-10-29T07:00:00Z" }, cat).order.delivery, "2026-10-29"); // a las 08:00 sí
  assert.match(webOrderFromBody(body("2020-01-01"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/); // pasado
  assert.match(webOrderFromBody(body("2027-06-01"), c, { key: "k", phone: "1", at }, cat).error, /día de entrega/); // demasiado lejos
  assert.equal(webOrderFromBody({ lines: [{ id: 1, qty: 1 }] }, c, { key: "k", phone: "1", at }, cat).order.delivery, null); // sin día: se admite
});

test("deliveryAllowed: de hoy a 90 días, fechas reales", () => {
  const at = "2026-10-29T09:00:00Z";
  assert.equal(deliveryAllowed("2026-10-30", at, H), true); // a las 10:00 el primer día posible es mañana (botón)
  assert.equal(deliveryAllowed("2026-10-28", at, H), false);
  assert.equal(deliveryAllowed("2027-01-27", at, H), true); // +90
  assert.equal(deliveryAllowed("2027-01-28", at, H), false);
  assert.equal(deliveryAllowed("2026-11-31", at, H), false); // no existe
  assert.equal(deliveryAllowed("mañana", at, H), false);
  assert.equal(deliveryAllowed(undefined, at, H), false);
});

test("«hoy» solo para los clientes del municipio 47085; los demás empiezan en mañana, en botones, calendario y validación", async () => {
  const { puedeHoy } = await import("./delivery.js");
  assert.equal(puedeHoy({ municipio: "47085" }), true);
  assert.equal(puedeHoy({ municipio: " 47085 " }), true);
  assert.equal(puedeHoy({ municipio: "47186" }), false); // otro municipio
  assert.equal(puedeHoy({ municipio: "" }), false);
  assert.equal(puedeHoy({}), false);
  assert.equal(puedeHoy(null), false);
  const antes = "2026-10-29T07:00:00Z"; // 08:00, antes de las 10
  assert.equal(deliveryOptions(antes, { hoy: true })[0].label, "Hoy");
  assert.deepEqual(deliveryOptions(antes).map((o) => o.label), ["Mañana", "Lunes 2 de noviembre", "Martes 3 de noviembre", "Miércoles 4 de noviembre", "Jueves 5 de noviembre"]); // sin «hoy»
  assert.equal(deliveryAllowed("2026-10-29", antes, { hoy: true }), true);
  assert.equal(deliveryAllowed("2026-10-29", antes), false); // ni por el servidor
  assert.equal(deliveryAllowed("2026-10-29", antes, {}), false);
  assert.equal(deliveryMin(antes), "2026-10-30");
  // pedido web: mismo día solo si su municipio lo permite
  const cat = [{ id: 1, name: "AGUA", price: 1 }], body = { lines: [{ id: 1, qty: 2 }], delivery: "2026-10-29" };
  const medina = { id: "C", name: "Bar", address: "x", municipio: "47085" }, otro = { id: "D", name: "Bar", address: "x", municipio: "47186" };
  assert.equal(webOrderFromBody(body, medina, { key: "k", phone: "1", at: antes }, cat).order.delivery, "2026-10-29");
  assert.match(webOrderFromBody(body, otro, { key: "k", phone: "1", at: antes }, cat).error, /Para tu zona no hay entrega en el mismo día/);
  // 365 días del año, a primera hora: sin permiso nunca sale hoy
  for (let d = 0; d < 365; d++) {
    const now = new Date(Date.UTC(2026, 0, 1 + d, 6)).toISOString();
    assert.ok(deliveryOptions(now).every((o) => o.kind !== "hoy"));
    assert.ok(deliveryMin(now) > now.slice(0, 10));
  }
});
