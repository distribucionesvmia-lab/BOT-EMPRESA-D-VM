import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, newSession, parseItems, setAskDelivery } from "./bot.js";

setAskDelivery(false); // estas pruebas son del pedido; la pregunta del día de entrega se prueba en bot.chat.test.js

const say = (s, t) => handleMessage(s, t);

test("interpreta texto libre", () => {
  const q = (t) => parseItems(t).map((i) => `${i.qty}x${i.id}`).join(",");
  assert.equal(q("2 aguas y una cerveza"), "2x1,1x2");
  assert.equal(q("Quiero dos botellas de agua"), "2x1");
  assert.equal(q("3 Estrella Galicia"), "3x2");
  assert.equal(q("una cerveza y 4 aguas"), "1x2,4x1");
  assert.equal(q("algo que no existe"), "");
});

test("cliente nuevo: flujo completo con texto libre", () => {
  let r = say(newSession(), "Hola");
  assert.match(r.reply, /Escribe directamente/);
  assert.equal(r.ui, undefined);
  r = say(r.session, "2 aguas y una cerveza");
  assert.match(r.reply, /Total: 2\.80/);
  r = say(r.session, "1");
  r = say(r.session, "Ana");
  r = say(r.session, "Calle Sol 5");
  r = say(r.session, "1");
  assert.equal(r.order.name, "Ana");
  assert.equal(r.order.text, "2 aguas y una cerveza");
  assert.ok(Math.abs(r.order.total - 2.8) < 1e-9);
  assert.equal(r.order.customerId, null);
  assert.equal(r.session.state, "menu");
});

test("cliente nuevo: texto sin producto reconocido se guarda tal cual", () => {
  let r = say(newSession(), "quiero algo para la fiesta del sábado");
  r = say(r.session, "1");
  r = say(r.session, "Luis");
  r = say(r.session, "recoger");
  r = say(r.session, "1");
  assert.equal(r.order.total, null);
  assert.match(r.order.text, /fiesta/);
});

test("cliente nuevo: se puede añadir más texto antes de continuar", () => {
  let r = say(newSession(), "2 aguas");
  r = say(r.session, "y 3 cervezas");
  assert.match(r.reply, /Total: 4\.40/);
});

// ---- Cliente conocido: cuestionario con lista y botones ----
const bar = {
  id: "C-0001", name: "Bar Alegría", address: "Plaza Mayor 3",
  orders: [
    { doc: "B", date: "2026-10-01", lines: [{ productId: 1, qty: 24 }, { productId: 2, qty: 12 }] },
    { doc: "A", date: "2026-09-01", lines: [{ productId: 1, qty: 20 }] },
  ],
};

test("cliente conocido: saluda por nombre y ofrece la lista de sus artículos", () => {
  const r = say(newSession(bar), "hola");
  assert.match(r.reply, /Bar Alegría/);
  assert.equal(r.ui.type, "list");
  assert.deepEqual(r.ui.rows.map((x) => x.id), ["p:1", "p:2"]); // el agua, comprada 2 veces, va primero
  assert.match(r.ui.rows[0].description, /última vez: 24 uds/);
  assert.ok(r.ui.rows.every((x) => x.title.length <= 24 && x.description.length <= 72));
});

test("cliente conocido: elige artículos, marca unidades con botones o escribiendo, y confirma", () => {
  let r = say(newSession(bar), "hola");
  r = say(r.session, "p:2");
  assert.match(r.reply, /¿Cuántas unidades/);
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["q:12", "q:24", "q:0"]);
  r = say(r.session, "q:12"); // botón "igual que la última vez"
  assert.match(r.reply, /12 × Cerveza/);
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["act:add", "act:done", "act:clear"]);
  r = say(r.session, "act:add");
  assert.equal(r.ui.type, "list");
  r = say(r.session, "p:1");
  r = say(r.session, "6"); // cantidad escrita
  assert.match(r.reply, /6 × Agua/);
  r = say(r.session, "act:done");
  assert.match(r.reply, /Plaza Mayor 3/);
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["c:ok", "c:edit", "c:cancel"]);
  r = say(r.session, "c:ok");
  assert.equal(r.order.customerId, "C-0001");
  assert.deepEqual(r.order.items.map((i) => [i.id, i.qty]), [[2, 12], [1, 6]]);
  assert.ok(Math.abs(r.order.total - (12 * 0.8 + 6)) < 1e-9);
  assert.equal(r.session.state, "menu");
  assert.deepEqual(r.session.cart, []);
});

test("cliente conocido: 0 unidades quita el artículo", () => {
  let r = say(newSession(bar), "p:1");
  r = say(r.session, "q:0");
  assert.equal(r.ui.type, "list");
  assert.match(r.reply, /quitado/);
});

test("cliente conocido: 'repetir' repite el último pedido", () => {
  let r = say(newSession(bar), "repetir");
  assert.equal(r.session.state, "confirm");
  assert.match(r.reply, /24 × Agua/);
  r = say(r.session, "c:ok");
  assert.deepEqual(r.order.items.map((i) => i.qty), [24, 12]);
});

test("cliente conocido: puede escribir lo que quiere y se suma al pedido", () => {
  let r = say(newSession(bar), "10 aguas");
  assert.match(r.reply, /10 × Agua/);
  r = say(r.session, "act:done");
  assert.equal(r.session.state, "confirm");
  assert.match(r.reply, /Plaza Mayor 3/);
});

test("cliente conocido: 'Cambiar' vuelve al pedido y vaciar lo deja a cero", () => {
  let r = say(newSession(bar), "repetir");
  r = say(r.session, "c:edit");
  assert.equal(r.session.state, "cart");
  assert.match(r.reply, /24 × Agua/);
  r = say(r.session, "act:clear");
  assert.deepEqual(r.session.cart, []);
  r = say(r.session, "act:done");
  assert.match(r.reply, /Aún no has añadido nada/);
});

test("persona genera handoff y cancelar reinicia", () => {
  assert.equal(say(newSession(), "asesor").handoff, true);
  assert.equal(say(newSession(), "3").handoff, true);
  const r = say({ ...newSession(), state: "confirm" }, "cancelar");
  assert.equal(r.session.state, "menu");
});
