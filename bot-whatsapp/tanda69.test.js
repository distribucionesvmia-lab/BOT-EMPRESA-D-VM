// Fluidez: índices de la base de pedidos (las consultas por cliente se hacen en cada visita).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.js";
import { openAccountsDb } from "./cuentas-db.js";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-idx-"));
const indices = (file, tabla) => { const r = new DatabaseSync(file); const x = r.prepare(`PRAGMA index_list(${tabla})`).all().map((i) => i.name); r.close(); return x; };
test("ÍNDICES: los pedidos se buscan por cliente, exportación y fecha sin recorrer toda la tabla", () => {
  const f = path.join(tmp(), "p.sqlite"); openDb(f);
  const n = indices(f, "orders"); for (const i of ["idx_orders_customer", "idx_orders_export_id", "idx_orders_created", "idx_orders_export"]) assert.ok(n.includes(i), i);
  const r = new DatabaseSync(f), plan = r.prepare("EXPLAIN QUERY PLAN SELECT * FROM orders WHERE customer_id = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 5").all("1").map((x) => x.detail).join(" ");
  assert.match(plan, /idx_orders_customer/); assert.doesNotMatch(plan, /SCAN orders(?! USING)/); r.close(); // usa el índice, no recorre la tabla
  openDb(f); // abrirla otra vez (arranque normal) no falla ni duplica nada
});
test("ÍNDICES: las listas de «últimos días» del panel (hechos sospechosos y actividad) usan su índice", () => {
  const f = path.join(tmp(), "c.sqlite"); openAccountsDb(f);
  const a = indices(f, "seguridad_eventos"), b = indices(f, "actividad_panel"); assert.ok(a.includes("idx_seguridad_at")); assert.ok(b.includes("idx_actividad_at"));
});
