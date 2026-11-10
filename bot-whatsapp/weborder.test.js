import test from "node:test";
import assert from "node:assert/strict";
import { webOrderFromBody, webProducts } from "./weborder.js";

const catalogo = [
  { id: "A", name: "AGUA", price: 2, unitsPerBox: 6 },
  { id: "B", name: "ZUMO", price: 1 },
];
const cliente = { id: "C1", name: "Bar", address: "Calle 1" };
const ctx = { key: "web:x", phone: "34600000001", at: "2026-10-29T10:00:00Z" };

test("las cajas solo valen para artículos que se venden en cajas; lo demás se toma como unidades", () => {
  const { order } = webOrderFromBody({ lines: [{ id: "A", qty: 2, unit: "caja" }, { id: "B", qty: 3, unit: "caja" }] }, cliente, ctx, catalogo);
  assert.deepEqual(order.items.map((i) => [i.id, i.qty, i.unit]), [["A", 2, "caja"], ["B", 3, "ud"]]);
  assert.match(order.text, /2 cajas de AGUA/);
});

test("valida cantidades, artículos desconocidos y notas", () => {
  assert.deepEqual(webOrderFromBody({ lines: [{ id: "Z", qty: 1 }, { id: "A", qty: 0 }, { id: "A", qty: 1000 }] }, cliente, ctx, catalogo), { error: "El pedido está vacío" });
  const { order } = webOrderFromBody({ lines: [{ id: "A", qty: 1, note: "  grande  " }], note: "jueves" }, cliente, ctx, catalogo);
  assert.equal(order.items[0].note, "grande");
  assert.equal(order.note, "jueves");
});

test("el catálogo web trae unidades por caja y ordena por lo habitual", () => {
  const habituales = () => [{ id: "B", lastQty: 4, count: 3 }];
  const p = webProducts(cliente, catalogo, habituales);
  assert.deepEqual(p.map((x) => [x.id, x.unitsPerBox, x.lastQty]), [["B", null, 4], ["A", 6, null]]);
});

test("webHistory: últimos pedidos del más reciente al más antiguo, solo con artículos que siguen en catálogo", async () => {
  const { webHistory } = await import("./weborder.js");
  const cat = [{ id: 1, name: "AGUA" }, { id: 2, name: "COLA" }];
  const customer = { orders: [
    { doc: "A", date: "2026-01-01", lines: [{ productId: "1", qty: 6 }] },
    { doc: "B", date: "2026-03-01", lines: [{ productId: "1", qty: 12 }, { productId: "2", qty: 24 }, { productId: "99", qty: 5 }] },
    { doc: "C", date: "2026-02-01", lines: [{ productId: "99", qty: 5 }] }, // artículo descatalogado: el pedido se omite
  ] };
  const h = webHistory(customer, cat);
  assert.deepEqual(h.map((o) => o.doc), ["B", "A"]);
  assert.deepEqual(h[0].lines, [{ id: "1", name: "AGUA", qty: 12 }, { id: "2", name: "COLA", qty: 24 }]);
  assert.equal(webHistory(customer, cat, 1).length, 1);
});

test("el catálogo web lleva categoría y subcategoría de cada producto y el árbol para navegar", async () => {
  const { webTree } = await import("./weborder.js");
  const cat = [{ id: "1", name: "AGUA MINERAL 1,5 L", price: 1 }, { id: "2", name: "Bezoya 50 cl", price: 1 }, { id: "3", name: "Vino tinto", price: 5 }, { id: "4", name: "Escoba", price: 3, category: "Droguería", subcategory: "Limpieza" }];
  const p = webProducts({ id: "C" }, cat, () => []);
  assert.deepEqual(p.map((x) => [x.name, x.cat, x.sub]).sort(), [["AGUA MINERAL 1,5 L", "aguas", "otros"], ["Bezoya 50 cl", "aguas", "bezoya"], ["Escoba", "f-drogueria", "limpieza"], ["Vino tinto", "vinos", "otros"]]);
  assert.deepEqual(webTree(cat).map((c) => [c.nombre, c.count]), [["Vinos", 1], ["Aguas", 2], ["Droguería", 1]]);
});

test("el catálogo web lleva el precio y el descuento que aplicará el servidor (precio especial del cliente o ficha)", () => {
  const cat = [{ id: "1", name: "COLA", price: 0.55, discount: 10 }, { id: "2", name: "AGUA", price: 1, discount: 5 }, { id: "3", name: "VINO", price: 5 }];
  const p = Object.fromEntries(webProducts({ id: "C", specialPrices: { 2: 0.8 }, discounts: { 2: 0 } }, cat, () => []).map((x) => [x.id, x]));
  assert.deepEqual([p[1].price, p[1].discount], [0.55, 10]);
  assert.deepEqual([p[2].price, p[2].discount], [0.8, 0]);
  assert.deepEqual([p[3].price, p[3].discount], [5, 0]);
});

test("el catálogo web añade la foto solo a los productos que la tienen", () => {
  const cat = [{ id: "1", name: "A", price: 1 }, { id: "2", name: "B", price: 1 }];
  const p = webProducts({ id: "C" }, cat, () => [], (id) => (id === "1" ? "/img/1" : null));
  assert.equal(p.find((x) => x.id === "1").img, "/img/1");
  assert.equal("img" in p.find((x) => x.id === "2"), false);
});

test("withOwnOrders: suma los pedidos hechos por la app solo si son posteriores al último de a3ERP", async () => {
  const { withOwnOrders } = await import("./weborder.js");
  const c = { id: "1", orders: [{ doc: "A2", date: "2026-10-20", lines: [{ productId: "1", qty: 5 }] }, { doc: "A1", date: "2026-10-01", lines: [] }] };
  const propios = [
    { doc: "W3", date: "2026-11-01", lines: [{ productId: "2", qty: 24 }] }, // nuevo: se suma
    { doc: "W2", date: "2026-10-15", lines: [{ productId: "2", qty: 6 }] }, // anterior al último de a3ERP: se supone ya facturado
    { doc: "W4", date: "2026-11-02", lines: [] }, // sin líneas: no cuenta
  ];
  const r = withOwnOrders(c, propios);
  assert.deepEqual(r.orders.map((o) => o.doc), ["W3", "A2", "A1"]);
  assert.equal(withOwnOrders(c, []), c); // sin pedidos propios: el mismo cliente
  assert.deepEqual(withOwnOrders({ id: "2", orders: [] }, propios).orders.map((o) => o.doc), ["W2", "W3"].reverse().filter(() => true).length ? ["W3", "W2"] : []);
});

test("conHistorial: pone el histórico indicado solo a los clientes que lo tienen", async () => {
  const { conHistorial } = await import("./weborder.js");
  const pedidos = [{ doc: "1", date: "2026-11-04", lines: [{ productId: "5", qty: 3 }] }];
  const r = conHistorial([{ id: "0429", name: "BAR GELI", orders: [{ doc: "viejo", date: "2026-01-01", lines: [] }] }, { id: "9", name: "OTRO", orders: [] }], { "429": pedidos }); // el código puede venir con o sin ceros delante
  assert.deepEqual(r[0].orders, pedidos); // sustituye al que traía
  assert.deepEqual(r[1].orders, []); // los demás no cambian
});

test("webProducts: avisa de las fotos creadas con IA (solo si el producto tiene foto)", () => {
  const cat = [{ id: 1, name: "Agua", price: 1 }, { id: 2, name: "Pan", price: 1 }, { id: 3, name: "Sal", price: 1 }];
  const r = webProducts({}, cat, () => [], (id) => (id === "3" ? null : `/img/${id}`), (id) => id !== "2");
  const por = Object.fromEntries(r.map((p) => [p.id, p.ia === true]));
  assert.deepEqual(por, { 1: true, 2: false, 3: false }); // el 3 no tiene foto: sin aviso
});
