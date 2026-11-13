import test from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildWorkbook } from "./xlsx.js";

// Carga inicial con un paquete FICTICIO: clientes, productos, descuentos, historial y un cliente de prueba; se repite sin duplicar nada.
test("carga inicial: deja clientes, productos, descuentos e historial listos, reconoce cada archivo solo y repetirla no duplica nada", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-inicial-")), dir = path.join(tmp, "inicial"), datos = path.join(tmp, "datos");
  fs.mkdirSync(path.join(dir, "prueba"), { recursive: true }); fs.mkdirSync(datos);
  const xl = (rows) => Buffer.from(buildWorkbook([{ name: "a", rows }]));
  const productos = Array.from({ length: 25 }, (_, i) => [String(1000 + i), "ARTICULO " + i, 1 + i / 10, i % 2 ? "RED10" : "ORD21", i % 3 ? 6 : 1, "No", i === 24 ? "si" : "No", i % 3 ? 3 : 2]);
  fs.writeFileSync(path.join(dir, "articulos.xlsx"), xl([["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado", "MODO DE VENTA"], ...productos]));
  const clientes = Array.from({ length: 22 }, (_, i) => ["0" + String(500 + i), "BAR NUMERO " + i, "BAR NUMERO " + i + " SL", "MEDINA DEL CAMPO", "CALLE " + i, "983" + String(100000 + i), "", "1234" + String(5000 + i) + "Z", "No", "No", ""]);
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), xl([["Cód. cliente", "Organización", "Razón social", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"], ...clientes]));
  const hist = (cli, doc) => xl([["Artículo", "Descripción", "Unidades", "Fecha", "Precio", "Nº Documento", "Cliente"], ["1001", "ARTICULO 1", 6, 46309, 1.1, doc, cli], ["1002", "ARTICULO 2", 12, 46309, 1.2, doc, cli]]);
  fs.writeFileSync(path.join(dir, "historial-501.xlsx"), hist("0501", "D1"));
  fs.writeFileSync(path.join(dir, "prueba", "historial-falso.xlsx"), hist("0999", "D2"));
  fs.writeFileSync(path.join(dir, "descuentos.json"), JSON.stringify({ 1001: 20, 1002: 10, 7777: 5 }));
  fs.writeFileSync(path.join(dir, "prueba.json"), JSON.stringify([{ id: "T999", name: "CLIENTE FALSO", nif: "81818181A", historial: "prueba/historial-falso.xlsx", codigoEnHistorial: "0999" }]));
  const env = { ...process.env, NIF_PEPPER: "pepper-test", LINK_SECRET: "x", DB_PATH: path.join(datos, "p.sqlite"), CATALOG_DB: path.join(datos, "c.sqlite"), CUSTOMERS_DB: path.join(datos, "cl.sqlite"), ACCOUNTS_DB: path.join(datos, "a.sqlite"), IMG_DIR: path.join(datos, "img") + path.sep };
  const correr = () => execFileSync(process.execPath, ["--no-warnings", "cargar-inicial.js", dir], { env, cwd: path.dirname(fileURLToPath(import.meta.url)), encoding: "utf8" });
  const a = correr();
  assert.match(a, /clientes: clientes\.xlsx → cargado \{"nuevos":22/);
  assert.match(a, /productos: articulos\.xlsx → cargado \{[^}]*"anadidos":24[^}]*\}/); // el bloqueado no entra
  assert.match(a, /descuentos: 2 artículos con descuento/); // el 7777 no existe: se ignora
  assert.match(a, /historial: historial-501\.xlsx → cargado/); assert.doesNotMatch(a, /historial-falso/); // el de prueba va aparte
  assert.match(a, /prueba: T999 CLIENTE FALSO \(cliente ficticio\) con 1 pedidos/);
  assert.match(a, /Catálogo: 24 productos activos .*Clientes: 23\./);
  const b = correr(); // repetirla: todo igual, nada duplicado
  assert.match(b, /clientes: clientes\.xlsx → ya estaba igual/); assert.match(b, /productos: articulos\.xlsx → ya estaba igual/); assert.match(b, /historial: historial-501\.xlsx → ya estaba igual/);
  assert.match(b, /Catálogo: 24 productos activos .*Clientes: 23\./);
  fs.rmSync(tmp, { recursive: true, force: true });
});
