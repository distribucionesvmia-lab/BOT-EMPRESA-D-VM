// Cuentas de clientes: solicitud de alta, aprobación por la empresa, acceso con teléfono + PIN y sesiones.
// Base de datos aparte (cuentas.sqlite). Garantiza que cada cuenta queda ligada a UN cliente de la base de clientes
// y que solo la empresa puede darla de alta: el cliente pide acceso con su teléfono, correo y nombre de empresa,
// la empresa lo aprueba y le da un PIN de 6 cifras (así también se comprueba que el teléfono es suyo).
//
// Seguridad:
//  - El PIN y el token de sesión no se guardan en claro: el PIN con scrypt + sal, el token con SHA-256.
//  - 5 fallos seguidos bloquean la cuenta 15 minutos; tras 3 bloqueos queda bloqueada hasta que la empresa la reactive.
//  - Un teléfono desconocido y un PIN erróneo dan la misma respuesta (no se revela qué teléfonos son clientes).

import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS registrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  business    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  customer_id TEXT,
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  email         TEXT,
  pin_hash      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  failed        INTEGER NOT NULL DEFAULT 0,
  lock_count    INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
`;

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
export const MAX_LOCKS = 3;
export const SESSION_DAYS = 30;

/** 9 últimos dígitos del teléfono; null si no parece un teléfono. */
export function normalizePhone(p) {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 9 && d.length <= 15 ? d.slice(-9) : null;
}
const validEmail = (e) => typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const hashPin = (pin) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(pin, salt, 32).toString("hex")}`;
};
const checkPin = (pin, stored) => {
  const [, salt, hash] = String(stored).split("$");
  const a = crypto.scryptSync(String(pin), Buffer.from(salt, "hex"), 32);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const DUMMY = hashPin("000000"); // para gastar el mismo tiempo con teléfonos desconocidos
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const newPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const plus = (iso, ms) => new Date(new Date(iso).getTime() + ms).toISOString();

export function openAccountsDb(path = process.env.ACCOUNTS_DB ?? "cuentas.sqlite") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const accountOut = (r) => r && { id: r.id, customerId: r.customer_id, phone: r.phone, email: r.email, status: r.status, locked: !!r.locked_until && r.locked_until > new Date().toISOString(), lastLogin: r.last_login, createdAt: r.created_at };
  const byPhone = db.prepare("SELECT * FROM accounts WHERE phone = ?");
  const byId = db.prepare("SELECT * FROM accounts WHERE id = ?");
  const dropSessions = db.prepare("DELETE FROM sessions WHERE account_id = ?");

  return {
    /** El cliente pide acceso. Devuelve { id } o { error }. Una solicitud pendiente del mismo teléfono se actualiza. */
    requestRegistration({ phone, email, business }, now = new Date().toISOString()) {
      const p = normalizePhone(phone);
      const biz = String(business ?? "").trim().replace(/\s+/g, " ");
      if (!p) return { error: "El teléfono no es válido." };
      if (!validEmail(String(email ?? "").trim())) return { error: "El correo no es válido." };
      if (biz.length < 2 || biz.length > 80) return { error: "Escribe el nombre de tu empresa." };
      const mail = String(email).trim();
      const open = db.prepare("SELECT id FROM registrations WHERE phone = ? AND status = 'pending'").get(p);
      if (open) {
        db.prepare("UPDATE registrations SET email = ?, business = ?, created_at = ? WHERE id = ?").run(mail, biz, now, open.id);
        return { id: Number(open.id) };
      }
      if (db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE status = 'pending'").get().n >= 300) return { error: "Hay demasiadas solicitudes pendientes. Inténtalo más tarde." };
      return { id: Number(db.prepare("INSERT INTO registrations (phone, email, business, created_at) VALUES (?, ?, ?, ?)").run(p, mail, biz, now).lastInsertRowid) };
    },
    listRegistrations: (status = "pending") =>
      db.prepare("SELECT id, phone, email, business, status, customer_id AS customerId, created_at AS createdAt FROM registrations WHERE status = ? ORDER BY id").all(status).map((r) => ({ ...r })),

    /** La empresa aprueba: liga el teléfono al cliente elegido y genera el PIN (se devuelve UNA vez). */
    approve(id, customerId, now = new Date().toISOString()) {
      const r = db.prepare("SELECT * FROM registrations WHERE id = ?").get(id);
      if (!r || r.status !== "pending") return { error: "La solicitud no existe o ya se resolvió." };
      if (byPhone.get(r.phone)) return { error: "Ese teléfono ya tiene una cuenta." };
      const pin = newPin();
      db.exec("BEGIN IMMEDIATE");
      try {
        const accId = Number(db.prepare("INSERT INTO accounts (customer_id, phone, email, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(String(customerId), r.phone, r.email, hashPin(pin), now).lastInsertRowid);
        db.prepare("UPDATE registrations SET status = 'approved', customer_id = ?, decided_at = ? WHERE id = ?").run(String(customerId), now, id);
        db.exec("COMMIT");
        return { account: accountOut(byId.get(accId)), pin };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    reject(id, now = new Date().toISOString()) {
      return db.prepare("UPDATE registrations SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").run(now, id).changes === 1;
    },

    listAccounts: () => db.prepare("SELECT * FROM accounts ORDER BY id").all().map(accountOut),

    /** Acceso con teléfono + PIN. { ok:true, token, account } o { ok:false, reason: "invalid" | "locked" }. */
    login(phone, pin, now = new Date().toISOString()) {
      const p = normalizePhone(phone);
      const row = p ? byPhone.get(p) : null;
      if (!row) {
        checkPin(String(pin ?? ""), DUMMY); // mismo coste que un intento real
        return { ok: false, reason: "invalid" };
      }
      if (row.status !== "active") return { ok: false, reason: "locked" };
      if (row.locked_until && row.locked_until > now) return { ok: false, reason: "locked" };
      if (!/^\d{6}$/.test(String(pin ?? "")) || !checkPin(String(pin), row.pin_hash)) {
        const failed = row.failed + 1;
        if (failed >= MAX_FAILED) {
          const locks = row.lock_count + 1;
          db.prepare("UPDATE accounts SET failed = 0, lock_count = ?, locked_until = ?, status = ? WHERE id = ?").run(locks, plus(now, LOCK_MINUTES * 60_000), locks >= MAX_LOCKS ? "blocked" : "active", row.id);
        } else db.prepare("UPDATE accounts SET failed = ? WHERE id = ?").run(failed, row.id);
        return { ok: false, reason: "invalid" };
      }
      db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL, last_login = ? WHERE id = ?").run(now, row.id);
      const token = crypto.randomBytes(32).toString("base64url");
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
      db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha(token), row.id, now, plus(now, SESSION_DAYS * 86_400_000));
      return { ok: true, token, account: accountOut(byId.get(row.id)) };
    },

    /** Cuenta de una sesión válida (activa y sin caducar), o null. */
    sessionAccount(token, now = new Date().toISOString()) {
      if (!token || typeof token !== "string") return null;
      const s = db.prepare("SELECT account_id, expires_at FROM sessions WHERE token_hash = ?").get(sha(token));
      if (!s || s.expires_at < now) return null;
      const a = byId.get(s.account_id);
      return a && a.status === "active" ? accountOut(a) : null;
    },
    logout: (token) => void db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(String(token))),

    /** Nuevo PIN (lo da la empresa): cierra todas las sesiones y quita bloqueos. Devuelve el PIN una vez. */
    resetPin(accountId) {
      if (!byId.get(accountId)) return null;
      const pin = newPin();
      db.prepare("UPDATE accounts SET pin_hash = ?, failed = 0, lock_count = 0, locked_until = NULL, status = 'active' WHERE id = ?").run(hashPin(pin), accountId);
      dropSessions.run(accountId);
      return pin;
    },
    setBlocked(accountId, blocked) {
      db.prepare("UPDATE accounts SET status = ? WHERE id = ?").run(blocked ? "blocked" : "active", accountId);
      if (blocked) dropSessions.run(accountId);
      else db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL WHERE id = ?").run(accountId);
    },
    close: () => db.close(),
  };
}
