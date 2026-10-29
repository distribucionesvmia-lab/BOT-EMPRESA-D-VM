// Las dos "bases de datos" de la demo del navegador: productos y clientes.
// Mismas operaciones que catalogo-db.js y clientes-db.js (que usan SQLite en el servidor), pero en memoria.
import { findCustomers } from "../identify.js";

const copy = (o) => JSON.parse(JSON.stringify(o));

/** Base de productos: precios, unidades por caja, IVA; con registro de cambios. */
export function productStore(products) {
  const rows = new Map(copy(products).map((p) => [String(p.id), { ...p, id: String(p.id), updatedAt: "inicial", changes: [] }]));
  return {
    /** Catálogo para el bot. */
    list: () => [...rows.values()].map(({ changes, updatedAt, ...p }) => p),
    rows: () => [...rows.values()],
    /** Cambia campos de un producto; devuelve true si algo cambió. */
    update(id, fields, now = new Date().toISOString()) {
      const r = rows.get(String(id));
      if (!r) throw new Error(`No existe el producto ${id}`);
      let changed = false;
      for (const [k, v] of Object.entries(fields)) {
        if (r[k] === v) continue;
        r.changes.unshift({ field: k, from: r[k], to: v, at: now });
        r[k] = v;
        changed = true;
      }
      if (changed) r.updatedAt = now;
      return changed;
    },
  };
}

/** Base de clientes: ficha, precios especiales e historial; con búsqueda por nombre (identify.js). */
export function customerStore(customers) {
  const rows = copy(customers);
  const byId = (id) => rows.find((c) => String(c.id) === String(id)) ?? null;
  return {
    getById: byId,
    find: (query) => findCustomers(rows, query).map((c) => byId(c.id)),
    rows: () =>
      rows.map((c) => ({
        id: c.id, name: c.name, phone: c.phone, recargoEquivalencia: !!c.recargoEquivalencia,
        orders: c.orders.length, lastOrder: c.orders[0]?.date ?? null,
      })),
  };
}
