// Prueba el bot con un catálogo con nombres reales de ERP y un cliente con historial de pedidos
import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, newSession, parseItems, setCatalog } from "./bot.js";

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
  assert.deepEqual(r.order.items, [{ id: "19800", name: "COCA-COLA ZERO Lata 33 CL PACK.(1X12)", price: 7.79, qty: 4 }]);
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
