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
  pin_hash    TEXT,
  matched     TEXT,
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT NOT NULL,
  phone         TEXT UNIQUE,
  email         TEXT,
  pin_hash      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  verified      INTEGER NOT NULL DEFAULT 1,
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
export const validEmail = (e) => typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

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
  // Bases creadas con versiones anteriores
  const addCol = (table, col, ddl) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((x) => x.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  };
  addCol("registrations", "pin_hash", "TEXT");
  addCol("registrations", "matched", "TEXT");
  addCol("accounts", "verified", "INTEGER NOT NULL DEFAULT 1");
  addCol("accounts", "code_key", "TEXT"); // huella del código personal que sustituye a los 6 del NIF
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code_key) WHERE code_key IS NOT NULL");
  // Cuentas creadas con versiones anteriores exigían teléfono y PIN: se reconstruye la tabla sin esa exigencia
  if (db.prepare("PRAGMA table_info(accounts)").all().find((x) => x.name === "phone")?.notnull) {
    const cols = "id, customer_id, phone, email, pin_hash, status, verified, failed, lock_count, locked_until, created_at, last_login, code_key";
    db.exec("PRAGMA foreign_keys = OFF; BEGIN");
    db.exec(`CREATE TABLE accounts_new (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, phone TEXT UNIQUE, email TEXT, pin_hash TEXT, status TEXT NOT NULL DEFAULT 'active', verified INTEGER NOT NULL DEFAULT 1, failed INTEGER NOT NULL DEFAULT 0, lock_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL, last_login TEXT, code_key TEXT);
      INSERT INTO accounts_new (${cols}) SELECT ${cols} FROM accounts; DROP TABLE accounts; ALTER TABLE accounts_new RENAME TO accounts; COMMIT; PRAGMA foreign_keys = ON;`);
  }

  const accountOut = (r) => r && { id: r.id, customerId: r.customer_id, phone: r.phone, email: r.email, status: r.status, verified: !!r.verified, locked: !!r.locked_until && r.locked_until > new Date().toISOString(), lastLogin: r.last_login, createdAt: r.created_at, ownCode: !!r.code_key };
  const byPhone = db.prepare("SELECT * FROM accounts WHERE phone = ?");
  const byId = db.prepare("SELECT * FROM accounts WHERE id = ?");
  const byCustomer = db.prepare("SELECT * FROM accounts WHERE customer_id = ? ORDER BY id LIMIT 1");
  const dropSessions = db.prepare("DELETE FROM sessions WHERE account_id = ?");

  /** Anota un fallo: 5 seguidos bloquean 15 minutos; tras 3 bloqueos la cuenta queda bloqueada hasta que la empresa la reactive. */
  const recordFail = (row, now) => {
    const failed = row.failed + 1;
    if (failed >= MAX_FAILED) {
      const locks = row.lock_count + 1;
      db.prepare("UPDATE accounts SET failed = 0, lock_count = ?, locked_until = ?, status = ? WHERE id = ?").run(locks, plus(now, LOCK_MINUTES * 60_000), locks >= MAX_LOCKS ? "blocked" : "active", row.id);
    } else db.prepare("UPDATE accounts SET failed = ? WHERE id = ?").run(failed, row.id);
  };
  const openSession = (row, now) => {
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha(token), row.id, now, plus(now, SESSION_DAYS * 86_400_000));
    return token;
  };
  const ensure = (customerId, now) => {
    const id = String(customerId);
    return byCustomer.get(id) ?? byId.get(Number(db.prepare("INSERT INTO accounts (customer_id, verified, created_at) VALUES (?, 0, ?)").run(id, now).lastInsertRowid));
  };

  return {
    /** Crea ya las cuentas de todos los clientes de la lista (sin teléfono ni PIN: entran con el NIF). Devuelve cuántas son nuevas. */
    ensureMany(customerIds, now = new Date().toISOString()) {
      let created = 0;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const id of customerIds) {
          if (!byCustomer.get(String(id))) { ensure(id, now); created++; }
        }
        db.exec("COMMIT");
        return created;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    /**
     * Acceso de un cliente habitual: nombre de empresa (candidatos) + últimos 6 caracteres del NIF.
     * check(customerId) dice si el NIF escrito es el de ese cliente. Los fallos cuentan contra las cuentas candidatas.
     * { ok:true, token, account } o { ok:false, reason: "invalid" | "locked" }.
     */
    loginNif(customerIds, check, now = new Date().toISOString()) {
      const rows = [...new Set(customerIds.map(String))].map((id) => ensure(id, now));
      const isLocked = (r) => r.status !== "active" || (r.locked_until && r.locked_until > now);
      const live = rows.filter((r) => !isLocked(r));
      if (!live.length) return { ok: false, reason: rows.length ? "locked" : "invalid" };
      const hits = live.filter((r) => check(r.customer_id));
      if (hits.length !== 1) {
        for (const r of live) recordFail(r, now);
        return { ok: false, reason: "invalid" };
      }
      const row = hits[0];
      // Conocer el NIF del cliente equivale a comprobar que es él: la cuenta pasa a confirmada
      db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL, verified = 1, last_login = ? WHERE id = ?").run(now, row.id);
      return { ok: true, token: openSession(row, now), account: accountOut(byId.get(row.id)) };
    },

    /** ¿Esta cuenta ya cambió el código del NIF por uno personal? Entonces el NIF deja de valer para entrar. */
    hasOwnCode: (customerId) => !!byCustomer.get(String(customerId))?.code_key,
    /** Guarda la huella del código personal de la cuenta. { ok:true } o { error } si otro cliente ya usa ese código. */
    setCodeKey(accountId, key) {
      try {
        return db.prepare("UPDATE accounts SET code_key = ? WHERE id = ?").run(key, accountId).changes === 1 ? { ok: true } : { error: "Cuenta no encontrada." };
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message))) return { error: "Ese código no está disponible. Elige otro." };
        throw e;
      }
    },
    /** Acceso con el código personal (la huella ya calculada). Los fallos no se anotan: no hay cuenta a la que atribuirlos. */
    loginByCode(key, now = new Date().toISOString()) {
      const row = db.prepare("SELECT * FROM accounts WHERE code_key = ?").get(key);
      if (!row) return { ok: false, reason: "invalid" };
      if (row.status !== "active" || (row.locked_until && row.locked_until > now)) return { ok: false, reason: "locked" };
      db.prepare("UPDATE accounts SET last_login = ? WHERE id = ?").run(now, row.id);
      return { ok: true, token: openSession(row, now), account: accountOut(byId.get(row.id)) };
    },

    /** El cliente pide acceso. Devuelve { id } o { error }. Una solicitud pendiente del mismo teléfono se actualiza. */
    requestRegistration({ phone, email, business, pin }, now = new Date().toISOString()) {
      const p = normalizePhone(phone);
      const biz = String(business ?? "").trim().replace(/\s+/g, " ");
      if (!p) return { error: "El teléfono no es válido." };
      if (!validEmail(String(email ?? "").trim())) return { error: "El correo no es válido." };
      if (biz.length < 2 || biz.length > 80) return { error: "Escribe el nombre de tu empresa." };
      if (pin !== undefined && !/^\d{6}$/.test(String(pin))) return { error: "El PIN debe tener 6 cifras." };
      const mail = String(email).trim();
      const hash = pin === undefined ? null : hashPin(String(pin));
      const open = db.prepare("SELECT id FROM registrations WHERE phone = ? AND status = 'pending'").get(p);
      if (open) {
        db.prepare("UPDATE registrations SET email = ?, business = ?, pin_hash = ?, created_at = ? WHERE id = ?").run(mail, biz, hash, now, open.id);
        return { id: Number(open.id) };
      }
      if (db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE status = 'pending'").get().n >= 300) return { error: "Hay demasiadas solicitudes pendientes. Inténtalo más tarde." };
      return { id: Number(db.prepare("INSERT INTO registrations (phone, email, business, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(p, mail, biz, hash, now).lastInsertRowid) };
    },
    /** Anota qué datos coincidieron con la base de clientes (se muestra a la empresa). */
    setMatched: (id, text) => void db.prepare("UPDATE registrations SET matched = ? WHERE id = ?").run(text, id),
    listRegistrations: (status = "pending") =>
      db.prepare("SELECT id, phone, email, business, status, customer_id AS customerId, matched, created_at AS createdAt FROM registrations WHERE status = ? ORDER BY id").all(status).map((r) => ({ ...r })),

    /** La empresa aprueba: liga el teléfono al cliente elegido y genera el PIN (se devuelve UNA vez). */
    approve(id, customerId, now = new Date().toISOString()) {
      const r = db.prepare("SELECT * FROM registrations WHERE id = ?").get(id);
      if (!r || r.status !== "pending") return { error: "La solicitud no existe o ya se resolvió." };
      if (byPhone.get(r.phone)) return { error: "Ese teléfono ya tiene una cuenta." };
      // Si el cliente eligió su PIN al registrarse, ese es el que vale; si no, se genera uno (y se devuelve una vez)
      const pin = r.pin_hash ? null : newPin();
      db.exec("BEGIN IMMEDIATE");
      try {
        // Si el cliente ya tenía su cuenta (creada al importar la lista), se completa con teléfono, correo y PIN; si no, se crea
        const pre = byCustomer.get(String(customerId));
        let accId;
        if (pre && !pre.phone) {
          db.prepare("UPDATE accounts SET phone = ?, email = ?, pin_hash = ? WHERE id = ?").run(r.phone, r.email, r.pin_hash ?? hashPin(pin), pre.id);
          accId = pre.id;
        } else accId = Number(db.prepare("INSERT INTO accounts (customer_id, phone, email, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(String(customerId), r.phone, r.email, r.pin_hash ?? hashPin(pin), now).lastInsertRowid);
        db.prepare("UPDATE registrations SET status = 'approved', customer_id = ?, decided_at = ? WHERE id = ?").run(String(customerId), now, id);
        db.exec("COMMIT");
        return { account: accountOut(byId.get(accId)), ...(pin ? { pin } : {}) };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    /**
     * Alta AUTOMÁTICA: el sistema comprobó los datos contra la base de clientes. Crea la cuenta enseguida con el PIN que eligió
     * el cliente, pero «sin confirmar» (verified = 0): puede entrar y pedir, y la empresa revisa sus pedidos hasta confirmarla.
     */
    registerAuto({ phone, email, business, pin, customerId, matched }, now = new Date().toISOString()) {
      const p = normalizePhone(phone);
      if (!p) return { error: "El teléfono no es válido." };
      if (!validEmail(String(email ?? "").trim())) return { error: "El correo no es válido." };
      if (!/^\d{6}$/.test(String(pin ?? ""))) return { error: "El PIN debe tener 6 cifras." };
      if (byPhone.get(p)) return { error: "Este teléfono ya tiene acceso. Entra con tu PIN, o pide uno nuevo a la empresa." };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO registrations (phone, email, business, status, customer_id, pin_hash, matched, created_at, decided_at) VALUES (?, ?, ?, 'auto', ?, NULL, ?, ?, ?)").run(p, String(email).trim(), String(business).trim().slice(0, 80), String(customerId), matched ?? null, now, now);
        const pre = byCustomer.get(String(customerId));
        let accId;
        if (pre && !pre.phone) {
          db.prepare("UPDATE accounts SET phone = ?, email = ?, pin_hash = ? WHERE id = ?").run(p, String(email).trim(), hashPin(String(pin)), pre.id);
          accId = pre.id;
        } else accId = Number(db.prepare("INSERT INTO accounts (customer_id, phone, email, pin_hash, verified, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(String(customerId), p, String(email).trim(), hashPin(String(pin)), now).lastInsertRowid);
        db.exec("COMMIT");
        return { account: accountOut(byId.get(accId)) };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    /** La empresa confirma una cuenta automática: sus pedidos ya no se retienen. */
    confirm: (accountId) => db.prepare("UPDATE accounts SET verified = 1 WHERE id = ?").run(accountId).changes === 1,
    reject(id, now = new Date().toISOString()) {
      return db.prepare("UPDATE registrations SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").run(now, id).changes === 1;
    },

    listAccounts: () => db.prepare("SELECT * FROM accounts ORDER BY id").all().map(accountOut),

    /** Acceso con teléfono + PIN. { ok:true, token, account } o { ok:false, reason: "invalid" | "locked" }. */
    login(phone, pin, now = new Date().toISOString(), verify = null) {
      const p = normalizePhone(phone);
      const row = p ? byPhone.get(p) : null;
      if (!row) {
        checkPin(String(pin ?? ""), DUMMY); // mismo coste que un intento real
        return { ok: false, reason: "invalid" };
      }
      if (row.status !== "active") return { ok: false, reason: "locked" };
      if (row.locked_until && row.locked_until > now) return { ok: false, reason: "locked" };
      // verify(cuenta): comprobación extra (p. ej. el nombre de empresa escrito coincide con el cliente de la cuenta)
      if (!row.pin_hash || !/^\d{6}$/.test(String(pin ?? "")) || !checkPin(String(pin), row.pin_hash) || (verify && !verify(accountOut(row)))) {
        recordFail(row, now);
        return { ok: false, reason: "invalid" };
      }
      db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL, last_login = ? WHERE id = ?").run(now, row.id);
      return { ok: true, token: openSession(row, now), account: accountOut(byId.get(row.id)) };
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
      db.prepare("UPDATE accounts SET pin_hash = ?, code_key = NULL, failed = 0, lock_count = 0, locked_until = NULL, status = 'active' WHERE id = ?").run(hashPin(pin), accountId);
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
