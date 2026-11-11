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
  assert.match(r.reply, /Total con IVA: 3,39/);
  assert.match(r.reply, /base 2,80 € \+ IVA 0,59 €/);
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
  assert.match(r.reply, /Total con IVA: 5,32/);
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
  assert.deepEqual(r.ui.rows.map((x) => x.id), ["p:1", "p:2", "p:3", "p:4"]); // primero lo ya pedido (el agua, comprada 2 veces, va primero) y después el resto del catálogo
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
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["c:ok", "c:more", "c:cancel"]);
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

test("cliente conocido: «repetir» no confirma ni apunta nada solo: explica el botón «Repetir y revisar» (el flujo antiguo con listas ya no existe)", () => {
  for (const t of ["repetir", "repite el último pedido", "lo de siempre"]) {
    const r = say(newSession(bar, "/catalogo"), t);
    assert.match(r.reply, /Repetir y revisar/, t);
    assert.equal(r.session.cart.length, 0, t);
    assert.notEqual(r.session.state, "confirm", t);
  }
  for (const t of ["h:repeat", "h:repeat1"]) assert.match(say(newSession(bar, "/catalogo"), t).reply, /No estoy diseñado/, t); // los botones antiguos ya no existen
});

test("«Histórico» enseña los pedidos con sus tablas y solo ofrece hacer un pedido (sin «repetir»)", () => {
  const h = say(newSession(bar, "/catalogo"), "histórico");
  assert.ok(h.cards.length >= 2); // un pedido por tabla
  assert.deepEqual(h.ui.buttons.map((b) => b.id), ["h:open"]);
  assert.doesNotMatch(JSON.stringify(h.ui) + h.reply, /Repetir|h:repeat|r:/);
});

test("cliente conocido: puede escribir lo que quiere y se suma al pedido", () => {
  let r = say(newSession(bar), "10 aguas");
  assert.match(r.reply, /10 × Agua/);
  r = say(r.session, "act:done");
  assert.equal(r.session.state, "confirm");
  assert.match(r.reply, /Plaza Mayor 3/);
});

test("cliente conocido: 'Cambiar' vuelve al pedido y vaciar lo deja a cero", () => {
  let r = say(newSession(bar), "24 aguas y 12 cervezas");
  r = say(r.session, "act:done");
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

// ---- Atajos del chat: abrir el catálogo, último pedido e histórico ----
test("«hacer pedido» y frases parecidas abren el catálogo (con enlace) o la lista (sin enlace)", () => {
  for (const t of ["hacer pedido", "Quiero hacer un pedido", "nuevo pedido", "abrir catálogo", "quiero pedir", "hola quiero hacer un pedido nuevo"]) {
    const r = say(newSession(bar, "/catalogo"), t);
    assert.equal(r.ui.type, "link", t);
    assert.equal(r.ui.url, "/catalogo");
    assert.equal(r.ui.open, true, t);
  }
  assert.equal(say(newSession(bar), "hacer pedido").ui.type, "list"); // sin enlace: la lista del chat
});

test("«hacer el pedido» con artículos en el carrito sigue siendo finalizar, no abrir el catálogo", () => {
  let r = say(newSession(bar, "/catalogo"), "2 aguas");
  r = say(r.session, "hacer el pedido");
  assert.notEqual(r.ui?.type, "link");
});

test("«último pedido» enseña el último pedido con botones; no lo repite solo", () => {
  for (const t of ["último pedido", "mi ultimo pedido", "qué pedí la última vez", "pedido anterior"]) {
    const r = say(newSession(bar, "/catalogo"), t);
    assert.match(r.reply, /Tu último pedido\* \(01\/10\/2026\)/, t);
    assert.match(r.reply, /24 uds/);
    assert.deepEqual(r.ui.buttons.map((b) => b.id), ["h:hist", "h:open"]);
    assert.equal(r.session.state, "menu");
  }
});

test("«histórico» enseña los pedidos anteriores con lo que pidió en cada uno", () => {
  for (const t of ["histórico", "mis pedidos", "pedidos anteriores", "qué he pedido"]) {
    const r = say(newSession(bar, "/catalogo"), t);
    assert.match(r.reply, /Tu histórico de pedidos/, t);
    assert.match(r.reply, /Pedido del 01\/10\/2026/);
    assert.match(r.reply, /Pedido del 01\/09\/2026/);
  }
});

test("los botones del último pedido: «Hacer pedido» abre el catálogo y «Ver histórico» el histórico", () => {
  let r = say(newSession(bar, "/catalogo"), "último pedido");
  assert.equal(say(r.session, "h:open").ui.open, true);
  assert.match(say(r.session, "h:hist").reply, /histórico/i);
});

test("un cliente sin pedidos anteriores: último pedido e histórico lo dicen y ofrecen hacer uno", () => {
  const nuevo = { id: "C-9", name: "Bar Nuevo", address: "x", orders: [] };
  for (const t of ["último pedido", "histórico"]) {
    const r = say(newSession(nuevo, "/catalogo"), t);
    assert.match(r.reply, /Todavía no tengo pedidos/);
    assert.equal(r.ui.type, "link");
  }
});

test("«último pedido» e «histórico» llevan además una tabla (cantidad, producto, importe, total) para la web", () => {
  const r = say(newSession(bar, "/catalogo"), "último pedido");
  assert.equal(r.cards.length, 1);
  const t = r.cards[0];
  assert.equal(t.titulo, "Pedido del 01/10/2026");
  assert.deepEqual(t.filas.map((f) => [f.cant, f.nombre, f.importe]), [["24 uds", "Agua", 24], ["12 uds", "Cerveza Estrella Galicia", 9.6]]);
  assert.equal(t.total, 40.66); // 33,60 de base + 21 % de IVA
  assert.match(r.reply, /Agua = 24,00/); // el texto sigue siendo el respaldo para WhatsApp
  assert.equal(r.short, "🧾 *Tu último pedido*");
  const h = say(newSession(bar, "/catalogo"), "histórico");
  assert.equal(h.cards.length, 2); // un pedido por tabla
});

test("el saludo explica en puntos lo fácil que es pedir (sin ofrecer «Repetir»)", () => {
  const r = say(newSession(bar, "/catalogo"), "hola");
  assert.match(r.reply, /Hacer tu pedido es muy fácil/);
  assert.match(r.reply, /• Pulsa \*Hacer pedido\*/);
  assert.doesNotMatch(r.reply, /Repetir|¿Lo de siempre/);
  assert.match(r.reply, /• Elige el día de entrega/);
  const nuevo = say(newSession({ id: "C-9", name: "Bar Nuevo", address: "x", orders: [] }, "/catalogo"), "hola");
  assert.doesNotMatch(nuevo.reply, /Repetir/);
});

test("lo que no tiene que ver con pedidos ni con productos recibe una respuesta clara con el botón de hacer pedido (las dudas y recomendaciones las contesta el asistente: ver asistente.test.js)", () => {
  for (const t of ["qué tal", "gracias", "buenas tardes", "quiero hablar", "blablabla"]) {
    const r = say(newSession(bar, "/catalogo"), t);
    assert.equal(r.reply, "No estoy diseñado para responderte a eso. Te puedo ayudar a hacer un pedido rápido.", t);
    assert.equal(r.ui.type, "link");
    assert.equal(r.session.cart.length, 0, t); // y no se apunta nada al pedido
  }
  // sin enlace (otro canal): botón «Hacer pedido» dentro del chat
  assert.deepEqual(say(newSession(bar), "qué tal").ui.buttons.map((b) => b.title), ["Hacer pedido"]);
  // pedir con cantidad sigue funcionando
  const ok = say(newSession(bar, "/catalogo"), "2 aguas");
  assert.match(ok.reply, /Anotado/);
});

test("añadir productos desde la pantalla de confirmar: se abre el catálogo con lo pedido ya dentro (y sin enlace, la lista incluye todo el catálogo)", () => {
  const conLink = newSession(bar, "/catalogo");
  let r = say(conLink, "24 aguas y 12 cervezas");
  r = say(r.session, "act:done");
  assert.ok(r.ui.buttons.some((b) => b.id === "c:more" && /Añadir/.test(b.title)));
  const ids = (r.session.items ?? r.session.cart).map((i) => i.id);
  r = say(r.session, "c:more");
  assert.equal(r.ui.type, "link");
  assert.equal(r.ui.open, true);
  assert.match(r.ui.url, /^\/catalogo#c=/);
  for (const id of ids) assert.ok(r.ui.url.includes(`${id}.`), `falta ${id} en ${r.ui.url}`);
  // sin enlace (chat de WhatsApp): la lista de artículos no se limita al histórico
  r = say(say(say(newSession(bar), "24 aguas y 12 cervezas").session, "act:done").session, "c:more");
  assert.equal(r.ui.type, "list");
  assert.ok(r.ui.rows.some((x) => x.id === "p:3") && r.ui.rows.some((x) => x.id === "p:4"));
});

test("totales para el cliente: llevan IVA (y recargo de equivalencia si lo tiene)", () => {
  const conRe = { ...bar, recargoEquivalencia: true };
  const r = say(newSession(conRe), "2 aguas");
  assert.match(r.reply, /Total con IVA: 2,52/); // 2,00 + 21 % IVA (0,42) + 5,2 % R.E. (0,10)
  assert.match(r.reply, /R\.E\. 0,10/);
});

test("CHAT: al empezar un pedido sale UN aviso «entrega hoy» solo si el cliente es de Medina del Campo, es laborable y son antes de las 10:00 (Madrid)", async () => {
  const { AVISO_HOY } = await import("./delivery.js");
  const medina = { ...bar, city: "MEDINA DEL CAMPO", municipio: "47085" }, otro = { ...bar, city: "TORDESILLAS", municipio: "47186" };
  const abrir = (cliente, iso) => say(newSession(cliente, "/catalogo"), "h:open").reply;
  const antes = handleMessage(newSession(medina, "/catalogo"), "h:open", { now: "2026-11-09T08:30:00Z" }).reply;
  assert.equal((antes.match(new RegExp(AVISO_HOY.replace(/[.]/g, "\\."), "g")) ?? []).length, 1, "un único aviso");
  for (const [cliente, iso] of [[medina, "2026-11-09T09:00:00Z"], [medina, "2026-11-09T10:00:00Z"], [medina, "2026-11-14T08:00:00Z"], [otro, "2026-11-09T08:30:00Z"]]) {
    const r = handleMessage(newSession(cliente, "/catalogo"), "h:open", { now: iso }).reply;
    assert.equal(r.includes("10:00"), false, `sin aviso: ${cliente.city} ${iso}`);
  }
  void abrir;
});
