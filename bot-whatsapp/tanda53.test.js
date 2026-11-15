// ALBARÁN / FACTURA en el Excel de pedidos según el «Modelo pedido» del cliente en a3ERP (datos ficticios).
import test from "node:test";
import assert from "node:assert/strict";
import { FORMAT, imprimirHtml, tipoDocumento, usarModeloPedido } from "./export-format.js";
import { parseClientes } from "./clientes-import.js";
import { openCustomersDb } from "./clientes-db.js";

const pedido = (cid) => ({ ref: "VM-2026-000001", customer_id: cid, name: "BAR PRUEBA", city: "MEDINA", created_at: "2026-11-15T09:00:00Z", delivery_date: "2026-11-16", re: 0, note: null,
  items: [{ id: "1001", name: "AGUA 1,5 L", units: 6, boxes: 1, price: 1, vat_rate: 10 }] });
const textos = (h) => h.rows.map((r) => r.map((c) => (c && typeof c === "object" ? c.v : c))).flat().filter((v) => typeof v === "string");

test("el Modelo pedido .002 sale como ALBARÁN, arriba y abajo; otro modelo, FACTURA; sin dato, nada", () => {
  usarModeloPedido((id) => ({ A: "LSTIMPRPEDV.002", B: "_DATGEN_", C: "LSTIMPRPEDV.001" })[id] ?? null);
  assert.equal(tipoDocumento("A"), "ALBARÁN"); assert.equal(tipoDocumento("B"), "FACTURA"); assert.equal(tipoDocumento("C"), "FACTURA"); assert.equal(tipoDocumento("Z"), null);
  const h = FORMAT.build([pedido("A")]).sheets[0];
  assert.equal(h.rows[0][0].v, "ALBARÁN"); assert.equal(h.rows.at(-1)[0].v, "ALBARÁN");
  assert.equal(FORMAT.build([pedido("B")]).sheets[0].rows[0][0].v, "FACTURA");
  assert.ok(!textos(FORMAT.build([pedido("Z")]).sheets[0]).some((t) => /ALBAR|FACTURA/.test(t)));
  assert.equal((imprimirHtml([pedido("A")], { autoprint: false }).match(/class="doc alb">ALBARÁN/g) ?? []).length, 2);
  usarModeloPedido(null);
});

test("la importación lee «Modelo pedido» y lo guarda en la ficha", () => {
  const rows = [["Cód. cliente", "Organización", "Teléfono", "Modelo pedido"], ["1", "UNO", "600111222", "LSTIMPRPEDV.002"], ["2", "DOS", "600111333", "_DATGEN_"]];
  const { customers } = parseClientes(rows);
  assert.deepEqual(customers.map((c) => c.modeloPedido), ["LSTIMPRPEDV.002", "_DATGEN_"]);
  const db = openCustomersDb(":memory:"); db.upsertCustomers(customers);
  assert.equal(db.modeloPedidoDe("1"), "LSTIMPRPEDV.002");
  db.upsertCustomers([{ id: "1", name: "UNO" }]); // un Excel sin la columna no lo borra
  assert.equal(db.modeloPedidoDe("1"), "LSTIMPRPEDV.002");
});
