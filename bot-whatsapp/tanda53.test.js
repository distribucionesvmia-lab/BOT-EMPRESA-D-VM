// Actualización automática desde BASE-ARTICULOS / BASE-CLIENTES / BASE-HISTORICO (auto-bases.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { crearAutoBases } from "./auto-bases.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const AHORA = Date.parse("2026-11-15T22:00:00Z"), hace = (min) => new Date(AHORA - min * 60_000).toISOString();
function montar({ archivos, preview = { aplicable: true, aviso: [], confirmar: [] }, fallaCopia = false, aplicaFalla = null, activa = true } = {}) {
  const e = { aplicados: [], archivados: [], copias: 0, actividad: [], ajustes: new Map(), previews: 0 };
  const act = {
    vistaPrevia: () => { e.previews++; return typeof preview === "function" ? preview() : preview; },
    aplicar: (tipo, buf, o) => { if (aplicaFalla) throw aplicaFalla; e.aplicados.push([tipo, buf.toString(), o.fichero, o.confirmo]); return { ok: true }; },
  };
  const auto = crearAutoBases({
    activa: () => activa, ahora: () => AHORA,
    listar: () => ({ configurada: true, archivos }),
    leer: (n) => Buffer.from(`contenido de ${n}`), archivar: (n, c) => e.archivados.push(`${c}/${n}`),
    actualizador: act, respaldar: () => { e.copias++; if (fallaCopia) throw new Error("disco lleno"); },
    leerAjuste: (k) => e.ajustes.get(k) ?? null, guardarAjuste: (k, v) => e.ajustes.set(k, v), registrar: (a) => e.actividad.push(a),
    log: { log() {}, error() {} },
  });
  return { auto, e };
}
const arch = (carpeta, tipo, nombre, min, extra = {}) => ({ carpeta, tipoCarpeta: tipo, tipo, nombre, tamano: 100, modificado: hace(min), ultimo: true, ...extra });

test("aplica solo el archivo más reciente de cada carpeta, con copia antes, lo archiva y lo apunta", async () => {
  const { auto, e } = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "clientes.xlsx", 10), arch("BASE-ARTÍCULOS", "productos", "tarifa.xlsx", 10), arch("BASE-HISTORICO PEDIDOS", "historial", "hist.xlsx", 10), { ...arch("BASE-CLIENTES", "clientes", "viejo.xlsx", 9999), ultimo: undefined }] });
  const h = await auto.revisar();
  assert.deepEqual(h.map((x) => x.tipo), ["productos", "clientes", "historial"]); // en este orden
  assert.deepEqual(e.aplicados.map((a) => a[2]), ["tarifa.xlsx", "clientes.xlsx", "hist.xlsx"]); // el viejo no
  assert.ok(e.aplicados.every((a) => a[3] === false), "nunca con «confirmo»");
  assert.equal(e.copias, 3); // copia de seguridad antes de cada aplicación
  assert.deepEqual(e.archivados.sort(), ["BASE-ARTÍCULOS/tarifa.xlsx", "BASE-CLIENTES/clientes.xlsx", "BASE-HISTORICO PEDIDOS/hist.xlsx"]);
  assert.equal(e.actividad.length, 3); assert.match(e.actividad[1], /Actualizó automáticamente clientes desde BASE-CLIENTES/);
  assert.equal(auto.estado().pendientes.length, 0);
});

test("no aplica lo que aún se está copiando (menos de 2 minutos sin cambiar) ni nada si está apagada", async () => {
  const { auto, e } = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 1)] });
  assert.deepEqual(await auto.revisar(), []); assert.equal(e.aplicados.length, 0);
  const apagada = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 30)], activa: false });
  assert.deepEqual(await apagada.auto.revisar(), []); assert.equal(apagada.e.aplicados.length, 0);
});

test("nunca aplica un archivo más viejo que lo último aplicado (al archivar el nuevo, el de debajo no se carga)", async () => {
  const { auto, e } = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "antiguo.xlsx", 5000)] });
  e.ajustes.set("auto_bases_clientes", hace(60)); // ya se aplicó uno hace una hora
  assert.deepEqual(await auto.revisar(), []); assert.equal(e.aplicados.length, 0);
});

test("si hay cosas que confirmar (precios que saltan, muchos que se quitan…) NO se aplica solo: queda esperando y avisa; no se reintenta en bucle", async () => {
  const { auto, e } = montar({ archivos: [arch("BASE-ARTICULOS", "productos", "t.xlsx", 10)], preview: { aplicable: true, aviso: [], confirmar: ["12 productos cambian de precio más de un 25 %"] } });
  assert.deepEqual(await auto.revisar(), []); assert.equal(e.aplicados.length, 0); assert.equal(e.copias, 0); assert.deepEqual(e.archivados, []);
  const p = auto.estado().pendientes; assert.equal(p.length, 1); assert.match(p[0].motivo, /confirmarlo a mano.*25 %/);
  await auto.revisar(); assert.equal(e.previews, 1, "el mismo archivo no se vuelve a probar cada minuto");
});

test("un Excel incompleto (se rechaza) o con el contenido de otro tipo no se aplica y se avisa", async () => {
  const a = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 10)], preview: { aplicable: false, aviso: ["El Excel tiene 3 clientes y hay 900: parece incompleto. No se puede aplicar."], confirmar: [] } });
  await a.auto.revisar(); assert.equal(a.e.aplicados.length, 0); assert.deepEqual(a.e.archivados, []); assert.match(a.auto.estado().pendientes[0].motivo, /parece incompleto/);
  const b = montar({ archivos: [arch("BASE-HISTORICO", "historial", "c.xlsx", 10, { tipo: null, aviso: "Está en BASE-HISTORICO pero parece de «clientes»." })] });
  await b.auto.revisar(); assert.equal(b.e.aplicados.length, 0); assert.equal(b.e.previews, 0); assert.match(b.auto.estado().pendientes[0].motivo, /parece de «clientes»/);
});

test("si no se puede hacer la copia de seguridad previa, no se aplica nada", async () => {
  const { auto, e } = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 10)], fallaCopia: true });
  assert.deepEqual(await auto.revisar(), []); assert.equal(e.aplicados.length, 0); assert.match(auto.estado().pendientes[0].motivo, /copia de seguridad.*disco lleno/);
});

test("sin cambios: se archiva sin tocar nada; y si al aplicar falla, queda esperando", async () => {
  const sc = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 10)], preview: { aplicable: false, aviso: [], confirmar: [] } });
  const h = await sc.auto.revisar(); assert.equal(h[0].sinCambios, true); assert.equal(sc.e.aplicados.length, 0); assert.equal(sc.e.copias, 0); assert.deepEqual(sc.e.archivados, ["BASE-CLIENTES/c.xlsx"]);
  const f = montar({ archivos: [arch("BASE-CLIENTES", "clientes", "c.xlsx", 10)], aplicaFalla: new Error("base bloqueada") });
  await f.auto.revisar(); assert.deepEqual(f.e.archivados, []); assert.match(f.auto.estado().pendientes[0].motivo, /No se pudo aplicar: base bloqueada/);
});

test("un archivo que cambia (otra hora) se vuelve a intentar", async () => {
  let archivos = [arch("BASE-CLIENTES", "clientes", "c.xlsx", 10)], aviso = ["parece incompleto. No se puede aplicar."];
  const { auto, e } = montar({ archivos, preview: () => ({ aplicable: !!e2.ok, aviso: e2.ok ? [] : aviso, confirmar: [] }) });
  const e2 = { ok: false };
  await auto.revisar(); assert.equal(auto.estado().pendientes.length, 1);
  e2.ok = true; archivos[0] = arch("BASE-CLIENTES", "clientes", "c.xlsx", 5); // la persona lo ha sustituido por otro
  await auto.revisar(); assert.equal(e.aplicados.length, 1); assert.equal(auto.estado().pendientes.length, 0);
});

test("piezas: server arranca el planificador y pasa la copia previa; admin enseña el estado; nombres «BASE-HISTORICO PEDIDOS» y «BASE-ARTÍCULOS»", () => {
  const sv = src("./server.js"), ad = src("./admin.js"), html = src("./empresa.html");
  assert.match(sv, /admin\.autoBases\.revisar\(\)/); assert.match(sv, /respaldar: respaldarAntesDeActualizar/); assert.match(sv, /ACTUALIZACION_AUTO !== "0"/); assert.match(sv, /clave: "actualizacion-automatica"/);
  assert.match(ad, /s\.startsWith\(pre\)/); assert.match(ad, /BASES_DIR/); assert.match(ad, /route\.autoBases = autoBases/);
  assert.match(html, /ACTUALIZACIÓN AUTOMÁTICA ACTIVADA/); assert.match(html, /No se ha aplicado solo/);
});
