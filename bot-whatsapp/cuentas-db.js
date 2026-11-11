// Cuentas de clientes: solicitud de alta, aprobación por la empresa, acceso con teléfono + PIN y sesiones.
// Base de datos aparte (cuentas.sqlite). Garantiza que cada cuenta queda ligada a UN cliente de la base de clientes
// y que solo la empresa puede darla de alta: el cliente pide acceso con su teléfono, correo y nombre de empresa,
// la empresa lo aprueba y le da una contraseña de 6 letras o números (así también se comprueba que el teléfono es suyo).
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
// Contraseña: 6 letras o números; mayúsculas y minúsculas son lo mismo (se guarda y se compara en MAYÚSCULAS)
export const normPin = (p) => String(p ?? "").trim().toUpperCase();
export const pinValido = (p) => /^[A-Z0-9]{6}$/.test(normPin(p));
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
  // Favoritos del cliente (privados, por cliente; no los toca la sincronización con a3ERP)
  // Pedido fijo semanal (F-16): la plantilla de líneas y los días de reparto; NUNCA se envía solo, el cliente la revisa cada día que toca
  db.exec("CREATE TABLE IF NOT EXISTS standing_orders (customer_id TEXT PRIMARY KEY, lines TEXT NOT NULL, days TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS reminders (customer_id TEXT NOT NULL, day TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (customer_id, day))"); // day = '' para «no avisar más»
  db.exec("CREATE TABLE IF NOT EXISTS favorites (customer_id TEXT NOT NULL, product_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (customer_id, product_id))");
  // Derechos de protección de datos que el cliente ejerce desde la aplicación (corregir, limitar, oponerse, otra) y bajas de cuenta
  // Uso de la aplicación: solo contadores por día y tipo de suceso (repetir, abandono, pedido…); no se guarda quién ni qué pide
  db.exec("CREATE TABLE IF NOT EXISTS uso (dia TEXT NOT NULL, evento TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, suma INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, evento))");
  db.exec("CREATE TABLE IF NOT EXISTS rights (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, tipo TEXT NOT NULL, texto TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', created_at TEXT NOT NULL, resolved_at TEXT)");
  addCol("accounts", "deleted_at", "TEXT");
  addCol("registrations", "pin_hash", "TEXT");
  addCol("registrations", "nif", "TEXT"); // DNI/NIE/CIF que escribe un cliente nuevo: la empresa lo necesita para darlo de alta; se borra al resolver la solicitud
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
     * Acceso de un cliente habitual: nombre de empresa (candidatos) + 6 primeros dígitos del DNI.
     * check(customerId) dice si el NIF escrito es el de ese cliente. Los fallos cuentan contra las cuentas candidatas.
     * { ok:true, token, account } o { ok:false, reason: "invalid" | "locked" }.
     */
    loginNif(customerIds, check, now = new Date().toISOString()) {
      const rows = [...new Set(customerIds.map(String))].map((id) => ensure(id, now));
      const isLocked = (r) => r.status !== "active" || (r.locked_until && r.locked_until > now);
      const live = rows.filter((r) => !isLocked(r));
      if (!live.length) return { ok: false, reason: rows.length && rows.every((r) => r.status === "deleted") ? "deleted" : rows.length ? "locked" : "invalid" };
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
    /** Ids de los productos favoritos del cliente (los más recientes primero). */
    favorites: (customerId) => db.prepare("SELECT product_id FROM favorites WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC").all(String(customerId)).map((r) => r.product_id),
    /** Marca o desmarca un favorito. Máximo 300 por cliente. Devuelve false si se pasa del máximo. */
    setFavorite(customerId, productId, on, now = new Date().toISOString()) {
      const c = String(customerId), p = String(productId);
      if (!on) { db.prepare("DELETE FROM favorites WHERE customer_id = ? AND product_id = ?").run(c, p); return true; }
      if (db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE customer_id = ?").get(c).n >= 300) return false;
      db.prepare("INSERT OR IGNORE INTO favorites (customer_id, product_id, created_at) VALUES (?, ?, ?)").run(c, p, now);
      return true;
    },
    /** Pedido fijo del cliente: { lines:[{id,qty,unit,note}], days:[1..5], paused } o null. */
    getStanding(customerId) {
      const r = db.prepare("SELECT * FROM standing_orders WHERE customer_id = ?").get(String(customerId));
      return r ? { lines: JSON.parse(r.lines), days: JSON.parse(r.days), paused: !!r.paused, updatedAt: r.updated_at } : null;
    },
    setStanding(customerId, { lines, days }, now = new Date().toISOString()) {
      const ls = (Array.isArray(lines) ? lines : []).slice(0, 80).map((l) => ({ id: String(l.id), qty: Math.min(999, Math.max(1, Math.floor(Number(l.qty)))), unit: l.unit === "caja" ? "caja" : "ud", note: String(l.note ?? "").slice(0, 120) })).filter((l) => l.id && Number.isFinite(l.qty));
      const ds = [...new Set((Array.isArray(days) ? days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 5))].sort();
      if (!ls.length || !ds.length) return false;
      db.prepare("INSERT INTO standing_orders (customer_id, lines, days, paused, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(customer_id) DO UPDATE SET lines = excluded.lines, days = excluded.days, paused = 0, updated_at = excluded.updated_at").run(String(customerId), JSON.stringify(ls), JSON.stringify(ds), now);
      return true;
    },
    allStanding() { const m = new Map(); for (const r of db.prepare("SELECT customer_id, days, paused FROM standing_orders").all()) m.set(r.customer_id, { days: JSON.parse(r.days), paused: !!r.paused }); return m; },
    /** «Ya avisado» (solo hoy) o «No avisar más» (siempre) para un cliente. */
    markReminder(customerId, state, day) { if (state === "nunca") db.prepare("INSERT OR REPLACE INTO reminders (customer_id, day, state) VALUES (?, '', 'nunca')").run(String(customerId)); else db.prepare("INSERT OR REPLACE INTO reminders (customer_id, day, state) VALUES (?, ?, 'avisado')").run(String(customerId), String(day)); return true; },
    reminderSets(day) { const r = db.prepare("SELECT customer_id, day, state FROM reminders WHERE day = '' OR day = ?").all(String(day)); return { avisadosHoy: new Set(r.filter((x) => x.state === "avisado").map((x) => x.customer_id)), nunca: new Set(r.filter((x) => x.state === "nunca").map((x) => x.customer_id)) }; },
    pauseStanding: (customerId, paused) => db.prepare("UPDATE standing_orders SET paused = ? WHERE customer_id = ?").run(paused ? 1 : 0, String(customerId)).changes === 1,
    deleteStanding: (customerId) => db.prepare("DELETE FROM standing_orders WHERE customer_id = ?").run(String(customerId)).changes === 1,
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
    requestRegistration({ phone, email, business, pin, nif }, now = new Date().toISOString()) {
      const p = normalizePhone(phone);
      const biz = String(business ?? "").trim().replace(/\s+/g, " ");
      if (!p) return { error: "El teléfono no es válido." };
      if (!validEmail(String(email ?? "").trim())) return { error: "El correo no es válido." };
      if (biz.length < 2 || biz.length > 80) return { error: "Escribe el nombre de tu empresa." };
      if (pin !== undefined && !pinValido(pin)) return { error: "La contraseña debe tener 6 letras o números." };
      const mail = String(email).trim();
      const dni = nif === undefined ? null : String(nif).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (dni !== null && !/^[A-Z0-9]{8,10}$/.test(dni)) return { error: "Escribe tu DNI, NIE o CIF." };
      const hash = pin === undefined ? null : hashPin(normPin(pin));
      const open = db.prepare("SELECT id FROM registrations WHERE phone = ? AND status = 'pending'").get(p);
      if (open) {
        db.prepare("UPDATE registrations SET email = ?, business = ?, pin_hash = ?, nif = ?, created_at = ? WHERE id = ?").run(mail, biz, hash, dni, now, open.id);
        return { id: Number(open.id) };
      }
      if (db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE status = 'pending'").get().n >= 300) return { error: "Hay demasiadas solicitudes pendientes. Inténtalo más tarde." };
      return { id: Number(db.prepare("INSERT INTO registrations (phone, email, business, pin_hash, nif, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(p, mail, biz, hash, dni, now).lastInsertRowid) };
    },
    /** Anota qué datos coincidieron con la base de clientes (se muestra a la empresa). */
    setMatched: (id, text) => void db.prepare("UPDATE registrations SET matched = ? WHERE id = ?").run(text, id),
    listRegistrations: (status = "pending") =>
      db.prepare("SELECT id, phone, email, business, nif, status, customer_id AS customerId, matched, created_at AS createdAt FROM registrations WHERE status = ? ORDER BY id").all(status).map((r) => ({ ...r })),

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
          db.prepare("UPDATE accounts SET phone = ?, email = ?, pin_hash = ?, status = CASE WHEN status = 'deleted' THEN 'active' ELSE status END WHERE id = ?").run(r.phone, r.email, r.pin_hash ?? hashPin(pin), pre.id);
          accId = pre.id;
        } else accId = Number(db.prepare("INSERT INTO accounts (customer_id, phone, email, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(String(customerId), r.phone, r.email, r.pin_hash ?? hashPin(pin), now).lastInsertRowid);
        db.prepare("UPDATE registrations SET status = 'approved', nif = NULL, customer_id = ?, decided_at = ? WHERE id = ?").run(String(customerId), now, id);
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
      if (!pinValido(pin)) return { error: "La contraseña debe tener 6 letras o números." };
      if (byPhone.get(p)) return { error: "Este teléfono ya tiene acceso. Entra con tu PIN, o pide uno nuevo a la empresa." };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO registrations (phone, email, business, status, customer_id, pin_hash, matched, created_at, decided_at) VALUES (?, ?, ?, 'auto', ?, NULL, ?, ?, ?)").run(p, String(email).trim(), String(business).trim().slice(0, 80), String(customerId), matched ?? null, now, now);
        const pre = byCustomer.get(String(customerId));
        let accId;
        if (pre && !pre.phone) {
          db.prepare("UPDATE accounts SET phone = ?, email = ?, pin_hash = ?, status = CASE WHEN status = 'deleted' THEN 'active' ELSE status END WHERE id = ?").run(p, String(email).trim(), hashPin(normPin(pin)), pre.id);
          accId = pre.id;
        } else accId = Number(db.prepare("INSERT INTO accounts (customer_id, phone, email, pin_hash, verified, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(String(customerId), p, String(email).trim(), hashPin(normPin(pin)), now).lastInsertRowid);
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
      return db.prepare("UPDATE registrations SET status = 'rejected', nif = NULL, decided_at = ? WHERE id = ? AND status = 'pending'").run(now, id).changes === 1;
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
      if (row.status === "deleted") return { ok: false, reason: "deleted" };
      if (row.status !== "active") return { ok: false, reason: "locked" };
      if (row.locked_until && row.locked_until > now) return { ok: false, reason: "locked" };
      // verify(cuenta): comprobación extra (p. ej. el nombre de empresa escrito coincide con el cliente de la cuenta)
      if (!row.pin_hash || !pinValido(pin) || !checkPin(normPin(pin), row.pin_hash) || (verify && !verify(accountOut(row)))) {
        recordFail(row, now);
        return { ok: false, reason: "invalid" };
      }
      db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL, last_login = ? WHERE id = ?").run(now, row.id);
      return { ok: true, token: openSession(row, now), account: accountOut(byId.get(row.id)) };
    },

    /**
     * Acceso de un cliente habitual con el teléfono que consta en la lista de clientes + la contraseña personal que eligió dentro de la aplicación.
     * Los fallos se anotan en su cuenta (5 seguidos la bloquean 15 minutos, como en el resto de accesos).
     */
    loginCustomerCode(customerId, key, now = new Date().toISOString()) {
      const row = byCustomer.get(String(customerId));
      if (!row) return { ok: false, reason: "invalid" };
      if (row.status === "deleted") return { ok: false, reason: "deleted" };
      if (row.status !== "active" || (row.locked_until && row.locked_until > now)) return { ok: false, reason: "locked" };
      if (!row.code_key || row.code_key !== key) { recordFail(row, now); return { ok: false, reason: "invalid" }; }
      db.prepare("UPDATE accounts SET failed = 0, lock_count = 0, locked_until = NULL, last_login = ? WHERE id = ?").run(now, row.id);
      return { ok: true, token: openSession(row, now), account: accountOut(byId.get(row.id)) };
    },

    /** Cuenta un suceso de uso (sin datos personales). evento: repetir | abandono | pedido | catalogo; seg = segundos hasta pedir (solo «pedido»). */
    anotarUso(evento, seg = null, now = new Date().toISOString()) {
      if (!["repetir", "abandono", "pedido", "catalogo"].includes(evento)) return false;
      const dia = now.slice(0, 10), s = evento === "pedido" && Number.isFinite(Number(seg)) ? Math.max(0, Math.min(86400, Math.round(Number(seg)))) : 0;
      db.prepare("INSERT INTO uso (dia, evento, n, suma) VALUES (?, ?, 1, ?) ON CONFLICT(dia, evento) DO UPDATE SET n = n + 1, suma = suma + excluded.suma").run(dia, evento, s);
      return true;
    },
    /** Resumen de los últimos `dias` días: repeticiones, pedidos, carritos abandonados y tiempo medio hasta pedir. */
    resumenUso(dias = 30, now = new Date().toISOString()) {
      const desde = new Date(new Date(now).getTime() - (dias - 1) * 86_400_000).toISOString().slice(0, 10);
      const filas = db.prepare("SELECT evento, SUM(n) AS n, SUM(suma) AS suma FROM uso WHERE dia >= ? GROUP BY evento").all(desde);
      const n = (e) => Number(filas.find((f) => f.evento === e)?.n ?? 0), suma = (e) => Number(filas.find((f) => f.evento === e)?.suma ?? 0);
      const pedidos = n("pedido"), abandonos = n("abandono");
      return { dias, repeticiones: n("repetir"), pedidos, abandonos, catalogoAbierto: n("catalogo"), tasaAbandono: pedidos + abandonos ? Math.round((abandonos / (pedidos + abandonos)) * 100) : null, segundosMedioHastaPedir: pedidos ? Math.round(suma("pedido") / pedidos) : null };
    },

    /** Solicitud de un derecho (corregir, limitar, oponerse, otra) que llega a la empresa. { id } o { error }. */
    addRightsRequest({ customerId, tipo, texto }, now = new Date().toISOString()) {
      if (!["corregir", "limitar", "oponerme", "otra"].includes(tipo)) return { error: "Elige qué quieres pedir." };
      const t = String(texto ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
      if (t.length < 3) return { error: "Cuéntanos qué necesitas (unas palabras bastan)." };
      return { id: Number(db.prepare("INSERT INTO rights (customer_id, tipo, texto, created_at) VALUES (?, ?, ?, ?)").run(String(customerId), tipo, t, now).lastInsertRowid) };
    },
    listRightsRequests: (estado = null) => db.prepare(`SELECT * FROM rights ${estado ? "WHERE estado = ?" : ""} ORDER BY id DESC LIMIT 300`).all(...(estado ? [estado] : [])),
    resolveRightsRequest: (id, now = new Date().toISOString()) => db.prepare("UPDATE rights SET estado = 'atendida', resolved_at = ? WHERE id = ? AND estado = 'pendiente'").run(now, Number(id)).changes === 1,
    /**
     * Baja de la cuenta a petición del cliente (derecho de supresión): se borran su acceso (teléfono, correo, contraseñas), sus sesiones, sus favoritos y sus
     * solicitudes de alta. La cuenta queda marcada como eliminada (así la sincronización con a3ERP no la vuelve a crear). Los pedidos y las facturas
     * se conservan, bloqueados, durante los plazos que exige la ley, y no los ve nadie del lado del cliente. Queda anotado para la empresa.
     */
    deleteAccount(accountId, now = new Date().toISOString()) {
      const row = byId.get(Number(accountId));
      if (!row) return { ok: false };
      db.exec("BEGIN IMMEDIATE");
      try {
        dropSessions.run(row.id);
        db.prepare("DELETE FROM favorites WHERE customer_id = ?").run(row.customer_id);
        db.prepare("DELETE FROM standing_orders WHERE customer_id = ?").run(row.customer_id);
        db.prepare("DELETE FROM registrations WHERE customer_id = ? OR (phone = ? AND ? IS NOT NULL)").run(row.customer_id, row.phone, row.phone);
        db.prepare("UPDATE accounts SET phone = NULL, email = NULL, pin_hash = NULL, code_key = NULL, status = 'deleted', verified = 0, failed = 0, lock_count = 0, locked_until = NULL, deleted_at = ? WHERE id = ?").run(now, row.id);
        db.prepare("INSERT INTO rights (customer_id, tipo, texto, estado, created_at, resolved_at) VALUES (?, 'supresion', ?, 'atendida', ?, ?)").run(row.customer_id, "El cliente eliminó su cuenta desde la aplicación (acceso, contactos y favoritos borrados; pedidos conservados por obligación legal).", now, now);
        db.exec("COMMIT");
        return { ok: true };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },

    /** ¿Hay una cuenta registrada con este teléfono? (solo para decidir por dónde seguir; nunca se le dice al visitante) */
    hasPhone: (phone) => { const p = normalizePhone(phone); return !!p && !!byPhone.get(p); },

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
    /** Copia consistente de la base en un fichero nuevo (sin parar el servicio). */
    backupTo(file) {
      db.prepare("VACUUM INTO ?").run(file);
    },
    close: () => db.close(),
  };
}
