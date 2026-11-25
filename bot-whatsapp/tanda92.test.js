// Cambiar el NOMBRE de un cliente desde su ficha (sobrevive a las importaciones de a3ERP) y añadir clientes a mano desde «Cuentas de clientes».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openCustomersDb } from "./clientes-db.js";
import { validarEdicion } from "./cliente-edicion.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("nombre: se valida, se guarda y no lo pisa una importación de a3ERP", () => {
  assert.equal(validarEdicion({ nombre: "  Bar   Nuevo  " }).patch.name, "Bar Nuevo");
  assert.match(validarEdicion({ nombre: " " }).error, /no puede estar vacío/);
  assert.equal(validarEdicion({ nombre: "x".repeat(200) }).patch.name.length, 80);
  const db = openCustomersDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-nom-")), "c.sqlite"));
  db.upsertCustomers([{ id: "7001", name: "BAR VIEJO" }, { id: "7002", name: "OTRO BAR" }]);
  assert.equal(db.editar("7001", { name: "Bar Nuevo" }), true);
  assert.equal(db.getById("7001").name, "Bar Nuevo"); assert.equal(db.getById("7002").name, "OTRO BAR");
  db.upsertCustomers([{ id: "7001", name: "BAR VIEJO SL" }, { id: "7002", name: "OTRO BAR" }]); // llega otro Excel con el nombre antiguo
  assert.equal(db.getById("7001").name, "Bar Nuevo", "lo escrito a mano manda");
  assert.equal(db.getById("7002").name, "OTRO BAR");
});

test("panel: la ficha tiene el campo «Nombre del cliente» y «Añadir un cliente» está en Cuentas de clientes", () => {
  const h = leer("empresa.html");
  assert.match(h, /campo\("Nombre del cliente", "nom"/); assert.match(h, /\{ nombre: iNom\.value, razon:/);
  const i = h.indexOf("<h1>Cuentas de clientes</h1>"), j = h.indexOf('id="alta-cli"');
  assert.ok(i > 0 && j > i && j - i < 600, "el desplegable está justo debajo del título de Cuentas de clientes");
  assert.equal(h.split('id="alta-cli"').length, 2, "solo uno");
});
