import { deliveryAllowed } from "./delivery.js";

// Lógica de la mini-aplicación de pedido, sin red ni disco (la comparten el servidor y la demo del navegador).

/** Catálogo que ve el cliente: sus habituales primero, con las unidades de la última vez y las unidades por caja. */
export function webProducts(customer, catalog, habitualProducts) {
  const habit = new Map(habitualProducts(customer).map((p) => [p.id, p]));
  return catalog
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      price: p.price,
      unitsPerBox: Number.isInteger(p.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null,
      lastQty: habit.get(p.id)?.lastQty ?? null,
      count: habit.get(p.id)?.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
    if (!deliveryAllowed(body.delivery, at)) return { error: "Elige un día de entrega válido." };
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
