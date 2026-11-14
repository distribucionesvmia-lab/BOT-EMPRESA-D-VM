// Auditoría de los cálculos de dinero: importes de línea, IVA y recargo de equivalencia, comparados con una referencia EXACTA (enteros, BigInt)
// y con el cálculo que hace la página del cliente (pedido.html). Si algo cambia en un céntimo, estas pruebas fallan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { priceLine, priceOrder, totals, importeCentimos, round2, RE_RATE } from "./pricing.js";

let semilla = 20261110;
const azar = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
// referencia: precio en diezmilésimas, descuento en centésimas, todo entero; la mitad de un céntimo sube
const ref = (unidades, precio, dto) => {
  const num = BigInt(unidades) * BigInt(Math.round(precio * 1e4)) * (10000n - BigInt(Math.round(dto * 100))) * 100n, den = 10n ** 8n;
  return Number((num * 2n + den) / (2n * den));
};
const refPct = (cent, pct100) => Number((BigInt(cent) * BigInt(pct100) * 2n + 10000n) / 20000n); // cent × (pct/100) con pct en centésimas de %

test("importe de línea: 100.000 casos al azar coinciden con el cálculo exacto (ni un céntimo de diferencia)", () => {
  for (let i = 0; i < 100000; i++) {
    const u = 1 + Math.floor(azar() * 500), p = Math.floor(azar() * 500000) / 10000, d = Math.floor(azar() * 3000) / 100;
    const got = Math.round(priceLine({ qty: u, unit: "ud" }, { price: p, discount: d, vat: 21 }, null).amount * 100);
    assert.equal(got, ref(u, p, d), `${u} × ${p} − ${d} %`);
  }
});

test("importe de línea: casos que con números decimales normales fallaban (mitad de céntimo)", () => {
  assert.equal(priceLine({ qty: 300, unit: "ud" }, { price: 2.286, discount: 12.5 }).amount, 600.08); // 600,075 exactos
  assert.equal(priceLine({ qty: 85, unit: "ud" }, { price: 32.751 }).amount, 2783.84); // 2783,835
  assert.equal(importeCentimos(1, 1.005, 0), 101);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  // los precios de a3ERP vienen con ruido de coma flotante («4,9950000000000001»): se leen como 4,995
  assert.equal(priceLine({ qty: 3, unit: "ud" }, { price: 4.9950000000000001, discount: 10 }).amount, 13.49);
});

test("cajas: unidades = cajas × unidades por caja, y el precio es por unidad", () => {
  const l = priceLine({ qty: 2, unit: "caja" }, { price: 0.49, unitsPerBox: 24, discount: 0, vat: 10 });
  assert.deepEqual([l.units, l.boxes, l.amount], [48, 2, 23.52]);
  assert.equal(priceLine({ qty: 5, unit: "ud" }, { price: 0.49, unitsPerBox: 24 }).amount, 2.45);
  assert.equal(priceLine({ qty: 1, unit: "caja" }, { price: 1, unitsPerBox: null }).unsureBox, true); // caja sin dato de unidades: se marca para revisar
});

test("precio y descuento especiales del cliente mandan sobre los de la ficha", () => {
  const c = { specialPrices: { 7: 0.8 }, discounts: { 7: 5 } };
  assert.equal(priceLine({ id: 7, qty: 10, unit: "ud" }, { price: 1, discount: 20 }, c).amount, 7.6); // 10 × 0,80 − 5 %
  assert.equal(priceLine({ id: 8, qty: 10, unit: "ud" }, { price: 1, discount: 20 }, c).amount, 8); // sin especial: ficha
});

test("totales: IVA y recargo de equivalencia sobre la MISMA base (nunca uno sobre el otro), por tipo de IVA", () => {
  for (let i = 0; i < 20000; i++) {
    const lineas = Array.from({ length: 1 + Math.floor(azar() * 6) }, () => ({ amount: Math.floor(azar() * 100000) / 100, vat: [4, 10, 21][Math.floor(azar() * 3)] }));
    const re = azar() < 0.5, t = totals(lineas, re);
    let base = 0, iva = 0, rec = 0;
    for (const v of [4, 10, 21]) {
      const b = lineas.filter((l) => l.vat === v).reduce((s, l) => s + Math.round(l.amount * 100), 0);
      base += b; iva += refPct(b, v * 100); rec += re ? refPct(b, Math.round(RE_RATE[v] * 100)) : 0;
    }
    assert.deepEqual([Math.round(t.base * 100), Math.round(t.iva * 100), Math.round(t.re * 100), Math.round(t.total * 100)], [base, iva, rec, base + iva + rec]);
  }
  // el ejemplo de la gestoría: 10 € al 21 % con R.E. → 10 + 2,10 + 0,52
  assert.deepEqual(totals([{ amount: 10, vat: 21 }], true).total, 12.62);
});

test("priceOrder: la base del pedido es la suma exacta de sus líneas", () => {
  const cat = [{ id: 1, name: "A", price: 2.286, vat: 10 }, { id: 2, name: "B", price: 32.751, vat: 21 }];
  const o = priceOrder({ items: [{ id: 1, qty: 300, unit: "ud" }, { id: 2, qty: 85, unit: "ud" }] }, { discounts: { 1: 12.5 } }, cat);
  assert.deepEqual(o.items.map((i) => i.amount), [600.08, 2783.84]);
  assert.equal(o.total, 3383.92);
});

test("la página del cliente (pedido.html) calcula EXACTAMENTE lo mismo que el servidor", () => {
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  const trozo = html.slice(html.indexOf("// Importes EXACTOS"), html.indexOf("const total = () => calc().total;") + "const total = () => calc().total;".length);
  assert.ok(trozo.includes("importeCent") && trozo.includes("function calc"), "no se encuentra el cálculo en pedido.html");
  for (let n = 0; n < 3000; n++) {
    const re = azar() < 0.5;
    const productos = Array.from({ length: 1 + Math.floor(azar() * 5) }, (_, i) => ({
      id: String(i + 1), price: Math.floor(azar() * 300000) / 10000, discount: Math.floor(azar() * 2500) / 100, vat: [4, 10, 21][Math.floor(azar() * 3)],
      unitsPerBox: azar() < 0.5 ? 2 + Math.floor(azar() * 30) : null, qty: 1 + Math.floor(azar() * 60), cajas: azar() < 0.5,
    }));
    const unitOf = new Map(productos.map((p) => [p.id, p.cajas && p.unitsPerBox ? "caja" : "ud"]));
    const ctx = vm.createContext({ BigInt, Number, Math, Map, data: { customer: { re } }, unit: (id) => unitOf.get(id) || "ud", lines: () => productos.map((p) => ({ ...p })) });
    vm.runInContext("const uds = l => l.qty * (unit(l.id) === 'caja' ? (l.unitsPerBox || 1) : 1);\n" + trozo + "\nglobalThis.salida = calc();", ctx);
    const servidor = priceOrder({ items: productos.map((p) => ({ id: p.id, qty: p.qty, unit: unitOf.get(p.id) })) }, { recargoEquivalencia: re, discounts: Object.fromEntries(productos.map((p) => [p.id, p.discount])), specialPrices: Object.fromEntries(productos.map((p) => [p.id, p.price])) },
      productos.map((p) => ({ id: p.id, name: "x", price: p.price, vat: p.vat, unitsPerBox: p.unitsPerBox })));
    const t = totals(servidor.items, re);
    assert.deepEqual([ctx.salida.base, ctx.salida.iva, ctx.salida.re, ctx.salida.total], [t.base, t.iva, t.re, t.total], `caso ${n}`);
  }
});

test("PEDIDO WEB: los artículos que se venden en cajas se piden por cajas por defecto y sin animar el −/+", async () => {
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(html, /const unit = id => productoPorId\.get\(id\)\?\.soloCaja \? "caja" : unitOf\.get\(id\) \|\| \(productoPorId\.get\(id\)\?\.unitsPerBox \? "caja" : "ud"\)/);
  assert.match(html, /\[\["caja", "Cajas"\], \["ud", "Uds"\]\]/); // Cajas primero
  assert.match(html, /\.ctl \.bump, \.hstep\.bump, \.step\.bump \{ animation:none !important; \}/);
});

test("MÓVIL: «Mostrar más» no se sale del ancho y el código y la contraseña de entrada admiten solo letras y números, máximo 6", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /m\.style\.width = "calc\(100% - 28px\)"/);
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  for (const id of ["a-nif", "a-pin", "r-pin", "r-pin2", "c-nuevo", "c-nuevo2"]) assert.match(cli, new RegExp(`id="${id}"[^>]*maxlength="6"`), id);
  assert.match(cli, /replace\(\/\[\^A-Za-z0-9\]\/g, ""\)\.slice\(0, 6\)/);
});

test("MÓVIL con letra grande (Samsung): ninguna caja de altura fija corta los textos y las categorías caben en 2 columnas", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /header \{ max-height:280px; flex-wrap:wrap/);
  assert.match(ped, /\.paso \{ max-height:160px; \}/);
  assert.match(ped, /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(ped, /\.ud button \{ flex:1 1 auto; white-space:nowrap/);
});

test("PRECIOS DE ARTÍCULO: se enseñan siempre con 3 decimales (catálogo web, chat y Excel); los importes y totales, con 2", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /const eurp = n => Number\(n\)\.toFixed\(3\)/);
  assert.match(ped, /price\.textContent = eurp\(p\.price\)/);
  assert.match(ped, /pr\.textContent = eurp\(l\.price\) \+ " \/ ud"/);
  assert.match(ped, /const eur = n => n\.toFixed\(2\)/); // los totales siguen con 2
  const { handleMessage, newSession } = await import("./bot.js");
  const bar = { id: "C1", name: "Bar", address: "x", orders: [] };
  const r = handleMessage(newSession(bar), "productos");
  assert.match(r.reply, /— \d+,\d{3} €/);
  const { workbookFiles } = await import("./xlsx-files.js");
  assert.match(workbookFiles([{ name: "H", rows: [[1]] }])["xl/styles.xml"], /formatCode="#,##0\.000"/); // la columna «Precio» del Excel lleva 3 decimales
});

test("MÓVIL: el tamaño de letra del sistema (Samsung) se compensa: ningún font-size en px sin dividir entre --k", async () => {
  const fs = await import("node:fs");
  for (const f of ["pedido.html", "cliente.html", "demo-web/page.html"]) {
    const html = fs.readFileSync(new URL("./" + f, import.meta.url), "utf8");
    assert.match(html, /function medir\(\)/, f + ": falta la medición de --k");
    assert.equal((html.match(/font-size: *\d+(\.\d+)?px/g) ?? []).filter((x) => !x.endsWith("100px")).length, 0, f + ": hay tamaños de letra sin compensar"); // (100px es la sonda que mide --k)
    assert.ok((html.match(/var\(--k,1\)/g) ?? []).length > 20, f);
  }
});

test("CATÁLOGO WEB: «+ Añadir» y el contador miden igual en todas las filas, zonas de toque de 44 px o más, móvil apaisado y ordenador en filas anchas", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /className = "ud udfijo"/); // los artículos sueltos ocupan el mismo hueco que los de cajas
  assert.match(ped, /\.slot \.add, \.slot \.step \{ width:100%; height:52px; min-height:52px; \} \.slot \.step button, \.slot \.step input \{ height:auto; align-self:stretch; min-height:48px; \}/); // 52 con el borde → los botones del contador miden 48 de verdad
  assert.match(ped, /\.favb \{ width:44px; height:44px/);
  assert.match(ped, /\.tabs button\.tab \{ min-height:48px; \}/);
  assert.match(ped, /@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(ped, /@media \(min-width:900px\)[\s\S]*\.p \{ grid-template-columns:104px minmax\(0, 1fr\) 330px/); // ordenador: una fila ancha por producto (la descripción no se parte en vertical)
  assert.doesNotMatch(ped, /" → " \+ qty\.get\(p\.id\) \* p\.unitsPerBox/); // el texto de la tarjeta no cambia al añadir (no se mueve lo de debajo)
});

test("CATÁLOGO WEB: sin «Última vez», carrito y «solo lo marcado» en tabla, foto ampliable también en el carrito, zoom nítido", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.doesNotMatch(ped, /Última vez/); // se quitó el botón «↻ Última vez: N uds» de cada producto
  assert.match(ped, /function tablaLineas\(ls\)/);
  assert.match(ped, /box\.appendChild\(tablaLineas\(ls\)\)/); // el carrito es una tabla…
  assert.match(ped, /list\.appendChild\(tablaLineas\(items\.map/); // …y «Ver solo lo que he marcado» también
  assert.match(ped, /av\.onclick = \(\) => verFoto\(l\)/); // tocar la foto en el carrito (o en la tabla) la amplía
  for (const col of ["Artículo", "Cantidad", "Importe"]) assert.ok(ped.includes(`"${col}"`), col);
  assert.match(ped, /im\.naturalWidth \* 1\.6/); // la foto ampliada no se estira más de 1,6 veces su tamaño real
});

test("CATÁLOGO WEB: controles del carrito a 48 px, sin barra fija con el carrito vacío, precio de la caja en la fila y un solo «Hacer pedido» en el chat", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /\.tl \.ud \{ min-width:112px; height:48px; \} \.tl \.ud button \{ min-height:48px; \}/);
  assert.match(ped, /\.tl \.hstep button \{ width:48px; height:100%;/);
  assert.match(ped, /<footer hidden>/); // «Añade productos para empezar» solo existe cuando hay algo en el carrito
  assert.match(ped, /document\.querySelector\("footer"\)\.hidden = !n/);
  assert.match(ped, /"Caja de " \+ p\.unitsPerBox \+ " uds · " \+ eur\(precioCaja\(p\)\)/); // el precio de la caja, calculado como el importe de línea
  assert.match(ped, /\.app\.compacto \.buscar \{ max-height:0;/); // en apaisado se pliega también el buscador al bajar
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /data-q="hacer pedido"/); // el atajo de abajo se quitó…
  assert.match(cli, /fila\("Pedido nuevo", "Elige del catálogo", "Hacer pedido"/); // …y queda el de la tarjeta de inicio
});

test("LETRA: nivel elegido 100/115/130 % con A− / A+ y «Automático» (tope +30 %), el mismo en el chat y el catálogo; controles táctiles de 48 px", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  for (const [n, html] of [["pedido", ped], ["cliente", cli]]) {
    assert.match(html, /NIVELES = \[1, 1\.15, 1\.3\], TOPE = 1\.3/, n); // nunca más de +30 %
    assert.match(html, /nivel \|\| Math\.min\(TOPE, ksist\)/, n); // automático: respeta la letra del móvil hasta el tope
    assert.match(html, /localStorage\.setItem\("vm:letra"/, n);
    assert.match(html, /\{ vmLetra: v \}/, n); // la página y el catálogo se pasan el nivel sin recargar
  }
  assert.match(ped, /window\.vmLetra\.control\(\$\("letraBox"\), "boton"\)/); // en la cabecera: un solo botón «Aa» que abre el panelito
  assert.match(ped, /\.letra \.letra-bt \{[^}]*min-height:48px/); assert.match(ped, /\.letra-pop button \{[^}]*min-height:52px/);
  assert.match(cli, /window\.vmLetra\.control\(\$\("menu-letra"\)\)/);
  assert.match(ped, /\.letra button \{ min-width:48px; min-height:48px;/);
  assert.match(ped, /\.tl \.hstep \{[^}]*height:52px/); // −, cantidad y + del carrito: 48 reales dentro del borde
  assert.match(ped, /\.screen \.head button \{ width:48px; height:48px; \}/); // también en apaisado
  assert.match(ped, /\.cartfoot \.keepbtn \{ flex:1 1 100%; min-height:48px;/);
});

test("«¿Te falta algo?» antes de enviar, aviso de entrega hoy renovable y medidas de uso sin datos personales", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  const srv = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
  assert.match(ped, /function pintarFalta\(box\)/);
  assert.match(ped, /data\.products\.filter\(p => p\.count > 0 && !qty\.has\(p\.id\)\)[^;]*\.slice\(0, 4\)/); // solo habituales que todavía no lleva, hasta 4
  assert.match(srv, /\/catalogo\/aviso/); // rutas ligeras para volver a comprobar la hora…
  assert.match(srv, /\(\\\/datos\|\\\/aviso\)\?\$/); // …en la sesión y en el enlace del pedido
  assert.match(ped, /refrescarEntrega/);
  assert.match(ped, /Ya no llegamos a entregarlo hoy: elige otro día\./);
  assert.match(ped, /\/api\/uso/);
});

test("«¿Te falta algo?» con foto del artículo y entrega: dirección de siempre u otra distinta (obligatoria sin dirección guardada)", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /className = "falta-av"/); assert.match(ped, /\.falta-fila \.falta-av \{ flex:none; width:56px; height:56px/);
  assert.match(ped, /name="addrmode" value="otra"/); assert.match(ped, /deliveryAddress: dirEntrega\(\)/);
  assert.match(ped, /const sinDireccion = \(\) => !String\(data\.customer\.address/);
  assert.match(ped, /\$\("confirm"\)\.onclick = \(\) => \{\s*\$\("err"\)\.textContent = ""; if \(!direccionOk/); // sin dirección válida no se pasa a elegir el día
});

test("ACTUALIZACIÓN AUTOMÁTICA: cada 10 minutos, con pruebas, comprobación de arranque, vuelta atrás y botón «Actualizar ahora»", async () => {
  const fs = await import("node:fs");
  const bat = fs.readFileSync(new URL("./deploy/windows/actualizar-auto.bat", import.meta.url), "utf8");
  assert.match(bat, /node --test/); assert.match(bat, /localhost:3000\/health/); assert.match(bat, /localhost:3001\/health/);
  assert.match(bat, /git reset --hard %ANTES%/); assert.match(bat, /actualizar\.mala/); // no reintenta una versión que ya falló
  assert.doesNotMatch(bat, /\(sin internet\?\)/); // un paréntesis dentro de un bloque rompería el .bat
  const tareas = fs.readFileSync(new URL("./deploy/windows/instalar-tareas.bat", import.meta.url), "utf8");
  assert.match(tareas, /\/TN "VM Actualizar".*\/SC MINUTE \/MO 10/);
  const emp = fs.readFileSync(new URL("./empresa.html", import.meta.url), "utf8");
  assert.match(emp, /id="act-ahora"/); assert.match(emp, /\/api\/admin\/actualizar"/);
});

test("PAQUETE «COMPRAR MÁS FÁCIL» A+B: lo que ya compra arriba, «Lo más pedido», atajos, deshacer con pausa y ayuda con datos de la empresa", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  // F-21
  assert.match(ped, /className = "lo-compras"/); assert.match(ped, /else if \(arbol\) items = \[\.\.\.items\.filter\(p => p\.count > 0\)/);
  assert.match(ped, /Lo más pedido/); assert.match(ped, /data\.top/);
  // F-22
  assert.doesNotMatch(ped, /atajos/); assert.match(ped, /inp\.pattern = "\[0-9\]\*"/); // sin botones «+1 caja / +6 cajas»
  // F-23
  assert.match(ped, /"Quitado: " \+/); assert.match(ped, /deshacer \? 8000 : 4000/); assert.match(ped, /t\.onpointerenter = t\.onfocusin/); assert.match(ped, /#toast\.arriba \{ bottom:auto/);
  assert.match(ped, /id="vaciar"/); assert.match(ped, /aria-label", "Quitar " \+ l\.name/);
  // F-24
  assert.match(ped, /function abrirAyuda\(a, nombre\)/); assert.match(cli, /function abrirAyuda\(a, nombre\)/);
  assert.match(ped, /if \(data\.ayuda\) \{ \$\("ayudaBtn"\)\.hidden = false/); assert.match(cli, /fetch\("\/api\/ayuda"\)/);
});

test("AYUDA: sin datos rellenados no hay botón; con teléfono o WhatsApp se ofrecen solo esos y el horario", async () => {
  const { ayudaPublica, AYUDA } = await import("./config.js");
  assert.equal(ayudaPublica(), null, "la empresa aún no ha rellenado teléfono ni WhatsApp: el botón no aparece");
  Object.assign(AYUDA, { telefono: "983 123 456", whatsapp: "600 111 222", horario: "L-V 8:00-14:00" });
  const a = ayudaPublica();
  assert.equal(a.telHref, "tel:+34983123456"); assert.equal(a.whatsappHref, "https://wa.me/34600111222"); assert.equal(a.horario, "L-V 8:00-14:00");
  Object.assign(AYUDA, { telefono: "", whatsapp: "600111222", horario: "" });
  const b = ayudaPublica(); assert.equal(b.telHref, undefined); assert.equal(b.whatsappHref, "https://wa.me/34600111222"); // solo lo rellenado
  Object.assign(AYUDA, { telefono: "", whatsapp: "", horario: "solo horario" });
  assert.equal(ayudaPublica(), null); // un horario sin teléfono ni WhatsApp no sirve de nada
});

test("DIRECCIÓN DE ENTREGA: lo oculto se oculta de verdad y solo se obliga a escribirla si el cliente no tiene dirección guardada", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /\[hidden\] \{ display:none !important; \}/); // sin esto, .addropc { display:flex } pisaba el atributo hidden
  assert.match(ped, /const modoDir = \(\) => \(sinDireccion\(\) \? "otra" : document\.querySelector/); // con dirección guardada manda lo que elija (de siempre = puede seguir)
  assert.match(ped, /if \(modoDir\(\) === "otra" && dirEntrega\(\)\.length < 5\)/); // solo se exige texto si es «otra» o no hay dirección
});

test("CABECERA DEL CATÁLOGO: compacta (logo, nombre, «Aa» y carrito en una fila) y en vertical no se pliega al bajar, para que el logo no se mueva", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /\.app\.compacto \.paso \{ max-height:0;/); // al bajar solo se pliega el rótulo «Paso 1 de 3»
  assert.doesNotMatch(ped, /\.app\.compacto header, \.app\.compacto \.paso, \.app\.compacto \.tabs \{/); // la cabecera ya no se pliega en vertical
  assert.match(ped, /\.app\.compacto header, \.app\.compacto \.tabs, \.app\.compacto \.buscar \{ max-height:0;/); // solo en apaisado se pliega todo
  assert.match(ped, /header img \{ height:34px; \}/); assert.match(ped, /\.letra \.letra-bt small \{ display:none; \}/);
});

test("BIENVENIDA: el saludo va dentro de la tarjeta de inicio (un solo mensaje alineado, con los 3 pasos) y no se pierde la tarjeta", async () => {
  const fs = await import("node:fs");
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  assert.match(cli, /if \(j\.ui\?\.home\) window\.__saludo = String\(j\.reply\)\.split\("\\n\\n"\)\[0\]; else burbuja\([^;]*"in"\); \(j\.cards \?\? \[\]\)\.forEach\(tarjetaTabla\); if \(j\.ui\) interactivo\(j\.ui\);/); // un comentario en esa línea se comía la tarjeta
  assert.match(cli, /className = "pasos"/); assert.match(cli, /fila\.className = "mrow in"; const av = document\.createElement\("div"\); av\.className = "av"/);
});

test("ALTAS A MANO Y CLIENTE NUEVO: formularios en el panel (producto, cliente y «crear su ficha» al aceptar una solicitud) y dirección en el alta del cliente", async () => {
  const fs = await import("node:fs");
  const emp = fs.readFileSync(new URL("./empresa.html", import.meta.url), "utf8"), cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  assert.match(emp, /id="alta-prod"/); assert.match(emp, /id="alta-cli"/);
  assert.match(emp, /\/api\/admin\/productos\/nuevo/); assert.match(emp, /\/api\/admin\/clientes\/nuevo/);
  assert.match(emp, /Es cliente nuevo: crear su ficha/); assert.match(emp, /\{ nuevo: form\.valores\(\) \}/);
  assert.match(emp, /Modo de venta \(2 = solo caja, 3 = caja o unidad\)/);
  assert.match(cli, /id="r-dir"/); assert.match(cli, /direccion: \$\("r-dir"\)\.value/);
});

test("TOTALES EN EL CATÁLOGO: el carrito y la barra de abajo van SIN IVA; el total con IVA sale arriba del paso de elegir el día", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /\$\{eur\(calc\(\)\.base\)\} sin IVA/); // barra «Ver carrito»
  assert.match(ped, /<span>Total sin IVA<small id="totSub">/); assert.match(ped, /tween\(\$\("total"\), calc\(\)\.base\)/); // paso 2
  assert.match(ped, /id="whenTotal"/); assert.match(ped, /\$\("whenTotal"\)\.textContent = eur\(total\(\)\)/); // paso 3: con IVA
  assert.match(ped, /\$\("resTotal"\)\.textContent = eur\(total\(\)\)/); // y el resumen final también
});

test("CÓDIGOS CON PUNTO (157.10, 151.21…): «repetir pedido» separa bien el código de la cantidad", async () => {
  const fs = await import("node:fs");
  const ped = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(ped, /par\.lastIndexOf\("\."\)/); assert.doesNotMatch(ped, /par\.split\("\."\)/);
});

test("TU PEDIDO DE SIEMPRE en el móvil: el texto a todo el ancho y los botones debajo, sin una columna estrecha", async () => {
  const fs = await import("node:fs");
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  assert.match(cli, /\.vm-inicio \.fila\.siempre \{ flex-direction:column; align-items:stretch;/);
  assert.match(cli, /f\.append\(t, bt, sem\); c\.appendChild\(f\);/); assert.match(cli, /sem\.className = "sec"/);
});

test("MI CUENTA (app del cliente): botón arriba, datos del cliente y pedidos por meses con «Repetir» y «Añadir al carrito»", () => {
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  const cat = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.match(cli, /<button type="button" id="micuenta" class="ds-circ cuenta"[^>]*>[\s\S]*?<span>Mi cuenta<\/span><\/button>/); // botón visible en la cabecera, sin emojis
  assert.match(cli, /\/api\/mi-cuenta/);
  for (const t of ["Mis datos", "Dirección", "Repetir pedido", "Añadir al carrito", "Modificar pedido", "Algo no es correcto"]) assert.ok(cli.includes(t), t);
  assert.match(cli, /"&r=1&x=1"/); // repetir: empieza un carrito nuevo con ese pedido
  assert.match(cli, /"&a=1"/); // añadir: suma a lo que ya hay
  assert.match(cli, /toLocaleDateString\("es-ES", \{ month: "long", year: "numeric" \}\)/); // agrupados por meses
  assert.match(cat, /sumar = \/\[#&\]a=1/); assert.match(cat, /deCero = \/\[#&\]x=1/);
  assert.doesNotMatch(cli, /id="m-pedidos"/); // la ventana antigua se sustituyó por «Mi cuenta»
});

test("AVISOS AL MÓVIL (app del cliente): botón «Activar avisos» en Mi cuenta, ayuda para iPhone y el service worker muestra los avisos", () => {
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  const sw = fs.readFileSync(new URL("./pwa/sw.js", import.meta.url), "utf8");
  for (const t of ["Activar avisos", "Desactivar avisos", "Añadir a pantalla de inicio", "/api/push/clave", "/api/push/suscribir", "/api/push/baja", "userVisibleOnly: true", "Notification.requestPermission"]) assert.ok(cli.includes(t), t);
  assert.match(cli, /\(await permiso\) !== "granted"/); // pide permiso al pulsar el botón (los móviles lo exigen), no al abrir
  assert.match(sw, /addEventListener\("push"/); assert.match(sw, /showNotification/); assert.match(sw, /addEventListener\("notificationclick"/);
  assert.doesNotMatch(sw, /caches\.(open|put)/); // sigue sin guardar nada en caché
  assert.match(sw, /startsWith\("\/"\)/); // el aviso solo puede abrir páginas de la propia aplicación
});

test("AVISOS AL MÓVIL: la primera vez que se abre la app instalada se pregunta una sola vez si quiere los avisos", () => {
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
  assert.match(cli, /id="m-avisos"[\s\S]*¿Quieres recibir avisos\?[\s\S]*ofertas[\s\S]*precios[\s\S]*Sí, activar avisos[\s\S]*Ahora no/);
  assert.match(cli, /display-mode: standalone/); // solo en el acceso directo (app instalada)
  assert.match(cli, /localStorage\.getItem\("vm:avisos-preguntado"\)/); assert.match(cli, /localStorage\.setItem\("vm:avisos-preguntado", "1"\)/); // una sola vez
  assert.match(cli, /Notification\.permission !== "default"/); // si ya decidió, no se pregunta
  assert.match(cli, /setTimeout\(preguntarAvisos, 2000\)/); // sale tras entrar, no tapa la bienvenida de golpe
  // el permiso se pide al pulsar «Sí», sin esperar nada antes
  assert.match(cli, /async function activarAvisos\(\) \{\s*\n\s*const permiso = Notification\.requestPermission\(\);/);
});

test("PANEL DE LA EMPRESA: sin pestaña «Clientes», con «Artículos» (precio, ofertas, filtros, campana) y la oferta se ve en el catálogo del cliente", () => {
  const emp = fs.readFileSync(new URL("./empresa.html", import.meta.url), "utf8");
  const cat = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");
  assert.doesNotMatch(emp, /data-t="clientes"/); assert.doesNotMatch(emp, /id="p-clientes"/);
  assert.match(emp, /data-t="cuentas"[^>]*>Cuentas de clientes/); assert.match(emp, /data-t="articulos"[^>]*>Artículos/);
  for (const t of ["ar-q", "ar-cat", "ar-filtro", "Cambiar precio", "Guardar oferta", "Quitar oferta", "% de descuento", "€ de descuento por unidad", "Hasta el día (opcional)", "className: \"campana\"", "/avisar"]) assert.ok(emp.includes(t), t);
  assert.match(emp, /<svg viewBox="0 0 24 24"[^>]*>.*Z.*<\/svg>/); // la campana es un icono, sin emojis
  assert.match(emp, /id="alta-cli"[\s\S]*id="p-datos"|id="p-datos"[\s\S]*id="alta-cli"/); // «Añadir un cliente a mano» sigue disponible (ahora en «Datos y Excel»)
  assert.match(cat, /p\.oferta[\s\S]*"OFERTA"/); // el cliente ve la etiqueta OFERTA en el artículo
});
