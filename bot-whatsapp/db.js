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
  reason        TEXT,
  re            INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'confirmed',
  export_status TEXT NOT NULL DEFAULT 'pending',
  exported_at   TEXT,
  export_id     INTEGER REFERENCES exports(id),
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  format      TEXT NOT NULL,
  file_name   TEXT NOT NULL UNIQUE,
  sha256      TEXT NOT NULL,
  order_count INTEGER NOT NULL,
  line_count  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name       TEXT,
  price      REAL,
  qty        INTEGER NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'ud',
  boxes      INTEGER,
  units      INTEGER,
  discount   REAL NOT NULL DEFAULT 0,
  vat_rate   REAL,
  amount     REAL,
  note       TEXT
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
  // Bases creadas con versiones anteriores: añadir las columnas que falten
  const addColumn = (table, column, ddl) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn("orders", "export_id", "INTEGER REFERENCES exports(id)");
  addColumn("orders", "re", "INTEGER NOT NULL DEFAULT 0");
  addColumn("orders", "reason", "TEXT");
  for (const [c, ddl] of [["unit", "TEXT NOT NULL DEFAULT 'ud'"], ["boxes", "INTEGER"], ["units", "INTEGER"], ["discount", "REAL NOT NULL DEFAULT 0"], ["vat_rate", "REAL"], ["amount", "REAL"], ["note", "TEXT"]]) {
    addColumn("order_lines", c, ddl);
  }

  const insertOrder = db.prepare(
    `INSERT OR IGNORE INTO orders (key, customer_id, phone, name, address, text, note, total, review, reason, re, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setRef = db.prepare("UPDATE orders SET ref = ? WHERE id = ?");
  const insertLine = db.prepare(
    "INSERT INTO order_lines (order_id, product_id, name, price, qty, unit, boxes, units, discount, vat_rate, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const byKey = db.prepare("SELECT * FROM orders WHERE key = ?");
  const linesOf = db.prepare(
    "SELECT product_id AS id, name, price, qty, unit, boxes, units, discount, vat_rate, amount, note FROM order_lines WHERE order_id = ? ORDER BY id",
  );
  const insertMsg = db.prepare("INSERT OR IGNORE INTO processed_messages (id, at) VALUES (?, ?)");

  const withLines = (row) => row && { ...row, review: !!row.review, re: !!row.re, items: linesOf.all(row.id) };

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
        const r = insertOrder.run(o.key, o.customerId ?? null, String(o.phone), o.name ?? null, o.address ?? null, o.text ?? null, o.note || null, o.total ?? null, o.review ? 1 : 0, o.reason ?? null, o.re ? 1 : 0, at);
        if (r.changes === 0) {
          db.exec("COMMIT");
          return { order: withLines(byKey.get(o.key)), duplicate: true };
        }
        const id = Number(r.lastInsertRowid);
        setRef.run(`VM-${at.slice(0, 4)}-${String(id).padStart(6, "0")}`, id);
        for (const i of o.items ?? []) {
          insertLine.run(id, String(i.id), i.name ?? null, i.price ?? null, i.qty, i.unit ?? "ud", i.boxes ?? null, i.units ?? i.qty, i.discount ?? 0, i.vat ?? null, i.amount ?? null, i.note ?? null);
        }
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

    /**
     * Exporta de forma atómica los pedidos confirmados y pendientes.
     * build(orders) debe generar y guardar el fichero y devolver { format, fileName, sha256, lineCount, discard() }.
     * Si algo falla (generar el fichero o anotar la exportación), no se marca ningún pedido y el fichero se descarta:
     * los pedidos siguen pendientes y se reintentan en la siguiente exportación.
     * Un pedido solo se exporta si es seguro: con código de cliente, con líneas y sin marca de "revisar".
     * Devuelve { export, held }: export es null si no había nada que exportar; held, cuántos pedidos pendientes
     * quedan retenidos esperando revisión.
     */
    exportPending(build, now = new Date().toISOString()) {
      db.exec("BEGIN IMMEDIATE");
      let built;
      try {
        const pending = db.prepare("SELECT * FROM orders WHERE export_status = 'pending' AND status = 'confirmed' ORDER BY id").all().map(withLines);
        const ready = pending.filter((o) => !o.review && o.customer_id && o.items.length);
        const held = pending.length - ready.length;
        if (!ready.length) {
          db.exec("COMMIT");
          return { export: null, held };
        }
        built = build(ready);
        const r = db
          .prepare("INSERT INTO exports (created_at, format, file_name, sha256, order_count, line_count) VALUES (?, ?, ?, ?, ?, ?)")
          .run(now, built.format, built.fileName, built.sha256, ready.length, built.lineCount);
        const exportId = Number(r.lastInsertRowid);
        const mark = db.prepare("UPDATE orders SET export_status = 'exported', exported_at = ?, export_id = ? WHERE id = ? AND export_status = 'pending'");
        for (const o of ready) if (mark.run(now, exportId, o.id).changes !== 1) throw new Error(`El pedido ${o.ref} ya no estaba pendiente`);
        db.exec("COMMIT");
        return { export: { id: exportId, ...db.prepare("SELECT * FROM exports WHERE id = ?").get(exportId) }, held };
      } catch (err) {
        db.exec("ROLLBACK");
        built?.discard?.();
        throw err;
      }
    },

    listExports: (limit = 100) => db.prepare("SELECT * FROM exports ORDER BY id DESC LIMIT ?").all(limit),
    getExport: (id) => db.prepare("SELECT * FROM exports WHERE id = ?").get(id) ?? null,
    exportedOrders: (exportId) => db.prepare("SELECT * FROM orders WHERE export_id = ? ORDER BY id").all(exportId).map(withLines),

    /** Un responsable da por revisado un pedido retenido (marcado "revisar"), para que entre en la siguiente exportación. */
    approveOrder(ref) {
      return db.prepare("UPDATE orders SET review = 0 WHERE ref = ? AND export_status = 'pending'").run(ref).changes === 1;
    },

    /** Copia consistente de toda la base de datos en un fichero nuevo (sin parar el servicio). */
    backupTo(file) {
      db.prepare("VACUUM INTO ?").run(file);
    },

    /** Comprobación de salud: la base de datos responde. */
    ping: () => db.prepare("SELECT 1 AS ok").get().ok === 1,

    close: () => db.close(),
  };
}

let shared;
/** Conexión compartida de la aplicación (ruta en DB_PATH; por defecto pedidos.sqlite). */
export const getDb = () => (shared ??= openDb());
