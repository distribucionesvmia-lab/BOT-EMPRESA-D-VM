import { deliveryAllowed, madridDay, puedeHoy } from "./delivery.js";
import { categorizar, arbolCategorias } from "./categorias.js";

// Lógica de la mini-aplicación de pedido, sin red ni disco (la comparten el servidor y la demo del navegador).

/** Catálogo que ve el cliente: sus habituales primero, con las unidades de la última vez y las unidades por caja. */
export function webProducts(customer, catalog, habitualProducts, imgOf = () => null, iaOf = () => false) {
  const habit = new Map(habitualProducts(customer).map((p) => [p.id, p]));
  return catalog
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      // Mismo criterio que pricing.js (priceLine): precio y descuento especiales del cliente si los hay, si no los de la ficha
      price: customer?.specialPrices?.[String(p.id)] ?? p.price,
      discount: customer?.discounts?.[String(p.id)] ?? p.discount ?? 0,
      vat: p.vat ?? 21, // tipo de IVA (para enseñar el total con IVA)
      unitsPerBox: Number.isInteger(p.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null,
      ...(({ cat, sub }) => ({ cat, sub }))(categorizar(p)), // categoría y subcategoría (ids) para navegar el catálogo
      ...((img) => (img ? { img } : {}))(imgOf(String(p.id))), // foto del producto (si hay)
      ...(imgOf(String(p.id)) && iaOf(String(p.id)) ? { ia: true } : {}), // la foto está generada con IA (se avisa en pequeño)
      lastQty: habit.get(p.id)?.lastQty ?? null,
      count: habit.get(p.id)?.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Árbol de categorías del catálogo que ve el cliente (con cuántos productos tiene cada una). */
export const webTree = (catalog) => arbolCategorias(catalog);

/** Pone el histórico indicado ({ código de cliente: [pedidos] }) a los clientes de la lista que lo tengan (sustituye al que traían). */
export function conHistorial(clientes, historial = {}) {
  const k = (id) => String(id).trim().replace(/^0+(?=\d)/, ""); // «0429» y «429» son el mismo cliente
  const por = new Map(Object.entries(historial).map(([id, o]) => [k(id), o]));
  return clientes.map((c) => (por.has(k(c.id)) ? { ...c, orders: por.get(k(c.id)) } : c));
}

/**
 * Suma al historial de a3ERP los pedidos que el cliente ha hecho por la aplicación o el chat (y que a3ERP aún no ha facturado):
 * solo los de fecha igual o posterior al último pedido de a3ERP, para no contarlos dos veces cuando después aparezcan en su historial.
 */
export function withOwnOrders(customer, ownOrders = []) {
  if (!customer || !ownOrders.length) return customer;
  const orders = customer.orders ?? [];
  const lastA3 = orders.reduce((m, o) => (String(o.date) > m ? String(o.date) : m), "");
  const seen = new Set(orders.map((o) => String(o.doc)));
  const own = ownOrders.filter((o) => o.date >= lastA3 && !seen.has(String(o.doc)) && o.lines.length);
  if (!own.length) return customer;
  return { ...customer, orders: [...own, ...orders].sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}

/** Últimos pedidos del cliente (los más recientes primero) con sus líneas, para volver a comprarlos o modificarlos. */
export function webHistory(customer, catalogList, limit = 5) {
  const names = new Map(catalogList.map((p) => [String(p.id), p.name]));
  return [...(customer.orders ?? [])]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((o) => ({ doc: String(o.doc), date: o.date, lines: o.lines.filter((l) => names.has(String(l.productId)) && l.qty > 0).map((l) => ({ id: String(l.productId), name: names.get(String(l.productId)), qty: l.qty })) }))
    .filter((o) => o.lines.length)
    .slice(0, limit);
}

/**
 * Valida lo que envía la mini-app y arma el pedido (sin precios: los pone priceOrder).
 * Devuelve { order } o { error } si el pedido está vacío.
 */
export function webOrderFromBody(body, customer, { key, phone, at = new Date().toISOString() }, catalogList) {
  const catalog = new Map(catalogList.map((p) => [String(p.id), p]));
  const merged = new Map();
  for (const l of Array.isArray(body?.lines) ? body.lines : []) {
    const p = catalog.get(String(l?.id));
    const qty = Math.floor(Number(l?.qty));
    // Unidades o cajas; las cajas solo valen para artículos que se venden en cajas
    const unit = l?.unit === "caja" && Number.isInteger(p?.unitsPerBox) && p.unitsPerBox > 1 ? "caja" : "ud";
    const lineNote = typeof l?.note === "string" ? l.note.trim().slice(0, 120) : "";
    if (p && qty >= 1 && qty <= 999) {
      const k = `${p.id}|${unit}`;
      const prev = merged.get(k);
      merged.set(k, { id: p.id, name: p.name, price: p.price, qty: (prev?.qty ?? 0) + qty, unit, ...((lineNote || prev?.note) && { note: lineNote || prev.note }) });
    }
  }
  const items = [...merged.values()];
  if (!items.length) return { error: "El pedido está vacío" };
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : "";
  // Día de entrega elegido (uno de los botones o cualquier día del calendario): debe ser una fecha real, de hoy en adelante
  let delivery = null;
  if (body?.delivery != null && body.delivery !== "") {
    const hoy = puedeHoy(customer); // el mismo día solo en los municipios que lo tienen
    if (!deliveryAllowed(body.delivery, at, { hoy })) {
      return { error: body.delivery === madridDay(at) ? (hoy ? "Para recibirlo hoy hay que pedir antes de las 10:00. Elige otro día." : "Para tu zona no hay entrega en el mismo día. Elige otro día.") : "Elige un día de entrega válido." };
    }
    delivery = body.delivery;
  }
  return {
    order: {
      at,
      key,
      phone,
      customerId: customer.id,
      name: customer.name,
      address: customer.address,
      text: items.map((i) => `${i.qty} ${i.unit === "caja" ? "cajas de " : ""}${i.name}`).join(" + ") + (note ? ` · Nota: ${note}` : ""),
      items,
      total: null, // lo calcula priceOrder (cajas × unidades por caja, precios especiales, descuentos)
      review: false,
      note,
      delivery,
    },
  };
}
