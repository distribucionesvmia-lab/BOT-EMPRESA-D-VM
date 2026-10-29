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

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
    amount: round2(units * price * (1 - discount / 100)),
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
  const base = round2(items.reduce((t, i) => t + i.amount, 0));
  return { ...order, items, review, re: !!customer?.recargoEquivalencia, total: items.length ? base : order.total };
}

/** Totales de un pedido: bases por tipo de IVA, IVA, R.E. y total del pedido. */
export function totals(items, re = false) {
  const byVat = new Map();
  for (const i of items) byVat.set(i.vat_rate ?? i.vat ?? DEFAULT_VAT, (byVat.get(i.vat_rate ?? i.vat ?? DEFAULT_VAT) ?? 0) + (i.amount ?? 0));
  const groups = [...byVat].sort((a, b) => b[0] - a[0]).map(([vat, sum]) => {
    const base = round2(sum);
    return { vat, base, iva: round2((base * vat) / 100), re: re ? round2((base * (RE_RATE[vat] ?? 0)) / 100) : 0 };
  });
  const sum = (k) => round2(groups.reduce((t, g) => t + g[k], 0));
  const base = sum("base"), iva = sum("iva"), reTotal = sum("re");
  return { groups, base, iva, re: reTotal, total: round2(base + iva + reTotal) };
}
