// Vista previa de «Clientes»: quién no tiene NIF / teléfono / correo, quién se modifica (campo a campo) y el detalle completo.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador } from "./actualizar-datos.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const CAB = ["Cód. cliente", "Organización", "Dirección", "Teléfono", "Correo", "NIF"];
const montar = () => { const customersDb = openCustomersDb(":memory:"); return { customersDb, a: crearActualizador({ catalogDb: openCatalogDb(":memory:"), customersDb, accountsDb: openAccountsDb(":memory:") }) }; };

test("la vista previa dice QUIÉN no tiene NIF, teléfono o correo (no solo cuántos)", () => {
  const { a } = montar();
  const x = libro([CAB,
    ["1", "BAR UNO", "Calle 1", "600111222", "a@a.es", "12345678Z"],
    ["2", "BAR DOS", "Calle 2", "", "b@b.es", "11111111H"],       // sin teléfono
    ["3", "BAR TRES", "Calle 3", "600333444", "", ""],             // sin NIF y sin correo
  ]);
  const p = a.vistaPrevia("clientes", x);
  assert.deepEqual(p.detalle.sinNif.map((f) => f.id), ["3"]);
  assert.deepEqual(p.detalle.sinTelefono.map((f) => f.id), ["2"]);
  assert.deepEqual(p.detalle.sinCorreo.map((f) => f.id), ["3"]);
  assert.equal(p.detalle.sinNif[0].nombre, "BAR TRES");
  assert.deepEqual([p.resumen.sinNif, p.resumen.sinTelefono], [1, 1]);
  assert.deepEqual(p.detalleTotal, { modificados: 0, nuevos: 3, ausentes: 0, sinNif: 1, sinTelefono: 1, sinCorreo: 1 });
});

test("quién se modifica, con cada cambio (campo, antes y ahora), y el detalle sale entero", () => {
  const { a } = montar();
  a.aplicar("clientes", libro([CAB, ["1", "BAR UNO", "Calle 1", "600111222", "a@a.es", "12345678Z"], ["2", "BAR DOS", "Calle 2", "600222333", "", "11111111H"]]));
  const p = a.vistaPrevia("clientes", libro([CAB, ["1", "BAR UNO", "Calle NUEVA 9", "600111222", "a@a.es", "12345678Z"], ["2", "BAR DOS", "Calle 2", "600222333", "", "11111111H"]]));
  assert.equal(p.resumen.modificados, 1);
  const m = p.detalle.modificados[0];
  assert.equal(m.id, "1");
  assert.deepEqual(m.cambios.map((c) => [c.campo, c.antes, c.despues]), [["Dirección", "Calle 1", "Calle NUEVA 9"]]);
  const muchos = libro([CAB, ...Array.from({ length: 120 }, (_, i) => [String(1000 + i), `BAR ${i}`, "Calle", "", "", ""])]);
  const q = montar().a.vistaPrevia("clientes", muchos);
  assert.equal(q.detalle.nuevos.length, 120, "todos, no solo los 40 primeros");
  assert.equal(q.detalle.sinNif.length, 120);
});
