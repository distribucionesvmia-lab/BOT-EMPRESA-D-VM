import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador, dimensiones } from "./actualizar-datos.js";

const libro = (rows) => Buffer.from(buildWorkbook([{ name: "H", widths: [], rows }]));
const montar = () => {
  const registros = [];
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-img-"));
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  return { catalogDb, customersDb, accountsDb, registros, a: crearActualizador({ catalogDb, customersDb, accountsDb, imgDir, registro: (e) => registros.push(e) }) };
};
const CAB_P = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado"];
const prod = (...f) => libro([CAB_P, ...f]);

test("productos: vista previa no escribe; aplicar solo toca las diferencias y deja registro", () => {
  const { a, catalogDb, registros } = montar();
  const v1 = prod(["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "1,00", "RED10", "6", "No", "No"]);
  const p1 = a.vistaPrevia("productos", v1);
  assert.equal(p1.resumen.anadidos, 2);
  assert.equal(catalogDb.list({ activeOnly: false }).length, 0); // la vista previa no escribe
  assert.equal(a.aplicar("productos", v1, { fichero: "a.xlsx" }).anadidos, 2);
  assert.equal(registros.length, 1);
  // segundo Excel: AGUA cambia de precio, LECHE ya no está, ZUMO es nuevo
  const v2 = prod(["1", "AGUA", "0,60", "RED10", "6", "No", "No"], ["3", "ZUMO", "2,00", "RED10", "1", "No", "No"]);
  const p2 = a.vistaPrevia("productos", v2);
  assert.deepEqual([p2.resumen.anadidos, p2.resumen.quitados, p2.resumen.modificados], [1, 1, 1]);
  assert.deepEqual(p2.detalle.modificados[0].cambios[0], { campo: p2.detalle.modificados[0].cambios[0].campo, antes: 0.5, despues: 0.6 });
  a.aplicar("productos", v2);
  const act = Object.fromEntries(catalogDb.list({ activeOnly: false }).map((p) => [p.id, p]));
  assert.equal(act["1"].price, 0.6);
  assert.equal(act["2"].active, false);
  assert.equal(act["3"].price, 2);
  assert.throws(() => a.aplicar("productos", v2), /nada que aplicar/); // repetirlo no hace nada
});

test("productos: un Excel incompleto (menos de la mitad) se rechaza", () => {
  const { a, catalogDb } = montar();
  catalogDb.upsertProducts(Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: "P" + i, price: 1, vat: 10 })));
  const p = a.vistaPrevia("productos", prod(["1", "P0", "1", "RED10", "1", "No", "No"]));
  assert.equal(p.aplicable, false);
  assert.throws(() => a.aplicar("productos", prod(["1", "P0", "1", "RED10", "1", "No", "No"])), /incompleto/);
});

const CAB_C = ["Cód. cliente", "Organización", "Razón social", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"];
const cli = (...f) => libro([CAB_C, ...f]);
const filaC = (id, n, tel = "611222333") => [id, n, n, "MEDINA", "CL UNO 1", tel, "", "B11111111", "No", "No", "1"];

test("clientes: añade los nuevos, actualiza solo los cambiados y no da de baja a los ausentes", () => {
  const { a, customersDb, accountsDb } = montar();
  a.aplicar("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS")));
  assert.equal(customersDb.count(), 2);
  const p = a.vistaPrevia("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS NUEVO", "699000111"), filaC("3", "BAR TRES")));
  assert.deepEqual([p.resumen.nuevos, p.resumen.modificados, p.resumen.iguales], [1, 1, 1]);
  assert.equal(p.detalle.modificados[0].cambios.some((c) => c.antes === "BAR DOS" && c.despues === "BAR DOS NUEVO"), true);
  a.aplicar("clientes", cli(filaC("2", "BAR DOS NUEVO", "699000111"), filaC("3", "BAR TRES")));
  assert.equal(customersDb.getById("2").name, "BAR DOS NUEVO");
  assert.equal(customersDb.getById("1").active, true); // el 1 no venía y sigue activo
  assert.equal(accountsDb.listAccounts().length, 3);
});

const CAB_H = ["Cód. cliente", "Fecha", "Documento", "Cód. artículo", "Cantidad"];
test("historial: solo se reescribe el de los clientes cuyo histórico cambia", () => {
  const { a, customersDb } = montar();
  a.aplicar("clientes", cli(filaC("1", "BAR UNO"), filaC("2", "BAR DOS")));
  const h1 = libro([CAB_H, ["1", "01/10/2026", "A1", "10", "2"], ["2", "02/10/2026", "A2", "11", "3"]]);
  assert.equal(a.aplicar("historial", h1).clientes, 2);
  const h2 = libro([CAB_H, ["1", "01/10/2026", "A1", "10", "2"], ["2", "02/10/2026", "A2", "11", "3"], ["2", "09/10/2026", "A3", "12", "1"], ["99", "09/10/2026", "A4", "12", "1"]]);
  const p = a.vistaPrevia("historial", h2);
  assert.deepEqual([p.resumen.clientesConCambios, p.resumen.pedidosNuevos, p.resumen.iguales, p.resumen.desconocidos], [1, 1, 1, 1]);
  a.aplicar("historial", h2);
  assert.equal(customersDb.getById("2").orders.length, 2);
  assert.equal(customersDb.getById("1").orders.length, 1);
});

test("tipo desconocido o Excel que no es del tipo: error claro", () => {
  const { a } = montar();
  assert.throws(() => a.vistaPrevia("pedidos", prod()), /desconocido/);
  assert.throws(() => a.vistaPrevia("clientes", prod(["1", "X", "1", "RED10", "1", "No", "No"])), /parece un Excel de productos o artículos, no de clientes/);
});

import { zip } from "./zip.js";
test("fotos: un ZIP con «<código>.jpg» en carpetas; solo las de productos del catálogo, nuevas o cambiadas", () => {
  const { a, catalogDb } = montarConFotos();
  catalogDb.upsertProducts([{ id: "11", name: "AGUA", price: 1, vat: 10 }, { id: "12", name: "LECHE", price: 1, vat: 10 }]);
  const foto = (n) => Buffer.alloc(300, n);
  const z1 = Buffer.from(zip({ "fotos/11 - AGUA/11.jpg": foto(1), "12.png": foto(2), "99.jpg": foto(3), "control.xlsx": foto(4), "__MACOSX/11.jpg": foto(5) }));
  const p = a.vistaPrevia("fotos", z1);
  assert.deepEqual([p.resumen.fotosNuevas, p.resumen.fotosCambiadas, p.resumen.ignoradas], [2, 0, 1]); // 99 no está en el catálogo
  assert.equal(a.aplicar("fotos", z1).fotosGuardadas, 2);
  assert.equal(fs.existsSync(path.join(a.imgDir, "11.jpg")) && fs.existsSync(path.join(a.imgDir, "12.png")), true);
  assert.throws(() => a.aplicar("fotos", z1), /nada que aplicar/); // repetirlo no hace nada
  const z2 = Buffer.from(zip({ "11.webp": foto(9) }));
  assert.equal(a.vistaPrevia("fotos", z2).resumen.fotosCambiadas, 1);
  a.aplicar("fotos", z2);
  assert.equal(fs.existsSync(path.join(a.imgDir, "11.jpg")), false); // una sola foto por producto
  assert.equal(fs.existsSync(path.join(a.imgDir, "11.webp")), true);
});
test("fotos: el Excel de control del ZIP marca las fotos «IA» y el catálogo las avisa", () => {
  const { a, catalogDb } = montarConFotos();
  catalogDb.upsertProducts([{ id: "21", name: "ATUN", price: 1, vat: 10 }, { id: "22", name: "PAN", price: 1, vat: 10 }]);
  const control = Buffer.from(buildWorkbook([{ name: "Hoja", widths: [], rows: [["codigo", "producto", "tipo"], ["21", "ATUN", "IA"], ["22", "PAN", "real"]] }]));
  const z = Buffer.from(zip({ "21.jpg": Buffer.alloc(300, 1), "22.jpg": Buffer.alloc(300, 2), "control_fotos.xlsx": control }));
  assert.equal(a.vistaPrevia("fotos", z).resumen.fotosIA, 1);
  a.aplicar("fotos", z);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.imgDir, "fotos-ia.json"), "utf8")), ["21"]);
  // una foto real posterior para el 21 la quita de la lista
  const z2 = Buffer.from(zip({ "21.png": Buffer.alloc(300, 7), "control_fotos.xlsx": Buffer.from(buildWorkbook([{ name: "H", widths: [], rows: [["codigo", "tipo"], ["21", "real"]] }])) }));
  a.aplicar("fotos", z2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.imgDir, "fotos-ia.json"), "utf8")), []);
});
function montarConFotos() {
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-img-"));
  const catalogDb = openCatalogDb(":memory:");
  return { catalogDb, a: { ...crearActualizador({ catalogDb, customersDb: openCustomersDb(":memory:"), accountsDb: openAccountsDb(":memory:"), imgDir }), imgDir } };
}

test("dimensiones: lee el tamaño de un PNG y de un JPEG, y avisa de las fotos pequeñas", () => {
  const png = Buffer.alloc(40); png[0] = 0x89; png[1] = 0x50; png.writeUInt32BE(64, 16); png.writeUInt32BE(48, 20);
  assert.deepEqual(dimensiones(png), { w: 64, h: 48 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x04, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // 1024 × 800
  assert.deepEqual(dimensiones(jpg), { w: 1024, h: 800 });
  assert.equal(dimensiones(Buffer.from("no es una imagen")), null);
  const { a, catalogDb } = montarConFotos();
  catalogDb.upsertProducts([{ id: "31", name: "AGUA", price: 1, vat: 10 }]);
  const z = Buffer.from(zip({ "31.png": Buffer.concat([png, Buffer.alloc(300)]) }));
  assert.match(a.vistaPrevia("fotos", z).aviso.join(" "), /baja resolución/);
});

test("productos: un precio que cambia mucho o datos raros obligan a confirmar antes de aplicar, y se enseña cómo se ha leído el Excel", () => {
  const { a, catalogDb } = montar();
  a.aplicar("productos", prod(["1", "AGUA", "0,50", "RED10", "6", "No", "No"], ["2", "LECHE", "1,00", "RED10", "6", "No", "No"]));
  // el Excel nuevo sube el agua de 0,50 a 5,00 (+900 %), trae una celda disparatada y un IVA que no existe
  const x = prod(["1", "AGUA", "5,00", "RED10", "6", "No", "No"], ["2", "LECHE", "1,00", "RED10", "6", "No", "No"], ["3", "LOCO", "99999", "RED10", "1", "No", "No"], ["4", "IVA RARO", "2", "7", "1", "No", "No"]);
  const p = a.vistaPrevia("productos", x);
  assert.equal(p.aplicable, true);
  assert.equal(p.confirmar.length, 2); // salto de precio y datos raros
  assert.match(p.confirmar.join(" "), /más de un 25 %/);
  assert.equal(p.resumen.rechazados, 2);
  assert.equal(p.lectura.columnas.price, "Precio venta"); // qué columna se ha tomado como precio
  assert.deepEqual(p.lectura.ejemplos[0], { codigo: "1", nombre: "AGUA", precio: 5, iva: 10, unidadesPorCaja: 6, descuento: null });
  // sin confirmar NO se aplica; el precio sigue como estaba
  assert.throws(() => a.aplicar("productos", x), (e) => e.confirmar?.length === 2 && /confirmar/.test(e.message));
  assert.equal(catalogDb.list({ activeOnly: false }).find((q) => q.id === "1").price, 0.5);
  // confirmado: se aplica, y los productos raros no entran
  a.aplicar("productos", x, { confirmo: true });
  const lista = catalogDb.list({ activeOnly: false });
  assert.equal(lista.find((q) => q.id === "1").price, 5);
  assert.equal(lista.some((q) => q.id === "3" || q.id === "4"), false);
});

test("productos: un Excel sin código de familia no cambia la categoría de los productos que ya existen", () => {
  const { a, catalogDb } = montar();
  catalogDb.upsertProducts([{ id: "1", name: "AGUA BEZOYA 1 L", price: 1, vat: 10, category: "Aguas", subcategory: "Bezoya" }]);
  const p = a.vistaPrevia("productos", prod(["1", "AGUA BEZOYA 1 L", "1,20", "RED10", "6", "No", "No"], ["2", "CERVEZA MAHOU LATA", "0,60", "ORD21", "24", "No", "No"]));
  assert.equal(p.resumen.modificados, 1); // solo cambia el precio
  assert.deepEqual(p.detalle.modificados[0].cambios.map((c) => c.campo).includes("Categoría"), false);
});

test("detecta de qué tipo es cada Excel y avisa si se sube en la tarjeta equivocada", async () => {
  const { detectarTipo } = await import("./actualizar-datos.js");
  const prod = buildWorkbook([{ name: "a", rows: [["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "MODO DE VENTA"], ["1", "AGUA", 1, "RED10", 6, 3]] }]);
  const cli = buildWorkbook([{ name: "a", rows: [["Cód. cliente", "Organización", "Razón social", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF"], ["1", "BAR UNO", "BAR UNO SL", "MEDINA", "CL UNO", "983000000", "", "12345678Z"]] }]);
  const his = buildWorkbook([{ name: "a", rows: [["Artículo", "Descripción", "Unidades", "Fecha", "Precio", "Nº Documento", "Cliente"], ["1", "AGUA", 2, 46309, 1, "202608793", "0429"]] }]);
  const art = buildWorkbook([{ name: "a", rows: [["", "   2-SOLO CAJA  3-CAJA ó UNID"], ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado", "MODO DE VENTA"], ["1", "AGUA", 1, "RED10", 6, "No", "No", 2]] }]); // como el de a3ERP: una fila de notas arriba
  assert.equal(detectarTipo(Buffer.from(prod)), "productos"); assert.equal(detectarTipo(Buffer.from(art)), "productos");
  assert.equal(detectarTipo(Buffer.from(cli)), "clientes"); assert.equal(detectarTipo(Buffer.from(his)), "historial");
  assert.equal(detectarTipo(Buffer.from("PK\u0003\u0004 fotos/a.jpg")), "fotos"); assert.equal(detectarTipo(Buffer.from("no es un excel")), null);
  // el actualizador rechaza el archivo equivocado antes de tocar nada
  const act = crearActualizador({ catalogDb: openCatalogDb(":memory:"), customersDb: { count: () => 0, list: () => [], getById: () => null, upsertCustomers: () => ({ added: 0, updated: 0 }) }, accountsDb: { ensureMany: () => 0 } });
  assert.throws(() => act.vistaPrevia("clientes", Buffer.from(prod)), /parece un Excel de productos o artículos, no de clientes\. Súbelo en la tarjeta «Productos y precios»/);
  assert.throws(() => act.vistaPrevia("productos", Buffer.from(cli)), /parece un Excel de clientes/);
});

test("un Excel nuevo enseña SOLO lo que cambia (precio, modo de venta, nuevo, bloqueado), se aplica solo eso y el mismo Excel otra vez dice que no hay cambios", () => {
  const cab = ["Cód. artículo", "Artículo", "Precio venta", "Tipo IVA ventas", "Unidades paquete venta", "Obsoleto", "Bloqueado", "MODO DE VENTA"];
  const base = Array.from({ length: 30 }, (_, i) => [String(100 + i), "ARTICULO " + i, 1 + i / 10, "ORD21", 6, "No", "No", 3]);
  const xl = (rows) => Buffer.from(buildWorkbook([{ name: "a", rows: [cab, ...rows] }]));
  const a = crearActualizador({ catalogDb: openCatalogDb(":memory:"), customersDb: {}, accountsDb: {} });
  assert.equal(a.vistaPrevia("productos", xl(base)).resumen.anadidos, 30); // primera vez: todo es nuevo
  a.aplicar("productos", xl(base), { confirmo: true });
  const igual = a.vistaPrevia("productos", xl(base));
  assert.equal(igual.aplicable, false); assert.equal(igual.resumen.iguales, 30); assert.deepEqual([igual.resumen.anadidos, igual.resumen.modificados, igual.resumen.quitados], [0, 0, 0]); // mismo Excel: sin cambios
  assert.throws(() => a.aplicar("productos", xl(base), { confirmo: true }), /No hay nada que aplicar/);
  const n = base.map((r) => [...r]);
  n[3][2] = 5.55; n[5][5] = "si"; n[5][6] = "si"; n[7][7] = 2; n.push(["999", "ARTICULO NUEVO", 2, "RED10", 12, "No", "No", 2]);
  const v = a.vistaPrevia("productos", xl(n));
  assert.deepEqual([v.resumen.anadidos, v.resumen.quitados, v.resumen.modificados, v.resumen.iguales], [1, 1, 2, 27]); // solo lo que cambia
  assert.deepEqual(v.detalle.modificados.map((m) => [m.id, m.cambios.map((c) => c.campo).join()]), [["103", "Precio"], ["107", "Modo de venta"]]);
  assert.equal(v.detalle.quitados[0].id, "105"); assert.equal(v.detalle.anadidos[0].id, "999");
  const r = a.aplicar("productos", xl(n), { confirmo: true });
  assert.deepEqual([r.anadidos, r.modificados, r.desactivados], [1, 2, 1]);
  assert.equal(a.vistaPrevia("productos", xl(n)).aplicable, false); // y otra vez igual: nada que aplicar
});
