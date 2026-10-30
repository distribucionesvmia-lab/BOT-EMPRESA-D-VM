// Base de datos de CLIENTES: ficha (nombre, teléfono, dirección, recargo de equivalencia), precios especiales,
// descuentos personalizados e historial de compras. Es una base aparte de la de productos y de la de pedidos.
// El bot la consulta para identificar al cliente (por teléfono o por el nombre que escribe) y para proponerle
// sus productos habituales. Se actualiza con upsertCustomers() (por ejemplo desde a3ERP).

import { DatabaseSync } from "node:sqlite";
import { findCustomers } from "./identify.js";
import { nifKeys, nifMatches } from "./nif-key.js";

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
CREATE TABLE IF NOT EXISTS customer_phones (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  phone       TEXT NOT NULL,
  PRIMARY KEY (customer_id, phone)
);
CREATE TABLE IF NOT EXISTS customer_emails (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  email       TEXT NOT NULL,
  PRIMARY KEY (customer_id, email)
);
CREATE INDEX IF NOT EXISTS idx_cphones_phone ON customer_phones(phone);
CREATE INDEX IF NOT EXISTS idx_cemails_email ON customer_emails(email);
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
  // Bases creadas antes de existir razón social y población
  for (const col of ["legal_name", "city", "nif_keys"]) {
    if (!db.prepare("PRAGMA table_info(customers)").all().some((x) => x.name === col)) db.exec(`ALTER TABLE customers ADD COLUMN ${col} TEXT`);
  }
  const phones9 = (c) => [...new Set([...(c.phones ?? []), ...(c.phone ? [c.phone] : [])].map(last9).filter((p) => p.length === 9))];
  const emailsOf = (c) => [...new Set((c.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

  /** Cliente completo tal como lo usa el bot. */
  const full = (r) => {
    const orders = new Map();
    for (const l of db.prepare("SELECT doc, date, product_id, qty FROM purchases WHERE customer_id = ? ORDER BY date DESC, id").all(r.id)) {
      const k = `${l.date}|${l.doc}`;
      if (!orders.has(k)) orders.set(k, { doc: l.doc, date: l.date, lines: [] });
      orders.get(k).lines.push({ productId: l.product_id, qty: l.qty });
    }
    return {
      id: r.id, name: r.name, legalName: r.legal_name ?? "", city: r.city ?? "", phone: r.phone ?? "", address: r.address ?? "", recargoEquivalencia: !!r.recargo, active: !!r.active,
      phones: db.prepare("SELECT phone FROM customer_phones WHERE customer_id = ? ORDER BY phone").all(r.id).map((x) => x.phone),
      emails: db.prepare("SELECT email FROM customer_emails WHERE customer_id = ? ORDER BY email").all(r.id).map((x) => x.email),
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
            `INSERT INTO customers (id, name, legal_name, city, phone, address, recargo, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, legal_name = COALESCE(excluded.legal_name, legal_name), city = COALESCE(excluded.city, city),
               phone = COALESCE(excluded.phone, phone), address = COALESCE(excluded.address, address),
               recargo = excluded.recargo, active = excluded.active, updated_at = excluded.updated_at`,
          ).run(id, String(c.name).trim(), c.legalName ?? null, c.city ?? null, c.phone ?? phones9(c)[0] ?? null, c.address ?? null, c.recargoEquivalencia ? 1 : 0, c.active === false ? 0 : 1, now);
          // El NIF no se guarda: solo la huella de sus 6 últimos caracteres (nif-key.js). Si el cliente ya trae las huellas, se usan tal cual.
          const keys = Array.isArray(c.nifKeys) ? c.nifKeys : c.nif ? nifKeys(id, c.nif) : [];
          if (keys.length) db.prepare("UPDATE customers SET nif_keys = ? WHERE id = ?").run(JSON.stringify(keys), id);
          if (c.phones || c.phone) {
            db.prepare("DELETE FROM customer_phones WHERE customer_id = ?").run(id);
            for (const p of phones9(c)) db.prepare("INSERT OR IGNORE INTO customer_phones VALUES (?, ?)").run(id, p);
          }
          if (c.emails) {
            db.prepare("DELETE FROM customer_emails WHERE customer_id = ?").run(id);
            for (const e of emailsOf(c)) db.prepare("INSERT OR IGNORE INTO customer_emails VALUES (?, ?)").run(id, e);
          }
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

    /** Clientes activos que podrían ser el que escribe (modo flexible: «alegría» encaja con «Bar Alegría»). Solo id y nombre. */
    candidates: (query) => findCustomers(db.prepare("SELECT id, name, legal_name AS legalName, active FROM customers").all().map((r) => ({ ...r, active: !!r.active })), query, { lenient: true }).map((c) => ({ id: c.id, name: c.name })),
    /** ¿Los 6 últimos caracteres del NIF escritos corresponden a este cliente? Un cliente sin NIF guardado nunca coincide. */
    checkNif(id, typed) {
      const r = db.prepare("SELECT nif_keys FROM customers WHERE id = ? AND active = 1").get(String(id));
      return !!r?.nif_keys && nifMatches(String(id), typed, JSON.parse(r.nif_keys));
    },
    withNif: () => db.prepare("SELECT COUNT(*) AS n FROM customers WHERE nif_keys IS NOT NULL").get().n,

    getById: (id) => (byId.get(String(id)) ? full(byId.get(String(id))) : null),
    /** Cliente cuyo teléfono coincide (9 últimos dígitos). Si lo comparten varios, null: se identificará por nombre. */
    getByPhone(phone) {
      const k = last9(phone);
      if (k.length < 9) return null;
      const rows = db.prepare("SELECT c.* FROM customers c JOIN customer_phones p ON p.customer_id = c.id WHERE p.phone = ? AND c.active = 1").all(k);
      return rows.length === 1 ? full(rows[0]) : null;
    },
    /** Clientes que encajan con el nombre o código escrito (ver identify.js). */
    find(query) {
      const names = db.prepare("SELECT id, name, legal_name AS legalName, active FROM customers").all().map((r) => ({ ...r, active: !!r.active }));
      return findCustomers(names, query).map((c) => full(byId.get(c.id)));
    },

    /**
     * Comprueba una solicitud de alta contra los clientes guardados. Acceso automático solo si hay UN cliente cuyo nombre
     * (comercial o razón social) coincide con el escrito Y cuyo teléfono o correo guardados coinciden con el enviado.
     * Devuelve { customer, matched: { name, phone, email } } o { customer: null, reason, suggestions }.
     */
    matchRegistration({ phone, email, business }) {
      const k = last9(phone), mail = String(email ?? "").trim().toLowerCase();
      const names = db.prepare("SELECT id, name, legal_name AS legalName, active FROM customers").all().map((r) => ({ ...r, active: !!r.active }));
      const byName = findCustomers(names, business);
      const hasPhone = (id) => k.length === 9 && !!db.prepare("SELECT 1 FROM customer_phones WHERE customer_id = ? AND phone = ?").get(id, k);
      const hasEmail = (id) => !!mail && !!db.prepare("SELECT 1 FROM customer_emails WHERE customer_id = ? AND email = ?").get(id, mail);
      const hits = byName.filter((c) => hasPhone(c.id) || hasEmail(c.id));
      // Otros clientes que coinciden solo por teléfono o correo (para que la empresa decida)
      const contact = db.prepare("SELECT DISTINCT customer_id AS id FROM (SELECT customer_id FROM customer_phones WHERE phone = ? UNION SELECT customer_id FROM customer_emails WHERE email = ?)").all(k, mail).map((r) => r.id);
      const suggestions = [...new Set([...byName.map((c) => c.id), ...contact])].map((id) => ({ id, name: byId.get(id).name, motivo: [byName.some((c) => c.id === id) ? "nombre" : null, hasPhone(id) ? "teléfono" : null, hasEmail(id) ? "correo" : null].filter(Boolean).join(" + ") }));
      if (hits.length === 1) return { customer: full(byId.get(hits[0].id)), matched: { name: true, phone: hasPhone(hits[0].id), email: hasEmail(hits[0].id) }, suggestions };
      return { customer: null, reason: hits.length > 1 ? "ambiguo" : byName.length ? "contacto" : "nombre", suggestions };
    },

    /** Lista paginada para la empresa: busca por nombre, razón social, código, población, teléfono o correo. */
    search({ q = "", offset = 0, limit = 50 } = {}) {
      const like = `%${String(q).trim().toLowerCase()}%`;
      const rows = db
        .prepare(
          `SELECT c.*, (SELECT GROUP_CONCAT(phone, ' ') FROM customer_phones WHERE customer_id = c.id) AS phones, (SELECT GROUP_CONCAT(email, ' ') FROM customer_emails WHERE customer_id = c.id) AS emails
           FROM customers c WHERE ? = '%%' OR lower(c.name) LIKE ? OR lower(COALESCE(c.legal_name, '')) LIKE ? OR c.id LIKE ? OR lower(COALESCE(c.city, '')) LIKE ?
             OR EXISTS (SELECT 1 FROM customer_phones p WHERE p.customer_id = c.id AND p.phone LIKE ?) OR EXISTS (SELECT 1 FROM customer_emails e WHERE e.customer_id = c.id AND e.email LIKE ?)
           ORDER BY c.name LIMIT ? OFFSET ?`,
        )
        .all(like, like, like, like, like, like, like, limit, offset);
      const total = db
        .prepare(
          `SELECT COUNT(*) AS n FROM customers c WHERE ? = '%%' OR lower(c.name) LIKE ? OR lower(COALESCE(c.legal_name, '')) LIKE ? OR c.id LIKE ? OR lower(COALESCE(c.city, '')) LIKE ?
             OR EXISTS (SELECT 1 FROM customer_phones p WHERE p.customer_id = c.id AND p.phone LIKE ?) OR EXISTS (SELECT 1 FROM customer_emails e WHERE e.customer_id = c.id AND e.email LIKE ?)`,
        )
        .get(like, like, like, like, like, like, like).n;
      return { total, rows: rows.map((r) => ({ id: r.id, name: r.name, legalName: r.legal_name ?? "", city: r.city ?? "", phones: r.phones ? r.phones.split(" ") : [], emails: r.emails ? r.emails.split(" ") : [], active: !!r.active })) };
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
