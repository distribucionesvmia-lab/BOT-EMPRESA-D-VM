// Entrar con la aprobación de la OFICINA (nombre + NIF, sin correo): el cliente pide, la oficina aprueba con un clic o da un código de 6 cifras.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { claveCodigoOficina } from "./nif-key.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Servidor con la lógica REAL de acceso, una base en memoria y clientes ficticios. */
async function montar({ tope = {} } = {}) {
  const accounts = openAccountsDb(":memory:");
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: [] }, C2: { id: "C2", name: "LOCAL UNO", emails: [] }, C3: { id: "C3", name: "LOCAL DOS", emails: [] } };
  const porNif = { 123456: ["C1"], 654321: ["C2", "C3"] };
  const quita = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const customers = { findByNif: (t) => [...new Set(nifCodes(t).flatMap((c) => porNif[c] ?? []))], getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null,
    nameMatches: (c, typed) => !!c && quita(typed).length >= 2 && quita(c.name).includes(quita(typed)),
    matchRegistration: () => ({ customer: null, reason: "nombre" }) };
  Object.assign(process.env, { OFICINA_IP_LIMIT: String(tope.ip ?? 50), OFICINA_GLOBAL_LIMIT: String(tope.global ?? 200), OFICINA_CODIGO_LIMIT: String(tope.codigo ?? 50) });
  const auth = createAuth({ accounts, customers });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { accounts, post, get, cerrar: () => srv.close() };
}
const pedir = (m, nif = "12345678Z", empresa = "Bar La Plaza") => m.post("/api/acceso/oficina/pedir", { nif, empresa });
const estado = (m, solicitud, codigo) => m.post("/api/acceso/oficina/estado", { solicitud, ...(codigo ? { codigo } : {}) });

test("flujo completo: nombre + NIF → aparece en la oficina con su referencia → la oficina aprueba → entra solo, una sola vez", async () => {
  const m = await montar();
  try {
    const r = await pedir(m); assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.match(r.json.ref, /^\d{4}$/); assert.ok(r.json.solicitud.length >= 40);
    assert.equal((await estado(m, r.json.solicitud)).json.estado, "pendiente");
    const lista = m.accounts.accesoSolicitudes(); assert.equal(lista.pendientes.length, 1); assert.equal(lista.pendientes[0].customerId, "C1"); assert.equal(lista.pendientes[0].ref, r.json.ref);
    assert.equal(JSON.stringify(lista).includes(r.json.solicitud), false, "el panel nunca recibe el secreto del navegador");
    assert.equal(m.accounts.accesoSolicitudResolver(lista.pendientes[0].id, "aprobada"), true);
    const e = await estado(m, r.json.solicitud); assert.equal(e.status, 200); assert.equal(e.json.estado, "entra"); assert.equal(e.json.cliente.nombre, "BAR LA PLAZA S.L.");
    const ck = e.cab.get("set-cookie"); assert.match(ck, /vm_session=/); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.match(ck, /Max-Age=2592000/, "la sesión dura 30 días: el aparato queda recordado");
    assert.equal((await m.get("/api/yo", { Cookie: ck.split(";")[0] })).json.cliente?.nombre, "BAR LA PLAZA S.L.");
    const otra = await estado(m, r.json.solicitud); assert.notEqual(otra.json.estado, "entra", "una solicitud aprobada vale una sola vez"); assert.equal(otra.cab.get("set-cookie"), null);
  } finally { m.cerrar(); }
});

test("no se puede averiguar qué NIF existen: misma respuesta y nada en el panel si no coincide", async () => {
  const m = await montar();
  try {
    const bien = await pedir(m);
    const casos = [["99999999R", "Bar La Plaza"], ["12345678Z", "Otro Negocio Distinto"], ["65432199A", "Local"] /* dos clientes con ese NIF y nombre que encaja con ambos */];
    for (const [nif, emp] of casos) { const r = await pedir(m, nif, emp); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), Object.keys(bien.json).sort()); assert.equal(r.json.mensaje, bien.json.mensaje); assert.equal((await estado(m, r.json.solicitud)).json.estado, "pendiente", "para el navegador sigue «pendiente»"); }
    assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 1, "solo la buena llegó a la oficina");
  } finally { m.cerrar(); }
});

test("rechazar, caducar y pedir otra vez: lo viejo deja de valer; esperar entre solicitudes", async () => {
  const m = await montar();
  try {
    const a = await pedir(m); const id = m.accounts.accesoSolicitudes().pendientes[0].id;
    assert.equal(m.accounts.accesoSolicitudResolver(id, "rechazada"), true); assert.equal((await estado(m, a.json.solicitud)).json.estado, "rechazada");
    assert.equal(m.accounts.accesoSolicitudResolver(id, "aprobada"), false, "una resuelta no se puede aprobar después");
    const b = await pedir(m); assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 0, "pedir otra vez a los pocos segundos no crea otra (espera)");
    assert.equal((await estado(m, b.json.solicitud)).json.estado, "pendiente");
    // fechas forzadas
    const base = "2026-11-16T10:00:00.000Z", mas = (min) => new Date(Date.parse(base) + min * 60000).toISOString();
    const cu = openAccountsDb(":memory:");
    const s1 = cu.accesoSolicitudCrear({ customerId: "C1", secretHash: "h1", ref: "1111", now: base }); assert.equal(s1.ok, true);
    assert.equal(cu.accesoSolicitudCrear({ customerId: "C1", secretHash: "h2", ref: "2222", now: mas(0.1) }).ok, false, "menos de 20 s");
    const s2 = cu.accesoSolicitudCrear({ customerId: "C1", secretHash: "h2", ref: "2222", now: mas(1) }); assert.equal(s2.ok, true);
    assert.equal(cu.accesoSolicitudEstado("h1", mas(1)).estado, "reemplazada");
    assert.equal(cu.accesoSolicitudEstado("h2", mas(29)).estado, "pendiente"); assert.equal(cu.accesoSolicitudEstado("h2", mas(40)).estado, "caducada");
    assert.equal(cu.accesoSolicitudResolver(s2.id, "aprobada", mas(40)), false, "caducada: no se aprueba");
  } finally { m.cerrar(); }
});

test("código de 6 cifras dado por la oficina: solo su huella se guarda, vale una vez, y tras 5 fallos se anula", async () => {
  const m = await montar();
  try {
    const r = await pedir(m), id = m.accounts.accesoSolicitudes().pendientes[0].id;
    assert.equal((await estado(m, r.json.solicitud, "123456")).status, 401); assert.match((await estado(m, r.json.solicitud, "123456")).json.error, /todavía no te ha dado/);
    assert.equal(m.accounts.accesoSolicitudCodigo(id, claveCodigoOficina("C1", "482913")), true);
    const mal = await estado(m, r.json.solicitud, "111111"); assert.equal(mal.status, 401); assert.match(mal.json.error, /incorrecto/);
    assert.equal((await estado(m, r.json.solicitud, "12ab")).status, 400);
    const ok = await estado(m, r.json.solicitud, "482 913"); assert.equal(ok.status, 200); assert.equal(ok.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.notEqual((await estado(m, r.json.solicitud, "482913")).status, 200, "el código vale una vez");
    const fila = m.accounts.accesoSolicitudes().recientes[0]; assert.equal(JSON.stringify(fila).includes("482913"), false);
  } finally { m.cerrar(); }
});

test("tras 5 códigos erróneos el código se anula (huella en la base; nada de código en claro)", () => {
  const cu = openAccountsDb(":memory:"), base = "2026-11-16T10:00:00.000Z";
  const s = cu.accesoSolicitudCrear({ customerId: "C1", secretHash: "hx", ref: "0001", now: base }); cu.accesoSolicitudCodigo(s.id, "huella-buena", base);
  for (let i = 0; i < 5; i++) assert.equal(cu.accesoSolicitudCodigoComprobar("hx", () => "otra", { now: base }).ok, false);
  const r = cu.accesoSolicitudCodigoComprobar("hx", () => "huella-buena", { now: base }); assert.equal(r.ok, false); assert.equal(r.reason, "agotado");
  assert.equal(cu.accesoSolicitudCodigo(s.id, "huella-nueva", base), true, "la oficina puede dar otro código y se reinician los intentos");
  assert.equal(cu.accesoSolicitudCodigoComprobar("hx", () => "huella-nueva", { now: base }).ok, true);
});

test("contra solicitudes en masa: tope por dirección y en total", async () => {
  const m = await montar({ tope: { ip: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await pedir(m, "99999999R")).status, 200);
    assert.equal((await pedir(m, "99999999R")).status, 429);
  } finally { m.cerrar(); }
});

test("datos mal escritos se explican y SOLO se entra así: el acceso con solo el NIF y con teléfono viene cerrado (ACCESO_SOLO_OFICINA=0 lo reabre)", async () => {
  const m = await montar();
  try {
    assert.equal((await m.post("/api/acceso/oficina/pedir", { nif: "12345678Z", empresa: "" })).status, 400);
    assert.equal((await m.post("/api/acceso/oficina/pedir", { nif: "", empresa: "Bar La Plaza" })).status, 400);
    assert.equal((await m.post("/api/acceso/oficina/estado", { solicitud: "corto" })).status, 400);
    const seg = (await m.get("/api/seguridad")).json; assert.equal(seg.accesoOficina, true); assert.equal(seg.soloOficina, true);
    assert.equal((await m.post("/api/acceso", { nif: "123456" })).status, 403);
    assert.equal((await m.post("/api/acceso", { telefono: "600111222", pin: "ABC123" })).status, 403);
    process.env.ACCESO_SOLO_OFICINA = "0";
    try { assert.equal((await m.get("/api/seguridad")).json.soloOficina, false); assert.notEqual((await m.post("/api/acceso", { nif: "123456" })).status, 403); } finally { delete process.env.ACCESO_SOLO_OFICINA; }
    process.env.ACCESO_OFICINA = "0";
    try { assert.equal((await pedir(m)).status, 503); } finally { delete process.env.ACCESO_OFICINA; }
  } finally { m.cerrar(); }
});

test("ALTAS: toda alta queda pendiente hasta que la empresa la acepte; el correo es OPCIONAL y no hay código de entrada", async () => {
  const m = await montar();
  try {
    const alta = (extra = {}) => m.post("/api/registro", { telefono: "600111222", correo: "", empresa: "Bar La Plaza", nif: "12345678Z", direccion: "Calle 1", ...extra });
    const r = await alta(); assert.equal(r.status, 200); assert.equal(r.json.estado, "pendiente"); assert.match(r.json.mensaje, /24 a 48 horas/);
    assert.equal(m.accounts.listRegistrations("pending").length, 1); assert.equal(m.accounts.listRegistrations("auto").length, 0, "nada entra solo");
    assert.equal((await alta({ telefono: "600333444", correo: "mal" })).status, 400, "si se escribe un correo, tiene que ser válido");
    assert.equal((await alta({ telefono: "600333445", empresa: "Otro", correo: "uno@ejemplo.es", pin: undefined })).status, 200);
  } finally { m.cerrar(); }
  const src = leer("./auth.js"); assert.match(src, /process\.env\.ALTA_AUTOMATICA === "1"/); assert.match(src, /m\.customer && altaAutomatica\(\) && !sinCodigoEntrada/);
});

test("pantalla del cliente: nombre + NIF, sin correo, sin manejadores en línea; panel de la empresa con aprobar / código / rechazar", () => {
  const h = leer("./cliente.html"), e = leer("./empresa.html"), a = leer("./admin.js"), db = leer("./cuentas-db.js");
  const tarjeta = h.slice(h.indexOf('id="f-correo"'), h.indexOf('id="f-acceso"'));
  for (const t of ['id="co-emp"', 'id="co-nif"', 'id="co-cod"', 'id="co-ref"', "Avisar a la oficina", 'autocomplete="one-time-code"']) assert.ok(tarjeta.includes(t), t);
  assert.ok(!tarjeta.includes('id="co-mail"') && !/correo electrónico/i.test(tarjeta), "ya no se pide correo para entrar");
  assert.doesNotMatch(tarjeta, /\son[a-z]+=/i);
  for (const t of ["/api/acceso/oficina/pedir", "/api/acceso/oficina/estado"]) assert.ok(h.includes(t), t);
  assert.ok(!h.includes("/api/acceso/correo/"), "el acceso por correo se quitó");
  for (const t of ['id="acc-panel"', 'id="acc-banner"', "Dejarle entrar", "Dar un código", "Rechazar", "Número de comprobación", "/api/admin/accesos"]) assert.ok(e.includes(t), t);
  assert.doesNotMatch(e, /onclick="/, "la política de scripts no deja manejadores en línea");
  assert.match(a, /accesos\\\/\(\\d\+\)\\\/\(aprobar\|rechazar\|codigo\)/); assert.match(db, /DELETE FROM acceso_solicitudes WHERE customer_id = \?/);
});
