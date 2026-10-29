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
