// Entrar con NIF + correo + código de un solo uso enviado al correo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { correoCodigoAcceso } from "./correo-cliente.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Servidor con la lógica REAL de acceso, una base en memoria, clientes ficticios y un «correo» que apunta lo que se enviaría. */
async function montar({ conCorreo = true, tope = {} } = {}) {
  const accounts = openAccountsDb(":memory:"), correos = [];
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: ["Cliente@Ejemplo.es"] }, C2: { id: "C2", name: "LOCAL UNO", emails: ["doble@ejemplo.es"] }, C3: { id: "C3", name: "LOCAL DOS", emails: ["doble@ejemplo.es"] }, C4: { id: "C4", name: "SIN CORREO", emails: [] }, C5: { id: "C5", name: "OTRO BAR", emails: ["otro@ejemplo.es"] } };
  const porNif = { 123456: ["C1"], 654321: ["C2", "C3"], 111222: ["C4"], 777888: ["C5"] };
  const customers = { findByNif: (t) => [...new Set(nifCodes(t).flatMap((c) => porNif[c] ?? []))], getById: (id) => fichas[id] ?? null, candidates: () => [], nameMatches: () => true, getByPhone: () => null };
  Object.assign(process.env, { CODIGO_CLAVE_LIMIT: String(tope.clave ?? 3), CODIGO_IP_LIMIT: String(tope.ip ?? 50), CODIGO_GLOBAL_LIMIT: String(tope.global ?? 120), CODIGO_VERIFICAR_LIMIT: String(tope.verificar ?? 50) });
  const auth = createAuth({ accounts, customers, enviarCodigo: conCorreo ? async (c) => void correos.push(c) : null });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, cab: r.headers, json: await r.json().catch(() => ({})) }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { accounts, correos, post, get, cerrar: () => srv.close() };
}
const enviar = (m, nif = "12345678Z", correo = "cliente@ejemplo.es") => m.post("/api/acceso/correo/enviar", { nif, correo });
const entrar = (m, codigo, nif = "12345678Z", correo = "cliente@ejemplo.es") => m.post("/api/acceso/correo/entrar", { nif, correo, codigo });

test("flujo completo: NIF + correo → llega un código de 6 cifras → con él se entra y queda sesión", async () => {
  const m = await montar();
  try {
    const r = await enviar(m); assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.espera, 60);
    assert.equal(m.correos.length, 1); const { to, codigo, minutos, nombre } = m.correos[0];
    assert.equal(to, "cliente@ejemplo.es"); assert.match(codigo, /^\d{6}$/); assert.equal(minutos, 10); assert.equal(nombre, "BAR LA PLAZA S.L.");
    const e = await entrar(m, codigo); assert.equal(e.status, 200); assert.equal(e.json.cliente.nombre, "BAR LA PLAZA S.L.");
    const ck = e.cab.get("set-cookie"); assert.match(ck, /vm_session=/); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/);
    const yo = await m.get("/api/yo", { Cookie: ck.split(";")[0] }); assert.equal(yo.json.cliente?.nombre, "BAR LA PLAZA S.L.", "la sesión abierta con el código vale");
  } finally { m.cerrar(); }
});

test("el correo y el NIF no se pueden usar para averiguar qué existe: misma respuesta y ningún correo si no coinciden", async () => {
  const m = await montar({ tope: { clave: 50 } });
  try {
    const bien = await enviar(m, "12345678Z", "cliente@ejemplo.es");
    const casos = [["12345678Z", "otro@ejemplo.es"], ["99999999R", "cliente@ejemplo.es"], ["12345678Z", "cliente@ejemplo.es.mal.com"], ["111222AB", "sin@correo.es"]];
    const antes = m.correos.length;
    for (const [nif, correo] of casos) { const r = await enviar(m, nif, correo); assert.equal(r.status, 200, correo); assert.deepEqual({ ...r.json, correo: "x" }, { ...bien.json, correo: "x" }, "cuerpo idéntico: " + nif + correo); }
    assert.equal(m.correos.length, antes, "no se mandó nada a quien no coincide");
    assert.equal(antes, 1);
  } finally { m.cerrar(); }
});

test("el código solo va al correo que ya consta en la ficha (no al que escriba cualquiera) y sin importar mayúsculas", async () => {
  const m = await montar({ tope: { clave: 50 } });
  try {
    await enviar(m, "123456", "CLIENTE@EJEMPLO.ES"); assert.equal(m.correos.length, 1); assert.equal(m.correos[0].to, "cliente@ejemplo.es");
    await enviar(m, "123456", "atacante@malo.com"); assert.equal(m.correos.length, 1, "un correo ajeno no recibe nada");
    await enviar(m, "654321", "doble@ejemplo.es"); assert.equal(m.correos.length, 1, "si el NIF+correo encajan con DOS clientes no se adivina cuál: nada se manda");
  } finally { m.cerrar(); }
});

test("un código sirve una vez; uno incorrecto no entra; tras 5 fallos el código se anula aunque luego se escriba bien", async () => {
  const m = await montar();
  try {
    await enviar(m); const { codigo } = m.correos[0];
    const mal = codigo === "000000" ? "111111" : "000000";
    assert.equal((await entrar(m, mal)).status, 401);
    assert.equal((await entrar(m, codigo)).status, 200);
    const otra = await entrar(m, codigo); assert.equal(otra.status, 401, "ya gastado"); assert.match(otra.json.error, /incorrecto|nuevo/i);
    // 5 fallos anulan el código vigente
    const k = await montar(); try {
      await enviar(k); const c2 = k.correos[0].codigo, malo = c2 === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await entrar(k, malo);
      const r = await entrar(k, c2); assert.equal(r.status, 401); assert.match(r.json.error, /demasiadas veces/i);
    } finally { k.cerrar(); }
    assert.equal((await entrar(m, "12345")).status, 400); assert.equal((await entrar(m, "abcdef")).status, 400);
  } finally { m.cerrar(); }
});

test("caducidad y espera entre códigos (fechas forzadas) y la huella: el código nunca se guarda", () => {
  const a = openAccountsDb(":memory:"), t0 = "2026-11-16T10:00:00.000Z", hash = (c) => `h-${c}`.padEnd(64, "0");
  assert.deepEqual(a.codigoCorreoCrear("C1", hash("123456"), { now: t0 }), { ok: true });
  assert.deepEqual(a.codigoCorreoCrear("C1", hash("999999"), { now: "2026-11-16T10:00:30.000Z" }), { ok: false, espera: 30 }, "no se puede pedir otro al momento");
  assert.deepEqual(a.codigoCorreoComprobar(["C1"], () => hash("123456"), { now: "2026-11-16T10:10:00.000Z" }), { ok: false, reason: "expired" }, "a los 10 minutos caduca");
  assert.equal(a.codigoCorreoCrear("C1", hash("222222"), { now: "2026-11-16T10:01:00.000Z" }).ok, true);
  assert.deepEqual(a.codigoCorreoComprobar(["C1"], () => hash("123456"), { now: "2026-11-16T10:02:00.000Z" }), { ok: false, reason: "invalid" }, "el código anterior ya no vale");
  assert.deepEqual(a.codigoCorreoComprobar(["C1"], () => hash("222222"), { now: "2026-11-16T10:03:00.000Z" }), { ok: true, customerId: "C1" });
  assert.deepEqual(a.codigoCorreoComprobar(["C1"], () => hash("222222"), { now: "2026-11-16T10:04:00.000Z" }), { ok: false, reason: "invalid" }, "una sola vez");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-cod-")), "c.sqlite"), b = openAccountsDb(f);
  b.codigoCorreoCrear("C9", "a".repeat(64)); const fila = new DatabaseSync(f).prepare("SELECT * FROM login_codes").get();
  assert.equal(fila.code_hash, "a".repeat(64)); assert.equal(Object.keys(fila).some((k) => /^(code|codigo)$/.test(k)), false);
});

test("contra buzones inundados: tope por cliente+correo, por dirección y en total", async () => {
  const m = await montar({ tope: { clave: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await enviar(m)).status, 200);
    const r = await enviar(m); assert.equal(r.status, 429); assert.match(r.json.error, /esperar|minutos/i);
    assert.equal(m.correos.length, 1, "además hay 60 s entre un código y otro: solo salió uno");
  } finally { m.cerrar(); }
  // tope total por hora: con 1, el segundo cliente (distinto, sin espera pendiente) ya no recibe; con 5, sí
  const g = await montar({ tope: { global: 1, clave: 50 } });
  try { await enviar(g, "123456", "cliente@ejemplo.es"); const r = await enviar(g, "777888", "otro@ejemplo.es"); assert.equal(r.status, 200, "misma respuesta de siempre"); assert.equal(g.correos.length, 1, "el segundo no sale: se llegó al máximo por hora"); } finally { g.cerrar(); }
  const h = await montar({ tope: { global: 5, clave: 50 } });
  try { await enviar(h, "123456", "cliente@ejemplo.es"); await enviar(h, "777888", "otro@ejemplo.es"); assert.equal(h.correos.length, 2, "con margen, salen los dos (el tope es lo que frena)"); } finally { h.cerrar(); }
  const p = await montar({ tope: { ip: 2, clave: 50 } });
  try { await enviar(p); await enviar(p); assert.equal((await enviar(p)).status, 429); } finally { p.cerrar(); }
});

test("datos mal escritos se explican; sin correo configurado la opción no existe y la pantalla de siempre sigue", async () => {
  const m = await montar();
  try {
    assert.equal((await m.post("/api/acceso/correo/enviar", { nif: "12", correo: "a@b.es" })).status, 400);
    assert.match((await m.post("/api/acceso/correo/enviar", { nif: "123456", correo: "no-es-correo" })).json.error, /correo/i);
    const s = await m.get("/api/seguridad"); assert.equal(s.json.codigoCorreo, true); assert.equal(s.json.soloCorreo, false);
    process.env.CODIGO_CORREO = "0"; try { assert.equal((await m.get("/api/seguridad")).json.codigoCorreo, false); assert.equal((await enviar(m)).status, 503); } finally { delete process.env.CODIGO_CORREO; }
  } finally { m.cerrar(); }
  const n = await montar({ conCorreo: false });
  try { assert.equal((await n.get("/api/seguridad")).json.codigoCorreo, false); assert.equal((await enviar(n)).status, 503); assert.equal((await n.post("/api/acceso", { nif: "654321" })).status !== 503, true, "el acceso de siempre no se toca"); } finally { n.cerrar(); }
});

test("ACCESO_SOLO_CORREO=1 cierra el acceso con solo el NIF y con teléfono; el del correo sigue funcionando", async () => {
  const m = await montar(); process.env.ACCESO_SOLO_CORREO = "1";
  try {
    assert.equal((await m.get("/api/seguridad")).json.soloCorreo, true);
    for (const cuerpo of [{ nif: "123456" }, { telefono: "600000000", pin: "ABC123" }]) { const r = await m.post("/api/acceso", cuerpo); assert.equal(r.status, 403); assert.match(r.json.error, /correo/i); }
    await enviar(m); assert.equal((await entrar(m, m.correos[0].codigo)).status, 200);
  } finally { delete process.env.ACCESO_SOLO_CORREO; m.cerrar(); }
});

test("el correo lleva el código y nada más sensible (ni NIF, ni enlaces) y avisa de que no se comparta", () => {
  const c = correoCodigoAcceso({ nombre: "BAR LA PLAZA S.L. Y MUCHAS PALABRAS MAS", codigo: "048213", minutos: 10, telefono: "983000000" });
  assert.match(c.subject, /código/i); assert.match(c.text, /048213/); assert.match(c.text, /10 minutos/); assert.match(c.text, /una vez/); assert.match(c.text, /nadie puede entrar/i); assert.match(c.text, /nunca te lo pediremos/i);
  assert.doesNotMatch(c.text, /https?:\/\/|12345678Z/); assert.match(c.text, /983000000/);
});

test("pantalla: tarjeta de NIF + correo + código, sin manejadores en línea, y borrado con la cuenta", () => {
  const h = leer("./cliente.html"), db = leer("./cuentas-db.js"), s = leer("./server.js");
  for (const t of ['id="f-correo"', 'id="co-nif"', 'id="co-mail"', 'id="co-cod"', 'autocomplete="one-time-code"', 'inputmode="numeric"', "/api/acceso/correo/enviar", "/api/acceso/correo/entrar", "Reenviar código"]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h.slice(h.indexOf('id="f-correo"'), h.indexOf('id="f-acceso"')), /\son[a-z]+=/i);
  assert.match(db, /DELETE FROM login_codes WHERE customer_id = \?"\)\.run\(row\.customer_id\)/);
  assert.match(s, /enviarCodigo: enviarCodigoAcceso/); assert.match(s, /correoCodigoAcceso/);
});
