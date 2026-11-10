import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { parseNumber, parseProductos, parseProductosXlsx } from "./productos-import.js";

test("parseNumber: formatos español e inglés", () => {
  assert.equal(parseNumber("1.234,56"), 1234.56);
  assert.equal(parseNumber("0,42 €"), 0.42);
  assert.equal(parseNumber("1.25"), 1.25);
  assert.equal(parseNumber("1.234.567"), 1234567);
  assert.equal(parseNumber(21), 21);
  assert.equal(parseNumber("21 %"), 21);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
});

const cab = ["Código", "Descripción", "Código de barras", "Precio venta", "Precio compra", "Uds. por caja", "% IVA", "Dto.", "Bloqueado", "Obsoleto"];
const xlsx = () => buildWorkbook([{ name: "ARTICULOS", rows: [["Listado de artículos"], cab,
  ["  1001", "AGUA MINERAL 1,5 L", "8412345678901", "0,42", "0,30", "6", "10", "", "No", "No"],
  ["1002", "REFRESCO COLA 33 CL", "", "0,55", "0,40", "24", "10", "5", "No", "No"],
  ["1003", "VINO CRIANZA", "", "27,50", "20", "", "21", "", "Sí", "No"],
  ["1004", "SIN PRECIO", "", "", "", "", "21", "", "No", "No"],
  ["1001", "REPETIDO", "", "9", "", "", "", "", "No", "No"],
  ["", "SIN CÓDIGO", "", "1", "", "", "", "", "No", "No"],
] }]);

test("parseProductos: reconoce las columnas por la cabecera (aunque haya un título antes) y usa el precio de venta", () => {
  const { products, stats } = parseProductosXlsx(xlsx());
  assert.deepEqual(products.map((p) => p.id), ["1001", "1002", "1003"]);
  assert.deepEqual(products[0], { id: "1001", name: "AGUA MINERAL 1,5 L", price: 0.42, active: true, unitsPerBox: 6, vat: 10 });
  assert.equal(products[1].discount, 5);
  assert.equal(products[2].active, false);
  assert.equal(products[2].unitsPerBox, undefined);
  assert.deepEqual(stats, { filas: 6, importados: 3, sinPrecio: 1, sinPrecioIds: ["1004"], duplicados: 1, inactivos: 1, descartadas: 1 });
});

test("parseProductos: sin cabecera reconocible da un error claro", () => {
  assert.throws(() => parseProductos([["a", "b"], ["1", "2"]]), /cabecera/);
  assert.throws(() => parseProductos([["Código", "Descripción"], ["1", "x"]]), /cabecera/); // falta el precio
});

test("tarifa con una hoja por proveedor: «Artículo» es el nombre, códigos de IVA, '#N/A' sin precio y cabecera duplicada", async () => {
  const { tipoIva } = await import("./productos-import.js");
  const r = parseProductos([["Cód. artículo", "Artículo", "Precio venta", "Dto%", "Tipo IVA ventas", "Unidades paquete venta", "Bloqueado"], ["1", "VINO A", "10,97", "", "ORD21", "6", "No"], ["2", "VINO B", "#N/A", "", "ORD21", "6", "No"], ["3", "LECHE", "0,7", "", "SRE", "8", "Sí"]]);
  assert.deepEqual(r.products.map((p) => [p.id, p.name, p.price, p.vat, p.unitsPerBox, p.active]), [["1", "VINO A", 10.97, 21, 6, true], ["3", "LECHE", 0.7, 4, 8, false]]);
  assert.equal(r.stats.sinPrecio, 1);
  assert.deepEqual(["21", "RED10", "ORD21", "SRE", "x"].map(tipoIva), [21, 10, 21, 4, null]);
  const d = parseProductos([["Cód. artículo", "Cód. artículo", "Precio venta"], ["9", "PASTA", "1,35"]]);
  assert.equal(d.products[0].name, "PASTA");
});
