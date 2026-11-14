// Estadísticas y patrones del panel de la empresa: exclusión de pruebas, reinicio del recuento, cálculos, latido «en directo» y la página.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sinTildes, EXCLUIDOS_DEFECTO, excluidosValidos, leerExcluidos, resolverExcluidos, esDePrueba, prepararPedidos, rangoDe, calcular, atrasados, patronesCliente } from "./estadisticas.js";
import { openAccountsDb } from "./cuentas-db.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const NOW = "2026-11-16T09:00:00.000Z"; // lunes 16 de noviembre de 2026, 10:00 en Madrid

const linea = (id, nombre, uds, precio, vat = 10, unit = "ud", cajas = null) => ({ id, name: nombre, price: precio, qty: uds, unit, boxes: cajas, units: uds, discount: 0, vat_rate: vat, amount: Math.round(uds * precio * 100) / 100 });
let n = 0;
const pedido = (cliente, nombre, iso, items) => ({ id: ++n, ref: "VM-T-" + n, customer_id: cliente, phone: "600" + cliente, name: nombre, re: false, created_at: iso, items });
const cfg = { nombres: ["PABLO MARTÍN CASTAÑEDA", "ENRIQUE MARTÍN GALLEGO"], codigos: ["T0999"], nifs: [] };
const dir = { findByNif: () => [], search: () => ({ rows: [] }) };

test("exclusión: por nombre sin mayúsculas ni tildes, por código y por NIF; nunca cuentan", () => {
  assert.equal(sinTildes("  PABLO   Martín CASTAÑEDA "), "pablo martin castaneda");
  const ex = resolverExcluidos({ ...cfg, nifs: ["818181"] }, { findByNif: (x) => (x === "818181" ? ["T0818"] : []), search: ({ q }) => ({ rows: q === "pablo" ? [{ id: "T0555", name: "PABLO MARTIN CASTAÑEDA" }] : [] }) });
  const filas = [
    pedido("T1", "pablo martin castañeda", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]), pedido("T2", "ENRIQUE MARTIN GALLEGO (prueba)", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]),
    pedido("T0818", "Cualquier nombre", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]), pedido("T0999", "X", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]), pedido("T0555", "Otro nombre", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]),
    pedido("T3", "Bar Pablo Martín", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]), pedido("T4", "Cafetería Real", "2026-11-14T08:00:00Z", [linea("a", "A", 1, 1)]),
  ];
  const { validos, excluidos } = prepararPedidos(filas, ex);
  assert.deepEqual(validos.map((o) => o.customer_id), ["T3", "T4"]); assert.equal(excluidos.length, 5); // «Bar Pablo Martín» no es de prueba
  assert.equal(esDePrueba({ customer_id: null, name: "Pablo Martín Castañeda" }, ex), true);
  const r = rangoDe({ rango: "todo" }, NOW, null), c = calcular(validos, excluidos, r); assert.equal(c.resumen.actual.pedidos, 2); assert.equal(c.excluidos, 5);
});
test("lista de excluidos: por defecto, ajuste guardado y validación", () => {
  assert.deepEqual(EXCLUIDOS_DEFECTO.nombres, ["PABLO MARTÍN CASTAÑEDA", "ENRIQUE MARTÍN GALLEGO"]); assert.deepEqual(EXCLUIDOS_DEFECTO.nifs, ["818181"]);
  const dir_ = fs.mkdtempSync(path.join(os.tmpdir(), "vm-est-")), a = openAccountsDb(path.join(dir_, "c.sqlite"));
  try {
    assert.deepEqual(leerExcluidos(a, {}).nombres, EXCLUIDOS_DEFECTO.nombres); assert.deepEqual(leerExcluidos(a, { STATS_EXCLUIR: "Juan Prueba Uno; ab" }).nombres, [...EXCLUIDOS_DEFECTO.nombres, "Juan Prueba Uno"]);
    const v = excluidosValidos({ nombres: ["Ana Prueba Dos", "Ana Prueba Dos"], codigos: ["T1"], nifs: ["123456789", "12"] }); assert.deepEqual(v.excluidos, { nombres: ["Ana Prueba Dos"], codigos: ["T1"], nifs: ["123456"] });
    assert.ok(excluidosValidos({ nombres: ["ab"] }).error); assert.ok(excluidosValidos(null).error);
    a.ajusteGuardar("stats_excluidos", JSON.stringify(v.excluidos)); assert.deepEqual(leerExcluidos(a, {}).nombres, ["Ana Prueba Dos"]);
  } finally { a.close?.(); fs.rmSync(dir_, { recursive: true, force: true }); }
});
test("rangos: hoy, 7 y 30 días, mes, todo, personalizado, comparación y reinicio del recuento", () => {
  const h = rangoDe({ rango: "hoy" }, NOW, null); assert.equal(h.desde, "2026-11-15T23:00:00.000Z"); assert.equal(h.hasta, "2026-11-16T23:00:00.000Z"); assert.equal(h.previo.desde, "2026-11-14T23:00:00.000Z");
  assert.equal(rangoDe({ rango: "7d" }, NOW, null).desde, "2026-11-09T23:00:00.000Z"); assert.equal(rangoDe({ rango: "30d" }, NOW, null).desde, "2026-10-17T22:00:00.000Z"); // cambio de hora de octubre
  assert.equal(rangoDe({ rango: "mes" }, NOW, null).desde, "2026-10-31T23:00:00.000Z"); assert.equal(rangoDe({ rango: "todo" }, NOW, null).previo, null);
  const c = rangoDe({ rango: "custom", desde: "2026-11-01", hasta: "2026-11-10" }, NOW, null); assert.equal(c.previo.desde, "2026-10-21T22:00:00.000Z"); assert.equal(c.etiqueta, "01/11/2026 – 10/11/2026");
  for (const m of [{ rango: "x" }, { rango: "custom", desde: "no", hasta: "2026-01-01" }, { rango: "custom", desde: "2026-02-01", hasta: "2026-01-01" }, { rango: "custom", desde: "2000-01-01", hasta: "2026-01-01" }]) assert.ok(rangoDe(m, NOW, null).error, JSON.stringify(m));
  const rec = "2026-11-16T08:00:00.000Z", r = rangoDe({ rango: "30d" }, NOW, rec); assert.equal(r.desde, rec); assert.equal(r.previo, null); // tras reiniciar: cuenta desde ahí y no se compara con un periodo que empezó antes
  assert.equal(rangoDe({ rango: "todo" }, NOW, rec).desde, rec);
});
test("cálculos: cifras, variación, ranking, categorías, horas y mapa de calor", () => {
  const ex = { nombres: new Set(), ids: new Set() };
  const filas = [
    pedido("C1", "Bar Uno", "2026-11-16T07:30:00Z", [linea("1", "COCA COLA LATA 33", 24, 0.6, 10, "caja", 1), linea("2", "LEJIA 5 L", 2, 2.1, 21)]), // lunes 08:30 Madrid
    pedido("C2", "Bar Dos", "2026-11-16T08:10:00Z", [linea("1", "COCA COLA LATA 33", 48, 0.6, 10, "caja", 2)]),                                      // lunes 09:10
    pedido("C1", "Bar Uno", "2026-11-09T07:30:00Z", [linea("2", "LEJIA 5 L", 1, 2.1, 21)]),                                                           // lunes anterior
  ];
  const { validos, excluidos } = prepararPedidos(filas, ex), r = rangoDe({ rango: "7d" }, NOW, null), c = calcular(validos, excluidos, r);
  assert.equal(c.resumen.actual.pedidos, 2); assert.equal(c.resumen.actual.clientes, 2); assert.equal(c.resumen.actual.articulos, 24 + 2 + 48);
  assert.equal(c.resumen.actual.importe, Math.round((14.4 * 1.1 + 4.2 * 1.21 + 28.8 * 1.1) * 100) / 100); // con IVA por tipo
  assert.equal(c.resumen.actual.ticket, Math.round((c.resumen.actual.importe / 2) * 100) / 100);
  assert.equal(c.comparacion, true); assert.equal(c.resumen.anterior.pedidos, 1); assert.equal(c.resumen.variacion.pedidos, 100); // sube un 100 %
  assert.equal(c.ranking.porUnidades[0].id, "1"); assert.equal(c.ranking.porUnidades[0].unidades, 72); assert.equal(c.ranking.porUnidades[0].cajas, 3); assert.equal(c.ranking.porUnidades[0].pedidos, 2);
  assert.equal(c.ranking.porImporte[0].id, "1"); assert.ok(c.categorias.length >= 1); assert.equal(c.categorias.reduce((a, x) => a + x.unidades, 0), 74);
  assert.equal(c.horas[8], 1); assert.equal(c.horas[9], 1); assert.equal(c.horaPico, 8); assert.equal(c.calor[0][8], 1); assert.equal(c.calor[0][9], 1); assert.equal(c.calor.flat().reduce((a, b) => a + b, 0), 2); // lunes = fila 0
});
test("clientes que se retrasan y patrones de un cliente", () => {
  const ex = { nombres: new Set(), ids: new Set() }, f = [];
  for (const d of ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]) f.push(pedido("C1", "Bar Uno", d + "T07:00:00Z", [linea("1", "COCA COLA", 24, 0.6), linea("2", "LEJIA", 1, 2)])); // cada lunes, pero hace 3 semanas que no pide
  for (const d of ["2026-11-02", "2026-11-09", "2026-11-16"]) f.push(pedido("C2", "Bar Dos", d + "T07:00:00Z", [linea("1", "COCA COLA", 12, 0.6)])); // al día
  f.push(pedido("C3", "Bar Tres", "2026-10-01T07:00:00Z", [linea("1", "COCA COLA", 1, 0.6)])); // un solo pedido: no se puede saber su ritmo
  const { validos } = prepararPedidos(f, ex), atr = atrasados(validos, NOW);
  assert.deepEqual(atr.map((x) => x.id), ["C1"]); assert.equal(atr[0].ciclo, 7); assert.equal(atr[0].dias, 21);
  const p = patronesCliente(validos.filter((o) => o.customer_id === "C1"), NOW);
  assert.equal(p.pedidos, 4); assert.equal(p.cada.mediana, 7); assert.equal(p.dias[0].dia, "lunes"); assert.equal(p.dias[0].pct, 100); assert.deepEqual([p.hora.habitual, p.hora.desde, p.hora.hasta], [9, 8, 9]); // las 07:00 UTC son las 09:00 en horario de verano y las 08:00 tras el cambio de hora de octubre; assert.equal(p.diasDesdeUltimo, 21); assert.ok(p.sinPedirDeMas);
  assert.equal(p.frecuentes[0].veces, 4);
  // lo que dejó de pedir: aparece ≥ 2 veces y no está en sus 3 últimos pedidos
  const g = [pedido("C9", "Bar Nueve", "2026-11-01T07:00:00Z", [linea("x", "ESPECIAL", 1, 1)]), pedido("C9", "Bar Nueve", "2026-11-03T07:00:00Z", [linea("x", "ESPECIAL", 1, 1)]), pedido("C9", "Bar Nueve", "2026-11-05T07:00:00Z", [linea("y", "OTRO", 1, 1)]), pedido("C9", "Bar Nueve", "2026-11-08T07:00:00Z", [linea("y", "OTRO", 1, 1)]), pedido("C9", "Bar Nueve", "2026-11-10T07:00:00Z", [linea("y", "OTRO", 1, 1)])];
  const q = patronesCliente(prepararPedidos(g, ex).validos, NOW); assert.deepEqual(q.dejados.map((x) => x.id), ["x"]);
  assert.equal(patronesCliente([], NOW).pedidos, 0); assert.ok(patronesCliente(prepararPedidos(g.slice(0, 2), ex).validos, NOW).avisoPocoHistorial);
});
test("latido: solo código, pantalla y líneas; a los 2 minutos sin latido se da por desconectado; se borra con la cuenta", () => {
  const dir_ = fs.mkdtempSync(path.join(os.tmpdir(), "vm-lat-")), a = openAccountsDb(path.join(dir_, "c.sqlite"));
  try {
    a.presenciaLatido("C1", { pantalla: "catalogo", lineas: 3, now: "2026-11-16T10:00:00.000Z" }); a.presenciaLatido("C2", { pantalla: "rarita", lineas: -5, now: "2026-11-16T10:01:00.000Z" }); a.presenciaLatido("C1", { pantalla: "resumen", lineas: 4, now: "2026-11-16T10:01:30.000Z" });
    const v = a.presenciaAhora({ now: "2026-11-16T10:02:00.000Z" }); assert.deepEqual(v.map((x) => [x.customer_id, x.pantalla, x.lineas]).sort(), [["C1", "resumen", 4], ["C2", "catalogo", 0]]); // un latido nuevo sustituye al anterior; lo raro se corrige
    assert.deepEqual(Object.keys(v[0]).sort(), ["at", "customer_id", "lineas", "pantalla"]); // nada más
    assert.equal(a.presenciaAhora({ now: "2026-11-16T10:03:35.000Z" }).length, 0); // más de 2 minutos: desconectados
  } finally { a.close?.(); fs.rmSync(dir_, { recursive: true, force: true }); }
});
test("página: pestaña con icono, filtros, tarjetas, gráficos propios, animaciones con «reducir movimiento», reinicio claro y latido ligero", () => {
  const e = leer("./empresa.html"), p = leer("./pedido.html"), sv = leer("./server.js"), ad = leer("./admin.js");
  assert.match(e, /data-t="estadisticas"[^>]*>Estadísticas y patrones/); assert.match(e, /#app > \.tabs \.tab\[data-t="estadisticas"\] \{ --ico:/);
  for (const t of ["Hoy", "7 días", "30 días", "Este mes", "Todo", "Personalizado", "Importe total con IVA", "Ticket medio", "Clientes distintos", "Artículos vendidos", "Ahora mismo, en directo", "Lo que más se compra", "Por categoría y subcategoría", "A qué hora se hacen más pedidos", "Mapa de calor", "Patrones de compra por cliente", "Llevan más tiempo de lo normal sin pedir", "Reiniciar estadísticas", "Deshacer reinicio", "Pedidos de prueba que no cuentan", "Las estadísticas empezarán a contar desde ahora.", "Los pedidos NO se borran."]) assert.ok(e.includes(t), t);
  assert.match(e, /Se excluyen \$\{nf\.format\(d\.excluidos\)\} pedido/); assert.match(e, /Contando desde el/); assert.match(e, /Aún no hay pedidos desde el/);
  assert.match(e, /prefers-reduced-motion: reduce\) \{ \.late::after/); assert.match(e, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/); assert.match(e, /function contarHasta/); assert.match(e, /createElementNS/); assert.match(e, /\.est-sk/); assert.match(e, /animation:late/);
  assert.doesNotMatch(e, /<script[^>]+src=|<link[^>]+href=|chart\.js|d3\./i); // gráficos hechos en la propia página, sin librerías ni servicios
  assert.match(e, /--accent:#C8102E/); assert.doesNotMatch(e.slice(e.indexOf("/* ═════════ Estadísticas y patrones")), /#0f7a4d|#37c382/); // rojo de marca, no verde
  // latido del catálogo: ligero, cada 45 s, solo con la pantalla a la vista y sin precios ni datos personales
  assert.match(p, /\/api\/latido/); assert.match(p, /setInterval\(latido, 45000\)/); assert.match(p, /document\.hidden/); assert.match(p, /pantalla: \$\("resumen"\)\.hidden \? "catalogo" : "resumen", lineas: lines\(\)\.length/);
  assert.match(sv, /p === "\/api\/latido"/); assert.match(sv, /presenciaLatido\(cid/); assert.match(ad, /accounts\.presenciaAhora\(\)/);
  assert.match(ad, /\/api\/admin\/estadisticas\/reiniciar/); assert.doesNotMatch(ad.slice(ad.indexOf("estadisticas/reiniciar"), ad.indexOf("estadisticas/deshacer")), /DELETE|deleteOrders/); // reiniciar nunca borra pedidos
});
