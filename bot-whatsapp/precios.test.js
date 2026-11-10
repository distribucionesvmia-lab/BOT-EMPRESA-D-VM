// Auditoría de los cálculos de dinero: importes de línea, IVA y recargo de equivalencia, comparados con una referencia EXACTA (enteros, BigInt)
// y con el cálculo que hace la página del cliente (pedido.html). Si algo cambia en un céntimo, estas pruebas fallan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { priceLine, priceOrder, totals, importeCentimos, round2, RE_RATE } from "./pricing.js";

let semilla = 20261110;
const azar = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
// referencia: precio en diezmilésimas, descuento en centésimas, todo entero; la mitad de un céntimo sube
const ref = (unidades, precio, dto) => {
  const num = BigInt(unidades) * BigInt(Math.round(precio * 1e4)) * (10000n - BigInt(Math.round(dto * 100))) * 100n, den = 10n ** 8n;
  return Number((num * 2n + den) / (2n * den));
};
const refPct = (cent, pct100) => Number((BigInt(cent) * BigInt(pct100) * 2n + 10000n) / 20000n); // cent × (pct/100) con pct en centésimas de %

test("importe de línea: 100.000 casos al azar coinciden con el cálculo exacto (ni un céntimo de diferencia)", () => {
  for (let i = 0; i < 100000; i++) {
    const u = 1 + Math.floor(azar() * 500), p = Math.floor(azar() * 500000) / 10000, d = Math.floor(azar() * 3000) / 100;
    const got = Math.round(priceLine({ qty: u, unit: "ud" }, { price: p, discount: d, vat: 21 }, null).amount * 100);
    assert.equal(got, ref(u, p, d), `${u} × ${p} − ${d} %`);
  }
});

test("importe de línea: casos que con números decimales normales fallaban (mitad de céntimo)", () => {
  assert.equal(priceLine({ qty: 300, unit: "ud" }, { price: 2.286, discount: 12.5 }).amount, 600.08); // 600,075 exactos
  assert.equal(priceLine({ qty: 85, unit: "ud" }, { price: 32.751 }).amount, 2783.84); // 2783,835
  assert.equal(importeCentimos(1, 1.005, 0), 101);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  // los precios de a3ERP vienen con ruido de coma flotante («4,9950000000000001»): se leen como 4,995
  assert.equal(priceLine({ qty: 3, unit: "ud" }, { price: 4.9950000000000001, discount: 10 }).amount, 13.49);
});

test("cajas: unidades = cajas × unidades por caja, y el precio es por unidad", () => {
  const l = priceLine({ qty: 2, unit: "caja" }, { price: 0.49, unitsPerBox: 24, discount: 0, vat: 10 });
  assert.deepEqual([l.units, l.boxes, l.amount], [48, 2, 23.52]);
  assert.equal(priceLine({ qty: 5, unit: "ud" }, { price: 0.49, unitsPerBox: 24 }).amount, 2.45);
  assert.equal(priceLine({ qty: 1, unit: "caja" }, { price: 1, unitsPerBox: null }).unsureBox, true); // caja sin dato de unidades: se marca para revisar
});

test("precio y descuento especiales del cliente mandan sobre los de la ficha", () => {
  const c = { specialPrices: { 7: 0.8 }, discounts: { 7: 5 } };
  assert.equal(priceLine({ id: 7, qty: 10, unit: "ud" }, { price: 1, discount: 20 }, c).amount, 7.6); // 10 × 0,80 − 5 %
  assert.equal(priceLine({ id: 8, qty: 10, unit: "ud" }, { price: 1, discount: 20 }, c).amount, 8); // sin especial: ficha
});

test("totales: IVA y recargo de equivalencia sobre la MISMA base (nunca uno sobre el otro), por tipo de IVA", () => {
  for (let i = 0; i < 20000; i++) {
    const lineas = Array.from({ length: 1 + Math.floor(azar() * 6) }, () => ({ amount: Math.floor(azar() * 100000) / 100, vat: [4, 10, 21][Math.floor(azar() * 3)] }));
    const re = azar() < 0.5, t = totals(lineas, re);
    let base = 0, iva = 0, rec = 0;
    for (const v of [4, 10, 21]) {
      const b = lineas.filter((l) => l.vat === v).reduce((s, l) => s + Math.round(l.amount * 100), 0);
      base += b; iva += refPct(b, v * 100); rec += re ? refPct(b, Math.round(RE_RATE[v] * 100)) : 0;
    }
    assert.deepEqual([Math.round(t.base * 100), Math.round(t.iva * 100), Math.round(t.re * 100), Math.round(t.total * 100)], [base, iva, rec, base + iva + rec]);
  }
  // el ejemplo de la gestoría: 10 € al 21 % con R.E. → 10 + 2,10 + 0,52
  assert.deepEqual(totals([{ amount: 10, vat: 21 }], true).total, 12.62);
});

test("priceOrder: la base del pedido es la suma exacta de sus líneas", () => {
  const cat = [{ id: 1, name: "A", price: 2.286, vat: 10 }, { id: 2, name: "B", price: 32.751, vat: 21 }];
  const o = priceOrder({ items: [{ id: 1, qty: 300, unit: "ud" }, { id: 2, qty: 85, unit: "ud" }] }, { discounts: { 1: 12.5 } }, cat);
  assert.deepEqual(o.items.map((i) => i.amount), [600.08, 2783.84]);
  assert.equal(o.total, 3383.92);
});

test("la página del cliente (pedido.html) calcula EXACTAMENTE lo mismo que el servidor", () => {
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  const trozo = html.slice(html.indexOf("// Importes EXACTOS"), html.indexOf("const total = () => calc().total;") + "const total = () => calc().total;".length);
  assert.ok(trozo.includes("importeCent") && trozo.includes("function calc"), "no se encuentra el cálculo en pedido.html");
  for (let n = 0; n < 3000; n++) {
    const re = azar() < 0.5;
    const productos = Array.from({ length: 1 + Math.floor(azar() * 5) }, (_, i) => ({
      id: String(i + 1), price: Math.floor(azar() * 300000) / 10000, discount: Math.floor(azar() * 2500) / 100, vat: [4, 10, 21][Math.floor(azar() * 3)],
      unitsPerBox: azar() < 0.5 ? 2 + Math.floor(azar() * 30) : null, qty: 1 + Math.floor(azar() * 60), cajas: azar() < 0.5,
    }));
    const unitOf = new Map(productos.map((p) => [p.id, p.cajas && p.unitsPerBox ? "caja" : "ud"]));
    const ctx = vm.createContext({ BigInt, Number, Math, Map, data: { customer: { re } }, unit: (id) => unitOf.get(id) || "ud", lines: () => productos.map((p) => ({ ...p })) });
    vm.runInContext("const uds = l => l.qty * (unit(l.id) === 'caja' ? (l.unitsPerBox || 1) : 1);\n" + trozo + "\nglobalThis.salida = calc();", ctx);
    const servidor = priceOrder({ items: productos.map((p) => ({ id: p.id, qty: p.qty, unit: unitOf.get(p.id) })) }, { recargoEquivalencia: re, discounts: Object.fromEntries(productos.map((p) => [p.id, p.discount])), specialPrices: Object.fromEntries(productos.map((p) => [p.id, p.price])) },
      productos.map((p) => ({ id: p.id, name: "x", price: p.price, vat: p.vat, unitsPerBox: p.unitsPerBox })));
    const t = totals(servidor.items, re);
    assert.deepEqual([ctx.salida.base, ctx.salida.iva, ctx.salida.re, ctx.salida.total], [t.base, t.iva, t.re, t.total], `caso ${n}`);
  }
});

test("PEDIDO WEB: los artículos que se venden en cajas se piden por cajas por defecto y sin animar el −/+", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(html, /const unit = id => unitOf\.get\(id\) \|\| \(productoPorId\.get\(id\)\?\.unitsPerBox \? "caja" : "ud"\)/);
  assert.match(html, /\[\["caja", "Cajas"\], \["ud", "Uds"\]\]/); // Cajas primero
  assert.match(html, /\.ctl \.bump, \.hstep\.bump, \.step\.bump \{ animation:none !important; \}/);
});

test("MÓVIL: «Mostrar más» no se sale del ancho y el código/PIN de entrada admite solo 6 cifras", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /m\.style\.width = "calc\(100% - 28px\)"/);
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  for (const id of ["a-nif", "a-pin", "r-pin", "r-pin2", "c-nuevo", "c-nuevo2"]) assert.match(cli, new RegExp(`id="${id}"[^>]*maxlength="6"`), id);
  assert.match(cli, /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/);
});
