// Base de datos propia de pedidos (SQLite, módulo integrado en Node 22.13+; sin dependencias).
// Aquí viven SOLO los datos nuevos del bot. Los datos que vengan del ERP no se guardan en este fichero,
// así una sincronización nunca puede borrar pedidos.
//
// Un pedido se identifica por:
//   - id/ref:  número correlativo y referencia legible (VM-2026-000123)
//   - key:     clave de idempotencia (UNIQUE). Si llega dos veces la misma clave, no se crea otro pedido.
//              Chat: "wa:<id del mensaje de WhatsApp>"; mini-app: "web:<identificador del enlace>".

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT UNIQUE,
  key           TEXT NOT NULL UNIQUE,
  customer_id   TEXT,
  phone         TEXT NOT NULL,
  name          TEXT,
  address       TEXT,
  text          TEXT,
  note          TEXT,
  total         REAL,
  review        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  export_status TEXT NOT NULL DEFAULT 'pending',
  exported_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name       TEXT,
  price      REAL,
  qty        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_export ON orders(export_status, created_at);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE TABLE IF NOT EXISTS processed_messages (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
`;

export function openDb(path = process.env.DB_PATH ?? "pedidos.sqlite") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const insertOrder = db.prepare(
    `INSERT OR IGNORE INTO orders (key, customer_id, phone, name, address, text, note, total, review, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setRef = db.prepare("UPDATE orders SET ref = ? WHERE id = ?");
  const insertLine = db.prepare("INSERT INTO order_lines (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)");
  const byKey = db.prepare("SELECT * FROM orders WHERE key = ?");
  const linesOf = db.prepare("SELECT product_id AS id, name, price, qty FROM order_lines WHERE order_id = ? ORDER BY id");
  const insertMsg = db.prepare("INSERT OR IGNORE INTO processed_messages (id, at) VALUES (?, ?)");

  const withLines = (row) => row && { ...row, review: !!row.review, items: linesOf.all(row.id) };

  return {
    /**
     * Guarda un pedido confirmado. Atómico: o se guardan cabecera y líneas, o nada.
     * Devuelve { order, duplicate }. Si la clave ya existía, devuelve el pedido original con duplicate=true.
     */
    createOrder(o) {
      if (!o?.key) throw new Error("El pedido necesita una clave de idempotencia (key)");
      if (!Array.isArray(o.items) && o.items != null) throw new Error("items debe ser una lista");
      const at = o.at ?? new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const r = insertOrder.run(o.key, o.customerId ?? null, String(o.phone), o.name ?? null, o.address ?? null, o.text ?? null, o.note || null, o.total ?? null, o.review ? 1 : 0, at);
        if (r.changes === 0) {
          db.exec("COMMIT");
          return { order: withLines(byKey.get(o.key)), duplicate: true };
        }
        const id = Number(r.lastInsertRowid);
        setRef.run(`VM-${at.slice(0, 4)}-${String(id).padStart(6, "0")}`, id);
        for (const i of o.items ?? []) insertLine.run(id, String(i.id), i.name ?? null, i.price ?? null, i.qty);
        db.exec("COMMIT");
        return { order: withLines(byKey.get(o.key)), duplicate: false };
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    hasOrderKey: (key) => !!byKey.get(key),

    /** Registra un mensaje de WhatsApp como procesado. Devuelve false si ya se había procesado (reenvío de Meta). */
    markMessage: (id) => insertMsg.run(String(id), new Date().toISOString()).changes === 1,

    listOrders({ exportStatus, limit = 200 } = {}) {
      const rows = exportStatus
        ? db.prepare("SELECT * FROM orders WHERE export_status = ? ORDER BY id DESC LIMIT ?").all(exportStatus, limit)
        : db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?").all(limit);
      return rows.map(withLines);
    },

    close: () => db.close(),
  };
}

let shared;
/** Conexión compartida de la aplicación (ruta en DB_PATH; por defecto pedidos.sqlite). */
export const getDb = () => (shared ??= openDb());
