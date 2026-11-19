// Código de 6 dígitos al correo de la ficha: al registrarse (crear la contraseña) y al entrar desde un aparato nuevo.
// Datos ficticios; el «correo» es una función que apunta lo que enviaría.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function montar({ conCorreo = true, fichas: extra = {}, env = {} } = {}) {
  const accounts = openAccountsDb(":memory:"), correos = [];
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: ["maria.lopez@ejemplo.es"] }, C2: { id: "C2", name: "LOCAL SIN CORREO", emails: [] }, ...extra };
  const porNif = { 123456: ["C1"], 654321: ["C2"] };
  const quita = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const customers = { findByNif: (t) => [...new Set(nifCodes(t).flatMap((c) => porNif[c] ?? []))], getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null,
    nameMatches: (c, typed) => !!c && quita(typed).length >= 2 && quita(c.name).includes(quita(typed)), matchRegistration: () => ({ customer: null, reason: "nombre" }) };
  Object.assign(process.env, { PW_IP_LIMIT: "100", LOGIN_LIMIT: "1000", PW_CREAR_IP_LIMIT: "100", PW_CORREO_IP_LIMIT: "100", PW_CORREO_VER_LIMIT: "100", ...env });
  const auth = createAuth({ accounts, customers, enviarCodigo: conCorreo ? async (c) => { correos.push(c); } : null });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  return { accounts, correos, post, cerrar: () => { srv.close(); for (const k of Object.keys(env)) delete process.env[k]; delete process.env.PW_CORREO_IP_LIMIT; delete process.env.PW_CORREO_VER_LIMIT; } };
}
const base = { empresa: "Bar La Plaza", nif: "12345678Z", t: 5000 };
const crear = (m, password, extra = {}, cab = {}) => m.post("/api/acceso/pw/crear", { ...base, password, password2: password, ...extra }, cab);
const entrar = (m, password, extra = {}, cab = {}) => m.post("/api/acceso/pw/entrar", { ...base, password, ...extra }, cab);
const cookies = (r) => r.cab.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const codigoDe = (m) => String(m.correos.at(-1).codigo);

test("REGISTRO: crear la contraseña manda un código al correo de la ficha, lo enseña tapado y no crea nada hasta que se escribe", async () => {
  const m = await montar();
  try {
    const a = await crear(m, "Mesa-Verde-42");
    assert.equal(a.status, 409); assert.equal(a.json.necesitaCodigoCorreo, true); assert.equal(a.json.correo, "m******@ejemplo.es");
    assert.match(a.json.mensaje, /código de 6 dígitos a m\*+@ejemplo\.es/); assert.equal(JSON.stringify(a.json).includes("maria.lopez"), false, "el correo nunca sale entero");
    assert.equal(m.correos.length, 1); assert.equal(m.correos[0].to, "maria.lopez@ejemplo.es"); assert.match(codigoDe(m), /^\d{6}$/);
    assert.equal(m.accounts.passwordTiene("C1"), false, "sin el código no se crea la contraseña");
    const mal = await crear(m, "Mesa-Verde-42", { codigoCorreo: "000000" }); assert.equal(mal.status, 401); assert.equal(mal.json.necesitaCodigoCorreo, true);
    assert.equal(m.accounts.passwordTiene("C1"), false);
    const bien = await crear(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) }); assert.equal(bien.status, 200); assert.equal(bien.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal(m.accounts.passwordTiene("C1"), true);
    const reuso = await crear(m, "Otra-Clave-77", { codigoCorreo: codigoDe(m) }); assert.notEqual(reuso.status, 200, "el código vale una sola vez: no sirve para crear otra contraseña encima");
  } finally { m.cerrar(); }
});

test("ENTRAR: aparato nuevo → código por correo; aparato ya recordado → no lo pide; no se puede repetir ni mandar otro antes de 60 s", async () => {
  const m = await montar();
  try {
    await crear(m, "Mesa-Verde-42"); const c = await crear(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) });
    const recordado = cookies(c);
    const e1 = await entrar(m, "Mesa-Verde-42", {}, { Cookie: recordado }); assert.equal(e1.status, 200, "con su aparato recordado entra sin código");
    const n = m.correos.length;
    const e2 = await entrar(m, "Mesa-Verde-42"); assert.equal(e2.status, 409); assert.equal(e2.json.necesitaCodigoCorreo, true); assert.equal(m.correos.length, n + 1, "aparato nuevo: se manda un código");
    assert.equal((await entrar(m, "Mesa-Verde-42")).status, 409); assert.equal(m.correos.length, n + 1, "otro intento antes de 60 s no manda otro correo");
    assert.equal((await entrar(m, "contraseña-mala", { codigoCorreo: codigoDe(m) })).status, 401, "con contraseña mala no entra aunque el código sea bueno");
    const ok = await entrar(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) }); assert.equal(ok.status, 200);
    assert.equal((await entrar(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) })).status === 200, false, "el código ya gastado no vale otra vez (y este aparato nuevo no queda sin comprobar)");
  } finally { m.cerrar(); }
});

test("SIN CORREO en la ficha: no se puede crear la contraseña y se dice que hay que llamar; sin correo configurado todo sigue como antes", async () => {
  const m = await montar();
  try {
    const r = await m.post("/api/acceso/pw/crear", { empresa: "Local sin correo", nif: "65432198A", t: 5000, password: "Mesa-Verde-42", password2: "Mesa-Verde-42" });
    assert.equal(r.status, 409); assert.equal(r.json.sinCorreo, true); assert.match(r.json.error, /Llámanos/); assert.equal(m.correos.length, 0); assert.equal(m.accounts.passwordTiene("C2"), false);
  } finally { m.cerrar(); }
  const s = await montar({ conCorreo: false });
  try { const r = await crear(s, "Mesa-Verde-42"); assert.equal(r.status, 200, "sin SMTP no se exige código (si no, nadie podría entrar)"); } finally { s.cerrar(); }
});

test("CODIGO_CORREO_PW=0 lo apaga, y un cliente con verificación en dos pasos usa la de su móvil en vez del correo", async () => {
  const off = await montar({ env: { CODIGO_CORREO_PW: "0" } });
  try { assert.equal((await crear(off, "Mesa-Verde-42")).status, 200); assert.equal(off.correos.length, 0); } finally { off.cerrar(); }
  const m = await montar();
  try {
    await crear(m, "Mesa-Verde-42"); await crear(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) });
    m.accounts.totpActivar("C1", "sello-falso", ["X"], 1); const n = m.correos.length;
    const r = await entrar(m, "Mesa-Verde-42"); assert.equal(r.status, 409); assert.equal(r.json.necesitaCodigo, true); assert.equal(r.json.necesitaCodigoCorreo, undefined); assert.equal(m.correos.length, n);
  } finally { m.cerrar(); }
});

test("PANTALLA: campo del código del correo, aviso de dónde llega y botón «Enviarme otro código»", () => {
  const h = leer("./cliente.html"), a = leer("./auth.js");
  for (const t of ['id="pw-cc-fila"', 'id="pw-cc"', 'id="pw-cc-otro"', "Enviarme otro código", "j.necesitaCodigoCorreo", "body.codigoCorreo", "código de 6 dígitos"]) assert.ok(h.includes(t), t);
  for (const t of ["necesitaCodigoCorreo", "sinCorreo", "exigirCorreo", "CODIGO_CORREO_PW", "tapar(dest)"]) assert.ok(a.includes(t), t);
  assert.doesNotMatch(h, /\son[a-z]+="/);
});

test("CAMBIAR LA CONTRASEÑA: pide el código de 6 dígitos al correo de la ficha y no cambia nada hasta que es bueno", async () => {
  const m = await montar();
  try {
    await crear(m, "Mesa-Verde-42"); const c = await crear(m, "Mesa-Verde-42", { codigoCorreo: codigoDe(m) });
    const ck = { Cookie: cookies(c) }, n = m.correos.length;
    const cambio = (extra = {}) => m.post("/api/password", { actual: "Mesa-Verde-42", nueva: "Nueva-Clave-88", nueva2: "Nueva-Clave-88", ...extra }, ck);
    assert.equal((await m.post("/api/password", { actual: "mala", nueva: "Nueva-Clave-88" }, ck)).status, 401); assert.equal(m.correos.length, n, "con la contraseña actual mala no se manda ningún código");
    const a = await cambio(); assert.equal(a.status, 409); assert.equal(a.json.necesitaCodigoCorreo, true); assert.equal(a.json.correo, "m******@ejemplo.es"); assert.equal(m.correos.length, n + 1);
    assert.equal(m.accounts.passwordComprobar("C1", "Nueva-Clave-88").ok, false, "sin el código no cambia");
    const mal = await cambio({ codigoCorreo: "000000" }); assert.equal(mal.status, 401); assert.equal(mal.json.necesitaCodigoCorreo, true);
    assert.equal(m.accounts.passwordComprobar("C1", "Nueva-Clave-88").ok, false);
    const bien = await cambio({ codigoCorreo: codigoDe(m) }); assert.equal(bien.status, 200);
    assert.equal(m.accounts.passwordComprobar("C1", "Nueva-Clave-88").ok, true);
    assert.equal((await m.post("/api/password", { actual: "Nueva-Clave-88", nueva: "Otra-Mas-9977", nueva2: "Otra-Mas-9977", codigoCorreo: codigoDe(m) }, ck)).status === 200, false, "el código gastado no sirve para otro cambio");
  } finally { m.cerrar(); }
  const s = await montar({ conCorreo: false });
  try { await crear(s, "Mesa-Verde-42").then((r) => s.post("/api/password", { actual: "Mesa-Verde-42", nueva: "Nueva-Clave-88", nueva2: "Nueva-Clave-88" }, { Cookie: cookies(r) })).then((r) => assert.equal(r.status, 200, "sin correo configurado no se exige código")); } finally { s.cerrar(); }
});

test("CAMBIAR LA CONTRASEÑA, pantalla: campo del código, aviso de dónde llega y «Enviarme otro código»", () => {
  const h = leer("./cliente.html");
  for (const t of ['id="p-cc-fila"', 'id="p-cc"', 'id="p-cc-otro"', "body.codigoCorreo"]) assert.ok(h.includes(t), t);
  assert.ok(leer("./auth.js").includes("exigirCorreoDe(req, res, b, acc.customerId)"));
});
