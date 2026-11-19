// Excel de «Consumo de clientes» (precio y descuento propios de cada cliente + historial): vista previa con diferencias, aplicar y repetir.
// Todo con datos ficticios (el Excel real lleva datos de clientes y costes: nunca va a GitHub).
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador, detectarTipo } from "./actualizar-datos.js";
import { parseConsumo } from "./consumo-import.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const CAB = ["Artículo", "Descripción ", "Unidades", "", "Precio", "Fecha", "Desc.1", "Nº Documento", "Base", "Nombre", "Cód Almacén", "Cliente", "Desc. Almacén", "Coste", "Obt. precio coste"];
const fila = (art, uds, precio, desc, fecha, doc, cli) => [`          ${art}`, "ARTICULO", String(uds), "", String(precio), String(fecha), String(desc), doc, "0", "NOMBRE", "1", `    ${cli}`, "Almacén central", "9.9999", "PMED"];
const consumo = (...f) => libro([CAB, ...f]);
const CAB_P = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado"];
const montar = () => {
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  const a = crearActualizador({ catalogDb, customersDb, accountsDb, imgDir: null, registro: () => {} });
  a.aplicar("productos", libro([CAB_P, ["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "2,00", "RED10", "6", "No", "No"]]));
  customersDb.upsertCustomers([{ id: "365", name: "BAR UNO", active: true, orders: [{ doc: "VIEJO", date: "2026-01-05", lines: [{ productId: "1", qty: 1 }] }] }]);
  return { a, customersDb };
};

test("CONSUMO: se leen las columnas con códigos rellenos de espacios y decimales con punto; el COSTE no se guarda", () => {
  const { items, stats } = parseConsumo([CAB, fila(1, 12, "4.995", "13.5", 46335, "D1", "0365"), fila(1, 2, "5", "10", 46340, "D2", "0365"), fila(3, 1, 0, 0, 46335, "D3", "0365")]);
  const m = items.get("0365");
  assert.deepEqual(m.get("1"), { price: 5, pct: 10, qty: 2, date: "2026-11-14", doc: "D2" }); // el mismo artículo dos veces: vale el más reciente
  assert.equal(m.get("3").price, null); // precio 0: cuenta como compra pero no toca precio ni descuento
  assert.equal(stats.sinPrecio, 1);
  assert.ok(!JSON.stringify([...items]).includes("9.9999")); // nada del coste
  assert.throws(() => parseConsumo([["a", "b"]]), /cabecera/);
});

test("CONSUMO: el Excel se reconoce como «consumo» y el historial de siempre sigue siendo «historial»", () => {
  assert.equal(detectarTipo(consumo(fila(1, 1, 1, 0, 46335, "D1", "1"))), "consumo");
  assert.equal(detectarTipo(libro([["Cliente", "Fecha", "Nº Documento", "Artículo", "Unidades"], ["1", "01/10/2026", "A1", "10", "2"]])), "historial");
  const { a } = montar();
  assert.throws(() => a.vistaPrevia("historial", consumo(fila(1, 1, 1, 0, 46335, "D1", "1"))), /consumo de clientes/); // en la tarjeta equivocada avisa
});

test("CONSUMO: vista previa sin escribir; aplicar añade descuento y precio propio y suma pedidos sin borrar; repetirlo no cambia nada", () => {
  const { a, customersDb } = montar();
  const f1 = consumo(fila(1, 12, "0.5", "10", 46335, "D1", "0365"), fila(2, 3, "2.5", "0", 46335, "D1", "0365"), fila(77, 1, "1", "0", 46335, "D1", "0365"), fila(1, 1, "0.5", "0", 46335, "D9", "9999"));
  const p = a.vistaPrevia("consumo", f1);
  assert.deepEqual([p.resumen.descuentosNuevos, p.resumen.preciosPropiosNuevos, p.resumen.pedidosNuevos, p.resumen.desconocidos], [1, 1, 1, 1]);
  assert.match(p.aviso.join(" "), /quitando ceros/); assert.match(p.aviso.join(" "), /no están en el catálogo/);
  const c = p.detalle.conCambios[0];
  assert.deepEqual(c.cambios.map((x) => [x.campo, x.antes, x.despues]), [["Descuento · AGUA", "0 %", "10 %"], ["Precio · LECHE", "2 €", "2.5 €"]]);
  assert.deepEqual(customersDb.getById("365").discounts, {}); // la vista previa no escribe
  assert.ok(p.confirmar?.length); // un precio distinto de la tarifa: hay que confirmarlo
  assert.throws(() => a.aplicar("consumo", f1), /confirmar/);
  a.aplicar("consumo", f1, { confirmo: true });
  const cli = customersDb.getById("365");
  assert.deepEqual(cli.discounts, { 1: 10 }); assert.deepEqual(cli.specialPrices, { 2: 2.5 });
  assert.deepEqual(cli.orders.map((o) => o.doc).sort(), ["D1", "VIEJO"]); // lo que tenía sigue ahí
  // el mismo Excel otra vez: nada que aplicar
  const p2 = a.vistaPrevia("consumo", f1);
  assert.equal(p2.aplicable, false); assert.equal(p2.resumen.iguales, 1);
  // otro Excel con un descuento distinto: solo cambia eso
  const f2 = consumo(fila(1, 6, "0.5", "15", 46350, "D2", "0365"), fila(2, 3, "2.5", "0", 46335, "D1", "0365"));
  const p3 = a.vistaPrevia("consumo", f2);
  assert.deepEqual([p3.resumen.descuentosCambian, p3.resumen.descuentosNuevos, p3.resumen.preciosPropiosCambian, p3.resumen.pedidosNuevos], [1, 0, 0, 1]);
  assert.ok(!p3.confirmar); // sin precios nuevos distintos de la tarifa no hace falta confirmar
  a.aplicar("consumo", f2);
  assert.deepEqual(customersDb.getById("365").discounts, { 1: 15 }); assert.deepEqual(customersDb.getById("365").specialPrices, { 2: 2.5 });
});
