import test from "node:test";
import assert from "node:assert/strict";
import { compararProductos, aplicarProductos } from "./productos-diff.js";
import { leerExcel, informe, saltosDePrecio, categoriaPorFamilia } from "./actualizar-productos.js";
import { aprenderFamilias } from "./familias-aprender.js";
import { openCatalogDb } from "./catalogo-db.js";
import { buildWorkbook } from "./xlsx.js";

const actual = [
  { id: "1", name: "AGUA 1,5 L", price: 0.5, unitsPerBox: 6, vat: 10, discount: 5, category: "Aguas" },
  { id: "2", name: "COLA", price: 1, vat: 21 },
  { id: "3", name: "VINO", price: 5, vat: 21, category: "Vinos" },
  { id: "4", name: "ANTIGUO", price: 2, vat: 21 },
  { id: "5", name: "BLOQUEADO LUEGO", price: 3, vat: 21 },
  { id: "6", name: "YA INACTIVO", price: 3, vat: 21, active: false },
];
const nuevo = [
  { id: "1", name: "AGUA 1,5 L", price: 0.5 }, // igual (el Excel no trae descuento ni categoría: se conservan)
  { id: "2", name: "COLA ZERO", price: 1.2, unitsPerBox: 24 }, // cambia nombre, precio y unidades por caja
  { id: "3", name: "VINO", price: 5, vat: 21 }, // igual
  { id: "5", name: "BLOQUEADO LUEGO", price: 3, active: false }, // ahora bloqueado
  { id: "7", name: "NUEVO", price: 4, vat: 10, category: "Despensa" }, // añadido
  { id: "8", name: "SIN PRECIO", price: 0 },
  { id: "6", name: "YA INACTIVO", price: 3, active: true }, // vuelve a estar activo
];

test("compararProductos: añadidos, quitados, modificados, reactivados y sin precio", () => {
  const r = compararProductos(actual, nuevo, { sinPrecioIds: ["9"] });
  assert.deepEqual(r.anadidos.map((p) => p.id), ["7"]);
  assert.deepEqual(r.quitados.map((p) => [p.id, p.motivo]), [["4", "ya no está en el Excel"], ["5", "bloqueado u obsoleto en a3ERP"]]);
  assert.deepEqual(r.modificados.map((m) => [m.id, m.cambios.map((c) => c.campo)]), [["2", ["name", "price", "unitsPerBox"]]]);
  assert.deepEqual(r.modificados[0].cambios.find((c) => c.campo === "price"), { campo: "price", antes: 1, despues: 1.2 });
  assert.deepEqual(r.reactivados.map((p) => p.id), ["6"]);
  assert.deepEqual(r.sinPrecio.map((p) => p.id).sort(), ["8", "9"]);
  assert.equal(r.iguales, 2);
});

test("compararProductos: lo que el Excel no trae no cuenta como cambio (descuento, categoría, IVA)", () => {
  const r = compararProductos([{ id: "1", name: "A", price: 1, vat: 10, discount: 29, category: "Pascual" }], [{ id: "1", name: "A", price: 1 }]);
  assert.equal(r.modificados.length, 0);
  assert.equal(r.iguales, 1);
});

test("aplicarProductos: conserva lo que el Excel no trae, añade los nuevos con su categoría y deja fuera quitados y sin precio", () => {
  const out = aplicarProductos(actual, nuevo);
  const por = Object.fromEntries(out.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(por).sort(), ["1", "2", "3", "6", "7"]);
  assert.equal(por["1"].discount, 5); assert.equal(por["1"].category, "Aguas"); assert.equal(por["1"].unitsPerBox, 6);
  assert.deepEqual([por["2"].name, por["2"].price, por["2"].unitsPerBox, por["2"].vat], ["COLA ZERO", 1.2, 24, 21]);
  assert.equal(por["7"].category, "Despensa");
});

test("saltosDePrecio: avisa de subidas o bajadas de más del 25 %", () => {
  const r = compararProductos([{ id: "1", name: "A", price: 1 }, { id: "2", name: "B", price: 1 }], [{ id: "1", name: "A", price: 1.3 }, { id: "2", name: "B", price: 1.1 }]);
  assert.deepEqual(saltosDePrecio(r).map((s) => [s.id, Math.round(s.pct)]), [["1", 30]]);
});

test("leerExcel: exportación de a3ERP con columna «+» delante del código, códigos con espacios e IVA como código", () => {
  const rows = [
    ["Cód. artículo", "", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado", "Cód. familia para estadísticas"],
    ["+", "          11098", "LECHE", "0,05", "SRE", "150", "No", "No", "1.1"],
    ["+", "         110012", "AGUA", "0,5", "RED10", "6", "No", "No", "10.1"],
    ["+", "           9", "VIEJO", "1", "ORD21", "1", "Sí", "No", "9.9"],
    ["+", "           7", "SIN PRECIO", "#N/A", "ORD21", "1", "No", "No", "9.9"],
  ];
  const { productos, sinPrecioIds } = leerExcel(buildWorkbook([{ name: "ARTICULOS", widths: [], rows }]));
  assert.deepEqual(productos.map((p) => [p.id, p.name, p.price, p.vat, p.vatCode, p.unitsPerBox, p.active, p.family]), [
    ["11098", "LECHE", 0.05, undefined, "SRE", 150, true, "1.1"],
    ["110012", "AGUA", 0.5, 10, undefined, 6, true, "10.1"],
    ["9", "VIEJO", 1, 21, undefined, 1, false, "9.9"],
  ]);
  assert.deepEqual(sinPrecioIds, ["7"]);
  assert.deepEqual(leerExcel(buildWorkbook([{ name: "A", widths: [], rows }]), { iva: { SRE: 4 } }).productos[0].vat, 4);
});

test("familias: se aprende la categoría de cada familia y se usa solo para productos nuevos", () => {
  const mapa = aprenderFamilias([{ id: "1", family: "1.1" }, { id: "2", family: "1.1" }, { id: "3", family: "56.0" }, { id: "4", family: "56.0" }, { id: "5", family: "56.0" }],
    [{ id: "1", category: "Pascual" }, { id: "2", category: "Pascual" }, { id: "3", category: "Hostelería", subcategory: "Vasos" }, { id: "4", category: "Hostelería", subcategory: "Vasos" }, { id: "5", category: "Despensa" }]);
  assert.deepEqual(mapa, { "1.1": { category: "Pascual" }, "56.0": { category: "Hostelería", subcategory: "Vasos" } });
  assert.deepEqual(categoriaPorFamilia(mapa)({ family: "56.0" }), { category: "Hostelería", subcategory: "Vasos" });
  assert.deepEqual(categoriaPorFamilia(mapa)({ family: "99.9" }), {});
});

test("informe: resumen con los números y los cambios de cada producto", () => {
  const t = informe(compararProductos(actual, nuevo, { sinPrecioIds: ["9"] }), { fichero: "A.xlsx" });
  assert.match(t, /\| 1 \| 2 \| 1 \| 1 \| 2 \| 2 \|/); // añadidos, quitados, modificados, reactivados, sin precio, iguales
  assert.match(t, /\*\*2\*\* COLA: Nombre COLA → COLA ZERO; Precio 1,00 € → 1,20 €; Unidades por caja — → 24/);
  assert.match(t, /- 4 ANTIGUO · ya no está en el Excel/);
});

test("upsertProducts parcial: lo no indicado se conserva y los que no vienen quedan inactivos con su historial", () => {
  const db = openCatalogDb(":memory:");
  db.upsertProducts([{ id: "1", name: "A", price: 1, vat: 10, discount: 29, category: "Pascual" }, { id: "2", name: "B", price: 2 }]);
  const r = db.upsertProducts([{ id: "1", name: "A", price: 1.5 }, { id: "3", name: "C", price: 3 }], { partial: true, deactivateMissing: true });
  assert.deepEqual(r, { added: 1, updated: 1, unchanged: 0, deactivated: 1 });
  const a = db.get("1");
  assert.deepEqual([a.price, a.vat, a.discount, a.category], [1.5, 10, 29, "Pascual"]);
  assert.deepEqual(db.list({ activeOnly: false }).map((p) => [p.id, p.active]), [["1", true], ["2", false], ["3", true]]);
  assert.deepEqual(db.history("1").map((h) => h.field), ["price", "alta"]); // el cambio de precio quedó registrado
});
