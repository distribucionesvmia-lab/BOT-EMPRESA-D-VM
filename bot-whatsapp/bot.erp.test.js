// Prueba el bot con un catálogo con nombres reales de ERP y un cliente con historial de pedidos
import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, newSession, parseItems, setCatalog, setAskDelivery } from "./bot.js";

setAskDelivery(false); // estas pruebas son del pedido; la pregunta del día de entrega se prueba en bot.chat.test.js

const catalogo = [
  { id: "19500", name: "CERVEZA MAHOU 5* LATA PACK (12x33cl)", price: 5.95 },
  { id: "19530", name: "CERVEZA MAHOU CLASICA Lat.PACK(12x33cl)", price: 5.1 },
  { id: "19700", name: "CERVEZA AMSTEL RADLER lata 33cl(1CJx24)", price: 0.49 },
  { id: "19800", name: "COCA-COLA ZERO Lata 33 CL PACK.(1X12)", price: 7.79 },
  { id: "19802", name: "COCA-COLA NORMAL Lata 33 CL.PACK.(1X12)", price: 7.79 },
  { id: "10016", name: "BORNOS VERDEJO 75 CL (CAJA 12 Unid)", price: 4.99 },
  { id: "110036", name: "PASCUAL R6 LECHE DESNAT.TAP1 Litro Brik", price: 0.8 },
];
// Artículos extra para probar la paginación de la lista (WhatsApp admite 10 filas)
for (let i = 1; i <= 8; i++) catalogo.push({ id: `9${i}`, name: `ARTICULO DE PRUEBA NUMERO ${i}`, price: 1 });
setCatalog(catalogo);

const cliente = {
  id: "5900", name: "Bar Alegría", address: "Plaza Mayor 3",
  orders: [
    { doc: "B", date: "2026-10-25", lines: [{ productId: "10016", qty: 3 }] },
    { doc: "A", date: "2026-08-31", lines: [{ productId: "19800", qty: 2 }, { productId: "19530", qty: 12 }, { productId: "110036", qty: 6 }] },
  ],
};

const q = (t, c = null) => parseItems(t, c).map((i) => `${i.qty}x${i.id}${i.unsure ? "?" : ""}`).join(",");

test("entiende nombres de producto reales", () => {
  assert.equal(q("2 cajas de coca cola zero"), "2x19800");
  assert.equal(q("6 verdejo"), "6x10016");
  assert.equal(q("una leche desnatada"), "1x110036");
  assert.equal(q("24 amstel radler y 2 coca cola normal"), "24x19700,2x19802");
});

test("no confunde el formato 75 cl con la cantidad", () => {
  assert.equal(q("verdejo 75 cl 6"), "6x10016");
});

test("si hay dudas lo marca, y prioriza lo que el cliente ya compró", () => {
  assert.match(q("2 mahou"), /^2x195\d\d\?$/); // hay varias Mahou: se marca como dudoso
  assert.equal(q("2 mahou", cliente), "2x19530"); // ya compró la clásica: no hay duda
});

test("la lista del cliente se limita a 10 filas y pagina", () => {
  const grande = {
    ...cliente,
    orders: [{ doc: "C", date: "2026-10-01", lines: catalogo.map((p) => ({ productId: p.id, qty: 1 })) }],
  };
  let r = handleMessage(newSession(grande), "hola");
  assert.equal(r.ui.rows.length, 10);
  assert.equal(r.ui.rows.at(-1).id, "more:1");
  assert.ok(r.ui.rows.every((x) => x.title.length <= 24 && x.description.length <= 72));
  r = handleMessage(r.session, "more:1");
  assert.equal(r.ui.rows.length, 6 + 0); // 15 artículos en total: 9 + 6
  assert.ok(r.ui.rows.every((x) => x.id.startsWith("p:")));
});

test("cliente con historial: elige de la lista y se graba con código de cliente y artículo", () => {
  let r = handleMessage(newSession(cliente), "hola");
  assert.match(r.reply, /Bar Alegría/);
  r = handleMessage(r.session, "p:19800");
  assert.match(r.reply, /última vez: 2 uds/);
  r = handleMessage(r.session, "q:4");
  r = handleMessage(r.session, "act:done");
  assert.match(r.reply, /4 × COCA-COLA ZERO/);
  r = handleMessage(r.session, "c:ok");
  assert.equal(r.order.customerId, "5900");
  assert.deepEqual(r.order.items, [{ id: "19800", name: "COCA-COLA ZERO Lata 33 CL PACK.(1X12)", price: 7.79, qty: 4, unit: "ud" }]);
  assert.equal(r.order.review, false);
});

test("pedido con duda queda marcado para revisión", () => {
  let r = handleMessage(newSession(), "2 mahou");
  r = handleMessage(r.session, "1");
  r = handleMessage(r.session, "Luis");
  r = handleMessage(r.session, "recoger");
  r = handleMessage(r.session, "1");
  assert.equal(r.order.review, true);
});

// ---- Cajas y unidades, observaciones ----
const catalogoCajas = [
  { id: "A1", name: "AGUA GAS LIMON VIDRIO 250", price: 3.46, unitsPerBox: 6 },
  { id: "J1", name: "JAMON SERRANO PIEZA", price: 90 },
  { id: "J2", name: "JAMON IBERICO PIEZA", price: 150 },
];
const conCajas = () => {
  setCatalog(catalogoCajas);
  return { id: "7", name: "Bar Prueba", address: "Calle 1", orders: [{ doc: "X", date: "2026-10-01", lines: [{ productId: "A1", qty: 6 }, { productId: "J1", qty: 1 }, { productId: "J2", qty: 1 }] }] };
};

test("texto libre: «2 cajas de agua» y «12 uds de agua» son líneas distintas", () => {
  setCatalog(catalogoCajas);
  const r = parseItems("2 cajas de agua gas y 3 uds de agua gas");
  assert.deepEqual(r.map((i) => [i.id, i.qty, i.unit, i.upb]), [["A1", 2, "caja", 6], ["A1", 3, "ud", 6]]);
  assert.deepEqual(parseItems("4 agua gas").map((i) => i.unit), ["ud"]);
});

test("chat: artículo en cajas pregunta cajas o unidades y calcula las unidades", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "p:A1");
  assert.match(r.reply, /caja de 6 uds/);
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["u:caja", "u:ud", "q:0"]);
  r = handleMessage(r.session, "u:caja");
  assert.match(r.reply, /Cuántas \*cajas\*/);
  r = handleMessage(r.session, "q:2");
  assert.match(r.reply, /2 cajas \(12 uds\) × AGUA GAS LIMON VIDRIO 250 = 41\.52/);
  r = handleMessage(r.session, "act:done");
  r = handleMessage(r.session, "c:ok");
  assert.deepEqual(r.order.items.map((i) => [i.id, i.qty, i.unit]), [["A1", 2, "caja"]]);
});

test("chat: se puede escribir «3 cajas» o «12 uds» al preguntar la cantidad", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "p:A1");
  r = handleMessage(r.session, "q:3"); // sin elegir unidad todavía: se vuelve a preguntar
  assert.match(r.reply, /cajas\* o en \*unidades/);
  r = handleMessage(r.session, "3 cajas");
  assert.match(r.reply, /3 cajas \(18 uds\)/);
});

test("chat: observación general y observación por artículo", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "1 jamon serrano y 1 jamon iberico");
  r = handleMessage(r.session, "act:done");
  r = handleMessage(r.session, "nota: servir el jueves, los demás días estoy cerrado");
  assert.match(r.reply, /Observaciones: servir el jueves/);
  r = handleMessage(r.session, "nota serrano: quiero piezas de peso grande, no de poco peso");
  assert.match(r.reply, /Anotado para JAMON SERRANO PIEZA/);
  assert.match(r.reply, /📝 quiero piezas de peso grande/);
  r = handleMessage(r.session, "nota jamon: otra cosa"); // dos jamones coinciden
  assert.match(r.reply, /varios artículos/);
  r = handleMessage(r.session, "c:ok");
  assert.equal(r.order.note, "servir el jueves, los demás días estoy cerrado");
  assert.equal(r.order.items.find((i) => i.id === "J1").note, "quiero piezas de peso grande, no de poco peso");
  assert.equal(r.order.items.find((i) => i.id === "J2").note, undefined);
});

test("chat: cliente nuevo también puede dejar una observación general", () => {
  let r = handleMessage(newSession(), "2 aguas");
  r = handleMessage(r.session, "nota: llamadme antes de venir");
  assert.match(r.reply, /Observación anotada/);
});

test("chat: «2 aguas» sin indicar unidad pregunta cajas o unidades si el artículo se vende en cajas", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "2 agua gas");
  assert.match(r.reply, /cajas de 6 unidades/);
  assert.deepEqual(r.ui.buttons.map((b) => b.id), ["ui:caja", "ui:ud", "ui:no"]);
  assert.equal(r.ui.buttons[0].title, "2 cajas (12 uds)");
  r = handleMessage(r.session, "ui:caja");
  assert.match(r.reply, /2 cajas \(12 uds\) × AGUA GAS LIMON/);
  r = handleMessage(r.session, "act:done");
  r = handleMessage(r.session, "c:ok");
  assert.deepEqual(r.order.items.map((i) => [i.id, i.qty, i.unit]), [["A1", 2, "caja"]]);
});

test("chat: si ya dice «cajas» o «uds» no se le pregunta; si es un artículo sin caja, tampoco", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "2 cajas de agua gas");
  assert.match(r.reply, /2 cajas \(12 uds\)/);
  r = handleMessage(newSession(c), "5 uds de agua gas");
  assert.match(r.reply, /5 × AGUA GAS/);
  r = handleMessage(newSession(c), "1 jamon serrano");
  assert.match(r.reply, /1 × JAMON SERRANO/);
});

test("chat: se puede contestar «unidades» escribiendo, y «no lo quiero» lo descarta", () => {
  const c = conCajas();
  let r = handleMessage(newSession(c), "3 agua gas");
  r = handleMessage(r.session, "unidades");
  assert.match(r.reply, /3 × AGUA GAS/);
  r = handleMessage(newSession(c), "3 agua gas y 1 jamon serrano");
  assert.equal(r.session.state, "unitq");
  r = handleMessage(r.session, "ui:no");
  assert.match(r.reply, /1 × JAMON SERRANO/);
  assert.doesNotMatch(r.reply, /AGUA/);
});

// ---- Identificación por nombre ----
import { setCustomerFinder, setLinkMaker } from "./bot.js";
import { findCustomers } from "./identify.js";

const baseClientes = [
  { id: "9001", name: "Bar El Ejemplo", phone: "+34 600 000 001", address: "Calle 1", orders: [{ doc: "X", date: "2026-10-01", lines: [{ productId: "A1", qty: 12 }, { productId: "J1", qty: 1 }] }] },
  { id: "9002", name: "Bar El Cruce", phone: "+34 600 000 002", address: "Calle 2", orders: [] },
  { id: "9003", name: "Bar El Cruce Centro", phone: "+34 600 000 003", address: "Calle 3", orders: [] },
];
const conIdentificacion = (opts = { identify: true, phone: "34611111111" }) => {
  setCatalog(catalogoCajas);
  setCustomerFinder((q) => findCustomers(baseClientes, q));
  setLinkMaker((c) => `https://x/pedido/${c.id}`);
  return newSession(null, null, opts);
};

test("identificación: «hola» pregunta quién es, busca el nombre y muestra sus habituales", () => {
  let r = handleMessage(conIdentificacion(), "hola");
  assert.match(r.reply, /nombre de tu negocio/);
  r = handleMessage(r.session, "Bar El Ejemplo");
  assert.match(r.reply, /Identificado! Eres \*Bar El Ejemplo\* \(cód\. 9001\)/);
  assert.match(r.reply, /Tu histórico de productos/);
  assert.match(r.reply, /AGUA GAS LIMON VIDRIO 250 — última vez: 12 uds/);
  assert.equal(r.ui.type, "link");
  assert.equal(r.ui.url, "https://x/pedido/9001");
  assert.equal(r.session.customer.id, "9001");
});

test("identificación: nombre desconocido, reintentos y derivación a una persona", () => {
  let r = handleMessage(conIdentificacion(), "Bar Inexistente");
  assert.match(r.reply, /No encuentro ese nombre/);
  r = handleMessage(r.session, "Otro Bar");
  r = handleMessage(r.session, "Tampoco");
  assert.equal(r.handoff, true);
  assert.match(r.reply, /No consigo identificarte/);
});

test("identificación: si varios encajan, pide el código y solo vale el de uno de ellos", () => {
  let r = handleMessage(conIdentificacion(), "Bar Cruce");
  assert.match(r.reply, /código de cliente/);
  assert.equal(r.session.state, "who2");
  r = handleMessage(r.session, "9001"); // existe, pero no era uno de los candidatos
  assert.match(r.reply, /no corresponde/);
  r = handleMessage(r.session, "9003");
  assert.match(r.reply, /Eres \*Bar El Cruce Centro\*/);
});

test("identificación: «nuevo» sigue el flujo de cliente nuevo y no vuelve a preguntar", () => {
  let r = handleMessage(conIdentificacion(), "nuevo");
  assert.match(r.reply, /Bienvenido/);
  r = handleMessage(r.session, "hola");
  assert.match(r.reply, /Bienvenido/);
});

test("identificación: un pedido de quien se identificó por nombre con otro teléfono queda retenido", () => {
  const flujo = (opts) => {
    let r = handleMessage(conIdentificacion(opts), "Bar El Ejemplo");
    r = handleMessage(r.session, "p:A1");
    r = handleMessage(r.session, "u:ud");
    r = handleMessage(r.session, "q:6");
    r = handleMessage(r.session, "act:done");
    return handleMessage(r.session, "c:ok");
  };
  assert.equal(flujo({ identify: true, phone: "34611111111", holdUnverified: true }).order.review, true);
  assert.equal(flujo({ identify: true, phone: "34600000001", holdUnverified: true }).order.review, false); // su teléfono: verificado
  assert.equal(flujo({ identify: true, phone: "34611111111", holdUnverified: false }).order.review, false); // regla desactivada (demo)
});
