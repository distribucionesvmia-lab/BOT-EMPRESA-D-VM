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
async function montar({ tope = {}, conCorreo = false, falloCorreo = false } = {}) {
  const accounts = openAccountsDb(":memory:"), correos = [];
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: ["Cliente@Ejemplo.es"] }, C2: { id: "C2", name: "LOCAL UNO", emails: [] }, C3: { id: "C3", name: "LOCAL DOS", emails: [] } };
  const porNif = { 123456: ["C1"], 654321: ["C2", "C3"] };
  const quita = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const customers = { findByNif: (t) => [...new Set(nifCodes(t).flatMap((c) => porNif[c] ?? []))], getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null,
    nameMatches: (c, typed) => !!c && quita(typed).length >= 2 && quita(c.name).includes(quita(typed)),
    matchRegistration: () => ({ customer: null, reason: "nombre" }) };
  Object.assign(process.env, { OFICINA_IP_LIMIT: String(tope.ip ?? 50), OFICINA_GLOBAL_LIMIT: String(tope.global ?? 200), OFICINA_CODIGO_LIMIT: String(tope.codigo ?? 50) });
  const auth = createAuth({ accounts, customers, enviarCodigo: conCorreo ? async (c) => { if (falloCorreo) throw new Error("SMTP caído"); correos.push(c); } : null });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { accounts, correos, port, post, get, cerrar: () => srv.close() };
}
const pedir = (m, nif = "12345678Z", empresa = "Bar La Plaza", extra = {}, cab = {}) => m.post("/api/acceso/oficina/pedir", { nif, empresa, t: 5000, ...extra }, cab);
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
    assert.equal((await pedir(m, "12345678Z", "")).status, 400);
    assert.equal((await pedir(m, "", "Bar La Plaza")).status, 400);
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

test("FÁCIL: tras UNA aprobación el aparato queda recordado y vuelve a entrar solo (sin la oficina), también al caducar la sesión", async () => {
  const m = await montar();
  try {
    const a = await pedir(m), id = m.accounts.accesoSolicitudes().pendientes[0].id; m.accounts.accesoSolicitudResolver(id, "aprobada");
    const e = await estado(m, a.json.solicitud), cks = e.cab.getSetCookie(); assert.equal(cks.length, 2, "sesión + aparato");
    const ses = cks.find((c) => c.startsWith("vm_session=")).split(";")[0], apa = cks.find((c) => c.startsWith("vm_aparato=")); assert.match(apa, /HttpOnly/); assert.match(apa, /SameSite=Strict/); assert.match(apa, /Max-Age=31536000/);
    const apaCk = apa.split(";")[0];
    assert.equal(JSON.stringify(m.accounts.aparatosDe("C1")).includes(apaCk.split("=")[1]), false, "el secreto del aparato no se guarda en claro");
    // la sesión caduca / se cierra el navegador: solo queda el aparato → /api/yo lo reconoce y abre una sesión nueva
    const yo = await fetch(`http://127.0.0.1:${m.port}/api/yo`, { headers: { Cookie: apaCk } }); const j = await yo.json();
    assert.equal(j.cliente?.nombre, "BAR LA PLAZA S.L."); assert.match(yo.headers.get("set-cookie"), /vm_session=/);
    // y si la sesión se perdió, pedir otra vez con su nombre y NIF entra directo, sin avisar a la oficina
    const antes = m.accounts.accesoSolicitudes().pendientes.length;
    const d = await pedir(m, "12345678Z", "Bar La Plaza", {}, { Cookie: apaCk }); assert.equal(d.json.entra, true); assert.equal(d.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal(m.accounts.accesoSolicitudes().pendientes.length, antes, "no molesta a la oficina");
    // el aparato de un cliente NO sirve para otro, ni un secreto inventado
    const otro = await pedir(m, "65432199A", "Local Uno", {}, { Cookie: apaCk }); assert.notEqual(otro.json.entra, true);
    assert.equal((await fetch(`http://127.0.0.1:${m.port}/api/yo`, { headers: { Cookie: "vm_aparato=" + "x".repeat(43) } }).then((r) => r.json())).cliente, null);
    // «Cerrar sesión» olvida este aparato: la próxima vez hará falta la oficina
    const sal = await fetch(`http://127.0.0.1:${m.port}/api/salir`, { method: "POST", headers: { Cookie: `${ses}; ${apaCk}` } }); assert.equal(sal.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${m.port}/api/yo`, { headers: { Cookie: apaCk } }).then((r) => r.json())).cliente, null);
    assert.equal(m.accounts.aparatosDe("C1").length, 0);
  } finally { m.cerrar(); }
});

test("aparatos: máximo 5 por cliente, caducan al año sin usarse, la oficina puede olvidarlos todos y se borran con la cuenta", () => {
  const cu = openAccountsDb(":memory:"), base = "2026-11-16T10:00:00.000Z", dia = (n) => new Date(Date.parse(base) + n * 86_400_000).toISOString();
  for (let i = 1; i <= 7; i++) cu.aparatoCrear("C1", `h${i}`, "Chrome", { now: base });
  assert.equal(cu.aparatosDe("C1").length, 5); assert.equal(cu.aparatoValido("h1", { now: base }), null, "el más antiguo se olvidó"); assert.equal(cu.aparatoValido("h7", { now: base }), "C1");
  assert.equal(cu.aparatoValido("h7", { now: dia(300) }), "C1", "se renueva al usarlo"); assert.equal(cu.aparatoValido("h7", { now: dia(300 + 364) }), "C1"); assert.equal(cu.aparatoValido("h6", { now: dia(366) }), null, "sin usar un año: caduca");
  assert.equal(cu.aparatosBorrar("C1") > 0, true); assert.equal(cu.aparatoValido("h7", { now: base }), null);
});

test("contra bots: el campo trampa y enviar demasiado rápido (o sin decir cuánto) parecen ir bien pero no llegan a la oficina; tope por cliente y hora", async () => {
  const m = await montar();
  try {
    const bien = await pedir(m, "12345678Z", "Bar La Plaza", { t: 5000 });
    const lista = () => m.accounts.accesoSolicitudes().pendientes.length; assert.equal(lista(), 1);
    for (const extra of [{ sitio_web: "http://spam" }, { t: 100 }, { t: undefined }]) { const r = await pedir(m, "12345678Z", "Bar La Plaza", extra); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), Object.keys(bien.json).sort()); }
    assert.equal(lista(), 1, "ninguna de esas llegó a la oficina (ni reemplazó a la buena)");
    assert.equal((await estado(m, (await pedir(m, "12345678Z", "Bar La Plaza", { t: 10 })).json.solicitud)).json.estado, "pendiente");
  } finally { m.cerrar(); }
  process.env.OFICINA_CLIENTE_LIMIT = "2"; process.env.OFICINA_ESPERA_S = "0";
  const m2 = await montar();
  try {
    for (let i = 0; i < 4; i++) await pedir(m2);
    const l = m2.accounts.accesoSolicitudes(); assert.equal(l.pendientes.length, 1); assert.equal(l.recientes.filter((x) => x.estado === "reemplazada").length, 1, "solo 2 solicitudes por hora para el mismo cliente: la 3.ª y la 4.ª no llegan");
  } finally { m2.cerrar(); delete process.env.OFICINA_CLIENTE_LIMIT; delete process.env.OFICINA_ESPERA_S; }
});

test("CÓDIGO POR CORREO (sin la oficina): nombre + NIF → el código llega al correo de la ficha → entra solo y el aparato queda recordado", async () => {
  const m = await montar({ conCorreo: true });
  try {
    const r = await pedir(m); assert.equal(r.status, 200); assert.match(r.json.mensaje, /código de 6 cifras al correo que tenemos/);
    await new Promise((ok) => setTimeout(ok, 30)); assert.equal(m.correos.length, 1); const c = m.correos[0];
    assert.equal(c.to, "Cliente@Ejemplo.es", "va al correo que YA consta en la ficha (nadie escribe un correo)"); assert.match(c.codigo, /^\d{6}$/); assert.equal(c.minutos, 15);
    assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 0, "la oficina NO ve ni tiene que aceptar nada");
    assert.equal(JSON.stringify(m.accounts.accesoSolicitudes()).includes(c.codigo), false);
    assert.equal((await estado(m, r.json.solicitud, c.codigo === "000000" ? "111111" : "000000")).status, 401);
    const e = await estado(m, r.json.solicitud, c.codigo); assert.equal(e.status, 200); assert.equal(e.json.cliente.nombre, "BAR LA PLAZA S.L."); assert.equal(e.cab.getSetCookie().length, 2, "sesión + aparato recordado");
    assert.notEqual((await estado(m, r.json.solicitud, c.codigo)).status, 200, "el código vale una vez");
    assert.equal((await m.get("/api/seguridad")).json.codigoCorreo, true);
  } finally { m.cerrar(); }
});

test("CÓDIGO POR CORREO: la respuesta es la misma si no coincide (no se averigua nada) y no se manda correo; sin correo en la ficha, o si el correo falla, lo ve la oficina", async () => {
  const m = await montar({ conCorreo: true });
  try {
    const bien = await pedir(m);
    for (const [nif, emp] of [["99999999R", "Bar La Plaza"], ["12345678Z", "Otro Negocio Distinto"]]) { const r = await pedir(m, nif, emp); assert.deepEqual(Object.keys(r.json).sort(), Object.keys(bien.json).sort()); assert.equal(r.json.mensaje, bien.json.mensaje); }
    await new Promise((ok) => setTimeout(ok, 30)); assert.equal(m.correos.length, 1, "solo al cliente real");
    // «Necesito ayuda»: pasa a la oficina
    assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 0);
    assert.equal((await m.post("/api/acceso/oficina/ayuda", { solicitud: bien.json.solicitud })).status, 200);
    const p = m.accounts.accesoSolicitudes().pendientes; assert.equal(p.length, 1); assert.equal(p[0].motivo, "Pidió ayuda");
    assert.equal((await m.post("/api/acceso/oficina/ayuda", { solicitud: "corto" })).status, 400);
    assert.equal((await m.post("/api/acceso/oficina/ayuda", { solicitud: "x".repeat(43) })).status, 200, "un secreto inventado no dice nada");
  } finally { m.cerrar(); }
  // cliente SIN correo en su ficha → lo ve la oficina directamente
  const sin = await montar({ conCorreo: true });
  try {
    const r = await pedir(sin, "65432199A", "Local Uno"); assert.equal(r.status, 200); // C2 y C3 comparten NIF; el nombre decide
    await new Promise((ok) => setTimeout(ok, 30)); assert.equal(sin.correos.length, 0); const p = sin.accounts.accesoSolicitudes().pendientes; assert.equal(p.length, 1); assert.equal(p[0].motivo, "No tiene correo en su ficha");
  } finally { sin.cerrar(); }
  // el correo falla → la oficina lo ve
  const roto = await montar({ conCorreo: true, falloCorreo: true });
  try { await pedir(roto); await new Promise((ok) => setTimeout(ok, 50)); const p = roto.accounts.accesoSolicitudes().pendientes; assert.equal(p.length, 1); assert.equal(p[0].motivo, "No se pudo enviar el correo"); } finally { roto.cerrar(); }
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

test("pantalla del cliente: nombre + NIF (no se escribe ningún correo), sin manejadores en línea; panel de la empresa con aprobar / código / rechazar", () => {
  const h = leer("./cliente.html"), e = leer("./empresa.html"), a = leer("./admin.js"), db = leer("./cuentas-db.js");
  const tarjeta = h.slice(h.indexOf('id="f-correo"'), h.indexOf('id="f-acceso"'));
  for (const t of ['id="co-emp"', 'id="co-nif"', 'id="co-cod"', 'id="co-ref"', "Enviarme el código", 'id="co-pedir-ayuda"', 'id="co-reenviar"', 'autocomplete="one-time-code"']) assert.ok(tarjeta.includes(t), t);
  assert.ok(!tarjeta.includes('id="co-mail"') && !/correo electrónico/i.test(tarjeta), "ya no se pide correo para entrar");
  assert.doesNotMatch(tarjeta, /\son[a-z]+=/i);
  for (const t of ["/api/acceso/oficina/pedir", "/api/acceso/oficina/estado", "/api/acceso/oficina/ayuda"]) assert.ok(h.includes(t), t);
  assert.ok(!h.includes("/api/acceso/correo/"), "el acceso por correo se quitó");
  for (const t of ['id="acc-panel"', 'id="acc-banner"', "Dejarle entrar", "Dar un código", "Rechazar", "Número de comprobación", "/api/admin/accesos"]) assert.ok(e.includes(t), t);
  assert.doesNotMatch(e, /onclick="/, "la política de scripts no deja manejadores en línea");
  assert.match(a, /accesos\\\/\(\\d\+\)\\\/\(aprobar\|rechazar\|codigo\)/); assert.match(db, /DELETE FROM acceso_solicitudes WHERE customer_id = \?/);
});
