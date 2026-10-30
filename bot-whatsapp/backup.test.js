import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { backupDb } from "./backup.js";

test("la copia de seguridad contiene los pedidos y se conservan solo las últimas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-bk-"));
  const db = openDb(path.join(dir, "origen.sqlite"));
  db.createOrder({ key: "k1", phone: "1", customerId: "C1", name: "X", at: "2026-10-28T10:00:00Z", items: [{ id: "A", qty: 2 }] });
  const out = path.join(dir, "bk");
  for (let d = 1; d <= 4; d++) backupDb(db, { dir: out, keep: 3, now: new Date(`2026-10-0${d}T10:00:00Z`) });
  const files = fs.readdirSync(out).sort();
  assert.equal(files.length, 3);
  assert.ok(files[0].includes("20261002"));
  const copia = openDb(path.join(out, files.at(-1)));
  assert.equal(copia.hasOrderKey("k1"), true);
  assert.equal(copia.listOrders()[0].items.length, 1);
  copia.close();
  assert.equal(db.ping(), true);
});

import { backupAll } from "./backup.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";

test("copia de todas las bases: pedidos, cuentas, clientes y catálogo (con sus datos) y una que falla no impide las demás", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-bk-"));
  const cat = openCatalogDb(":memory:"), cus = openCustomersDb(":memory:"), acc = openAccountsDb(":memory:"), ped = openDb(":memory:");
  cat.upsertProducts([{ id: "1", name: "AGUA", price: 1 }]);
  cus.upsertCustomers([{ id: "C1", name: "BAR UNO", nif: "12345678Z" }]);
  acc.ensureMany(["C1"]);
  const { files, errors } = backupAll({ pedidos: ped, cuentas: acc, clientes: cus, catalogo: cat, rota: { backupTo() { throw new Error("disco lleno"); } } }, { dir });
  assert.deepEqual(Object.keys(files).sort(), ["catalogo", "clientes", "cuentas", "pedidos"]);
  assert.match(errors.rota, /disco lleno/);
  assert.equal(openCatalogDb(files.catalogo).get("1").name, "AGUA");
  assert.equal(openCustomersDb(files.clientes).getById("C1").name, "BAR UNO");
  assert.equal(openCustomersDb(files.clientes).checkNif("C1", "45678Z"), true); // la huella del NIF también va en la copia
  assert.equal(openAccountsDb(files.cuentas).listAccounts().length, 1);
});
