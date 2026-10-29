// Base de datos de CLIENTES: ficha (nombre, teléfono, dirección, recargo de equivalencia), precios especiales,
// descuentos personalizados e historial de compras. Es una base aparte de la de productos y de la de pedidos.
// El bot la consulta para identificar al cliente (por teléfono o por el nombre que escribe) y para proponerle
// sus productos habituales. Se actualiza con upsertCustomers() (por ejemplo desde a3ERP).

import { DatabaseSync } from "node:sqlite";
import { findCustomers } from "./identify.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  recargo    INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_prices (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id  TEXT NOT NULL,
  price       REAL NOT NULL,
  PRIMARY KEY (customer_id, product_id)
);
CREATE TABLE IF NOT EXISTS customer_discounts (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id  TEXT NOT NULL,
  pct         REAL NOT NULL,
  PRIMARY KEY (customer_id, product_id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  doc         TEXT NOT NULL,
  date        TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  qty         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases(customer_id, date);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
`;

const last9 = (p) => String(p ?? "").replace(/\D/g, "").slice(-9);

export function openCustomersDb(path = process.env.CUSTOMERS_DB ?? "clientes.sqlite") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  /** Cliente completo tal como lo usa el bot. */
  const full = (r) => {
    const orders = new Map();
    for (const l of db.prepare("SELECT doc, date, product_id, qty FROM purchases WHERE customer_id = ? ORDER BY date DESC, id").all(r.id)) {
      const k = `${l.date}|${l.doc}`;
      if (!orders.has(k)) orders.set(k, { doc: l.doc, date: l.date, lines: [] });
      orders.get(k).lines.push({ productId: l.product_id, qty: l.qty });
    }
    return {
      id: r.id, name: r.name, phone: r.phone ?? "", address: r.address ?? "", recargoEquivalencia: !!r.recargo, active: !!r.active,
      specialPrices: Object.fromEntries(db.prepare("SELECT product_id, price FROM customer_prices WHERE customer_id = ?").all(r.id).map((x) => [x.product_id, x.price])),
      discounts: Object.fromEntries(db.prepare("SELECT product_id, pct FROM customer_discounts WHERE customer_id = ?").all(r.id).map((x) => [x.product_id, x.pct])),
      orders: [...orders.values()],
      frequent: [],
    };
  };
  const byId = db.prepare("SELECT * FROM customers WHERE id = ?");

  return {
    /**
     * Crea o actualiza clientes (todo o nada). Si el cliente trae orders / specialPrices / discounts, sustituyen a los
     * que había (la fuente de verdad es el ERP); si no los trae, se conservan.
     */
    upsertCustomers(list, { now = new Date().toISOString() } = {}) {
      for (const c of list) {
        if (!String(c?.id ?? "").trim() || !String(c?.name ?? "").trim()) throw new Error("Un cliente necesita código (id) y nombre");
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = { added: 0, updated: 0 };
        for (const c of list) {
          const id = String(c.id).trim();
          out[byId.get(id) ? "updated" : "added"]++;
          db.prepare(
            `INSERT INTO customers (id, name, phone, address, recargo, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, address = excluded.address,
               recargo = excluded.recargo, active = excluded.active, updated_at = excluded.updated_at`,
          ).run(id, String(c.name).trim(), c.phone ?? null, c.address ?? null, c.recargoEquivalencia ? 1 : 0, c.active === false ? 0 : 1, now);
          if (c.specialPrices) {
            db.prepare("DELETE FROM customer_prices WHERE customer_id = ?").run(id);
            for (const [pid, price] of Object.entries(c.specialPrices)) db.prepare("INSERT INTO customer_prices VALUES (?, ?, ?)").run(id, String(pid), Number(price));
          }
          if (c.discounts) {
            db.prepare("DELETE FROM customer_discounts WHERE customer_id = ?").run(id);
            for (const [pid, pct] of Object.entries(c.discounts)) db.prepare("INSERT INTO customer_discounts VALUES (?, ?, ?)").run(id, String(pid), Number(pct));
          }
          if (c.orders) {
            db.prepare("DELETE FROM purchases WHERE customer_id = ?").run(id);
            for (const o of c.orders) for (const l of o.lines) db.prepare("INSERT INTO purchases (customer_id, doc, date, product_id, qty) VALUES (?, ?, ?, ?, ?)").run(id, String(o.doc), String(o.date), String(l.productId), Math.floor(Number(l.qty)));
          }
        }
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    getById: (id) => (byId.get(String(id)) ? full(byId.get(String(id))) : null),
    /** Cliente cuyo teléfono coincide (9 últimos dígitos). Si lo comparten varios, null: se identificará por nombre. */
    getByPhone(phone) {
      const k = last9(phone);
      if (k.length < 9) return null;
      const rows = db.prepare("SELECT * FROM customers WHERE active = 1").all().filter((r) => last9(r.phone) === k);
      return rows.length === 1 ? full(rows[0]) : null;
    },
    /** Clientes que encajan con el nombre o código escrito (ver identify.js). */
    find(query) {
      const names = db.prepare("SELECT id, name, active FROM customers").all().map((r) => ({ ...r, active: !!r.active }));
      return findCustomers(names, query).map((c) => full(byId.get(c.id)));
    },
    /** Lista ligera para paneles: sin historial. */
    list: () =>
      db.prepare("SELECT c.*, (SELECT COUNT(DISTINCT doc || date) FROM purchases p WHERE p.customer_id = c.id) AS n_orders, (SELECT MAX(date) FROM purchases p WHERE p.customer_id = c.id) AS last_order FROM customers c ORDER BY name")
        .all()
        .map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? "", address: r.address ?? "", recargoEquivalencia: !!r.recargo, active: !!r.active, orders: r.n_orders, lastOrder: r.last_order, updatedAt: r.updated_at })),
    count: () => db.prepare("SELECT COUNT(*) AS n FROM customers").get().n,
    close: () => db.close(),
  };
}
