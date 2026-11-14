// Copias de seguridad comprobadas (estado, aviso y comprobación de solo lectura) y exportar estadísticas a Excel/CSV.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openCatalogDb } from "./catalogo-db.js";
import { backupAll } from "./backup.js";
import { estadoCopias, comprobarCopias, msDeSello } from "./copias.js";
import { estadoSistema } from "./monitor.js";
import { hojasEstadisticas, csvDeEstadisticas, xlsxDeEstadisticas } from "./estadisticas-export.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const montar = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cop-")), datos = path.join(dir, "datos");
  fs.mkdirSync(datos);
  const dbs = { pedidos: openDb(path.join(datos, "p.sqlite")), cuentas: openAccountsDb(path.join(datos, "c.sqlite")), clientes: openCustomersDb(path.join(datos, "cl.sqlite")), catalogo: openCatalogDb(path.join(datos, "ca.sqlite")) };
  return { dir, dbs, respaldos: path.join(dir, "respaldos"), cerrar: () => Object.values(dbs).forEach((d) => d.close()) };
};

test("COPIAS: estado de la última copia de cada base y aviso si tiene más de 26 horas o falta", () => {
  const { dbs, respaldos, cerrar } = montar();
  assert.equal(estadoCopias(respaldos).ok, false); // carpeta que aún no existe: no hay copias
  assert.equal(estadoCopias(respaldos).existe, false);
  backupAll(dbs, { dir: respaldos, now: new Date() });
  const hoy = Date.now(), e = estadoCopias(respaldos, { ahora: hoy });
  assert.equal(e.bases.length, 4); assert.ok(e.bases.every((b) => b.hay && b.cuantas === 1 && b.bytes > 0 && /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(b.fecha)));
  assert.equal(e.ok, true); // recién hecha
  const tarde = estadoCopias(respaldos, { ahora: hoy + 27 * 3600000 });
  assert.equal(tarde.ok, false); assert.equal(tarde.problemas.length, 4); assert.match(tarde.problemas[0], /horas/);
  assert.equal(estadoCopias(respaldos, { ahora: hoy + 25 * 3600000 }).ok, true);
  // si desaparece la copia de una sola base, se avisa de esa
  const f = fs.readdirSync(respaldos).find((x) => x.startsWith("cuentas-")); fs.rmSync(path.join(respaldos, f));
  const sin = estadoCopias(respaldos, { ahora: hoy }); assert.equal(sin.ok, false); assert.match(sin.problemas.join(" "), /Cuentas de clientes: no hay ninguna copia/);
  cerrar();
});

test("COPIAS: la antigüedad sale de la fecha del nombre (hora de Madrid), no de la hora del archivo", () => {
  assert.equal(new Date(msDeSello("20261110-0300")).toISOString(), "2026-11-10T02:00:00.000Z"); // invierno: UTC+1
  assert.equal(new Date(msDeSello("20260710-0300")).toISOString(), "2026-07-10T01:00:00.000Z"); // verano: UTC+2
  const { dbs, respaldos, cerrar } = montar();
  backupAll(dbs, { dir: respaldos, now: new Date(Date.now() - 40 * 3600000) }); // archivos recién escritos pero con nombre de hace 40 h
  const e = estadoCopias(respaldos); assert.equal(e.ok, false); assert.ok(e.bases.every((b) => b.horas >= 39 && b.horas <= 41 && b.vieja));
  cerrar();
});

test("COPIAS: «Comprobar» abre las copias en solo lectura, cuenta sus datos, detecta una dañada y no cambia ningún archivo", () => {
  const { dbs, respaldos, cerrar } = montar();
  backupAll(dbs, { dir: respaldos, now: new Date() });
  const huella = () => fs.readdirSync(respaldos).sort().map((f) => `${f}:${fs.statSync(path.join(respaldos, f)).size}:${fs.statSync(path.join(respaldos, f)).mtimeMs}`).join("|");
  const antes = huella(), c = comprobarCopias(respaldos);
  assert.equal(c.todasCorrectas, true); assert.equal(c.ok, true);
  assert.equal(c.bases.find((b) => b.base === "pedidos").datos.orders, 0); assert.ok(c.bases.every((b) => b.comprobada && b.correcta));
  assert.equal(huella(), antes, "comprobar no toca nada");
  const rota = fs.readdirSync(respaldos).find((x) => x.startsWith("catalogo-")); fs.writeFileSync(path.join(respaldos, rota), "esto no es una base de datos");
  const m = comprobarCopias(respaldos); assert.equal(m.todasCorrectas, false); assert.equal(m.ok, false);
  const bad = m.bases.find((b) => b.base === "catalogo"); assert.equal(bad.correcta, false); assert.ok(bad.motivo); assert.match(m.problemas.join(" "), /Catálogo y precios/);
  assert.ok(m.bases.filter((b) => b.base !== "catalogo").every((b) => b.correcta));
  cerrar();
});

test("COPIAS: el vigilante avisa también si una sola base se ha quedado sin copia o con una vieja", () => {
  const { dbs, respaldos, cerrar } = montar();
  backupAll(dbs, { dir: respaldos, now: new Date() });
  const base = { pedidosPendientes: () => [], solicitudesPendientes: () => [], cuentasSinConfirmar: () => 0, sync: null, correo: { status: () => ({ destino: ["a@b.c"], enviados: 0, ultimoError: null }) }, copiasDir: respaldos, dataDir: respaldos };
  assert.ok(!estadoSistema(base).problemas.some((p) => p.clave.startsWith("copia")));
  fs.rmSync(path.join(respaldos, fs.readdirSync(respaldos).find((x) => x.startsWith("clientes-"))));
  const p = estadoSistema(base).problemas.find((x) => x.clave === "copia-base-clientes"); assert.ok(p); assert.equal(p.gravedad, "alta"); assert.match(p.texto, /Clientes/);
  cerrar();
});

const V = { etiqueta: "Últimos 30 días", desde: "2026-10-15T00:00:00.000Z", hasta: "2026-11-14T00:00:00.000Z", excluidos: 2,
  resumen: { actual: { pedidos: 4, importe: 123.456, ticket: 30.86, clientes: 3, articulos: 20 }, anterior: { pedidos: 2, importe: 50, ticket: 25, clientes: 2, articulos: 9 }, variacion: { pedidos: 100, importe: 146.9, ticket: 23.4, clientes: 50, articulos: 122.2 } },
  ranking: { porUnidades: [{ id: "1", nombre: "AGUA 1,5 L", unidades: 12, cajas: 2, importe: 10.5, pedidos: 3 }, { id: "2", nombre: "=CMD(\"x\")", unidades: 4, cajas: 0, importe: 3, pedidos: 1 }], porImporte: [] },
  categorias: [{ nombre: "Bebidas", unidades: 16, importe: 13.5, subs: [{ nombre: "Agua", unidades: 12, importe: 10.5 }] }],
  horas: Array.from({ length: 24 }, (_, h) => (h === 9 ? 3 : 0)), calor: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 1 && h === 9 ? 3 : 0))),
  atrasados: [{ id: "9", nombre: "BAR PEPE; S.L.", ultimo: "2026-10-20", ciclo: 4, dias: 25, razon: 6.3 }] };

test("EXPORTAR: seis hojas con el resumen, artículos, categorías, horas, mapa de calor y clientes que se retrasan", () => {
  const h = hojasEstadisticas(V, { hechoEl: "14/11/2026 10:00", contandoDesde: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual(h.map((x) => x.name), ["Resumen", "Artículos", "Categorías", "Horas", "Mapa de calor", "Clientes que se retrasan"]);
  const txt = JSON.stringify(h[0].rows); assert.match(txt, /Pedidos de prueba excluidos/); assert.match(txt, /Contando desde el 01\/11\/2026/); assert.match(txt, /123\.46/);
  assert.equal(h[1].rows.length, 3); assert.equal(h[3].rows.length, 25); assert.equal(h[4].rows.length, 8);
  assert.equal(h[4].rows[2].at(-1), 3); // martes: total
  const x = xlsxDeEstadisticas(V, {}); assert.equal(x.subarray(0, 2).toString(), "PK");
  assert.ok(!x.toString("latin1").includes("Pablo Martín")); // sin marcas raras: solo los datos
});

test("EXPORTAR: el CSV va en UTF-8 con BOM, «;», decimales con coma, comillas protegidas y sin fórmulas de Excel", () => {
  const c = csvDeEstadisticas(V, {});
  assert.ok(c.startsWith("\uFEFFRESUMEN")); assert.match(c, /Importe con IVA \(€\);123,46;50;146,9/); assert.match(c, /\r\nCLIENTES QUE SE RETRASAN\r\n/);
  assert.match(c, /"BAR PEPE; S\.L\.";20\/10\/2026;4;25;6,3/); // el «;» del nombre no rompe la fila
  assert.ok(c.includes("'=CMD(\"\"x\"\")") || c.includes(`"'=CMD(""x"")"`)); // lo que empieza por «=» no se ejecuta
  assert.ok(!/(^|;)=CMD/m.test(c));
});

test("PANEL: botones de descarga y tarjeta de copias en empresa.html; rutas de solo lectura en admin.js", () => {
  const h = leer("./empresa.html"), a = leer("./admin.js");
  assert.match(h, /id="est-xlsx"/); assert.match(h, /id="est-csv"/); assert.match(h, /estadisticas\/exportar\?/);
  assert.match(h, /id="copias-panel"/); assert.match(h, /Comprobar copias ahora/); assert.match(h, /Comprobar no cambia nada/); assert.match(h, /copias\(\)\]/);
  assert.match(a, /"\/api\/admin\/copias" && get/); assert.match(a, /"\/api\/admin\/copias\/comprobar" && post/); assert.match(a, /"\/api\/admin\/estadisticas\/exportar" && get/);
  assert.ok(!/copias.*(restaurar|unlink|rmSync)/.test(leer("./copias.js").replace(/\/\/.*$/gm, "")), "copias.js no borra ni restaura");
  assert.ok(!leer("./exporter.js").includes("estadisticas-export"), "el Excel de a3ERP no se toca");
});
