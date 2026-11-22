process.env.DESCUENTO_TARIFA = "1"; // estas pruebas comprueban el cálculo con descuento de tarifa (por defecto está apagado)
// REGLAS DE DESCUENTO (dinero en juego): qué descuento se aplica y cuál no, lo que ve el cliente = lo que se le cobra, y la vigilancia al subir el Excel de artículos.
// Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import { precioEfectivo, priceOrder } from "./pricing.js";
import { webProducts } from "./weborder.js";
import { parseProductos } from "./productos-import.js";
import { aplicarProductos } from "./productos-diff.js";
import { cambiosDeDescuento, revisarDescuentos } from "./descuentos-auditoria.js";

const HOY = "2026-11-16";
const prod = (id, extra = {}) => ({ id, name: "ART " + id, price: 10, unitsPerBox: 6, vat: 10, discount: 0, active: true, ...extra });

test("REGLAS: el descuento de la tarifa vale para todos; el PROPIO del cliente manda (también 0 %); sin dato, sin descuento", () => {
  const p = prod("1", { discount: 5 });
  assert.equal(precioEfectivo(p, null, "1", undefined, HOY).discount, 5, "sin cliente: el de la ficha del artículo");
  assert.equal(precioEfectivo(p, { discounts: {} }, "1", undefined, HOY).discount, 5, "cliente sin descuento propio: el de la tarifa");
  assert.equal(precioEfectivo(p, { discounts: { 1: 12 } }, "1", undefined, HOY).discount, 12, "el propio sustituye (no se suma)");
  assert.equal(precioEfectivo(p, { discounts: { 1: 0 } }, "1", undefined, HOY).discount, 0, "propio 0 % = a ÉL no se le hace el de la tarifa");
  assert.equal(precioEfectivo(prod("2"), { discounts: { 1: 12 } }, "2", undefined, HOY).discount, 0, "el descuento propio de un artículo NO pasa a otro");
  assert.equal(precioEfectivo(prod("3", { discount: undefined }), null, "3", undefined, HOY).discount, 0);
});

test("REGLAS: un descuento raro (texto, vacío, negativo, más de 100) se ignora: nunca se aplica", () => {
  for (const malo of ["", "abc", -5, 101, NaN, null, undefined]) {
    assert.equal(precioEfectivo(prod("1", { discount: malo }), null, "1", undefined, HOY).discount, 0, `tarifa ${String(malo)}`);
    assert.equal(precioEfectivo(prod("1", { discount: 5 }), { discounts: { 1: malo } }, "1", undefined, HOY).discount, 5, `propio ${String(malo)} no debe anular ni inventar`);
  }
});

test("REGLAS: oferta en % = el mayor entre descuento y oferta (no se suman); oferta en € resta al precio; caducada no cuenta", () => {
  const p = prod("1", { discount: 5, promo: { tipo: "pct", valor: 10 } });
  assert.equal(precioEfectivo(p, null, "1", undefined, HOY).discount, 10);
  assert.equal(precioEfectivo({ ...p, promo: { tipo: "pct", valor: 3 } }, null, "1", undefined, HOY).discount, 5, "una oferta menor no baja el descuento");
  const e = precioEfectivo(prod("1", { promo: { tipo: "eur", valor: 1.5 } }), null, "1", undefined, HOY);
  assert.deepEqual([e.price, e.discount], [8.5, 0]);
  assert.equal(precioEfectivo({ ...p, promo: { tipo: "pct", valor: 10, hasta: "2026-11-15" } }, null, "1", undefined, HOY).discount, 5, "caducada ayer: vale el de siempre");
  assert.equal(precioEfectivo({ ...p, promo: { tipo: "pct", valor: 10, hasta: HOY } }, null, "1", undefined, HOY).discount, 10, "el último día cuenta");
});

test("LO QUE SE VE = LO QUE SE COBRA: para muchos clientes y artículos, el precio y descuento del catálogo son los del pedido", () => {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const catalogo = Array.from({ length: 40 }, (_, i) => prod(String(i + 1), { price: 1 + Math.round(rnd() * 900) / 100, discount: rnd() < 0.3 ? Math.round(rnd() * 20) : 0, promo: rnd() < 0.15 ? { tipo: rnd() < 0.5 ? "pct" : "eur", valor: 1 + Math.round(rnd() * 5), ...(rnd() < 0.3 ? { hasta: "2026-11-01" } : {}) } : undefined }));
  for (let c = 0; c < 25; c++) {
    const cliente = { discounts: {}, specialPrices: {} };
    for (const p of catalogo) { if (rnd() < 0.2) cliente.discounts[p.id] = Math.round(rnd() * 30); if (rnd() < 0.1) cliente.specialPrices[p.id] = Math.round(rnd() * 800) / 100 + 1; }
    const vistos = new Map(webProducts(cliente, catalogo, () => []).map((p) => [p.id, p]));
    const pedido = priceOrder({ items: catalogo.map((p) => ({ id: p.id, qty: 2, unit: "ud" })) }, cliente, catalogo);
    for (const l of pedido.items) { const v = vistos.get(String(l.id)); if (!v) continue; assert.equal(l.discount, v.discount, `descuento de ${l.id}`); assert.equal(l.price, v.price, `precio de ${l.id}`); }
  }
});

test("IMPORTAR ARTÍCULOS: ve qué descuentos cambian y pide confirmar cuando son muchos, muy altos o demasiados en total", () => {
  const actual = Array.from({ length: 30 }, (_, i) => prod(String(i + 1), { discount: i < 3 ? 5 : 0 }));
  const cab = ["Cód. artículo", "Artículo", "Precio venta", "Dto%"];
  const excel = (f) => parseProductos([cab, ...actual.map((p, i) => [p.id, p.name, "10", f(i)])]).products;
  const sinCambios = revisarDescuentos(cambiosDeDescuento(actual, aplicarProductos(actual, excel((i) => (i < 3 ? "5" : "")))), { columna: "Dto%" });
  assert.deepEqual(sinCambios.confirmar, [], "mismos descuentos: nada que confirmar");
  assert.equal(sinCambios.detalle.length, 0);
  const todos = revisarDescuentos(cambiosDeDescuento(actual, aplicarProductos(actual, excel(() => "7"))), { columna: "Dto%" });
  assert.ok(todos.confirmar.some((t) => /cambian de descuento/.test(t)) && todos.confirmar.some((t) => /tendrían descuento/.test(t)), "27 artículos ganan descuento: hay que confirmar y avisar de que es mucho");
  assert.equal(todos.detalle.length, 30 - 0, "30 cambian (3 pasan de 5 a 7 y 27 pasan de 0 a 7)");
  const alto = revisarDescuentos(cambiosDeDescuento(actual, aplicarProductos(actual, excel((i) => (i === 10 ? "60" : "")))), { columna: "Dto%" });
  assert.ok(alto.confirmar.some((t) => /50 % o más/.test(t)), "un 60 % nuevo hay que confirmarlo");
  assert.ok(alto.detalle.some((x) => /SE QUITA: 5 % → 0 %/.test(x.motivo)), "los 5 % que desaparecen se enseñan");
});

test("IMPORTAR ARTÍCULOS: sin columna de descuento se avisa de que no se toca ningún descuento", () => {
  const actual = [prod("1", { discount: 5 }), prod("2")];
  const nuevo = parseProductos([["Cód. artículo", "Artículo", "Precio venta"], ["1", "ART 1", "10"], ["2", "ART 2", "10"]]).products;
  const r = revisarDescuentos(cambiosDeDescuento(actual, aplicarProductos(actual, nuevo)), { columna: "" });
  assert.deepEqual(r.confirmar, []); assert.match(r.aviso[0], /no trae columna de descuento/);
});

test("QUITAR DESCUENTOS DE TARIFA: el panel lo ofrece, pide clave y confirmación, y la ruta existe", async () => {
  const fs = await import("node:fs"), leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const a = leer("./admin.js"), h = leer("./empresa.html");
  for (const t of ["/api/admin/articulos/quitar-descuentos", "catalogo-antes-de-quitar-descuentos", "b.confirmo !== true", "exigeReclave(req, res, who)", "discount: 0"]) assert.ok(a.includes(t), t);
  for (const t of ['id="ar-dto-quitar"', "Quitar TODOS los descuentos de tarifa", "ar-dto-caja"]) assert.ok(h.includes(t), t);
});

test("QUITAR PRECIOS Y DESCUENTOS PROPIOS DE UN CLIENTE: solo ese cliente, y el panel lo ofrece con clave", async () => {
  const { openCustomersDb } = await import("./clientes-db.js"), fs = await import("node:fs");
  const db = openCustomersDb(":memory:");
  db.upsertCustomers([{ id: "1", name: "UNO", active: true, orders: [] }, { id: "2", name: "DOS", active: true, orders: [] }]);
  db.setPreciosPropios(new Map([["1", { precios: { 10: 1.5 }, descuentos: { 10: 30, 11: 5 } }], ["2", { precios: {}, descuentos: { 10: 20 } }]]));
  assert.deepEqual(db.quitarPreciosPropios("1"), { descuentos: 2, precios: 1 });
  assert.deepEqual(db.getById("1").discounts, {}); assert.deepEqual(db.getById("1").specialPrices, {});
  assert.deepEqual(db.getById("2").discounts, { 10: 20 }, "el otro cliente no cambia");
  const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(leer("./admin.js").includes("precios-propios\\/quitar") && leer("./admin.js").includes("clientes-antes-de-quitar-precios"));
  assert.ok(leer("./empresa.html").includes("Quitar sus precios y descuentos propios"));
});

test("POR DEFECTO NO HAY DESCUENTOS DE TARIFA: solo valen el propio del cliente y la oferta del panel", async () => {
  const { precioEfectivo } = await import("./pricing.js"), antes = process.env.DESCUENTO_TARIFA; delete process.env.DESCUENTO_TARIFA;
  try {
    const p = { id: "1", price: 10, discount: 30 };
    assert.equal(precioEfectivo(p, null, "1").discount, 0, "el 30 % antiguo de la ficha no se aplica a nadie");
    assert.equal(precioEfectivo(p, { discounts: {} }, "1").discount, 0);
    assert.equal(precioEfectivo(p, { discounts: { 1: 12 } }, "1").discount, 12, "el propio del cliente sí");
    assert.equal(precioEfectivo({ ...p, promo: { tipo: "pct", valor: 5 } }, null, "1").discount, 5, "la oferta del panel sí");
    process.env.DESCUENTO_TARIFA = "1"; assert.equal(precioEfectivo(p, null, "1").discount, 30, "con DESCUENTO_TARIFA=1 vuelve el de la tarifa");
  } finally { if (antes === undefined) delete process.env.DESCUENTO_TARIFA; else process.env.DESCUENTO_TARIFA = antes; }
});
