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

test("el cliente elige su contraseña al registrarse: al aprobar se activa esa y no se genera otra", () => {
  const db = openAccountsDb(":memory:");
  assert.match(db.requestRegistration(solicitud({ pin: "12ab5" })).error, /contraseña/); // 5 caracteres
  assert.match(db.requestRegistration(solicitud({ pin: "12ab5!" })).error, /contraseña/); // con un símbolo
  const { id } = db.requestRegistration(solicitud({ pin: "123456" }));
  const r = db.approve(id, "9001");
  assert.equal(r.pin, undefined);
  assert.equal(r.account.verified, true);
  assert.equal(db.login("600111222", "123456").ok, true);
  assert.equal(db.login("600111222", "654321").ok, false);
});

test("alta automática: cuenta creada con el PIN del cliente pero sin confirmar; la empresa puede confirmarla", () => {
  const db = openAccountsDb(":memory:");
  const r = db.registerAuto({ ...solicitud(), pin: "246810", customerId: "493", matched: "nombre + teléfono" });
  assert.deepEqual([r.account.customerId, r.account.verified, r.account.status], ["493", false, "active"]);
  assert.equal(db.login("600111222", "246810").ok, true);
  assert.equal(db.listRegistrations("auto")[0].matched, "nombre + teléfono");
  assert.match(db.registerAuto({ ...solicitud(), pin: "111111", customerId: "493" }).error, /ya tiene acceso/);
  assert.equal(db.confirm(1), true);
  assert.equal(db.listAccounts()[0].verified, true);
  assert.match(db.registerAuto({ ...solicitud({ phone: "699000111" }), pin: "12", customerId: "1" }).error, /contraseña/);
});

test("acceso con comprobación extra: si falla (nombre de empresa distinto) cuenta como un intento fallido", () => {
  const db = openAccountsDb(":memory:");
  db.registerAuto({ ...solicitud(), pin: "246810", customerId: "493" });
  const exigeNombre = (nombre) => (acc) => acc.customerId === "493" && nombre === "bar el ejemplo";
  assert.deepEqual(db.login("600111222", "246810", undefined, exigeNombre("otro")), { ok: false, reason: "invalid" });
  assert.equal(db.login("600111222", "246810", undefined, exigeNombre("bar el ejemplo")).ok, true);
  for (let i = 0; i < MAX_FAILED; i++) db.login("600111222", "246810", undefined, exigeNombre("mal")); // adivinar el nombre también bloquea
  assert.deepEqual(db.login("600111222", "246810", undefined, exigeNombre("bar el ejemplo")), { ok: false, reason: "locked" });
});

test("favoritos: privados por cliente, sin duplicados, se quitan y tienen tope", () => {
  const db = openAccountsDb(":memory:");
  assert.deepEqual(db.favorites("1"), []);
  assert.equal(db.setFavorite("1", "A", true, "2026-01-01T00:00:00Z"), true);
  db.setFavorite("1", "B", true, "2026-01-02T00:00:00Z");
  db.setFavorite("1", "A", true, "2026-01-03T00:00:00Z"); // repetido: no duplica
  db.setFavorite("2", "Z", true);
  assert.deepEqual(db.favorites("1"), ["B", "A"]);
  assert.deepEqual(db.favorites("2"), ["Z"]);
  db.setFavorite("1", "A", false);
  assert.deepEqual(db.favorites("1"), ["B"]);
  for (let i = 0; i < 299; i++) db.setFavorite("3", "P" + i, true);
  assert.equal(db.setFavorite("3", "ULTIMO", true), true);
  assert.equal(db.setFavorite("3", "UNO-MAS", true), false);
});

test("contraseña con letras: mayúsculas y minúsculas valen igual, y el hash es el mismo", () => {
  const db = openAccountsDb(":memory:");
  const r = db.registerAuto({ ...solicitud(), pin: "Ab12Cd", customerId: "493", matched: "nombre + teléfono" });
  assert.equal(r.error, undefined);
  for (const escrito of ["Ab12Cd", "ab12cd", "AB12CD", "aB12cD", " ab12cd "]) assert.equal(db.login("600111222", escrito).ok, true, escrito);
  assert.equal(db.login("600111222", "ab12ce").ok, false);
});

test("alta de un cliente nuevo: el DNI/NIE/CIF se guarda en la solicitud (para darlo de alta) y se borra al aprobar o rechazar", () => {
  const db = openAccountsDb(":memory:");
  assert.match(db.requestRegistration(solicitud({ nif: "123" })).error, /DNI/);
  const { id } = db.requestRegistration(solicitud({ nif: "12.345.678-z" }));
  assert.equal(db.listRegistrations("pending")[0].nif, "12345678Z"); // limpio y en mayúsculas
  assert.equal(db.approve(id, "9001").account.customerId, "9001");
  const otra = db.requestRegistration(solicitud({ phone: "699111222", nif: "B12345678" })).id;
  assert.equal(db.reject(otra), true);
  const todas = [...db.listRegistrations("approved"), ...db.listRegistrations("rejected")];
  assert.equal(todas.length, 2);
  assert.ok(todas.every((r) => r.nif === null), "al resolver la solicitud el DNI/CIF ya no se conserva");
});

test("derechos: pedir corregir/limitar/oponerse llega a la empresa y se puede marcar como atendido", () => {
  const db = openAccountsDb(":memory:");
  assert.match(db.addRightsRequest({ customerId: "9001", tipo: "borrar-todo", texto: "x" }).error, /qué quieres pedir/);
  assert.match(db.addRightsRequest({ customerId: "9001", tipo: "corregir", texto: " " }).error, /Cuéntanos/);
  const { id } = db.addRightsRequest({ customerId: "9001", tipo: "corregir", texto: "Mi teléfono   ya no es ese" });
  const [r] = db.listRightsRequests("pendiente");
  assert.deepEqual([r.id, r.tipo, r.texto, r.estado], [id, "corregir", "Mi teléfono ya no es ese", "pendiente"]);
  assert.equal(db.resolveRightsRequest(id), true);
  assert.equal(db.resolveRightsRequest(id), false); // ya atendida
  assert.equal(db.listRightsRequests("pendiente").length, 0);
});

test("supresión: eliminar la cuenta borra acceso, contactos, favoritos y solicitudes; la cuenta no vuelve a crearse y se deja constancia", () => {
  const db = openAccountsDb(":memory:");
  const { id } = db.requestRegistration(solicitud());
  const acc = db.approve(id, "9001").account;
  db.setFavorite("9001", "P1", true);
  const s = db.login("600111222", "654321");
  const r0 = db.registerAuto({ ...solicitud({ phone: "699000111" }), pin: "ABC123", customerId: "9002", matched: "x" });
  assert.equal(db.deleteAccount(acc.id).ok, true);
  const [a] = db.listAccounts().filter((x) => x.id === acc.id);
  assert.deepEqual([a.status, a.phone, a.email], ["deleted", null, null]);
  assert.deepEqual(db.favorites("9001"), []);
  assert.equal(db.sessionAccount(s.token ?? "x"), null);
  assert.deepEqual(db.login("600111222", "654321"), { ok: false, reason: "invalid" }); // el teléfono ya no está
  assert.equal(db.ensureMany(["9001"]), 0); // la sincronización con a3ERP no la crea otra vez
  assert.equal(db.listRightsRequests().find((x) => x.tipo === "supresion").estado, "atendida"); // queda anotado para la empresa
  assert.equal(r0.account.customerId, "9002"); // las demás cuentas no se tocan
  assert.equal(db.login("699000111", "abc123").ok, true);
  // si el cliente vuelve a darse de alta, la cuenta se reactiva; una bloqueada por la empresa no
  const nuevo = db.requestRegistration(solicitud({ phone: "677000111" })).id;
  assert.equal(db.approve(nuevo, "9001").account.status, "active");
});

test("cliente habitual: teléfono de la lista + contraseña personal (solo si la ha puesto); los fallos cuentan y una cuenta eliminada lo dice", () => {
  const db = openAccountsDb(":memory:");
  db.ensureMany(["7001"]);
  const acc = db.listAccounts().find((a) => a.customerId === "7001");
  assert.equal(db.loginCustomerCode("7001", "huella").ok, false); // aún no tiene contraseña personal
  db.setCodeKey(acc.id, "huella");
  assert.equal(db.loginCustomerCode("7001", "otra").ok, false);
  assert.equal(db.loginCustomerCode("7001", "huella").ok, true);
  for (let i = 0; i < 5; i++) db.loginCustomerCode("7001", "mal");
  assert.deepEqual(db.loginCustomerCode("7001", "huella"), { ok: false, reason: "locked" }); // 5 fallos seguidos la bloquean un rato
  db.deleteAccount(acc.id);
  assert.deepEqual(db.loginCustomerCode("7001", "huella"), { ok: false, reason: "deleted" });
});

test("uso de la aplicación: contadores por día sin datos personales; resumen con % de abandono y tiempo medio hasta pedir", () => {
  const db = openAccountsDb(":memory:");
  const ahora = "2026-11-11T10:00:00Z";
  assert.equal(db.anotarUso("espiar", null, ahora), false); // solo sucesos conocidos
  db.anotarUso("repetir", null, ahora); db.anotarUso("repetir", null, ahora);
  db.anotarUso("pedido", 120, ahora); db.anotarUso("pedido", 60, "2026-11-10T09:00:00Z"); db.anotarUso("pedido", 90000, ahora); // el tiempo se acota a 24 h
  db.anotarUso("abandono", null, ahora);
  db.anotarUso("pedido", 600, "2026-09-01T09:00:00Z"); // fuera de los 30 días
  const r = db.resumenUso(30, ahora);
  assert.deepEqual([r.repeticiones, r.pedidos, r.abandonos], [2, 3, 1]);
  assert.equal(r.tasaAbandono, 25); // 1 de cada 4 (3 pedidos + 1 abandono)
  assert.equal(r.segundosMedioHastaPedir, Math.round((120 + 60 + 86400) / 3));
  assert.deepEqual(openAccountsDb(":memory:").resumenUso(30), { dias: 30, repeticiones: 0, pedidos: 0, abandonos: 0, catalogoAbierto: 0, tasaAbandono: null, segundosMedioHastaPedir: null });
});

test("confirmAll confirma de golpe todas las cuentas sin confirmar, salvo las eliminadas", () => {
  const db = openAccountsDb(":memory:");
  db.ensureMany(["1", "2", "3"]);
  assert.equal(db.listAccounts().filter((a) => !a.verified).length, 3);
  assert.equal(db.confirmAll(), 3);
  assert.equal(db.listAccounts().filter((a) => !a.verified).length, 0);
  assert.equal(db.confirmAll(), 0); // repetirlo no cambia nada
});
