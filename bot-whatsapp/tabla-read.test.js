import { test } from "node:test";
import assert from "node:assert/strict";
import { leerCsv, leerFilas } from "./tabla-read.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { parseProductosXlsx } from "./productos-import.js";

const buf = (s, enc = "utf8") => Buffer.from(s, enc);

test("texto de sqlcmd con «|»: las comillas son parte del nombre y no se interpretan", () => {
  const rows = leerCsv(buf('Código|Descripción|Precio\r\n10016|"2025" BORNOS VERDEJO 75 CL|4.5\r\n25132|HELIOS  "BRIK" TOMATE|1.825\r\n'));
  assert.deepEqual(rows[1], ["10016", '"2025" BORNOS VERDEJO 75 CL', "4.5"]);
  assert.deepEqual(rows[2], ["25132", 'HELIOS  "BRIK" TOMATE', "1.825"]);
});

test("CSV de Excel con «;»: comillas, comillas escapadas y saltos de línea dentro de un campo", () => {
  const rows = leerCsv(buf('a;b;c\n1;"x;y";"di ""hola"""\n2;"línea 1\nlínea 2";z\n'));
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x;y", 'di "hola"'], ["2", "línea 1\nlínea 2", "z"]]);
});

test("codificación: UTF-8 con BOM, y Windows-1252 si no es UTF-8 válido", () => {
  assert.equal(leerCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf("Cód|Sí\n1|2\n")]))[0][0], "Cód");
  assert.equal(leerCsv(buf("Organización|Población\n1|2\n", "latin1"))[0][0], "Organización");
});

test("leerFilas elige por la extensión del nombre y las importaciones aceptan texto", () => {
  assert.equal(leerFilas(buf("a|b\n1|2\n"), "clientes.csv").length, 2);
  const cli = parseClientesXlsx(buf("Cód. cliente|Organización|Razón social / Nombre fiscal de la organización|Población|Cód. municipio|Dirección fiscal|Teléfono|E-Mail|NIF|Bloqueado|Obsoleto\n954|CARNICERIA JESUS|JESUS ALONSO ARRIBAS|MEDINA DEL CAMPO|47085|CL. VALLADOLID 67|983812329 / 600111222|a@b.es|12333110G|No|No\n"), "clientes.csv");
  assert.equal(cli.customers[0].id, "954");
  assert.equal(cli.customers[0].municipio, "47085");
  assert.deepEqual(cli.customers[0].phones, ["983812329", "600111222"]);
  const pro = parseProductosXlsx(buf("Código|Descripción|Precio|Uds. por caja|% IVA|Dto.|Bloqueado|Obsoleto\n9107|P. COOKIE|1.654|20|10|0.0000|No|No\n"), "productos.csv");
  assert.equal(pro.products[0].price, 1.654);
  assert.equal(pro.products[0].unitsPerBox, 20);
});
