import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { readXlsx } from "./xlsx-read.js";
import { extractPhones, extractEmails, parseClientesXlsx } from "./clientes-import.js";

// Excel FICTICIO con el mismo formato que la exportación de a3ERP
const cab = ["Cód. cliente", "Organización", "Razón social / Nombre fiscal de la organización", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"];
const filas = [
  ["     493", "BAR EL EJEMPLO", "JUAN PEREZ GARCIA", "VALLADOLID", "CL. FALSA, 2", "", "", "00000000T", "No", "No", "       6"],
  ["    0004", "TIENDA FICTICIA", "TIENDA FICTICIA SL", "MEDINA DEL CAMPO", "CR. A6 KM 10", "674088618 MARIA / 983 81 23 29", "Tienda@Ejemplo.es; otro@ejemplo.es", "B00000000", "No", "No", "1"],
  ["954", "BAR CERRADO", "BAR CERRADO", "TORDESILLAS", "PZ. MAYOR 1", "+34 600 111 222", "bar@cerrado.es", "", "Sí", "No", "2"],
  ["955", "MESON ANTIGUO", "MESON ANTIGUO", "", "", "983000111", "", "", "No", "Sí", "2"],
  ["954", "REPETIDO", "REPETIDO", "", "", "", "", "", "No", "No", ""],
  ["", "", "", "", "", "", "", "", "", "", ""],
  ["", "TOTAL", "", "", "", "", "", "", "", "", ""],
];
const xlsx = () => buildWorkbook([{ name: "CLIENTES", rows: [cab, ...filas] }]);

test("readXlsx: lee la primera hoja con textos y celdas vacías", () => {
  const rows = readXlsx(xlsx());
  assert.deepEqual(rows[0].slice(0, 3), ["Cód. cliente", "Organización", "Razón social / Nombre fiscal de la organización"]);
  assert.equal(rows[2][5], "674088618 MARIA / 983 81 23 29");
  assert.equal(rows[1][5], "");
});

test("extractPhones: varios teléfonos en una celda, con espacios, prefijo y texto", () => {
  assert.deepEqual(extractPhones("674088618 IRENE"), ["674088618"]);
  assert.deepEqual(extractPhones("983 81 23 29 / 674-088-618"), ["983812329", "674088618"]);
  assert.deepEqual(extractPhones("+34 600 111 222"), ["600111222"]);
  assert.deepEqual(extractPhones("12345"), []);
  assert.deepEqual(extractPhones(""), []);
});

test("extractEmails: varios correos, en minúsculas y sin repetir", () => {
  assert.deepEqual(extractEmails("Tienda@Ejemplo.es; otro@ejemplo.es, tienda@ejemplo.es"), ["tienda@ejemplo.es", "otro@ejemplo.es"]);
  assert.deepEqual(extractEmails("no es correo"), []);
});

test("parseClientes: campos, inactivos, duplicados y filas de total; sin NIF", () => {
  const { customers, stats } = parseClientesXlsx(xlsx());
  assert.deepEqual(customers.map((c) => c.id), ["493", "0004", "954", "955"]); // códigos limpios, ceros conservados
  const t = customers[1];
  assert.deepEqual([t.name, t.legalName, t.city, t.phones, t.emails, t.active], ["TIENDA FICTICIA", "TIENDA FICTICIA SL", "MEDINA DEL CAMPO", ["674088618", "983812329"], ["tienda@ejemplo.es", "otro@ejemplo.es"], true]);
  assert.equal(customers[0].legalName, "JUAN PEREZ GARCIA");
  assert.equal(customers[2].active, false); // bloqueado
  assert.equal(customers[3].active, false); // obsoleto
  assert.equal(JSON.stringify(customers).includes("00000000T"), false); // el NIF no se guarda
  assert.deepEqual(stats, { filas: 6, importados: 4, sinTelefono: 1, sinCorreo: 2, inactivos: 2, duplicados: 1, descartadas: 1 });
});

test("parseClientes: sin cabecera reconocible da un error claro", () => {
  assert.throws(() => parseClientesXlsx(buildWorkbook([{ name: "X", rows: [["a", "b"], ["1", "2"]] }])), /cabecera/);
});
