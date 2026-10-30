import test from "node:test";
import assert from "node:assert/strict";
import { nifCodes, nifKeys, nifMatches } from "./nif-key.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb, MAX_FAILED } from "./cuentas-db.js";
import { findCustomers } from "./identify.js";

test("nifCodes: 6 últimos caracteres y, si acaba en letra, 6 últimos números", () => {
  assert.deepEqual(nifCodes("12345678Z"), ["45678Z", "345678"]);
  assert.deepEqual(nifCodes("b-67.813.469"), ["813469"]); // CIF acabado en número: un solo código
  assert.deepEqual(nifCodes("123"), []);
});

test("nifMatches: acepta mayúsculas/minúsculas, separadores y el NIF completo; rechaza otros", () => {
  const keys = nifKeys("0008", "12312328Z");
  assert.equal(JSON.stringify(keys).includes("12312328"), false); // no se guarda el NIF
  for (const ok of ["12328Z", "12328z", "312328", "12 328-Z", "12312328Z"]) assert.equal(nifMatches("0008", ok, keys), true, ok);
  for (const bad of ["12328A", "123456", "", "12328"]) assert.equal(nifMatches("0008", bad, keys), false, bad);
  assert.equal(nifMatches("0009", "12328Z", keys), false); // la huella depende del cliente
});

test("identify lenient: «alegría» encaja con «Bar Alegría» y «bar alegría» con «Alegría»; el modo normal no", () => {
  const list = [{ id: "1", name: "BAR ALEGRIA" }, { id: "2", name: "ALEGRIA" }, { id: "3", name: "BAR GLORIA" }, { id: "4", name: "CAFE ALEGRIA DEL SUR" }];
  const ids = (q, o) => findCustomers(list, q, o).map((c) => c.id).sort();
  assert.deepEqual(ids("alegría", { lenient: true }), ["1", "2", "4"]);
  assert.deepEqual(ids("bar alegria", { lenient: true }), ["1", "2", "4"]);
  assert.deepEqual(ids("bar", { lenient: true }), []); // solo palabras genéricas: no identifica a nadie
  assert.deepEqual(ids("gloria", { lenient: true }), ["3"]);
  assert.deepEqual(ids("alegria"), ["2"]); // el modo estricto sigue exigiendo el nombre casi completo
});

test("acceso con NIF: cuentas ya creadas, nombre flexible, bloqueo por fallos y aislamiento", () => {
  const cus = openCustomersDb(":memory:"), acc = openAccountsDb(":memory:");
  cus.upsertCustomers([
    { id: "1", name: "BAR ALEGRIA", nif: "12312328Z" },
    { id: "2", name: "CAFE ALEGRIA", nif: "12399999K" },
    { id: "3", name: "SIN NIF" },
  ]);
  assert.equal(acc.ensureMany(["1", "2", "3"]), 3);
  assert.equal(acc.ensureMany(["1", "2", "3"]), 0); // idempotente
  assert.equal(acc.listAccounts().length, 3);
  assert.equal(acc.listAccounts()[0].verified, false);

  const entrar = (empresa, nif) => acc.loginNif(cus.candidates(empresa).map((c) => c.id), (id) => cus.checkNif(id, nif));
  // «alegría» vale para los dos bares; el NIF decide cuál es
  const ok = entrar("alegría", "12328Z");
  assert.equal(ok.ok, true);
  assert.equal(ok.account.customerId, "1");
  assert.equal(ok.account.verified, true); // conocer el NIF confirma la cuenta
  assert.equal(acc.sessionAccount(ok.token).customerId, "1");
  assert.equal(entrar("bar alegria", "555555").ok, false); // un NIF que no es de ninguno de los dos no vale, aunque el nombre encaje
  assert.equal(entrar("cafe alegria", "99999K").account.customerId, "2");
  assert.equal(entrar("sin nif", "000000").ok, false); // sin NIF guardado nadie entra
  // fallos seguidos: bloqueo de la cuenta
  for (let i = 0; i < MAX_FAILED; i++) assert.equal(entrar("cafe alegria", "111111").ok, false);
  assert.equal(entrar("cafe alegria", "99999K").reason, "locked");
});

test("una cuenta creada al importar se completa cuando el cliente se registra con teléfono y PIN", () => {
  const acc = openAccountsDb(":memory:");
  acc.ensureMany(["7"]);
  const r = acc.registerAuto({ phone: "600111222", email: "a@b.es", business: "X", pin: "123456", customerId: "7", matched: "x" });
  assert.equal(r.account.customerId, "7");
  assert.equal(acc.listAccounts().length, 1); // no se duplica
  assert.equal(acc.login("600111222", "123456").ok, true);
});
