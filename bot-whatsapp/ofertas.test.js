import test from "node:test";
import assert from "node:assert/strict";
import { priceLine, promoVigente, precioEfectivo } from "./pricing.js";
import { openCatalogDb } from "./catalogo-db.js";
import { webProducts } from "./weborder.js";

const base = { id: "1", name: "AGUA 1,5 L", price: 1.5, discount: 0, vat: 10, unitsPerBox: 6 };

test("OFERTAS: una oferta en % sustituye al descuento si es mayor (no se suma) y una en € se resta al precio de cada unidad", () => {
  assert.deepEqual(precioEfectivo({ ...base, promo: { tipo: "pct", valor: 15 } }, null, "1"), { price: 1.5, discount: 15 });
  assert.deepEqual(precioEfectivo({ ...base, discount: 20, promo: { tipo: "pct", valor: 15 } }, null, "1"), { price: 1.5, discount: 20 }); // ya tenía más
  assert.deepEqual(precioEfectivo({ ...base, promo: { tipo: "eur", valor: 0.1 } }, null, "1"), { price: 1.4, discount: 0 });
  assert.deepEqual(precioEfectivo({ ...base, price: 0.843, promo: { tipo: "eur", valor: 0.003 } }, null, "1"), { price: 0.84, discount: 0 }); // sin errores de coma flotante
  // el cliente con precio y descuento especiales: su precio de partida es el suyo; el % no se suma a su descuento si ya es mayor
  const c = { specialPrices: { 1: 1.2 }, discounts: { 1: 25 } };
  assert.deepEqual(precioEfectivo({ ...base, promo: { tipo: "pct", valor: 15 } }, c, "1"), { price: 1.2, discount: 25 });
  assert.deepEqual(precioEfectivo({ ...base, promo: { tipo: "eur", valor: 0.1 } }, c, "1"), { price: 1.1, discount: 25 });
  // nunca baja de 0
  assert.equal(precioEfectivo({ ...base, promo: { tipo: "eur", valor: 9 } }, null, "1").price, 0);
});

test("OFERTAS: solo valen hasta su fecha de fin (incluida) y las mal puestas no cuentan", () => {
  const o = { tipo: "pct", valor: 10, hasta: "2026-12-01" };
  assert.ok(promoVigente({ promo: o }, "2026-12-01")); assert.equal(promoVigente({ promo: o }, "2026-12-02"), null);
  assert.ok(promoVigente({ promo: { tipo: "pct", valor: 10 } }, "2099-01-01")); // sin fecha de fin: no caduca
  for (const mala of [null, {}, { tipo: "raro", valor: 5 }, { tipo: "pct", valor: 0 }, { tipo: "eur", valor: -1 }]) assert.equal(promoVigente({ promo: mala }), null);
});

test("OFERTAS: la línea del pedido lleva el precio y el descuento con la oferta, en céntimos exactos", () => {
  const l = priceLine({ id: "1", qty: 12, unit: "ud" }, { ...base, promo: { tipo: "pct", valor: 15 } }, null);
  assert.deepEqual([l.price, l.discount, l.units, l.amount], [1.5, 15, 12, 15.3]);
  const e = priceLine({ id: "1", qty: 2, unit: "caja" }, { ...base, promo: { tipo: "eur", valor: 0.1 } }, null);
  assert.deepEqual([e.price, e.discount, e.units, e.amount], [1.4, 0, 12, 16.8]);
  assert.equal(priceLine({ id: "1", qty: 12, unit: "ud" }, { ...base, promo: { tipo: "pct", valor: 15, hasta: "2000-01-01" } }, null).discount, 0); // caducada
});

test("OFERTAS: el catálogo que ve el cliente trae el mismo precio y descuento que el pedido, y enseña la oferta solo si le cambia el precio", () => {
  const p = { ...base, promo: { tipo: "pct", valor: 15, hasta: "2099-01-01" } };
  const habit = () => [];
  const [w] = webProducts(null, [p], habit);
  const l = priceLine({ id: "1", qty: 1, unit: "ud" }, p, null);
  assert.deepEqual([w.price, w.discount], [l.price, l.discount]);
  assert.deepEqual(w.oferta, { tipo: "pct", valor: 15, hasta: "2099-01-01" });
  const [conMas] = webProducts({ discounts: { 1: 30 } }, [p], habit); assert.equal(conMas.oferta, undefined); assert.equal(conMas.discount, 30); // ya tiene más descuento: no se le enseña oferta
  const [sin] = webProducts(null, [base], habit); assert.equal(sin.oferta, undefined);
});

test("OFERTAS (base de datos): se guardan en el artículo, quedan en su historial, no las pisa el Excel de a3ERP y el catálogo se recarga", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts([{ id: "1", name: "AGUA", price: 1.5, vat: 10 }]);
  const v0 = db.version();
  assert.equal(db.setPromo("1", { tipo: "pct", valor: 15, hasta: "2099-12-31" }, "2026-11-13T10:00:00.000Z"), "updated");
  assert.deepEqual(db.get("1").promo, { tipo: "pct", valor: 15, hasta: "2099-12-31" });
  assert.notEqual(db.version(), v0); // los programas recargan los precios
  assert.deepEqual({ ...db.history("1")[0] }, { field: "oferta", oldValue: null, newValue: "15 % hasta 2099-12-31", changedAt: "2026-11-13T10:00:00.000Z" });
  assert.equal(db.setPromo("1", { tipo: "pct", valor: 15, hasta: "2099-12-31" }), "unchanged");
  // el Excel de a3ERP cambia el precio y la oferta sigue
  db.upsertProducts([{ id: "1", name: "AGUA", price: 1.6, vat: 10 }], { partial: true });
  assert.equal(db.get("1").price, 1.6); assert.deepEqual(db.get("1").promo, { tipo: "pct", valor: 15, hasta: "2099-12-31" });
  assert.equal(db.list()[0].promo.valor, 15);
  assert.equal(db.setPromo("1", null), "updated"); assert.equal(db.get("1").promo, undefined);
  // lo que no vale
  for (const [promo, msg] of [[{ tipo: "raro", valor: 5 }, /% o en €/], [{ tipo: "pct", valor: 0 }, /mayor que 0/], [{ tipo: "pct", valor: 95 }, /90/], [{ tipo: "eur", valor: 1.6 }, /menor que el precio/], [{ tipo: "pct", valor: 5, hasta: "mañana" }, /fecha/]]) assert.throws(() => db.setPromo("1", promo), msg);
  assert.throws(() => db.setPromo("no-existe", null), /No existe/);
});

test("OFERTAS (base de datos): último cambio de precio de cada artículo y último aviso (campana) mandado", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts([{ id: "1", name: "AGUA", price: 1.5 }, { id: "2", name: "COLA", price: 2 }], { now: "2026-11-01T10:00:00.000Z" });
  db.update("1", { price: 1.2 }, "2026-11-10T10:00:00.000Z"); db.update("1", { price: 1.1 }, "2026-11-12T10:00:00.000Z");
  const c = db.ultimosCambiosDePrecio();
  assert.deepEqual(c.get("1"), { antes: 1.2, despues: 1.1, at: "2026-11-12T10:00:00.000Z" }); assert.equal(c.get("2"), undefined);
  db.avisoHecho("1", "precio:1.1", "2026-11-12T11:00:00.000Z"); db.avisoHecho("1", "precio:1", "2026-11-13T11:00:00.000Z");
  assert.deepEqual(db.avisosHechos().get("1"), { clave: "precio:1", at: "2026-11-13T11:00:00.000Z" });
});
