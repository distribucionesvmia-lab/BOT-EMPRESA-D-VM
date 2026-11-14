// Editar la ficha de un cliente a mano: validación, que se guarde aparte y que las importaciones de a3ERP no lo borren.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openCustomersDb } from "./clientes-db.js";
import { validarEdicion } from "./cliente-edicion.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const montar = () => { const db = openCustomersDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-ed-")), "c.sqlite")); db.upsertCustomers([{ id: "7001", name: "BAR PRUEBA", legalName: "MARIA LOPEZ SL", city: "MEDINA", address: "CL UNO 1", phones: ["611222333"], emails: ["erp@ejemplo.es"] }]); return db; };

test("VALIDACIÓN: teléfonos de 9 cifras, correos válidos, municipio de 5 cifras, límites y sin nada que guardar", () => {
  const ok = validarEdicion({ razon: "  Mi  Empresa SL ", direccion: "Calle 1", poblacion: "Medina", municipio: "47085", recargo: true, notas: " llamar antes ", telefonos: ["+34 600 111 222", "600111222", "611 222 333"], correos: ["Maria@Cafe.ES", "maria@cafe.es"] }).patch;
  assert.equal(ok.legalName, "Mi Empresa SL"); assert.deepEqual(ok.phones, ["600111222", "611222333"]); assert.deepEqual(ok.emails, ["maria@cafe.es"]); assert.equal(ok.recargo, true); assert.equal(ok.notes, "llamar antes");
  assert.match(validarEdicion({ telefonos: ["12345"] }).error, /teléfono válido/); assert.match(validarEdicion({ correos: ["sin-arroba"] }).error, /correo válido/);
  assert.match(validarEdicion({ municipio: "470" }).error, /5 cifras/); assert.match(validarEdicion({}).error, /nada que guardar/); assert.match(validarEdicion(null).error, /no válida/);
  assert.match(validarEdicion({ telefonos: Array(11).fill("600111222") }).error, /máximo 10/);
  assert.equal(validarEdicion({ razon: "x".repeat(300) }).patch.legalName.length, 80);
  assert.equal(validarEdicion({ poblacion: "" }).patch.city, ""); // vaciar un campo es válido
});

test("FICHA: lo añadido a mano se ve, se puede quitar y no se confunde con lo de a3ERP", () => {
  const db = montar();
  assert.equal(db.editar("9999", { notes: "x" }), false); // cliente que no existe
  assert.equal(db.editar("7001", { phones: ["611222333", "600111222"], emails: ["erp@ejemplo.es", "maria@cafe.es"], address: "Calle Nueva 5", city: "Valladolid", municipio: "47186", recargo: true, notes: "Llamar antes" }), true);
  const c = db.getById("7001"); assert.deepEqual(c.phones.sort(), ["600111222", "611222333"]); assert.deepEqual(c.emails.sort(), ["erp@ejemplo.es", "maria@cafe.es"]);
  assert.equal(c.address, "Calle Nueva 5"); assert.equal(c.city, "Valladolid"); assert.equal(c.municipio, "47186"); assert.equal(c.recargoEquivalencia, true); assert.equal(c.legalName, "MARIA LOPEZ SL");
  assert.deepEqual(db.manualOf("7001").phones, ["600111222"]); assert.deepEqual(db.manualOf("7001").emails, ["maria@cafe.es"]); assert.equal(db.manualOf("7001").notes, "Llamar antes");
  assert.equal(db.getByPhone("600111222")?.id, "7001"); // el teléfono nuevo ya sirve para reconocer al cliente
  // quitar un teléfono y un correo añadidos a mano; intentar quitar los de a3ERP no surte efecto (volverían con la próxima importación)
  db.editar("7001", { phones: [], emails: [] });
  const d = db.getById("7001"); assert.deepEqual(d.phones, ["611222333"]); assert.deepEqual(d.emails, ["erp@ejemplo.es"]); assert.deepEqual(db.manualOf("7001").phones, []);
  db.editar("7001", { address: "" }); assert.ok(!db.getById("7001").address); // se puede vaciar un campo a propósito
});

test("IMPORTACIÓN DE a3ERP: no borra lo escrito a mano (teléfonos y correos extra, dirección, notas, recargo)", () => {
  const db = montar();
  db.editar("7001", { phones: ["611222333", "600111222"], emails: ["erp@ejemplo.es", "maria@cafe.es"], address: "Calle Nueva 5", municipio: "47085", recargo: true, notes: "Llamar antes" });
  // el Excel de a3ERP trae sus propios datos (y una lista de correos vacía, que antes habría borrado todo)
  db.upsertCustomers([{ id: "7001", name: "BAR PRUEBA RENOMBRADO", legalName: "MARIA LOPEZ SL", city: "MEDINA", address: "CL UNO 1", phones: ["611222333"], emails: [], recargoEquivalencia: false }]);
  const c = db.getById("7001");
  assert.equal(c.name, "BAR PRUEBA RENOMBRADO"); // lo de a3ERP sigue mandando en el nombre
  assert.deepEqual(c.phones.sort(), ["600111222", "611222333"]); assert.deepEqual(c.emails, ["maria@cafe.es"]); // el correo de a3ERP desapareció del Excel; el añadido a mano sigue
  assert.equal(c.address, "Calle Nueva 5"); assert.equal(c.municipio, "47085"); assert.equal(c.recargoEquivalencia, true); assert.equal(db.manualOf("7001").notes, "Llamar antes");
  // y si a3ERP cambia un dato que NO se tocó a mano, sí se actualiza
  db.upsertCustomers([{ id: "7001", name: "BAR PRUEBA", city: "OTRA CIUDAD", phones: ["611222333"] }]); assert.equal(db.getById("7001").city, "OTRA CIUDAD");
});

test("PANEL: botón «Editar datos» en la ficha, formulario con teléfonos y correos, y rutas en admin.js", () => {
  const h = leer("./empresa.html"), a = leer("./admin.js");
  assert.match(h, /function seccionDatos\(f\)/); assert.match(h, /function editarDatos\(f, sec\)/); assert.match(h, /Editar datos/); assert.match(h, /Notas internas \(el cliente no las ve\)/); assert.match(h, /Viene de a3ERP: no se puede quitar desde aquí/);
  assert.match(a, /if \(mf && post\)/); assert.match(a, /validarEdicion/); assert.match(a, /también lo tiene/);
});

test("FICHA: dice a qué correo va la confirmación de pedido (el de su cuenta tiene prioridad) y si el cliente la quitó", async () => {
  const { elegirDestino } = await import("./correo-cliente.js");
  assert.equal(elegirDestino({ account: { email: "cuenta@ejemplo.es" }, customer: { emails: ["ficha@ejemplo.es"] } }), "cuenta@ejemplo.es");
  assert.equal(elegirDestino({ account: { email: null }, customer: { emails: ["ficha@ejemplo.es"] } }), "ficha@ejemplo.es");
  const h = leer("./empresa.html"), a = leer("./admin.js");
  assert.match(h, /Confirmación de pedido por correo/); assert.match(h, /tiene prioridad sobre los de su ficha/); assert.match(a, /correoPedidos: \{ destino: elegirDestino/);
});
