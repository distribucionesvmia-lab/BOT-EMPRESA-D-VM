// Segundo factor del panel (código del móvil), confirmación extra de la clave en acciones peligrosas y freno al copiado del catálogo.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { base32, hotp, totp, verificarTotp, deBase32 } from "./totp.js";
import { crear2fa } from "./panel-2fa.js";
import { openAccountsDb } from "./cuentas-db.js";
import { crearFrenoCopia, TEXTO_FRENO } from "./freno-copia.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("TOTP: coincide con los valores oficiales del estándar (RFC 6238) y admite un paso de desfase", () => {
  const s = base32(Buffer.from("12345678901234567890"));
  for (const [t, esp] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]]) assert.equal(hotp(s, Math.floor(t / 30), 8), esp, String(t));
  const ahora = 1_700_000_000_000, c = totp(s, ahora);
  assert.equal(verificarTotp(s, c, ahora), Math.floor(ahora / 30000)); assert.notEqual(verificarTotp(s, c, ahora + 30_000), null, "un paso después sigue valiendo"); assert.equal(verificarTotp(s, c, ahora + 95_000), null, "tres pasos después ya no");
  assert.equal(verificarTotp(s, "12345", ahora), null); assert.equal(verificarTotp(s, "abcdef", ahora), null); assert.equal(deBase32(base32(Buffer.from("hola"))).toString(), "hola");
});

test("2FA del panel: secreto cifrado con ADMIN_TOKEN, cada código vale una vez, emergencia de un solo uso, 5 fallos bloquean y cambiar la clave lo vuelve ilegible", () => {
  const a = openAccountsDb(":memory:"); let reloj = 1_700_000_000_000, token = "clave-del-panel-de-prueba-123";
  const f = crear2fa(a, { token: () => token, ahora: () => reloj, bypass: () => "llave-de-claude-que-es-larga-1234" });
  assert.equal(f.activo(), false);
  const prep = f.preparar(), clave = prep.clave.replace(/\s/g, ""); assert.match(prep.url, /^otpauth:\/\/totp\//); assert.ok(prep.url.includes(clave));
  assert.equal(f.activar("000000"), null, "con un código malo no se activa"); assert.equal(f.activo(), false);
  const rec = f.activar(totp(clave, reloj)); assert.equal(rec.length, 8); assert.match(rec[0], /^[0-9A-F]{5}-[0-9A-F]{5}$/); assert.equal(f.activo(), true);
  assert.equal(a.ajuste("totp_secreto").includes(clave), false, "el secreto no está en claro en la base"); assert.equal(JSON.stringify([a.ajuste("totp_recuperacion")]).includes(rec[0]), false, "ni los códigos de emergencia");
  assert.equal(f.verificar(totp(clave, reloj)), false, "el código con el que se activó ya está gastado");
  reloj += 30_000; const c2 = totp(clave, reloj); assert.equal(f.verificar(c2), true); assert.equal(f.verificar(c2), false, "no se puede reutilizar");
  assert.equal(f.verificar(rec[0]), true); assert.equal(f.verificar(rec[0]), false, "un código de emergencia vale una vez"); assert.equal(f.recuperacionRestante(), 7);
  const t = f.abrirSesion(); assert.equal(f.permitida({ headers: { "x-vm-2fa": t } }), true); assert.equal(f.permitida({ headers: { "x-vm-2fa": "otro" } }), false); assert.equal(f.permitida({ headers: {} }), false);
  assert.equal(f.permitida({ headers: { "x-vm-2fa": "llave-de-claude-que-es-larga-1234" } }), true, "la llave de la conexión con Claude");
  reloj += 13 * 3_600_000; assert.equal(f.permitida({ headers: { "x-vm-2fa": t } }), false, "el permiso caduca a las 12 horas");
  for (let i = 0; i < 5; i++) { assert.equal(f.puedeProbar("1.1.1.1"), true); f.fallo("1.1.1.1"); } assert.equal(f.puedeProbar("1.1.1.1"), false, "5 fallos = bloqueo"); assert.equal(f.puedeProbar("2.2.2.2"), true); reloj += 16 * 60_000; assert.equal(f.puedeProbar("1.1.1.1"), true);
  token = "otra-clave-distinta-del-panel-999"; assert.equal(f.ilegible(), true, "al cambiar ADMIN_TOKEN el secreto no se puede leer"); assert.equal(f.verificar(totp(clave, reloj)), false);
  f.desactivar(); assert.equal(f.activo(), false); assert.equal(f.ilegible(), false);
});

// ── Programa de verdad (dos aplicaciones en uno, DEMO) ──
const ADMIN = "clave-de-prueba-del-panel-larga-1";
let proc, BASE; const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-2fa-")); const PUERTO = await libre(); BASE = `http://127.0.0.1:${PUERTO}`;
before(async () => {
  proc = spawn(process.execPath, ["server.js"], { cwd: path.dirname(fileURLToPath(import.meta.url)), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DEMO: "1", PORT: String(PUERTO), ADMIN_TOKEN: ADMIN, ADMIN_2FA_BYPASS: "llave-de-claude-que-es-larga-1234", VM_HOY: "2026-11-15", DB_PATH: path.join(dir, "p.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cu.sqlite"), BACKUP_DIR: path.join(dir, "b") } });
  await new Promise((ok, mal) => { const t = setTimeout(() => mal(new Error("no arrancó")), 40000); proc.stdout.on("data", (d) => { if (String(d).includes("Bot escuchando")) (clearTimeout(t), ok()); }); proc.on("exit", (c) => mal(new Error("salió " + c))); });
});
after(() => { proc?.kill(); });
const api = async (metodo, ruta, { cuerpo, clave = ADMIN, extra = {} } = {}) => { const r = await fetch(BASE + ruta, { method: metodo, headers: { ...(clave ? { Authorization: "Bearer " + clave } : {}), ...(cuerpo ? { "Content-Type": "application/json" } : {}), ...extra }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

test("2FA del panel de punta a punta: activar, sin permiso no se entra, código incorrecto y bloqueo, emergencia, llave de Claude y desactivar", async () => {
  assert.equal((await api("GET", "/api/admin/2fa/estado")).json.activo, false); assert.equal((await api("GET", "/api/admin/resumen")).status, 200, "sin 2FA todo como siempre");
  const prep = (await api("POST", "/api/admin/2fa/preparar", { cuerpo: {} })).json, clave = prep.clave.replace(/\s/g, "");
  assert.equal((await api("POST", "/api/admin/2fa/activar", { cuerpo: { codigo: "123456", confirmo: true } })).status, 400);
  assert.equal((await api("POST", "/api/admin/2fa/activar", { cuerpo: { codigo: totp(clave) } })).status, 400, "sin confirmar no");
  const act = await api("POST", "/api/admin/2fa/activar", { cuerpo: { codigo: totp(clave), confirmo: true } }); assert.equal(act.status, 200); assert.equal(act.json.emergencia.length, 8); assert.ok(act.json.token);
  // ahora, con la clave sola, no se entra a nada (salvo preguntar el estado o poner el código)
  const sin = await api("GET", "/api/admin/resumen"); assert.equal(sin.status, 401); assert.equal(sin.json.necesita2fa, true);
  assert.equal((await api("GET", "/api/admin/2fa/estado")).json.activo, true);
  assert.equal((await api("GET", "/api/admin/resumen", { extra: { "X-VM-2FA": act.json.token } })).status, 200, "con el permiso, sí");
  assert.equal((await api("GET", "/api/admin/resumen", { extra: { "X-VM-2FA": "inventado" } })).status, 401);
  assert.equal((await api("GET", "/api/admin/resumen", { clave: "mala", extra: { "X-VM-2FA": act.json.token } })).status, 403, "el permiso solo no vale sin la clave");
  assert.equal((await api("GET", "/api/admin/resumen", { extra: { "X-VM-2FA": "llave-de-claude-que-es-larga-1234" } })).status, 200, "la conexión con Claude");
  // un código de emergencia entra y se gasta
  const em = act.json.emergencia[0], e1 = await api("POST", "/api/admin/2fa/entrar", { cuerpo: { codigo: em } }); assert.equal(e1.status, 200); assert.ok(e1.json.token);
  assert.equal((await api("POST", "/api/admin/2fa/entrar", { cuerpo: { codigo: em } })).status, 401);
  // códigos incorrectos: 5 y bloqueo
  const mal = []; for (let i = 0; i < 6; i++) mal.push((await api("POST", "/api/admin/2fa/entrar", { cuerpo: { codigo: "000000" } })).status);
  assert.deepEqual(mal.slice(0, 4), [401, 401, 401, 401]); assert.ok(mal.includes(429), "tras varios fallos, bloqueo: " + mal);
  assert.equal((await api("POST", "/api/admin/2fa/entrar", { cuerpo: { codigo: totp(clave, Date.now() + 30_000) } })).status, 429, "bloqueado: ni con un código bueno");
});

test("acciones peligrosas: hay que volver a escribir la clave (borrar pedidos, restablecer una contraseña, cambiar la tarifa); una clave mala no vale y cuenta como intento", async () => {
  const permiso = { "X-VM-2FA": "llave-de-claude-que-es-larga-1234" }; // el 2FA ya está activo de la prueba anterior
  const sin = await api("POST", "/api/admin/pedidos/borrar", { cuerpo: { refs: ["VM-2026-000001"], confirmo: true }, extra: permiso }); assert.equal(sin.status, 401); assert.equal(sin.json.necesitaReconfirmar, true);
  const mala = await api("POST", "/api/admin/pedidos/borrar", { cuerpo: { refs: ["VM-2026-000001"], confirmo: true }, extra: { ...permiso, "X-VM-Reclave": "no-es-la-clave" } }); assert.equal(mala.status, 401); assert.match(mala.json.error, /no es correcta/);
  const buena = await api("POST", "/api/admin/pedidos/borrar", { cuerpo: { refs: ["VM-2026-000001"], confirmo: true }, extra: { ...permiso, "X-VM-Reclave": ADMIN } }); assert.ok([200, 400, 404].includes(buena.status) && !buena.json.necesitaReconfirmar, "con la clave pasa a la lógica de siempre (" + buena.status + ")");
  const rs = await api("POST", "/api/admin/cliente/9001/password/restablecer", { cuerpo: {}, extra: permiso }); assert.equal(rs.status, 401); assert.equal(rs.json.necesitaReconfirmar, true);
  assert.equal((await api("POST", "/api/admin/cliente/9001/password/restablecer", { cuerpo: {}, extra: { ...permiso, "X-VM-Reclave": ADMIN } })).status, 200);
  const ap = await fetch(BASE + "/api/admin/aplicar/productos?fichero=x.xlsx", { method: "POST", headers: { Authorization: "Bearer " + ADMIN, "X-VM-2FA": "llave-de-claude-que-es-larga-1234", "Content-Type": "application/octet-stream" }, body: Buffer.from("no es un excel") });
  assert.equal(ap.status, 401); assert.equal((await ap.json()).necesitaReconfirmar, true, "cambiar la tarifa pide la clave otra vez (antes de mirar el archivo)");
  const aps = await fetch(BASE + "/api/admin/vista-previa/productos?fichero=x.xlsx", { method: "POST", headers: { Authorization: "Bearer " + ADMIN, "X-VM-2FA": "llave-de-claude-que-es-larga-1234", "Content-Type": "application/octet-stream" }, body: Buffer.from("no es un excel") });
  assert.notEqual(aps.status, 401, "la vista previa no cambia nada: no pide la clave");
});

test("tras los códigos incorrectos, la dirección sigue bloqueada también para desactivar el segundo factor (la prueba de desactivar con código bueno está en el módulo)", async () => {
  const lleva = { "X-VM-2FA": "llave-de-claude-que-es-larga-1234" };
  const est = (await api("GET", "/api/admin/2fa/estado", { extra: lleva })).json; assert.equal(est.activo, true); assert.ok(est.emergencia >= 6);
  assert.equal((await api("POST", "/api/admin/2fa/desactivar", { cuerpo: { codigo: "000000" }, extra: lleva })).status, 429);
});

test("freno al copiado: 40 peticiones en 10 min sí, la 41.ª no; la tercera vez en una hora frena la cuenta; los PDF van aparte; y otra cuenta no se ve afectada", () => {
  let t = 1_700_000_000_000; const eventos = []; const f = crearFrenoCopia({ datos: 5, pdf: 3, ahora: () => t, evento: (a, b) => eventos.push([a, b]) });
  for (let i = 0; i < 5; i++) assert.equal(f("c1", "datos"), "");
  assert.equal(f("c1", "datos"), TEXTO_FRENO); assert.equal(eventos[0][0], "catalogo-a-ritmo-de-maquina"); assert.match(eventos[0][1], /cuenta c1 \(datos\)/);
  assert.equal(f("c2", "datos"), "", "otra cuenta sigue bien"); for (let i = 0; i < 3; i++) assert.equal(f("c1", "pdf"), "", "los PDF tienen su propio tope");
  t += 11 * 60_000; for (let i = 0; i < 5; i++) assert.equal(f("c1", "datos"), "", "pasados 10 minutos se libera"); assert.equal(f("c1", "datos"), TEXTO_FRENO);
  t += 11 * 60_000; for (let i = 0; i < 5; i++) f("c1", "datos"); assert.equal(f("c1", "datos"), TEXTO_FRENO); // 3.ª falta en una hora → frenada
  assert.ok(eventos.some((e) => e[0] === "catalogo-cuenta-frenada"));
  t += 11 * 60_000; assert.equal(f("c1", "datos"), TEXTO_FRENO, "frenada una hora aunque pase la ventana de 10 min"); t += 61 * 60_000; assert.equal(f("c1", "datos"), "", "pasada la hora, vuelve");
  const s = leer("./server.js"); assert.equal((s.match(/frenoCopia\(account\.id, "(datos|pdf)"\)/g) ?? []).length, 5, "inicio, catálogo, 2 PDF y el ZIP del mes");
});

test("la revisión de seguridad avisa si el panel no tiene segundo factor o ya no se puede leer", async () => {
  const { revisar } = await import("./revision-seguridad.js"); const por = (p) => revisar({ env: { ADMIN_TOKEN: "Abc9Xk2LmQ7ZpR4tVw8Y" }, panel2fa: p }).lista.find((x) => x.id === "panel-2fa");
  assert.equal(por({ activo: false }).nivel, "aviso"); assert.equal(por({ activo: true }).nivel, "ok"); assert.equal(por({ activo: true, ilegible: true }).nivel, "mal"); assert.match(por({ activo: true, ilegible: true }).arreglo, /desactivar-2fa/);
});

test("panel y documentación: pantalla del segundo factor, código en el acceso y ventana de la clave; sin manejadores en línea", () => {
  const e = leer("./empresa.html"), a = leer("./admin.js");
  for (const t of ['id="f2-panel"', 'id="codigo2fa"', "Introducir clave de configuración", "Guarda estos códigos de emergencia", "X-VM-2FA", "X-VM-Reclave", "pedirReclave", "conReclave", "necesita2fa", "desactivar-2fa.bat"]) assert.ok(e.includes(t), t);
  assert.doesNotMatch(e, /\son[a-z]+="/); assert.match(a, /exigeReclave\(req, res, who\)/); assert.equal((a.match(/exigeReclave\(req, res, who\)/g) ?? []).length, 3, "borrar pedidos, restablecer y tarifa");
  assert.match(leer("./mcp/vm-mcp.js"), /VM_ADMIN_2FA_BYPASS/);
});
