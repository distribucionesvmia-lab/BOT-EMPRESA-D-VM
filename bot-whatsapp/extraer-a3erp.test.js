import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSULTAS, aExcel } from "./extraer-a3erp.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { parseProductosXlsx } from "./productos-import.js";
import { parseHistorialXlsx } from "./historial-import.js";

// Filas tal y como las devuelve sqlcmd (todo texto): el Excel resultante debe entenderlo la sincronización de la web.
test("clientes: el Excel extraído lo lee la importación (código, municipio, teléfonos, NIF, bloqueado)", () => {
  const filas = [["954", "CARNICERIA JESUS", "JESUS ALONSO ARRIBAS", "MEDINA DEL CAMPO", "47085", "CL. VALLADOLID 67, 67", "983812329 / 600111222", "a@b.es", "12333110G", "No", "No"]];
  const { customers } = parseClientesXlsx(aExcel(CONSULTAS.clientes, filas, "clientes"));
  assert.equal(customers.length, 1);
  assert.equal(customers[0].id, "954");
  assert.equal(customers[0].municipio, "47085");
  assert.deepEqual(customers[0].phones, ["983812329", "600111222"]);
  assert.equal(customers[0].active, true);
});

test("productos: precio, unidades por caja, IVA y descuento salen como números", () => {
  const filas = [["9107", "P. COOKIE DOBLE CHOCOLATE 80 GR", "1.654", "20", "10", "0", "No", "No"], ["0", "ARTICULO GENERICO", "0", "", "21", "0", "Sí", "No"]];
  const { products } = parseProductosXlsx(aExcel(CONSULTAS.productos, filas, "productos"));
  const p = products.find((x) => x.id === "9107");
  assert.equal(p.price, 1.654);
  assert.equal(p.unitsPerBox, 20);
  assert.equal(p.vat, 10);
});

test("historial: agrupa por cliente y documento, con fecha y cantidad", () => {
  const filas = [["954", "2026-10-20", "A-123", "9107", "12"], ["954", "2026-10-20", "A-123", "25132", "6"], ["954", "2026-10-01", "A-100", "9107", "24"]];
  const { byCustomer, stats } = parseHistorialXlsx(aExcel(CONSULTAS.historial, filas, "historial"));
  assert.equal(stats.lineas, 3);
  assert.equal(byCustomer.get("954").length, 2);
});

test("las consultas son SELECT fijos y de solo lectura", () => {
  for (const def of Object.values(CONSULTAS)) assert.match(def.sql(12).trim(), /^SELECT/i), assert.doesNotMatch(def.sql(12), /\b(INSERT|UPDATE|DELETE|DROP|EXEC)\b/i);
});
