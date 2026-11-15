// Seguridad 2: registro de hechos sospechosos, actividad del panel, aviso al cliente, segunda carpeta de copias, límites y clave del panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openAccountsDb } from "./cuentas-db.js";
import { etiquetaAccion } from "./actividad.js";
import { claveDebil, ipDe, eventoSeguridad, registrarSeguridad, usarRegistro } from "./seguridad.js";
import { copiarASegundaCarpeta } from "./backup.js";
import { estadoSistema } from "./monitor.js";
import { unzip } from "./xlsx-read.js";
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const base = (extra = {}) => ({ pedidosPendientes: () => [], solicitudesPendientes: () => [], cuentasSinConfirmar: () => 0, sync: null, correo: { status: () => ({ configurado: true }) }, copiasDir: os.tmpdir() + "/no-existe-vm", dataDir: os.tmpdir(), catalogo: () => ({ activos: 1, sinPrecio: 0 }), ...extra });

test("cuentas-db: hechos sospechosos, actividad del panel y aparatos vistos", () => {
  const db = openAccountsDb(":memory:");
  db.seguridadRegistrar("alta-con-campo-trampa", "1.2.3.4"); db.seguridadRegistrar("alta-con-campo-trampa", "1.2.3.5"); db.seguridadRegistrar("panel-clave-incorrecta", "9.9.9.9");
  const r = db.seguridadResumen({ horas: 24 });
  assert.equal(r.total, 3); assert.deepEqual(r.porTipo.map((x) => [x.tipo, x.n]), [["alta-con-campo-trampa", 2], ["panel-clave-incorrecta", 1]]);
  assert.equal(db.seguridadResumen({ horas: 24, now: new Date(Date.now() + 3 * 86_400_000).toISOString() }).total, 0); // fuera de la ventana
  db.actividadRegistrar({ ip: "10.0.0.2", accion: "Cambió el precio de un artículo", ruta: "/api/admin/articulos/1001/precio", estado: 200 });
  const a = db.actividadLista(10); assert.equal(a.length, 1); assert.equal(a[0].accion, "Cambió el precio de un artículo"); assert.equal(a[0].estado, 200);
  // la primera vez que entra desde un aparato NO es «nuevo» (no hay otro con el que comparar); el segundo aparato sí; el mismo otra vez, no
  assert.deepEqual(db.aparatoVisto(1, "aaaa"), { nuevo: false, conocidos: 0 });
  assert.equal(db.aparatoVisto(1, "aaaa").nuevo, false);
  assert.equal(db.aparatoVisto(1, "bbbb").nuevo, true);
  assert.equal(db.aparatoVisto(1, "bbbb").nuevo, false);
  assert.equal(db.aparatoVisto(2, "bbbb").nuevo, false); // otra cuenta: su propia primera vez
});

test("actividad: solo apunta lo que cambia algo y lo dice en palabras; mirar no se apunta", () => {
  assert.equal(etiquetaAccion("GET", "/api/admin/pedidos"), null);
  assert.equal(etiquetaAccion("POST", "/api/admin/vista-previa/clientes"), null);
  assert.equal(etiquetaAccion("POST", "/api/admin/exportar/vista"), null);
  assert.equal(etiquetaAccion("POST", "/api/admin/pedidos/borrar"), "Borró pedidos");
  assert.equal(etiquetaAccion("POST", "/api/admin/articulos/1001/precio"), "Cambió el precio de un artículo");
  assert.equal(etiquetaAccion("POST", "/api/admin/invitaciones/5/anular"), "Anuló un enlace de acceso");
  assert.equal(etiquetaAccion("POST", "/api/admin/cuentas/3/pin"), "Cambió el código de entrada de una cuenta");
  assert.equal(etiquetaAccion("POST", "/api/admin/algo-nuevo"), "Acción en el panel");
});

test("clave del panel: corta o fácil = débil; larga y variada = buena; nunca se devuelve", () => {
  for (const d of ["", ]) assert.equal(claveDebil(d), false); // sin clave no es «débil» (es que no hay panel)
  for (const d of ["demo", "1234567890123456789", "aaaaaaaaaaaaaaaaaaaa", "clave-de-prueba", "password123456789012", "corta"]) assert.equal(claveDebil(d), true, d);
  assert.equal(claveDebil("k8Zq3vN7xR2mWp9TdY4hLs6B"), false);
});

test("ipDe: detrás de Cloudflare usa CF-Connecting-IP (no se puede falsear con X-Forwarded-For); sin proxy usa la conexión", () => {
  const req = (h, ra = "127.0.0.1") => ({ headers: h, socket: { remoteAddress: ra } });
  assert.equal(ipDe(req({ "cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "6.6.6.6, 8.8.8.8" }), true), "8.8.8.8");
  assert.equal(ipDe(req({ "x-forwarded-for": "6.6.6.6" }), true), "6.6.6.6");
  assert.equal(ipDe(req({ "cf-connecting-ip": "8.8.8.8" }), false), "127.0.0.1"); // sin TRUST_PROXY, un cliente no puede decir quién es
});

test("eventoSeguridad guarda en el registro como mucho una vez cada 10 s por tipo", () => {
  const vistos = []; usarRegistro((t, d) => vistos.push([t, d]));
  try { registrarSeguridad("x-prueba", "a"); registrarSeguridad("x-prueba", "b"); registrarSeguridad("y-prueba", "c"); } finally { usarRegistro(null); }
  assert.deepEqual(vistos, [["x-prueba", "a"], ["y-prueba", "c"]]);
});

test("segunda carpeta de copias: copia, conserva las 14 últimas y avisa si falta", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cp-")), o = path.join(d, "a"), d2 = path.join(d, "usb");
  fs.mkdirSync(o);
  for (let i = 1; i <= 16; i++) { const f = path.join(o, `pedidos-202611${String(i).padStart(2, "0")}-0300.sqlite`); fs.writeFileSync(f, "x"); const r = copiarASegundaCarpeta({ pedidos: f }, d2); assert.deepEqual(r.errores, {}); }
  const quedan = fs.readdirSync(d2).sort(); assert.equal(quedan.length, 14); assert.equal(quedan[0], "pedidos-20261103-0300.sqlite");
  assert.deepEqual(copiarASegundaCarpeta({ pedidos: path.join(o, "no.sqlite") }, d2).copiados, []); // origen que no existe: error apuntado, no se rompe
  assert.deepEqual(copiarASegundaCarpeta({}, ""), { copiados: [], errores: {} }); // sin segunda carpeta, no hace nada
  process.env.BACKUP_DIR2 = path.join(d, "no-hay-usb");
  try { assert.ok(estadoSistema(base()).problemas.some((p) => p.clave === "copia-segunda-carpeta")); } finally { delete process.env.BACKUP_DIR2; }
  assert.ok(!estadoSistema(base()).problemas.some((p) => p.clave === "copia-segunda-carpeta"));
});

test("estado del sistema: los avisos extra (seguridad) salen como problemas", () => {
  const e = estadoSistema(base({ extras: () => [{ clave: "intentos-sospechosos", gravedad: "media", texto: "N intentos" }] }));
  assert.ok(e.problemas.some((p) => p.clave === "intentos-sospechosos"));
  assert.doesNotThrow(() => estadoSistema(base({ extras: () => { throw new Error("falla"); } })));
});

test("unzip: una «bomba» ZIP (pequeña que se hincha) se rechaza en vez de llenar la memoria", () => {
  const raw = Buffer.alloc(130_000_000, 0), data = zlib.deflateRawSync(raw, { level: 9 }); // 130 MB de ceros que ocupan ~130 KB
  const nombre = Buffer.from("grande.txt"), local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nombre.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(0, 42);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10); fin.writeUInt32LE(46 + nombre.length, 12); fin.writeUInt32LE(30 + nombre.length + data.length, 16);
  const zip = Buffer.concat([local, nombre, data, cd, nombre, fin]);
  assert.ok(zip.length < 1_000_000);
  assert.throws(() => unzip(zip, ["grande.txt"]));
});

test("piezas del servidor: tiempos máximos, límite de pedidos en el chat, avisos al cliente y registro de actividad", () => {
  const sv = src("./server.js"), ad = src("./admin.js"), au = src("./auth.js");
  assert.match(sv, /servidorHttp\.headersTimeout = 20_000/); assert.match(sv, /servidorHttp\.requestTimeout = clientEnabled && !adminEnabled \? 60_000/);
  assert.match(sv, /\(chat\)/); assert.match(sv, /pedidosLimite\(String\(account\.id\)\)\) \{ eventoSeguridad\("demasiados-pedidos", `cuenta \$\{account\.id\} \(chat\)`\)/);
  assert.match(sv, /Nuevo acceso a tu cuenta/); assert.match(sv, /Código de entrada cambiado/); assert.match(sv, /usarRegistro\(/);
  assert.match(sv, /clave-panel-debil/); assert.match(sv, /intentos-sospechosos/);
  assert.match(ad, /etiquetaAccion\(req\.method, p\)/); assert.match(ad, /p === "\/api\/admin\/seguridad"/); assert.match(ad, /panel-clave-incorrecta/);
  assert.match(au, /onAcceso/); assert.match(au, /onCodigo/); assert.match(au, /ipDe\(req, trustProxy\)/);
  assert.match(src("./empresa.html"), /seguridadPanel/);
});
