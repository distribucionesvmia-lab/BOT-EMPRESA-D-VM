import test from "node:test";
import assert from "node:assert/strict";
import { openAccountsDb, normalizePhone, MAX_FAILED, MAX_LOCKS, LOCK_MINUTES } from "./cuentas-db.js";

const solicitud = (o = {}) => ({ phone: "+34 600 111 222", email: "bar@ejemplo.es", business: "Bar El Ejemplo", ...o });
const conCuenta = () => {
  const db = openAccountsDb(":memory:");
  const { id } = db.requestRegistration(solicitud());
  const { account, pin } = db.approve(id, "9001");
  return { db, account, pin };
};

test("normalizePhone: 9 últimos dígitos; rechaza lo que no es un teléfono", () => {
  assert.equal(normalizePhone("+34 600 111 222"), "600111222");
  assert.equal(normalizePhone("0034600111222"), "600111222");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("abc"), null);
});

test("solicitud: valida los datos y actualiza una solicitud pendiente del mismo teléfono", () => {
  const db = openAccountsDb(":memory:");
  assert.match(db.requestRegistration(solicitud({ phone: "123" })).error, /teléfono/);
  assert.match(db.requestRegistration(solicitud({ email: "no-es-correo" })).error, /correo/);
  assert.match(db.requestRegistration(solicitud({ business: " " })).error, /empresa/);
  const a = db.requestRegistration(solicitud());
  const b = db.requestRegistration(solicitud({ email: "otro@ejemplo.es" }));
  assert.equal(a.id, b.id);
  assert.equal(db.listRegistrations().length, 1);
  assert.equal(db.listRegistrations()[0].email, "otro@ejemplo.es");
});

test("aprobación: crea la cuenta ligada al cliente y da un PIN de 6 cifras una sola vez", () => {
  const { db, account, pin } = conCuenta();
  assert.match(pin, /^\d{6}$/);
  assert.deepEqual([account.customerId, account.phone, account.status], ["9001", "600111222", "active"]);
  assert.equal(db.listRegistrations("pending").length, 0);
  assert.equal(db.listRegistrations("approved")[0].customerId, "9001");
  assert.equal(JSON.stringify(db.listAccounts()).includes(pin), false); // el PIN no se guarda en claro
  assert.match(db.approve(1, "9001").error, /ya se resolvió/);
});

test("un teléfono con cuenta no puede aprobarse otra vez", () => {
  const { db } = conCuenta();
  const { id } = db.requestRegistration(solicitud({ business: "Otro Bar" }));
  assert.match(db.approve(id, "9002").error, /ya tiene una cuenta/);
});

test("acceso: teléfono + PIN correctos dan una sesión ligada a SU cliente", () => {
  const { db, pin } = conCuenta();
  const r = db.login("600 111 222", pin);
  assert.equal(r.ok, true);
  assert.equal(db.sessionAccount(r.token).customerId, "9001");
  assert.equal(db.sessionAccount("token-inventado"), null);
  assert.equal(db.sessionAccount(null), null);
});

test("acceso: PIN incorrecto y teléfono desconocido dan la misma respuesta", () => {
  const { db } = conCuenta();
  assert.deepEqual(db.login("600111222", "000000"), { ok: false, reason: "invalid" });
  assert.deepEqual(db.login("699999999", "123456"), { ok: false, reason: "invalid" });
  assert.deepEqual(db.login("600111222", "abc"), { ok: false, reason: "invalid" });
});

test("acceso: 5 fallos bloquean 15 minutos y tras 3 bloqueos hace falta la empresa", () => {
  const { db, pin } = conCuenta();
  let t = new Date("2026-11-01T10:00:00Z");
  const at = () => t.toISOString();
  for (let i = 0; i < MAX_FAILED; i++) db.login("600111222", "000000", at());
  assert.deepEqual(db.login("600111222", pin, at()), { ok: false, reason: "locked" }); // ni con el PIN bueno
  t = new Date(t.getTime() + (LOCK_MINUTES + 1) * 60_000);
  assert.equal(db.login("600111222", pin, at()).ok, true); // pasado el bloqueo vuelve a entrar
  for (let lock = 0; lock < MAX_LOCKS; lock++) {
    for (let i = 0; i < MAX_FAILED; i++) db.login("600111222", "000000", at());
    t = new Date(t.getTime() + (LOCK_MINUTES + 1) * 60_000);
  }
  assert.equal(db.login("600111222", pin, at()).ok, false); // bloqueada hasta que la empresa la reactive
  assert.equal(db.listAccounts()[0].status, "blocked");
  db.setBlocked(1, false);
  assert.equal(db.login("600111222", pin, at()).ok, true);
});

test("sesiones: caducan, se cierran y el nuevo PIN las invalida", () => {
  const { db, pin } = conCuenta();
  const r = db.login("600111222", pin, "2026-11-01T10:00:00.000Z");
  assert.ok(db.sessionAccount(r.token, "2026-11-20T10:00:00.000Z"));
  assert.equal(db.sessionAccount(r.token, "2026-12-05T10:00:00.000Z"), null); // pasados 30 días
  const r2 = db.login("600111222", pin);
  db.logout(r2.token);
  assert.equal(db.sessionAccount(r2.token), null);
  const r3 = db.login("600111222", pin);
  const nuevo = db.resetPin(1);
  assert.equal(db.sessionAccount(r3.token), null);
  assert.equal(db.login("600111222", pin).ok, false); // el PIN viejo ya no vale
  assert.equal(db.login("600111222", nuevo).ok, true);
});

test("una cuenta bloqueada por la empresa pierde sus sesiones", () => {
  const { db, pin } = conCuenta();
  const r = db.login("600111222", pin);
  db.setBlocked(1, true);
  assert.equal(db.sessionAccount(r.token), null);
  assert.deepEqual(db.login("600111222", pin), { ok: false, reason: "locked" });
});

test("rechazar una solicitud no crea cuenta", () => {
  const db = openAccountsDb(":memory:");
  const { id } = db.requestRegistration(solicitud());
  assert.equal(db.reject(id), true);
  assert.equal(db.listAccounts().length, 0);
  assert.equal(db.reject(id), false);
});
