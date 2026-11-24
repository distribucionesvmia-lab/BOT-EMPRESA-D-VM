// Consumo completo de 6 meses: el Excel trae TODAS las compras (no solo la última de cada artículo) y pasa a ser la verdad de los últimos 6 meses del cliente.
// «Los 5 que más consumes» = más veces comprado y, si empatan, más unidades. Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador } from "./actualizar-datos.js";
import { parseConsumo } from "./consumo-import.js";
import { habitualProducts, setCatalog } from "./bot.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const CAB = ["Artículo", "Descripción ", "Unidades", "", "Precio", "Fecha", "Desc.1", "Nº Documento", "Base", "Nombre", "Cód Almacén", "Cliente"];
const fila = (art, uds, fecha, doc, cli = "365") => [String(art), "ARTICULO", String(uds), "", "1", String(fecha), "0", doc, "0", "BAR UNO", "1", cli];
const CAB_P = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado"];
const hoy = new Date().toISOString().slice(0, 10);
const montar = (orders) => {
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  const a = crearActualizador({ catalogDb, customersDb, accountsDb, imgDir: null, registro: () => {} });
  a.aplicar("productos", libro([CAB_P, ["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "2,00", "RED10", "6", "No", "No"], ["3", "CAFE", "5,00", "RED10", "1", "No", "No"]]));
  customersDb.upsertCustomers([{ id: "365", name: "BAR UNO", active: true, orders }]);
  return { a, customersDb };
};
// 46335 = 09/11/2026, 46300 = 05/10/2026, 46250 = 16/08/2026

test("CONSUMO: se leen TODAS las compras de cada artículo (no solo la última)", () => {
  const { todas, items } = parseConsumo([CAB, fila(1, 12, 46250, "A1"), fila(1, 6, 46300, "A2"), fila(1, 24, 46335, "A3")]);
  assert.equal(todas.get("365").length, 3);
  assert.equal(items.get("365").get("1").qty, 24); // para precio y descuento sigue valiendo la última
});

test("CONSUMO COMPLETO: sustituye compras incompletas, quita las de 6 meses que ya no salen y respeta lo anterior a 6 meses", () => {
  const { a, customersDb } = montar([
    { doc: "A3", date: "2026-11-09", lines: [{ productId: "1", qty: 24 }] }, // incompleta: solo el último servicio del agua
    { doc: "FALSA", date: "2026-09-01", lines: [{ productId: "3", qty: 99 }] }, // dentro de 6 meses y no sale en el Excel
    { doc: "ANTIGUA", date: "2026-01-05", lines: [{ productId: "2", qty: 4 }] }, // de hace más de 6 meses: no se toca
  ]);
  const f = libro([CAB, fila(1, 12, 46250, "A1"), fila(2, 3, 46250, "A1"), fila(1, 6, 46300, "A2"), fila(1, 24, 46335, "A3"), fila(2, 3, 46335, "A3")]);
  const p = a.vistaPrevia("consumo", f, { soloCompras: true });
  assert.deepEqual([p.resumen.pedidosNuevos, p.resumen.pedidosCompletados, p.resumen.pedidosQuitados], [2, 1, 1]);
  assert.match(p.confirmar.join(" "), /NO salen en este Excel/); // quitar algo guardado pide confirmación
  assert.equal(customersDb.getById("365").orders.length, 3); // la vista previa no escribe
  assert.throws(() => a.aplicar("consumo", f, { soloCompras: true }), /confirmar/);
  a.aplicar("consumo", f, { soloCompras: true, confirmo: true });
  const docs = Object.fromEntries(customersDb.getById("365").orders.map((o) => [o.doc, o.lines.map((l) => `${l.productId}:${l.qty}`).sort().join(",")]));
  assert.deepEqual(docs, { A1: "1:12,2:3", A2: "1:6", A3: "1:24,2:3", ANTIGUA: "2:4" });
  // repetir el mismo Excel: nada que cambiar
  const p2 = a.vistaPrevia("consumo", f, { soloCompras: true });
  assert.equal(p2.aplicable, false);
});

test("LOS 5 QUE MÁS CONSUMES: más veces comprado y, si empatan, más unidades; las compras de la app también cuentan", async () => {
  const { a, customersDb } = montar([]);
  a.aplicar("consumo", libro([CAB, fila(1, 12, 46250, "A1"), fila(1, 6, 46300, "A2"), fila(1, 24, 46335, "A3"), fila(2, 100, 46300, "A2"), fila(3, 1, 46335, "A3")]), { soloCompras: true });
  setCatalog(catalogDbLista(a, customersDb));
  const cli = customersDb.getById("365");
  let h = habitualProducts(cli, { hoy });
  assert.deepEqual(h.map((p) => [p.id, p.count, p.units]), [["1", 3, 42], ["2", 1, 100], ["3", 1, 1]]); // agua 3 veces; leche (más unidades) antes que café
  // el cliente usa la app: un pedido nuevo cambia lo habitual
  const conApp = { ...cli, orders: [{ doc: "VM-1", date: hoy, lines: [{ productId: "3", qty: 2 }] }, { doc: "VM-2", date: hoy, lines: [{ productId: "3", qty: 2 }] }, { doc: "VM-3", date: hoy, lines: [{ productId: "3", qty: 2 }] }, ...cli.orders] };
  h = habitualProducts(conApp, { hoy });
  assert.deepEqual(h.map((p) => p.id), ["3", "1", "2"]);
  assert.equal(h[0].count, 4); assert.equal(h[0].units, 7); // café: 1 compra de a3ERP + 3 de la app
});

test("INICIO: los precios de las tarjetas van en negrita", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(html, /\.vm-inicio \.in-pie small \{[^}]*font-weight:700/);
});

function catalogDbLista(a, customersDb) {
  return [{ id: "1", name: "AGUA", price: 0.5, vat: 10 }, { id: "2", name: "LECHE", price: 2, vat: 10 }, { id: "3", name: "CAFE", price: 5, vat: 10 }];
}
