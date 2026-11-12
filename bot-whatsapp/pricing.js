// Precios, descuentos, cajas/unidades e impuestos de un pedido, con las reglas de la empresa:
//
//  - Unidades: las que pide el cliente; si pide CAJAS, cajas × «unidades por caja» de la ficha del artículo.
//  - Precio: el de la tabla de precios especiales artículo/cliente; si no hay, el precio de venta de la ficha del artículo.
//  - Descuento: el de la tabla de descuentos artículo/cliente; si no hay, el descuento general de la ficha del artículo.
//  - IVA: el tipo de la ficha del artículo. Recargo de equivalencia (R.E.): si el cliente lo tiene, según el tipo de IVA.
//  - Los impuestos se calculan por tipo de IVA sobre la suma de bases (redondeo a 2 decimales), como en el «Detalle de
//    impuestos» de a3ERP. Se comprueba con un pedido real de a3ERP en pricing.test.js.
//
// Datos esperados (cuando existan; si faltan se usan valores neutros y se marca el pedido para revisar):
//   artículo: { id, name, price, unitsPerBox, discount, vat }
//   cliente:  { specialPrices: { [artículo]: precio }, discounts: { [artículo]: % }, recargoEquivalencia: boolean }
// Estos datos vendrán de las fichas de a3ERP (sincronización); mientras tanto hay datos ficticios en ejemplo/.

export const DEFAULT_VAT = 21;
// Recargo de equivalencia legal en España según el tipo de IVA (%). Confirmar con la gestoría si hay otros tipos.
export const RE_RATE = { 21: 5.2, 10: 1.4, 4: 0.5 };

// Los euros se redondean a céntimos hacia arriba en la mitad (0,005 → 0,01), pero SIN errores de coma flotante: los importes se calculan con ENTEROS
// (céntimos). Con números decimales normales 300 × 2,286 × 0,875 = 600,075 salía 600,07 en vez de 600,08.
export const round2 = (n) => Math.round(Number((Math.abs(n) * 100).toPrecision(14))) * Math.sign(n) / 100;
const escala = (x, dec) => BigInt(Math.round(Number(x) * 10 ** dec)); // x con como mucho «dec» decimales (los precios se guardan a 4 y los descuentos a 2)
const mitadArriba = (num, den) => (num * 2n + den) / (2n * den); // num/den redondeado al entero, la mitad hacia arriba (num ≥ 0)
/** Importe de una línea en CÉNTIMOS (entero): unidades × precio × (1 − descuento %), todo exacto. */
export function importeCentimos(units, price, discount = 0) {
  const u = escala(units, 3), pr = escala(price, 4), d = escala(discount, 2);
  const c = mitadArriba(u * pr * (10000n - d) * 100n, 1000n * 10000n * 10000n);
  return Number(c);
}

/** Calcula los campos de una línea: { unit, boxes, units, price, discount, vat, amount, unsureBox } */
export function priceLine(item, product, customer) {
  const id = String(item.id);
  const qty = item.qty;
  const upb = Number.isInteger(product?.unitsPerBox) && product.unitsPerBox >= 1 ? product.unitsPerBox : null;
  const byBox = item.unit === "caja";
  const price = customer?.specialPrices?.[id] ?? product?.price ?? item.price ?? 0;
  const discount = customer?.discounts?.[id] ?? product?.discount ?? 0;
  const units = byBox ? qty * (upb ?? 1) : qty;
  return {
    unit: byBox ? "caja" : "ud",
    boxes: byBox ? qty : null,
    units,
    price,
    discount,
    vat: product?.vat ?? DEFAULT_VAT,
    amount: importeCentimos(units, price, discount) / 100,
    unsureBox: byBox && !upb, // pidió cajas pero no sabemos cuántas unidades trae cada una
  };
}

/** Completa un pedido con precio, descuento, cajas/unidades e IVA de cada línea. Si algo es dudoso, lo marca para revisar. */
export function priceOrder(order, customer, catalog) {
  const byId = new Map((catalog ?? []).map((p) => [String(p.id), p]));
  let review = !!order.review;
  const items = (order.items ?? []).map((it) => {
    const p = priceLine(it, byId.get(String(it.id)), customer);
    if (p.unsureBox) review = true;
    const { unsureBox, ...fields } = p;
    return { ...it, ...fields };
  });
  const base = items.reduce((t, i) => t + Math.round(i.amount * 100), 0) / 100;
  return { ...order, items, review, re: !!customer?.recargoEquivalencia, total: items.length ? base : order.total };
}

/** Totales de un pedido: bases por tipo de IVA, IVA, R.E. y total del pedido. */
export function totals(items, re = false) {
  const byVat = new Map(); // tipo de IVA → céntimos de base (enteros: sin errores de redondeo)
  for (const i of items) { const v = i.vat_rate ?? i.vat ?? DEFAULT_VAT; byVat.set(v, (byVat.get(v) ?? 0) + Math.round((i.amount ?? 0) * 100)); }
  const pct = (cents, rate) => Number(mitadArriba(BigInt(cents) * escala(rate, 2), 10000n)); // cents × rate / 100, a céntimos
  const groups = [...byVat].sort((a, b) => b[0] - a[0]).map(([vat, base]) => ({ vat, base, iva: pct(base, vat), re: re ? pct(base, RE_RATE[vat] ?? 0) : 0 }));
  const sum = (k) => groups.reduce((t, g) => t + g[k], 0);
  const base = sum("base"), iva = sum("iva"), reTotal = sum("re");
  const e = (c) => c / 100;
  return { groups: groups.map((g) => ({ vat: g.vat, base: e(g.base), iva: e(g.iva), re: e(g.re) })), base: e(base), iva: e(iva), re: e(reTotal), total: e(base + iva + reTotal) };
}

/** Artículo que solo se vende por cajas enteras (modo de venta «2-SOLO CAJA» de a3ERP con más de 1 unidad por caja, p. ej. la leche): no hay «Uds». Con 1 unidad por caja (p. ej. un cubo de basura) la caja y la unidad son lo mismo y se pide en unidades. */
export const soloCaja = (p) => p?.saleMode === "caja" && Number.isInteger(p?.unitsPerBox) && p.unitsPerBox > 1;
