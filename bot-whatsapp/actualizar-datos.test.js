import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador } from "./actualizar-datos.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const montar = () => {
  const registros = [];
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-img-"));
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  return { catalogDb, customersDb, accountsDb, registros, a: crearActualizador({ catalogDb, customersDb, accountsDb, imgDir, registro: (e) => registros.push(e) }) };
};
const CAB_P = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado"];
const prod = (...f) => libro([CAB_P, ...f]);

test("productos: vista previa no escribe; aplicar solo toca las diferencias y deja registro", () => {
  const { a, catalogDb, registros } = montar();
  const v1 = prod(["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "1,00", "RED10", "6", "No", "No"]);
  const p1 = a.vistaPrevia("productos", v1);
  assert.equal(p1.resumen.anadidos, 2);
  assert.equal(catalogDb.list({ activeOnly: false }).length, 0); // la vista previa no escribe
  assert.equal(a.aplicar("productos", v1, { fichero: "a.xlsx" }).anadidos, 2);
  assert.equal(registros.length, 1);
  // segundo Excel: AGUA cambia de precio, LECHE ya no está, ZUMO es nuevo
  const v2 = prod(["1", "AGUA", "0,60", "RED10", "6", "No", "No"], ["3", "ZUMO", "2,00", "RED10", "1", "No", "No"]);
  const p2 = a.vistaPrevia("productos", v2);
  assert.deepEqual([p2.resumen.anadidos, p2.resumen.quitados, p2.resumen.modificados], [1, 1, 1]);
  assert.deepEqual(p2.detalle.modificados[0].cambios[0], { campo: p2.detalle.modificados[0].cambios[0].campo, antes: 0.5, despues: 0.6 });
  a.aplicar("productos", v2);
  const act = Object.fromEntries(catalogDb.list({ activeOnly: false }).map((p) => [p.id, p]));
  assert.equal(act["1"].price, 0.6);
  assert.equal(act["2"].active, false);
  assert.equal(act["3"].price, 2);
  assert.throws(() => a.aplicar("productos", v2), /nada que aplicar/); // repetirlo no hace nada
});

test("productos: un Excel incompleto (menos de la mitad) se rechaza", () => {
  const { a, catalogDb } = montar();
  catalogDb.upsertProducts(Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: "P" + i, price: 1, vat: 10 })));
  const p = a.vistaPrevia("productos", prod(["1", "P0", "1", "RED10", "1", "No", "No"]));
  assert.equal(p.aplicable, false);
  assert.throws(() => a.aplicar("productos", prod(["1", "P0", "1", "RED10", "1", "No", "No"])), /incompleto/);
});

const CAB_C = ["Cód. cliente", "Organización", "Razón social", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"];
const cli = (...f) => libro([CAB_C, ...f]);
const filaC = (id, n, tel = "611222333") => [id, n, n, "MEDINA", "CL UNO 1", tel, "", "B11111111", "No", "No", "1"];

test("clientes: añade los nuevos, actualiza solo los cambiados y no da de baja a los ausentes", () => {
  const { a, customersDb, accountsDb } = montar();
  a.aplicar("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS")));
  assert.equal(customersDb.count(), 2);
  const p = a.vistaPrevia("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS NUEVO", "699000111"), filaC("3", "BAR TRES")));
  assert.deepEqual([p.resumen.nuevos, p.resumen.modificados, p.resumen.iguales], [1, 1, 1]);
  assert.equal(p.detalle.modificados[0].cambios.some((c) => c.antes === "BAR DOS" && c.despues === "BAR DOS NUEVO"), true);
  a.aplicar("clientes", cli(filaC("2", "BAR DOS NUEVO", "699000111"), filaC("3", "BAR TRES")));
  assert.equal(customersDb.getById("2").name, "BAR DOS NUEVO");
  assert.equal(customersDb.getById("1").active, true); // el 1 no venía y sigue activo
  assert.equal(accountsDb.listAccounts().length, 3);
});

const CAB_H = ["Cód. cliente", "Fecha", "Documento", "Cód. artículo", "Cantidad"];
test("historial: solo se reescribe el de los clientes cuyo histórico cambia", () => {
  const { a, customersDb } = montar();
  a.aplicar("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS")));
  const h1 = libro([CAB_H, ["1", "01/10/2026", "A1", "10", "2"], ["2", "02/10/2026", "A2", "11", "3"]]);
  assert.equal(a.aplicar("historial", h1).clientes, 2);
  const h2 = libro([CAB_H, ["1", "01/10/2026", "A1", "10", "2"], ["2", "02/10/2026", "A2", "11", "3"], ["2", "09/10/2026", "A3", "12", "1"], ["99", "09/10/2026", "A4", "12", "1"]]);
  const p = a.vistaPrevia("historial", h2);
  assert.deepEqual([p.resumen.clientesConCambios, p.resumen.pedidosNuevos, p.resumen.iguales, p.resumen.desconocidos], [1, 1, 1, 1]);
  a.aplicar("historial", h2);
  assert.equal(customersDb.getById("2").orders.length, 2);
  assert.equal(customersDb.getById("1").orders.length, 1);
});

test("tipo desconocido o Excel que no es del tipo: error claro", () => {
  const { a } = montar();
  assert.throws(() => a.vistaPrevia("pedidos", prod()), /desconocido/);
  assert.throws(() => a.vistaPrevia("clientes", prod(["1", "X", "1", "RED10", "1", "No", "No"])), /cabecera/);
});
