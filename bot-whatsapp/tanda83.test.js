// Descuentos especiales y precios especiales desde los PDF de a3ERP: lector de PDF sin dependencias, intérpretes de los dos listados y las dos tarjetas
// (cada una por separado). Todo con PDF y datos ficticios generados aquí (los listados reales llevan datos de clientes: nunca a GitHub).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { leerPdf, revisarPdf } from "./pdf-texto.js";
import { parseListadoDescuentos, parseListadoPrecios, tipoDeListado } from "./listados-a3erp.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearActualizador, detectarTipo } from "./actualizar-datos.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** PDF mínimo como los de eDocEngine: una página por cada lista de «celdas» { x, y, t }; texto en WinAnsi y contenido comprimido. */
function pdf(paginas, { comprimir = true, extra = "" } = {}) {
  const objs = [], add = (c) => { objs.push(c); return objs.length; };
  const cat = add("<< /Type /Catalog /Pages 2 0 R >>"), pag = add("PLACEHOLDER");
  const f0 = add("<< /Type /Font /Subtype /TrueType /Name /F0 /BaseFont /Arial,Bold /Encoding /WinAnsiEncoding >>"), f1 = add("<< /Type /Font /Subtype /TrueType /Name /F1 /BaseFont /Arial /Encoding /WinAnsiEncoding >>");
  const hojas = [];
  for (const celdas of paginas) {
    const cont = celdas.map((c) => `BT /${c.f ?? "F1"} 10 Tf 1 0 0 1 ${c.x} ${c.y} Tm (${c.t.replace(/[\\()]/g, (m) => "\\" + m)}) Tj ET`).join("\n");
    const datos = comprimir ? zlib.deflateSync(Buffer.from(cont, "latin1")) : Buffer.from(cont, "latin1");
    const idC = add({ stream: datos, dic: `/Length ${datos.length}${comprimir ? " /Filter /FlateDecode" : ""}` });
    hojas.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F0 ${f0} 0 R /F1 ${f1} 0 R >> >> /Contents ${idC} 0 R ${extra} >>`));
  }
  objs[pag - 1] = `<< /Type /Pages /Kids [${hojas.map((h) => `${h} 0 R`).join(" ")}] /Count ${hojas.length} >>`;
  const partes = [Buffer.from("%PDF-1.4\n", "latin1")];
  objs.forEach((o, i) => {
    partes.push(Buffer.from(`${i + 1} 0 obj\n`, "latin1"));
    if (typeof o === "string") partes.push(Buffer.from(o.replace(/[^\x00-\x7f]/g, "") + "\n", "latin1"));
    else partes.push(Buffer.from(`<< ${o.dic} >>\nstream\n`, "latin1"), o.stream, Buffer.from("\nendstream\n", "latin1"));
    partes.push(Buffer.from("endobj\n", "latin1"));
  });
  partes.push(Buffer.from("trailer << /Root 1 0 R >>\n%%EOF", "latin1"));
  return Buffer.concat(partes);
}
// Texto en WinAnsi (Á = 0xC1…): se escribe en latin1 dentro de la cadena del PDF
const win = (t) => Buffer.from(t, "latin1").toString("latin1");

const CAB_D = [{ x: 35, y: 700, t: "Listado de descuentos artículo/cliente", f: "F0" }, { x: 35, y: 686, t: "Nombre artículo", f: "F0" }, { x: 194, y: 686, t: "Nombre cliente", f: "F0" }, { x: 368, y: 686, t: "Unidades", f: "F0" }, { x: 415, y: 686, t: "Fecha", f: "F0" }, { x: 477, y: 686, t: "% Dto.", f: "F0" }];
const filaD = (y, art, cli, uds, fecha, pct) => [{ x: 34, y, t: art }, { x: 194, y, t: cli }, { x: 379, y, t: uds }, { x: 415, y, t: fecha }, ...(pct === undefined ? [] : [{ x: 475, y, t: pct }])];
const CAB_P = [{ x: 35, y: 700, t: "Listado de precios especiales", f: "F0" }, { x: 35, y: 686, t: "Artículo", f: "F0" }, { x: 183, y: 686, t: "Nombre", f: "F0" }, { x: 351, y: 686, t: "Unidades", f: "F0" }, { x: 397, y: 686, t: "Fec.ini.", f: "F0" }, { x: 440, y: 686, t: "Fec.fin", f: "F0" }, { x: 512, y: 686, t: "Precio", f: "F0" }];
const filaP = (y, art, cli, uds, ini, fin, precio) => [{ x: 34, y, t: art }, { x: 183, y, t: cli }, { x: 362, y, t: uds }, { x: 397, y, t: ini }, { x: 440, y, t: fin }, { x: 509, y, t: precio }, { x: 543, y, t: "Eur" }];
const pieP = { x: 278, y: 30, t: "Página: 1" };

const montar = () => {
  const catalogDb = openCatalogDb(":memory:"), customersDb = openCustomersDb(":memory:"), accountsDb = openAccountsDb(":memory:");
  catalogDb.upsertProducts([{ id: "1", name: "AGUA 1,5 L", price: 10, vat: 10, unitsPerBox: 6 }, { id: "2", name: "LECHE ENTERA", price: 2, vat: 4, unitsPerBox: 6 }, { id: "3", name: "CAFÉ MOLIDO", price: 7.5, vat: 10, unitsPerBox: 1 }, { id: "4", name: "VASO", price: 1, vat: 21 }]);
  customersDb.upsertCustomers([{ id: "4", name: "VALCARCE SAN VICENTE", active: true, orders: [] }, { id: "8", name: "BAR GLORIA", active: true, orders: [] }, { id: "9", name: "RESTAURANTE EL ROBLE", legalName: "EL ROBLE S.L.", active: true, orders: [] }]);
  const a = crearActualizador({ catalogDb, customersDb, accountsDb, imgDir: null, registro: () => {} });
  return { a, catalogDb, customersDb };
};
const HOY = "2026-11-22";

test("LECTOR DE PDF: saca el texto con su posición (acentos, paréntesis y varias páginas), con y sin comprimir", () => {
  for (const comprimir of [true, false]) {
    const p = leerPdf(pdf([[{ x: 10, y: 700, t: win("Año (nuevo) \\ café") }, { x: 200, y: 700, t: "0,5" }], [{ x: 10, y: 700, t: "Página dos" }]], { comprimir }));
    assert.equal(p.length, 2); assert.equal(p[0].lineas[0].map((t) => t.t).join("|"), "Año (nuevo) \\ café|0,5"); assert.equal(p[1].trozos[0].t, "Página dos");
  }
});

test("LECTOR DE PDF: rechaza lo que no es un PDF, está protegido o lleva elementos activos", () => {
  assert.throws(() => revisarPdf(Buffer.from("PK\x03\x04 esto es un zip".padEnd(200, "x"))), /no es un PDF/);
  assert.throws(() => leerPdf(pdf([[{ x: 1, y: 1, t: "a" }]], { extra: "/OpenAction 5 0 R" })), /elementos activos/);
  assert.throws(() => leerPdf(pdf([[{ x: 1, y: 1, t: "a" }]], { extra: "/Encrypt 9 0 R" })), /contraseña/);
  assert.throws(() => leerPdf(pdf([[{ x: 1, y: 1, t: "a" }]], { extra: "/JavaScript (alert(1))" })), /elementos activos/);
});

test("LISTADO DE DESCUENTOS: lee código y nombre de artículo y cliente, mínimo de unidades, fecha de fin y porcentaje (con coma y vacío)", () => {
  const b = pdf([[...CAB_D, ...filaD(670, "56005,MANTEL BLANCO 1,20", "0004,VALCARCE SAN VICENTE", "0,000000", "31/12/9999", "10"), ...filaD(655, "10016,\"2025\" VERDEJO", "0033,BAR ZAMORANO", "0,000000", "31/12/9999"), ...filaD(640, "12017,PINNA", "0825,HOTEL VILLA", "0,000000", "31/03/2027", "16,7"), ...filaD(625, "2207,AGUA GAS", "0297,BODEGA", "960,000000", "31/12/9999", "18"), { x: 278, y: 30, t: "Página: 1" }]]);
  assert.equal(tipoDeListado(b), "descuentos");
  const { filas, stats } = parseListadoDescuentos(b);
  assert.equal(filas.length, 4); assert.deepEqual(stats.sinInterpretar, []);
  assert.deepEqual(filas[0], { articulo: "56005", nombreArticulo: "MANTEL BLANCO 1,20", cliente: "0004", nombreCliente: "VALCARCE SAN VICENTE", unidades: 0, hasta: null, pct: 10, pagina: 1 });
  assert.equal(filas[1].pct, null); assert.equal(filas[2].pct, 16.7); assert.equal(filas[2].hasta, "2027-03-31"); assert.equal(filas[3].unidades, 960);
  assert.throws(() => parseListadoDescuentos(pdf([[...CAB_P, ...filaP(670, "1  X", "0008 BAR", "0,000000", "01/01/1900", "31/12/9999", "1,000000")]])), /no es el «Listado de descuentos/);
});

test("LISTADO DE PRECIOS: lee artículo, cliente, fechas de inicio y fin, mínimo y precio con 6 decimales", () => {
  const b = pdf([[...CAB_P, ...filaP(670, "55253  VASO CHIQUITO PLAST. ", "0008 BAR GLORIA", "0,000000", "01/01/1900", "31/12/9999", "2,160000"), ...filaP(655, "11747  MOCAY BARISTA", "0511 BAR FIGON", "0,000000", "01/01/2026", "31/01/2026", "22,583000"), pieP]]);
  assert.equal(tipoDeListado(b), "precios");
  const { filas, stats } = parseListadoPrecios(b);
  assert.deepEqual(stats.sinInterpretar, []);
  assert.deepEqual(filas[0], { articulo: "55253", nombreArticulo: "VASO CHIQUITO PLAST.", cliente: "0008", nombreCliente: "BAR GLORIA", unidades: 0, desde: null, hasta: null, precio: 2.16, pagina: 1 });
  assert.deepEqual([filas[1].desde, filas[1].hasta, filas[1].precio], ["2026-01-01", "2026-01-31", 22.583]);
});

test("DESCUENTOS ESPECIALES: vista previa por tipo, solo lo vigente, sin mínimo, sin regalos; aplicar guarda solo lo suyo y repetirlo no cambia nada", () => {
  const { a, customersDb } = montar();
  const b = pdf([[...CAB_D,
    ...filaD(670, "1,AGUA 1,5 L", "0004,VALCARCE SAN VICENTE", "0,000000", "31/12/9999", "10"),
    ...filaD(655, "2,LECHE ENTERA", "0008,BAR GLORIA", "0,000000", "31/12/9999", "15,5"),
    ...filaD(640, "3,CAFE", "0008,BAR GLORIA", "0,000000", "31/12/9999"),           // sin porcentaje
    ...filaD(625, "4,VASO", "0008,BAR GLORIA", "0,000000", "31/12/9999", "100"),    // regalo
    ...filaD(610, "1,AGUA 1,5 L", "0009,RESTAURANTE EL ROBLE", "960,000000", "31/12/9999", "18"), // mínimo
    ...filaD(595, "2,LECHE ENTERA", "0009,RESTAURANTE EL ROBLE", "0,000000", "31/10/2026", "12"), // caducado
    ...filaD(580, "1,AGUA 1,5 L", "0999,CLIENTE QUE NO EXISTE", "0,000000", "31/12/9999", "7"),   // cliente que no existe
    ...filaD(565, "999,ARTICULO RARO", "0004,VALCARCE SAN VICENTE", "0,000000", "31/12/9999", "7"), // artículo que no existe
    ...filaD(550, "3,CAFE", "0004,VALCARCE SAN VICENTE", "0,000000", "31/03/2027", "5"),            // vigente con fecha de fin
    pieP]]);
  assert.equal(detectarTipo(b), "descuentos");
  const v = a.vistaPrevia("descuentos", b, { hoy: HOY }), cat = Object.fromEntries(v.categorias.map((c) => [c.id, c]));
  assert.deepEqual(["nuevo", "sinPct", "regalo", "minimo", "caducado", "artSin", "cliSin"].map((k) => cat[k]?.total), [3, 1, 1, 1, 1, 1, 1]);
  assert.match(cat.nuevo.filas.map((f) => f.texto).join(" "), /válido hasta el 31\/03\/2027/);
  assert.equal(v.resumen.clientesConCambios, 2); assert.equal(customersDb.getById("4").discounts["1"], undefined, "la vista previa no escribe nada");
  const r = a.aplicar("descuentos", b, { hoy: HOY });
  assert.deepEqual(customersDb.getById("4").discounts, { 1: 10, 3: 5 }); assert.deepEqual(customersDb.getById("8").discounts, { 2: 15.5 });
  assert.deepEqual(customersDb.getById("9").discounts, {}, "el mínimo de unidades y el caducado no se guardan");
  assert.equal(r.descuentos, 3);
  const otra = a.vistaPrevia("descuentos", b, { hoy: HOY }); assert.equal(otra.aplicable, false); assert.equal(otra.resumen.yaGuardados, 3, "el mismo listado dos veces no cambia nada");
  assert.deepEqual(customersDb.getById("4").specialPrices, {}, "los descuentos nunca tocan los precios");
});

test("PRECIOS ESPECIALES: solo vigentes y sin mínimo; igual a la tarifa no se guarda; precio 0 no; muy distinto de la tarifa pide confirmar; aplicar no toca los descuentos", () => {
  const { a, customersDb } = montar();
  customersDb.setPreciosPropios(new Map([["4", { precios: {}, descuentos: { 1: 30 } }]]));
  const b = pdf([[...CAB_P,
    ...filaP(670, "1  AGUA 1,5 L", "0004 VALCARCE SAN VICENTE", "0,000000", "01/01/1900", "31/12/9999", "9,000000"),
    ...filaP(655, "2  LECHE ENTERA", "0008 BAR GLORIA", "0,000000", "01/01/1900", "31/12/9999", "2,000000"),   // = tarifa
    ...filaP(640, "3  CAFE", "0008 BAR GLORIA", "0,000000", "01/01/1900", "31/12/9999", "0,000000"),          // 0
    ...filaP(625, "4  VASO", "0008 BAR GLORIA", "0,000000", "01/01/2026", "31/01/2026", "0,500000"),          // caducado
    ...filaP(610, "4  VASO", "0009 RESTAURANTE EL ROBLE", "0,000000", "01/02/2026", "31/12/9999", "1,500000"),
    ...filaP(595, "4  VASO", "0009 RESTAURANTE EL ROBLE", "0,000000", "01/01/2023", "31/01/2026", "9,000000"), // la antigua, caducada
    ...filaP(580, "3  CAFE", "0009 RESTAURANTE EL ROBLE", "10,000000", "01/01/1900", "31/12/9999", "1,000000"), // mínimo
    ...filaP(565, "3  CAFE", "0004 VALCARCE SAN VICENTE", "0,000000", "01/01/1900", "31/12/9999", "1,000000"),  // 13 % de la tarifa
    pieP]]);
  const v = a.vistaPrevia("precios", b, { hoy: HOY }), cat = Object.fromEntries(v.categorias.map((c) => [c.id, c]));
  assert.deepEqual(["nuevo", "tarifa", "cero", "caducado", "minimo"].map((k) => cat[k].total), [3, 1, 1, 2, 1]);
  assert.ok(v.confirmar?.some((c) => /menos de la mitad o más del doble/.test(c)), "un precio muy distinto de la tarifa hay que confirmarlo");
  assert.throws(() => a.aplicar("precios", b, { hoy: HOY }), /confirmar/);
  a.aplicar("precios", b, { hoy: HOY, confirmo: true });
  assert.deepEqual(customersDb.getById("4").specialPrices, { 1: 9, 3: 1 }); assert.deepEqual(customersDb.getById("9").specialPrices, { 4: 1.5 }); assert.deepEqual(customersDb.getById("8").specialPrices, {});
  assert.deepEqual(customersDb.getById("4").discounts, { 1: 30 }, "los precios nunca tocan los descuentos");
});

test("NO SE BORRA NADA SOLO: lo guardado que ya no sale se enseña; solo se quita si se marca la casilla (y entonces pide confirmar); igual a la tarifa quita el precio especial antiguo", () => {
  const { a, customersDb } = montar();
  customersDb.setPreciosPropios(new Map([["4", { precios: { 2: 1.5, 3: 6 }, descuentos: { 1: 30, 2: 20 } }], ["8", { precios: {}, descuentos: { 3: 8 } }]]));
  const d = pdf([[...CAB_D, ...filaD(670, "1,AGUA 1,5 L", "0004,VALCARCE SAN VICENTE", "0,000000", "31/12/9999", "30"), ...filaD(655, "4,VASO", "0009,RESTAURANTE EL ROBLE", "0,000000", "31/12/9999", "5"), pieP]]);
  const sin = a.vistaPrevia("descuentos", d, { hoy: HOY }); assert.equal(sin.categorias.find((c) => c.id === "sobran").total, 2); assert.equal(sin.confirmar, undefined);
  a.aplicar("descuentos", d, { hoy: HOY }); assert.deepEqual(customersDb.getById("4").discounts, { 1: 30, 2: 20 }, "sin la casilla no se quita nada"); assert.deepEqual(customersDb.getById("8").discounts, { 3: 8 });
  const con = a.vistaPrevia("descuentos", d, { hoy: HOY, quitarSobrantes: true }); assert.ok(con.confirmar?.some((c) => /QUITAR 2 descuentos/.test(c)));
  assert.throws(() => a.aplicar("descuentos", d, { hoy: HOY, quitarSobrantes: true }), /confirmar/);
  a.aplicar("descuentos", d, { hoy: HOY, quitarSobrantes: true, confirmo: true });
  assert.deepEqual(customersDb.getById("4").discounts, { 1: 30 }); assert.deepEqual(customersDb.getById("8").discounts, {}); assert.deepEqual(customersDb.getById("4").specialPrices, { 2: 1.5, 3: 6 }, "los descuentos nunca tocan los precios");
  const p = pdf([[...CAB_P, ...filaP(670, "2  LECHE ENTERA", "0004 VALCARCE SAN VICENTE", "0,000000", "01/01/1900", "31/12/9999", "2,000000"), pieP]]);
  const vp = a.vistaPrevia("precios", p, { hoy: HOY }); assert.equal(vp.resumen.seQuitanPorSerTarifa, 1);
  a.aplicar("precios", p, { hoy: HOY }); assert.deepEqual(customersDb.getById("4").specialPrices, { 3: 6 }, "al ser igual que la tarifa deja de ser especial; el otro no sale en el listado y se queda");
});

test("TARJETA EQUIVOCADA: un PDF de descuentos en la de precios (o un Excel en la de PDF) avisa en vez de aplicar", () => {
  const { a } = montar();
  const d = pdf([[...CAB_D, ...filaD(670, "1,AGUA", "0004,VALCARCE", "0,000000", "31/12/9999", "10"), pieP]]);
  assert.throws(() => a.vistaPrevia("precios", d, { hoy: HOY }), /parece un PDF de descuentos especiales de clientes, no un PDF de precios especiales de clientes\. Súbelo en la tarjeta «Descuentos especiales»/);
  assert.throws(() => a.vistaPrevia("productos", d, { hoy: HOY }), /Descuentos especiales/);
  assert.throws(() => a.vistaPrevia("descuentos", Buffer.from("PK\x03\x04" + "x".repeat(200)), {}), /./);
});

test("PANEL: dos tarjetas separadas (PDF), casilla de quitar sobrantes, rutas y actividad; la de consumo y las demás siguen", () => {
  const h = leer("./empresa.html"), a = leer("./admin.js"), act = leer("./actividad.js");
  for (const t of ['{ p: "de", tipo: "descuentos"', '{ p: "pe", tipo: "precios"', 'acepta: ".pdf"', "Quitar lo guardado que ya no sale", "dxOpciones", "quitarSobrantes", 'r.tipoListado === "descuentos"', 'r.tipoListado === "precios"', 'p: "co", tipo: "consumo"']) assert.ok(h.includes(t), t);
  assert.ok(a.includes("(productos|clientes|historial|consumo|fotos|descuentos|precios)") && a.includes('quitarSobrantes: url.searchParams.get("quitarSobrantes") === "1"'));
  assert.ok(act.includes("descuentos especiales de clientes") && act.includes("precios especiales de clientes"));
});

test("CONSUMO SOLO COMPRAS: apunta las compras y NO guarda precios ni descuentos (de eso se encargan los PDF)", async () => {
  const { buildWorkbook } = await import("./xlsx.js");
  const { a, customersDb } = montar();
  const CAB = ["Artículo", "Descripción ", "Unidades", "", "Precio", "Fecha", "Desc.1", "Nº Documento", "Base", "Nombre", "Cód Almacén", "Cliente", "Desc. Almacén", "Coste", "Obt. precio coste"];
  const fila = (art, uds, precio, desc, fecha, doc, cli) => [`   ${art}`, "X", String(uds), "", String(precio), String(fecha), String(desc), doc, "0", "VALCARCE SAN VICENTE", "1", `   ${cli}`, "Almacén", "1", ""];
  const xl = Buffer.from(buildWorkbook([{ name: "H", widths: [], rows: [CAB, fila(1, 2, 9, 10, 46335, "D1", "4"), fila(2, 1, 1.5, 0, 46335, "D1", "4")] }]));
  const v = a.vistaPrevia("consumo", xl, { soloCompras: true });
  assert.equal(v.resumen.descuentosNuevos, 0); assert.equal(v.resumen.preciosPropiosNuevos, 0); assert.equal(v.resumen.pedidosNuevos, 1);
  assert.match(JSON.stringify(v.categorias), /solo compras/);
  a.aplicar("consumo", xl, { soloCompras: true });
  const c = customersDb.getById("4"); assert.deepEqual(c.discounts, {}); assert.deepEqual(c.specialPrices, {}); assert.equal(c.orders.length, 1);
  const h = leer("./empresa.html"); assert.ok(h.includes('id="${t.p}-sc" checked') && h.includes("Solo compras (sin precios ni descuentos)") && h.includes("&soloCompras=1"));
});
