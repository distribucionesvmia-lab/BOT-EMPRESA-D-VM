// Tanda 16 y Bench 1: instalar la app, estáticos, textos de configuración, títulos…
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { limpiaTextoEnv, condicionesPedido, BUSINESS } from "./config.js";
import { privacidadHtml } from "./privacidad.js";
import { responder } from "./asistente.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cli = leer("./cliente.html"), ped = leer("./pedido.html");

test("Bench 1.1: textos de configuración con la codificación mal («Valent??n», «ValentÃ­n») se reparan o se descartan; el aviso de privacidad sale con tildes", () => {
  assert.equal(limpiaTextoEnv("Valent??n Mart??n"), ""); assert.equal(limpiaTextoEnv("Valent�n"), ""); assert.equal(limpiaTextoEnv("ValentÃ­n"), "Valentín");
  assert.equal(limpiaTextoEnv("  Distribuciones Valentín Martín "), "Distribuciones Valentín Martín"); assert.equal(limpiaTextoEnv("¿Quieres algo?"), "¿Quieres algo?"); assert.equal(limpiaTextoEnv(undefined), "");
  const t = privacidadHtml({ titular: undefined }); assert.match(t, /Distribuciones Valentín Martín/); assert.equal((t.match(/\?\?/g) ?? []).length, 0);
  const sinEscapes = cli.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""); assert.equal((sinEscapes.match(/\?\?/g) ?? []).length, 0);
});
test("T16 5-8: manifest con id y capturas, iconos separados, favicon y un solo formato de título", () => {
  const m = JSON.parse(leer("./pwa/manifest.webmanifest")); assert.equal(m.id, "/cliente"); assert.equal(m.icons.length, 4);
  for (const i of m.icons) assert.ok(["any", "maskable"].includes(i.purpose));
  for (const f of ["icono-maskable-192.png", "icono-maskable-512.png", "captura-estrecha.png", "captura-ancha.png"]) assert.ok(fs.existsSync(new URL("./pwa/" + f, import.meta.url)), f);
  for (const h of [cli, ped]) { assert.match(h, /<link rel="icon" href="\/favicon\.ico"/); assert.match(h, /<link rel="apple-touch-icon"/); assert.match(h, /<title>[^<]+ · Distribuciones Valentín Martín<\/title>/); }
  assert.match(ped, /document\.title = titulo \+ " · Distribuciones Valentín Martín"/); assert.doesNotMatch(ped, /document\.title = "Pedido a "/);
});
test("T16 4: «Instalar la app» en el menú ⋯ y en Inicio, con el aviso del navegador o instrucciones (también iPhone)", () => {
  assert.match(cli, /id="instalar-menu">Instalar la app</); assert.match(cli, /"Instala la app en tu móvil"/); assert.match(cli, /async function abrirInstalar\(\)/);
  assert.match(cli, /instalacion\.prompt\(\)/); assert.match(cli, /Añadir a pantalla de inicio/); assert.match(cli, /Compartir/); assert.match(cli, /if \(!yaInstalada\(\)\)/);
});
test("T16 9: «¿cuál es el horario de reparto?» responde con los días de reparto (y HORARIO_REPARTO si está configurado)", () => {
  const ctx = { catalogo: [], cliente: {}, ahora: "2026-11-09T08:30:00Z" };
  for (const t of ["¿Cuál es el horario de reparto?", "horario de entrega", "¿qué días repartís?"]) assert.match(responder(t, ctx).reply, /Repartimos de lunes a viernes/, t);
  assert.match(responder("horario de reparto", { ...ctx, horarioReparto: "Lunes a viernes, de 8:00 a 14:00" }).reply, /Horario de reparto: Lunes a viernes, de 8:00 a 14:00/);
});
test("Bench 1.9: texto de precios sin contradicción", () => {
  assert.equal(BUSINESS.priceNote, "Precios sin IVA; abajo tienes el total con IVA. Los confirmamos al preparar el pedido.");
  assert.match(ped, /\$\("priceNote"\)\.textContent = data\.priceNote \|\| ""/); assert.equal(condicionesPedido().minimo >= 0, true);
});

import vm from "node:vm";
const trozo = (ini, fin) => { const a = ped.indexOf(ini), b = ped.indexOf(fin, a); assert.ok(a >= 0 && b > a, ini); return ped.slice(a, b); };
const motor = [ped.match(/const norm = [^\n]*\n/)[0], ped.match(/const dist = [^\n]*\n/)[0], trozo("const PALABRAS_VACIAS_B", "// ── Búsqueda: filtros por marca")].join("");
const buscador = (productos, tree) => { const ctx = vm.createContext({ data: { products: productos, tree } }); vm.runInContext(motor + "\nthis.buscar = buscarOrden;", ctx); return (q) => { const m = ctx.buscar(q); return m ? [...m.keys()] : []; }; };
test("Bench 1.3-1.6: relevancia, categorías, nombres pegados, sin ruido de códigos ni trozos, «Tipo:» y precio de solo cajas", () => {
  const P = (id, name, cat, sub, count = 0) => ({ id, name, cat, sub, count });
  const productos = [P("1", "JARRA LECHE 1 L", "hos", "menaje"), P("2", "LECHE ENTERA PASCUAL 1 L", "lac", "leche"), P("3", "LECHE PASCUAL SIN LACTOSA 1 L", "lac", "sl"), P("4", "COCA-COLA LATA 33 CL", "beb", "ref"),
    P("5", "COLA CAO ORIGINAL 383 G", "des", "cacao"), P("6", "SAL FINA 1 KG", "ali", "sal"), P("7", "SALFUMANT 1 L", "lim", "lej", 5), P("1330", "VASO 25 CL", "hos", "menaje"), P("8", "LECHE DESNATADA 1 L", "lac", "sl")];
  const tree = [{ id: "hos", nombre: "Hostelería", subs: [{ id: "menaje", nombre: "Menaje" }] }, { id: "lac", nombre: "Lácteos", subs: [{ id: "leche", nombre: "Leche" }, { id: "sl", nombre: "Leche sin lactosa" }] }, { id: "beb", nombre: "Bebidas", subs: [{ id: "ref", nombre: "Refrescos" }] },
    { id: "des", nombre: "Desayuno", subs: [{ id: "cacao", nombre: "Cacao" }] }, { id: "ali", nombre: "Alimentación", subs: [{ id: "sal", nombre: "Sal" }] }, { id: "lim", nombre: "Limpieza", subs: [{ id: "lej", nombre: "Lejías" }] }];
  const q = buscador(productos, tree);
  const l = q("leche"); assert.ok(l.indexOf("2") < l.indexOf("1") && l.indexOf("3") < l.indexOf("1"), "las leches antes que la jarra: " + l);
  assert.equal(q("leche sin lactosa")[0], "3"); assert.ok(q("refresco").includes("4")); assert.deepEqual(q("cocacola"), ["4"]); assert.deepEqual(q("colacao"), ["5"]); assert.deepEqual(q("pascual").sort(), ["2", "3"]);
  assert.ok(!q("33").includes("1330")); assert.ok(q("33").includes("4")); assert.deepEqual(buscador([P("3300", "VASO 25 CL", "hos", "menaje")], tree)("33"), ["3300"]); // «33»: lo que lleva «33» en el nombre; un código solo si EMPIEZA por 33, nunca si lo lleva en medio
  const s = q("sal"); assert.equal(s[0], "6"); // «sal»: la palabra «SAL» antes que «SALFUMANT»
  assert.match(ped, /grupo\("Tipo:", cuenta\(marcaDe\)/); assert.doesNotMatch(ped, /grupo\("Marca:"/);
  assert.match(ped, /p\.soloCaja && p\.unitsPerBox \? `Solo cajas de \$\{p\.unitsPerBox\}/);
});

test("Bench 1.8, 1.10 y T16 3: orderKey nuevo tras cada envío, carrito 7 días por código de cliente y sincronizado entre pestañas", () => {
  assert.match(ped, /let orderKey = nuevaClave\(\)/); assert.match(ped, /modificando = null; \$\("modBanner"\)\.hidden = true; orderKey = nuevaClave\(\);/);
  assert.match(ped, /const HORAS = 168;/); assert.match(ped, /"c_" \+ \(data\.customer\.codigo \|\| data\.customer\.name\)/); assert.match(ped, /vm_carrito_c_" \+ data\.customer\.name; if \(data\.customer\.codigo/); // y migra el guardado con la clave antigua
  assert.match(ped, /addEventListener\("storage", \(e\) => \{ try \{ if \(e\.key === clave\(\)\) releerCarrito\(\)/); assert.match(ped, /document\.addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) releerCarrito\(\); \}\)/);
  assert.match(ped, /function guardar\(\) \{ if \(sinGuardar\) return;/); // al aplicar lo de otra pestaña no se vuelve a escribir (sin bucles)
  const s = leer("./server.js"); assert.equal((s.match(/codigoCliente/g) ?? []).length, 0);
});

import { pdfPedido, datosPdf, lineaPdf } from "./pdf.js";
test("T16 1-2 y Bench 1.13-1.14: el PDF enseña formato, unidades por caja, precio ud., descuento e importe, y los datos fiscales de la empresa", () => {
  const l = lineaPdf({ name: "ROSCA VERDEJO", unit: "caja", boxes: 1, units: 6, qty: 1, price: 5, discount: 25.07, amount: 22.48 });
  assert.deepEqual(l, { cant: "1 caja", formato: "Caja de 6 · 6 uds", nombre: "ROSCA VERDEJO", precio: 5, dto: 25.07, importe: 22.48 });
  assert.deepEqual(lineaPdf({ name: "AGUA", unit: "ud", qty: 6, units: 6, price: 0.4, amount: 2.4 }), { cant: "6 uds", formato: "Unidades", nombre: "AGUA", precio: 0.4, dto: 0, importe: 2.4 });
  const o = { ref: "VM-2026-000004", created_at: "2026-11-13T10:00:00Z", delivery_date: "2026-11-16", address: "Calle Mayor 1", note: "", re: 0, items: [{ product_id: "1", name: "ROSCA VERDEJO", unit: "caja", boxes: 1, units: 6, qty: 1, price: 5, discount: 25.07, vat: 10, amount: 22.48 }] };
  const buf = pdfPedido(datosPdf(o, { empresa: "Distribuciones Valentín Martín", datosEmpresa: ["CIF B12345674 · Calle Ejemplo 1, Medina del Campo", "Tel. 983 000 000 · info@vm.es"], cliente: "BAR UNO", telefonoCliente: "600000001" }));
  const t = buf.toString("latin1");
  for (const x of ["Formato", "Dto.", "Precio ud.", "Importe", "Caja de 6", "25,07 %", "CIF B12345674", "Tel. 983 000 000", "600000001", "22,48"]) assert.ok(t.includes(x), x);
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-"); assert.match(buf.subarray(-6).toString(), /%%EOF/);
  const s = leer("./server.js"); assert.match(s, /function datosPdfComunes\(\)/); assert.match(s, /cant: cajas \? `\$\{cajas\} \$\{cajas === 1 \? "caja" : "cajas"\} \(\$\{l\.qty\} uds\)`/);
  assert.match(cli, /\$\{l\.cant \|\| l\.uds\} \$\{l\.nombre\}/); // Mi cuenta usa el mismo formato
});

test("Bench 1.11, 1.12, 1.15, 1.16: recordatorio del fijo bien explicado, sin mezclar el carrito, formularios sin fallos en silencio y guía de la portada", () => {
  assert.match(cli, /los días que elijas te lo recordamos al abrir la aplicación/); assert.match(ped, /Elige los días en que quieres que te lo recordemos/); assert.match(ped, /aria-label="Días en que te lo recordamos"/);
  // «Revisar y enviar» y «Cambiar» del fijo abren con #c=…&r=1 (nunca &a=1): con un pedido empezado sale la pregunta sustituir/añadir
  const fijoLinks = [...cli.matchAll(/"#c=" \+ (?:j\.fijo|f)\.lineas\.map[^;]*?\+ "(&r=1[^"]*)"/g)].map((m) => m[1]); assert.ok(fijoLinks.length >= 2); for (const l of fijoLinks) assert.doesNotMatch(l, /a=1/);
  assert.match(cli, /async function enviando\(form, boton, fn, errId\)/); assert.match(cli, /if \(form\.dataset\.enviando\) return;/); assert.match(cli, /catch \{ \$\(errId\)\.textContent = SIN_RED; \}/);
  assert.match(cli, /return enviando\(\$\("f-acceso"\)/); assert.match(cli, /return enviando\(\$\("f-registro"\)/);
  assert.match(cli, /<b>Entra<\/b> con los 6 primeros dígitos de tu DNI o CIF, o con tu <b>teléfono y tu código de entrada<\/b>/); assert.match(cli, /«Ver solo lo que he marcado»/); assert.doesNotMatch(cli, /«Solo con cantidad»/);
});
