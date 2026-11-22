// Excel de «Consumo de clientes» (precio y descuento propios de cada cliente + historial): vista previa con diferencias, aplicar y repetir.
// Todo con datos ficticios (el Excel real lleva datos de clientes y costes: nunca va a GitHub).
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador, detectarTipo } from "./actualizar-datos.js";
import { precioEfectivo } from "./pricing.js";
import { parseConsumo } from "./consumo-import.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const CAB = ["Artículo", "Descripción ", "Unidades", "", "Precio", "Fecha", "Desc.1", "Nº Documento", "Base", "Nombre", "Cód Almacén", "Cliente", "Desc. Almacén", "Coste", "Obt. precio coste"];
const fila = (art, uds, precio, desc, fecha, doc, cli, nombre = "BAR UNO") => [`          ${art}`, "ARTICULO", String(uds), "", String(precio), String(fecha), String(desc), doc, "0", nombre, "1", `    ${cli}`, "Almacén central", "9.9999", "PMED"];
const consumo = (...f) => libro([CAB, ...f]);
const CAB_P = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado"];
const montar = () => {
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  const a = crearActualizador({ catalogDb, customersDb, accountsDb, imgDir: null, registro: () => {} });
  a.aplicar("productos", libro([CAB_P, ["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "2,00", "RED10", "6", "No", "No"]]));
  customersDb.upsertCustomers([
    { id: "365", name: "BAR UNO", active: true, orders: [{ doc: "VIEJO", date: "2026-01-05", lines: [{ productId: "1", qty: 1 }] }] },
    { id: "400", name: "Dos", legalName: "RESTAURANTE EL ROBLE SL", active: true, orders: [{ doc: "VIEJO2", date: "2026-02-05", lines: [{ productId: "2", qty: 4 }] }] },
    { id: "500", name: "TERCERO", active: true, orders: [] },
  ]);
  return { a, customersDb, catalogDb };
};

test("CONSUMO: se leen las columnas con códigos rellenos de espacios y decimales con punto; el COSTE no se guarda", () => {
  const { items, stats } = parseConsumo([CAB, fila(1, 12, "4.995", "13.5", 46335, "D1", "0365"), fila(1, 2, "5", "10", 46340, "D2", "0365"), fila(3, 1, 0, 0, 46335, "D3", "0365")]);
  const m = items.get("0365");
  assert.deepEqual(m.get("1"), { price: 5, pct: 10, qty: 2, date: "2026-11-14", doc: "D2" }); // el mismo artículo dos veces: vale el más reciente
  assert.equal(m.has("3"), false); // precio 0: es un regalo, no una compra: se ignora del todo (ni habitual, ni precio, ni descuento)
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

test("CONSUMO: cada cliente recibe SOLO lo suyo (precios, descuentos e historial) y los demás ni lo ven ni se tocan", () => {
  const { a, customersDb, catalogDb } = montar();
  const antes500 = JSON.stringify(customersDb.getById("500"));
  const f = consumo(
    fila(1, 12, "0.5", "10", 46335, "D1", "0365", "BAR UNO"), fila(2, 3, "2", "5", 46335, "D1", "0365", "BAR UNO"),
    fila(1, 6, "0.5", "25", 46340, "D2", "0400", "ROBLE, EL"), fila(2, 2, "3", "0", 46340, "D2", "0400", "ROBLE, EL"),
  );
  const p = a.vistaPrevia("consumo", f);
  assert.equal(p.resumen.nombreNoCoincide, 0); assert.equal(p.resumen.clientesConCambios, 2);
  a.aplicar("consumo", f, { confirmo: true });
  const A = customersDb.getById("365"), B = customersDb.getById("400"), C = customersDb.getById("500");
  assert.deepEqual([A.discounts, A.specialPrices], [{ 1: 10, 2: 5 }, {}]);   // lo de A
  assert.deepEqual([B.discounts, B.specialPrices], [{ 1: 25 }, { 2: 3 }]);    // lo de B: otro descuento y un precio propio que A no tiene
  assert.equal(JSON.stringify(C), antes500);                                   // el tercero, intacto
  assert.deepEqual(A.orders.map((o) => o.doc).sort(), ["D1", "VIEJO"]);        // el historial de A: el suyo
  assert.deepEqual(B.orders.map((o) => o.doc).sort(), ["D2", "VIEJO2"]);       // el de B: el suyo, sin nada de A
  assert.deepEqual(B.orders.find((o) => o.doc === "D2").lines.map((l) => [l.productId, l.qty]).sort(), [["1", 6], ["2", 2]]);
  // lo que paga cada uno por el MISMO artículo: distinto, y cada cliente solo ve su propio precio
  const leche = catalogDb.list({ activeOnly: false }).find((x) => String(x.id) === "2"), agua = catalogDb.list({ activeOnly: false }).find((x) => String(x.id) === "1");
  assert.deepEqual(precioEfectivo(leche, A, "2"), { price: 2, discount: 5 });
  assert.deepEqual(precioEfectivo(leche, B, "2"), { price: 3, discount: 0 });
  assert.deepEqual(precioEfectivo(leche, C, "2"), { price: 2, discount: 0 });  // sin datos propios: la tarifa
  assert.deepEqual([precioEfectivo(agua, A, "1").discount, precioEfectivo(agua, B, "1").discount, precioEfectivo(agua, C, "1").discount], [10, 25, 0]);
});

test("CONSUMO: si el nombre del Excel no se parece al del cliente de ese código, NO se toca a ese cliente (el código podría ser de otro)", () => {
  const { a, customersDb } = montar();
  const antes = JSON.stringify(customersDb.getById("365"));
  const f = consumo(fila(1, 12, "0.5", "40", 46335, "D1", "0365", "PANADERIA OTRA"), fila(1, 6, "0.5", "25", 46340, "D2", "0400", "RESTAURANTE EL ROBLE"));
  const p = a.vistaPrevia("consumo", f);
  assert.equal(p.resumen.nombreNoCoincide, 1); assert.equal(p.resumen.clientesConCambios, 1);
  assert.match(p.aviso.join(" "), /NO se tocan/); assert.equal(p.detalle.nombreNoCoincide[0].id, "365");
  a.aplicar("consumo", f);
  assert.equal(JSON.stringify(customersDb.getById("365")), antes);             // intacto: ni descuento ni historial
  assert.deepEqual(customersDb.getById("400").discounts, { 1: 25 });           // el que sí coincide (por su razón social) se aplica
});

test("CONSUMO: «solo descuentos e historial» aplica eso sin pedir confirmar y NO guarda ningún precio propio", () => {
  const { a, customersDb } = montar();
  const f = consumo(fila(1, 12, "0.5", "10", 46335, "D1", "0365"), fila(2, 3, "2.5", "0", 46335, "D1", "0365")); // el artículo 2 traería un precio distinto de la tarifa
  assert.ok(a.vistaPrevia("consumo", f).confirmar?.length);                       // normal: pide confirmar
  const p = a.vistaPrevia("consumo", f, { sinPrecios: true });
  assert.equal(p.confirmar, undefined); assert.equal(p.resumen.preciosPropiosNuevos, 0); assert.equal(p.resumen.descuentosNuevos, 1);
  a.aplicar("consumo", f, { sinPrecios: true });                                   // sin confirmo: no hace falta
  const c = customersDb.getById("365");
  assert.deepEqual(c.discounts, { 1: 10 }); assert.deepEqual(c.specialPrices, {});  // el descuento sí, el precio no
  assert.deepEqual(c.orders.map((o) => o.doc).sort(), ["D1", "VIEJO"]);              // y el historial también
  // más tarde, ya revisados los precios, se pueden aplicar con el modo normal
  a.aplicar("consumo", f, { confirmo: true });
  assert.deepEqual(customersDb.getById("365").specialPrices, { 2: 2.5 });
});

test("CONSUMO: precio y descuento son cosas distintas: a tarifa con descuento propio, precio propio con su descuento aparte, y sin descuento propio no se guarda ninguno", () => {
  const { a, customersDb } = montar();
  a.aplicar("productos", libro([[...CAB_P, "Descuento"], ["1", "AGUA", "0,50", "RED10", "6", "No", "No", "0"], ["2", "LECHE", "2,00", "RED10", "6", "No", "No", "8"]]));
  const f = consumo(
    fila(1, 12, "0.5", "10", 46335, "D1", "0365"),  // a precio de tarifa pero con descuento propio → solo descuento
    fila(2, 3, "2.5", "0", 46335, "D1", "0365"),    // precio distinto y cobrado SIN descuento aunque la tarifa tiene 8 % → se guarda 0 %: prevalece lo cobrado
    fila(2, 3, "2.5", "15", 46335, "D2", "0400", "ROBLE, EL"), // precio especial CON su descuento aparte
    fila(1, 1, "0.5", "100", 46340, "D3", "0400", "ROBLE, EL"), // 100 %: nunca se guarda como descuento
  );
  const p = a.vistaPrevia("consumo", f);
  assert.match(p.aviso.join(" "), /100 %/);
  a.aplicar("consumo", f, { confirmo: true });
  const A = customersDb.getById("365"), B = customersDb.getById("400");
  assert.deepEqual([A.discounts, A.specialPrices], [{ 1: 10, 2: 0 }, { 2: 2.5 }]);
  assert.deepEqual([B.discounts, B.specialPrices], [{ 2: 15 }, { 2: 2.5 }]);
  assert.ok(A.orders.some((o) => o.doc === "D1" && o.date === "2026-11-09"), JSON.stringify(A.orders.map((o) => [o.doc, o.date]))); // la compra con su fecha queda en su historial
});
