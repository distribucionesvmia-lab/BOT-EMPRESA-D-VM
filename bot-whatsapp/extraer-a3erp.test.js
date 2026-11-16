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

test("--bases: cada Excel va a su carpeta BASE-… (la que ya exista, con tilde o palabras detrás) con la fecha en el nombre, y las que faltan se crean", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { carpetaBase, sello } = await import("./extraer-a3erp.js");
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "vm-bases-"));
  fs.mkdirSync(path.join(raiz, "BASE-ARTÍCULOS")); fs.mkdirSync(path.join(raiz, "BASE-HISTORICO PEDIDOS")); fs.mkdirSync(path.join(raiz, "otra"));
  assert.equal(path.basename(carpetaBase(raiz, "productos")), "BASE-ARTÍCULOS"); // la que ya estaba, tal cual
  assert.equal(path.basename(carpetaBase(raiz, "historial")), "BASE-HISTORICO PEDIDOS");
  assert.equal(path.basename(carpetaBase(raiz, "clientes")), "BASE-CLIENTES"); // no existía: se crea
  assert.ok(fs.existsSync(path.join(raiz, "BASE-CLIENTES")));
  assert.equal(fs.readdirSync(raiz).filter((n) => /^base/i.test(n)).length, 3); // no se crean duplicadas
  assert.match(sello(new Date(2026, 10, 16, 9, 5)), /^20261116-0905$/);
  // el archivo que deja es un Excel que ya entiende la importación (y que el programa reconocerá en su carpeta)
  const filas = [["954", "CARNICERIA JESUS", "JESUS ALONSO ARRIBAS", "MEDINA DEL CAMPO", "47085", "CL. VALLADOLID 67, 67", "983812329", "a@b.es", "123456789", "No", "No"]];
  const f = path.join(carpetaBase(raiz, "clientes"), `clientes-${sello()}.xlsx`); fs.writeFileSync(f, aExcel(CONSULTAS.clientes, filas, "clientes"));
  assert.equal(parseClientesXlsx(fs.readFileSync(f)).customers.length, 1);
  const bat = fs.readFileSync(new URL("./deploy/windows/extraer-excels.bat", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(bat, /extraer-a3erp\.js --db %BASE% --bases C:\\vm/); assert.match(bat, /set "SERVIDOR=\."/); assert.match(bat, /set "SQLCMD_JSON=\["sqlcmd","-S","%SERVIDOR%","-E","-C"\]"/);
});
