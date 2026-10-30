import test from "node:test";
import assert from "node:assert/strict";
import { numberWords, extractDelivery, explainDelivery, deliveryRows, isYes, isNo, isDone, parseRemove, parseChangeQty, lev } from "./nlu.js";

const JUE = "2026-10-29T07:00:00Z"; // jueves 29 de octubre, 08:00 en Madrid (antes de las 10)
const JUE_TARDE = "2026-10-29T09:30:00Z"; // 10:30: ya no se puede «hoy»

test("números en palabras", () => {
  assert.equal(numberWords("Ponme media docena de huevos"), "ponme 6 huevos");
  assert.equal(numberWords("una docena de agua"), "12 agua");
  assert.equal(numberWords("dos docenas de cerveza"), "24 cerveza");
  assert.equal(numberWords("docena y media de huevos"), "18 huevos");
  assert.equal(numberWords("treinta y cinco cervezas"), "35 cervezas");
  assert.equal(numberWords("cuarenta y dos aguas"), "42 aguas");
  assert.equal(numberWords("un par de cervezas"), "2 cervezas");
  assert.equal(numberWords("12x cerveza y cola x6"), "12 cerveza y cola 6");
});

test("día de entrega dicho con naturalidad", () => {
  const d = (t, now = JUE) => extractDelivery(t, now);
  assert.equal(d("6 cervezas para mañana").date, "2026-10-30");
  assert.equal(d("6 cervezas para mañana").rest, "6 cervezas");
  assert.equal(d("lo quiero hoy").date, "2026-10-29");
  assert.equal(d("pasado mañana").date, "2026-10-31");
  assert.equal(d("el lunes").date, "2026-11-02");
  assert.equal(d("para el viernes").date, "2026-10-30");
  assert.equal(d("el lunes que viene").date, "2026-11-02");
  assert.equal(d("el jueves").date, "2026-11-05"); // hoy es jueves: el siguiente
  assert.equal(d("el 5 de noviembre").date, "2026-11-05");
  assert.equal(d("el viernes 20 de noviembre").date, "2026-11-20");
  assert.equal(d("para el 3 de febrero").date, "2027-02-03"); // ya pasó este año: el siguiente
  assert.equal(d("5/11").date, "2026-11-05");
  assert.equal(d("el 05-11-2026").date, "2026-11-05");
  assert.equal(d("dentro de 4 días").date, "2026-11-02");
  assert.equal(d("el día 3").date, "2026-11-03");
  assert.equal(d("cuanto antes").date, "2026-10-29"); // antes de las 10: hoy
  assert.equal(d("cuanto antes", JUE_TARDE).date, "2026-10-30"); // después: mañana
  assert.equal(d("para la semana que viene").ambiguous, true);
  assert.equal(d("6 cervezas y 2 aguas"), null);
});

test("explicación cuando ese día no se puede", () => {
  assert.equal(explainDelivery("2026-11-02", JUE), null);
  assert.match(explainDelivery("2026-10-29", JUE_TARDE), /antes de las 10:00.*viernes 30 de octubre/);
  assert.match(explainDelivery("2026-10-31", JUE), /sábados y domingos/);
  assert.match(explainDelivery("2026-10-20", JUE), /ya ha pasado/);
  assert.match(explainDelivery("2027-06-01", JUE), /90 días/);
});

test("filas de la lista de días", () => {
  const rows = deliveryRows(JUE);
  assert.deepEqual(rows.map((r) => r.id), ["d:2026-10-29", "d:2026-10-30", "d:2026-11-02", "d:2026-11-03", "d:2026-11-04", "d:otro"]);
  assert.ok(rows.every((r) => r.title.length <= 24));
});

test("afirmaciones, negaciones y «eso es todo»", () => {
  for (const t of ["sí", "Vale", "ok, confirmo", "Perfecto!", "adelante", "de acuerdo"]) assert.equal(isYes(t), true, t);
  for (const t of ["sí, y 6 cervezas más", "no", "6 cervezas"]) assert.equal(isYes(t), false, t);
  for (const t of ["no", "mejor no", "cancela", "no gracias"]) assert.equal(isNo(t), true, t);
  for (const t of ["no, 6 cervezas", "nocilla"]) assert.equal(isNo(t), false, t);
  for (const t of ["eso es todo", "nada más", "ya está", "listo", "finalizar", "ya"]) assert.equal(isDone(t), true, t);
  assert.equal(isDone("6 cervezas"), false);
});

test("quitar y cambiar cantidades", () => {
  assert.deepEqual(parseRemove("quita las cervezas"), { query: "las cervezas" });
  assert.deepEqual(parseRemove("Quítame el agua"), { query: "el agua" });
  assert.equal(parseRemove("6 cervezas"), null);
  assert.deepEqual(parseChangeQty("cambia el agua a 10"), { query: "el agua", qty: 10 });
  assert.deepEqual(parseChangeQty("déjame las cervezas en 3 cajas"), { query: "las cervezas", qty: 3, unit: "caja" });
  assert.deepEqual(parseChangeQty("pon el vino a veinte"), { query: "el vino", qty: 20 });
  assert.equal(parseChangeQty("ponme 6 cervezas"), null);
});

test("distancia de edición", () => {
  assert.equal(lev("cerveza", "cerbeza"), 1); // una letra cambiada: se perdona la errata
  assert.equal(lev("cerveza", "cervesa"), 1);
  assert.equal(lev("agua", "aguaa"), 1);
});
