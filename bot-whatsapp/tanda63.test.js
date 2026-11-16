// Verificación en dos pasos del CLIENTE (opcional): nombre + NIF + contraseña + código de una aplicación del móvil (tipo Google Authenticator).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { totp } from "./totp.js";
import { sellar, abrirSello } from "./nif-key.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function montar() {
  const accounts = openAccountsDb(":memory:"), avisos = [];
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: [] }, C2: { id: "C2", name: "OTRO BAR", emails: [] } };
  const customers = { findByNif: (t) => (nifCodes(t).includes("123456") ? ["C1"] : nifCodes(t).includes("222222") ? ["C2"] : []), getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null, nameMatches: () => true, matchRegistration: () => ({ customer: null }) };
  Object.assign(process.env, { PW_IP_LIMIT: "500", LOGIN_LIMIT: "5000", PW_CREAR_IP_LIMIT: "500" });
  const auth = createAuth({ accounts, customers, onCodigo: (a) => avisos.push(a.customerId) });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { accounts, avisos, post, get, cerrar: () => srv.close() };
}
const PW = "Mesa-Verde-42";
const crear = (m, nif = "123456", extra = {}) => m.post("/api/acceso/pw/crear", { empresa: "", nif, password: PW, password2: PW, t: 5000, ...extra });
const entrar = (m, extra = {}, cab = {}) => m.post("/api/acceso/pw/entrar", { empresa: "", nif: "123456", password: PW, t: 5000, ...extra }, cab);
const galletas = (r) => r.cab.getSetCookie().map((c) => c.split(";")[0]);

async function conDobleFactor(m) {
  const c = await crear(m), ck = galletas(c).join("; ");
  const prep = await m.post("/api/2fa/preparar", { password: PW }, { Cookie: ck }); assert.equal(prep.status, 200);
  const clave = prep.json.clave.replace(/\s/g, ""); const act = await m.post("/api/2fa/activar", { codigo: totp(clave) }, { Cookie: ck }); assert.equal(act.status, 200);
  return { ck, clave, emergencia: act.json.emergencia, aparato: galletas(c).find((x) => x.startsWith("vm_aparato=")) };
}

test("activar: pide la contraseña, enseña la clave, comprueba un código y da 8 códigos de emergencia; el secreto no está en claro", async () => {
  const m = await montar();
  try {
    assert.equal((await m.post("/api/2fa/preparar", { password: PW })).status, 401, "sin sesión no");
    const c = await crear(m), ck = galletas(c).join("; ");
    assert.equal((await m.get("/api/yo", { Cookie: ck })).json.cliente.dobleFactor, false);
    assert.equal((await m.post("/api/2fa/preparar", { password: "mala-clave-1" }, { Cookie: ck })).status, 401, "hay que escribir la contraseña");
    const prep = await m.post("/api/2fa/preparar", { password: PW }, { Cookie: ck }); assert.equal(prep.status, 200); assert.match(prep.json.url, /^otpauth:\/\/totp\//); assert.match(prep.json.clave, /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    const clave = prep.json.clave.replace(/\s/g, "");
    assert.equal((await m.post("/api/2fa/activar", { codigo: "000000" }, { Cookie: ck })).status, 400); assert.equal(m.accounts.dobleFactor("C1").activo, false);
    const act = await m.post("/api/2fa/activar", { codigo: totp(clave) }, { Cookie: ck }); assert.equal(act.status, 200); assert.equal(act.json.emergencia.length, 8); assert.match(act.json.emergencia[0], /^[0-9A-F]{5}-[0-9A-F]{5}$/);
    assert.deepEqual({ ...m.accounts.dobleFactor("C1"), creado: "x" }, { activo: true, creado: "x", emergencia: 8 }); assert.equal((await m.get("/api/yo", { Cookie: ck })).json.cliente.dobleFactor, true); assert.equal(m.avisos.filter((x) => x === "C1").length >= 2, true, "se avisa al móvil del cliente");
    const enc = m.accounts.totpSecreto("C1"); assert.equal(enc.includes(clave), false, "cifrado en la base"); assert.equal(abrirSello(enc), clave); { const p = enc.split("$"); p[2] = Buffer.alloc(16).toString("base64"); assert.equal(abrirSello(p.join("$")), null, "un sello manipulado no se abre"); }
    assert.equal(JSON.stringify(m.accounts.listAccounts()).includes(act.json.emergencia[0]), false);
    assert.equal(sellar("hola") === sellar("hola"), false, "cada sello lleva su valor aleatorio");
    assert.equal((await m.post("/api/2fa/preparar", { password: PW }, { Cookie: ck })).status, 409, "ya está activado");
  } finally { m.cerrar(); }
});

test("entrar desde un aparato NUEVO: tras la contraseña pide el código; uno malo no sirve; uno bueno vale una sola vez; el aparato recordado no lo pide", async () => {
  const m = await montar();
  try {
    const { clave, emergencia, aparato } = await conDobleFactor(m);
    const sin = await entrar(m); assert.equal(sin.status, 409); assert.equal(sin.json.necesitaCodigo, true); assert.equal(sin.cab.getSetCookie().length, 0, "sin código no se abre ninguna sesión");
    assert.equal((await entrar(m, { password: "mala-clave-1" })).status, 401, "con la contraseña mala ni se llega a pedir el código");
    const mal = await entrar(m, { codigo: "000000" }); assert.equal(mal.status, 401); assert.equal(mal.cab.getSetCookie().length, 0);
    const bien = await entrar(m, { codigo: totp(clave, Date.now() + 30_000) }); assert.equal(bien.status, 200); assert.equal(bien.cab.getSetCookie().length, 2);
    assert.equal((await entrar(m, { codigo: totp(clave, Date.now() + 30_000) })).status, 401, "el mismo código no vale dos veces");
    const em = await entrar(m, { codigo: emergencia[0] }); assert.equal(em.status, 200); assert.equal((await entrar(m, { codigo: emergencia[0] })).status, 401, "un código de emergencia vale una vez"); assert.equal(m.accounts.dobleFactor("C1").emergencia, 7);
    assert.equal((await entrar(m, { codigo: emergencia[0].toLowerCase() })).status, 401);
    // aparato ya recordado de ESE cliente: no pide código
    assert.equal((await entrar(m, {}, { Cookie: aparato })).status, 200);
    // código de otra cuenta no sirve
    const otro = await crear(m, "222222"); assert.equal(otro.status, 200); assert.equal((await entrar(m, { codigo: totp(clave, Date.now() + 60_000) })).status, 401);
  } finally { m.cerrar(); }
});

test("fuerza bruta de códigos: 5 fallos bloquean la cuenta 15 minutos (también con el código bueno); no se puede adivinar un código de 6 cifras", async () => {
  const m = await montar();
  try {
    const { clave } = await conDobleFactor(m);
    for (let i = 0; i < 5; i++) assert.equal((await entrar(m, { codigo: "00000" + i })).status, 401);
    const b = await entrar(m, { codigo: totp(clave, Date.now() + 30_000) }); assert.equal(b.status, 401); assert.match(b.json.error, /bloqueada temporalmente/);
  } finally { m.cerrar(); }
});

test("desactivar: contraseña + código; restablecer desde el panel lo quita también; el secreto de un cliente no vale para otro", async () => {
  const m = await montar();
  try {
    const { ck, clave } = await conDobleFactor(m);
    assert.equal((await m.post("/api/2fa/desactivar", { password: "mala-clave-1", codigo: totp(clave, Date.now() + 30_000) }, { Cookie: ck })).status, 401);
    assert.equal((await m.post("/api/2fa/desactivar", { password: PW, codigo: "000000" }, { Cookie: ck })).status, 401); assert.equal(m.accounts.dobleFactor("C1").activo, true);
    assert.equal((await m.post("/api/2fa/desactivar", { password: PW, codigo: totp(clave, Date.now() + 30_000) }, { Cookie: ck })).status, 200); assert.equal(m.accounts.dobleFactor("C1").activo, false);
    assert.equal((await entrar(m)).status, 200, "sin 2FA, solo la contraseña");
  } finally { m.cerrar(); }
  const m2 = await montar();
  try {
    await conDobleFactor(m2); assert.equal(m2.accounts.dobleFactor("C1").activo, true);
    m2.accounts.passwordQuitar("C1"); assert.equal(m2.accounts.dobleFactor("C1").activo, false, "restablecer también quita el segundo factor");
    assert.equal(m2.accounts.totpSecreto("C1"), null); assert.equal((await entrar(m2)).json.necesitaCrear, true);
  } finally { m2.cerrar(); }
});

test("pantalla y panel: campo del código al entrar, ventana de activar/desactivar en el menú, y la ficha lo muestra; sin manejadores en línea", () => {
  const h = leer("./cliente.html"), e = leer("./empresa.html"), a = leer("./auth.js");
  for (const t of ['id="pw-cod"', 'id="pw-cod-fila"', 'id="abrir-2fa"', 'id="m-2fa"', "Introducir clave de configuración", "Guarda estos códigos de emergencia", "/api/2fa/preparar", "/api/2fa/activar", "/api/2fa/desactivar", "necesitaCodigo"]) assert.ok(h.includes(t), t);
  assert.doesNotMatch(h, /\son[a-z]+="/); assert.match(e, /Verificación en dos pasos/); assert.match(a, /accounts\.dobleFactor\(ids\[0\]\)\.activo && aparatoDe\(req\) !== ids\[0\]/);
});
