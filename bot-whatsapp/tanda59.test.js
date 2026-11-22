// Entrar con nombre + NIF + CONTRASEÑA: la primera vez la crea el cliente, después la escribe; el aparato queda recordado; la oficina ve las activaciones y puede restablecer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function montar(env = {}) {
  const accounts = openAccountsDb(":memory:"), avisos = [];
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: [] }, C2: { id: "C2", name: "LOCAL UNO", emails: [] }, C3: { id: "C3", name: "LOCAL DOS", emails: [] } };
  const porNif = { 123456: ["C1"], 654321: ["C2", "C3"] };
  const quita = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const customers = { findByNif: (t) => [...new Set(nifCodes(t).flatMap((c) => porNif[c] ?? []))], getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null,
    nameMatches: (c, typed) => !!c && quita(typed).length >= 2 && quita(c.name).includes(quita(typed)), matchRegistration: () => ({ customer: null, reason: "nombre" }) };
  Object.assign(process.env, { PW_IP_LIMIT: "100", LOGIN_LIMIT: "1000", PW_CREAR_IP_LIMIT: "100", ...env });
  const auth = createAuth({ accounts, customers, onCodigo: (a) => avisos.push(a.customerId) });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  return { accounts, avisos, port, post, get, cerrar: () => { srv.close(); for (const k of Object.keys(env)) delete process.env[k]; } };
}
const entrar = (m, password, extra = {}, cab = {}) => m.post("/api/acceso/pw/entrar", { empresa: "Bar La Plaza", nif: "12345678Z", password, t: 5000, ...extra }, cab);
const crear = (m, password, extra = {}, cab = {}) => m.post("/api/acceso/pw/crear", { empresa: "Bar La Plaza", nif: "12345678Z", password, password2: password, t: 5000, ...extra }, cab);
const cookies = (r) => r.cab.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("primera vez: entrar dice «crea tu contraseña»; al crearla entra, queda recordado y la oficina lo ve; después entra con ella", async () => {
  const m = await montar();
  try {
    const a = await entrar(m, "loquesea1"); assert.equal(a.status, 409); assert.equal(a.json.necesitaCrear, true);
    const c = await crear(m, "Mesa-Verde-42"); assert.equal(c.status, 200); assert.equal(c.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal(c.cab.getSetCookie().length, 3, "sesión + aparato recordado + quitar la marca de «salió a propósito»");
    assert.equal((await m.get("/api/yo", { Cookie: cookies(c) })).json.cliente.tienePassword, true);
    const lista = m.accounts.accesosNuevos(); assert.equal(lista.length, 1); assert.equal(lista[0].customerId, "C1"); assert.equal(lista[0].tipo, "primera");
    assert.equal(m.avisos.includes("C1"), true, "se avisa al móvil del cliente (si lo tiene)");
    assert.equal(JSON.stringify(m.accounts.accesosNuevos()).includes("Mesa-Verde-42"), false);
    const e = await entrar(m, "Mesa-Verde-42"); assert.equal(e.status, 200); assert.equal(e.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal((await entrar(m, "mesa-verde-42")).status, 401, "mayúsculas y minúsculas SÍ cuentan");
    // una vez creada, nadie más puede «crearla» encima
    const otra = await crear(m, "Otra-Clave-77"); assert.equal(otra.status, 409); assert.equal((await entrar(m, "Mesa-Verde-42")).status, 200);
  } finally { m.cerrar(); }
});

test("seguridad de la contraseña: scrypt, nada en claro, y no vale el NIF, el nombre ni las típicas", async () => {
  const m = await montar();
  try {
    for (const [p, re] of [["corta1", /al menos 8/], ["12345678", /demasiado fácil/], ["aaaaaaaaa", /demasiado fácil/], ["12345678Z", /NIF/], ["xx123456xx", /NIF/], ["BarLaPlaza", /NIF ni el nombre/], ["x".repeat(65), /demasiado larga/]]) { const r = await crear(m, p); assert.equal(r.status, 400, p); assert.match(r.json.error, re, p); }
    assert.equal((await crear(m, "Mesa-Verde-42", { password2: "otra-cosa-99" })).status, 400);
    assert.equal(m.accounts.passwordTiene("C1"), false, "nada de lo rechazado se guardó");
    assert.equal((await crear(m, "Mesa-Verde-42")).status, 200);
    const fila = m.accounts.listAccounts?.() && JSON.stringify(m.accounts.listAccounts()); assert.equal(fila.includes("Mesa-Verde-42"), false);
  } finally { m.cerrar(); }
  const src = leer("./cuentas-db.js"); assert.match(src, /pw_hash = \?, pw_at = \?, failed = 0 WHERE id = \? AND pw_hash IS NULL/); assert.match(src, /hashPin\(String\(plain\)\)/);
});

test("no se averigua nada: datos que no coinciden dan siempre el mismo error y ninguna contraseña se crea", async () => {
  const m = await montar();
  try {
    await crear(m, "Mesa-Verde-42");
    const casos = [{ nif: "99999999R" }, { nif: "65432199A", empresa: "Local" } /* dos clientes con esos dígitos y una palabra que encaja con ambos */, { nif: "65432199A", empresa: "" }];
    const base = await entrar(m, "mala-clave-1");
    for (const extra of casos) { const r = await entrar(m, "mala-clave-1", extra); assert.equal(r.status, 401); assert.deepEqual(r.json, base.json); }
    for (const extra of casos) { const r = await crear(m, "Clave-Nueva-55", extra); assert.ok([409].includes(r.status), JSON.stringify(extra)); assert.equal(r.cab.getSetCookie().length, 0); }
    assert.equal(m.accounts.passwordTiene("C2"), false); assert.equal(m.accounts.passwordTiene("C3"), false);
  } finally { m.cerrar(); }
});

test("EL NOMBRE ES SECUNDARIO: lo que identifica al cliente son los 6 dígitos del NIF; vale cualquier nombre (o ninguno) y solo desempata cuando varios comparten esos dígitos", async () => {
  const m = await montar();
  try {
    // un solo cliente con esos dígitos: da igual lo que se escriba como nombre
    for (const emp of ["Plaza", "plaza", "bar plaza", "PLAZA SL", "Alegría", "", "lo que sea"]) { const r = await entrar(m, "mala-clave-1", { empresa: emp }); assert.notEqual(r.json.error?.match?.(/Los datos no son correctos/) ? "no" : "si", "no", "«" + emp + "»: el NIF identifica al cliente (debe pedir crear la contraseña, no decir que no existe)"); assert.equal(r.status, 409, emp); assert.equal(r.json.necesitaCrear, true); }
    const c = await crear(m, "Mesa-Verde-42", { empresa: "otra cosa", nif: "123456" }); assert.equal(c.status, 200); assert.equal(c.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal((await entrar(m, "Mesa-Verde-42", { empresa: "", nif: "123456" })).status, 200);
    // varios clientes con los mismos dígitos: el nombre (una palabra, sin tildes ni mayúsculas) desempata
    assert.equal((await entrar(m, "x1y2z3w4", { nif: "654321", empresa: "uno" })).json.necesitaCrear, true);
    assert.equal(m.accounts.passwordTiene("C2"), false);
    assert.equal((await crear(m, "Clave-Local-77", { nif: "654321", empresa: "BAR LOCAL UNO" })).status, 200); assert.equal(m.accounts.passwordTiene("C2"), true); assert.equal(m.accounts.passwordTiene("C3"), false);
    assert.equal((await crear(m, "Clave-Local-88", { nif: "654321", empresa: "dos" })).status, 200); assert.equal(m.accounts.passwordTiene("C3"), true);
    assert.equal((await entrar(m, "Clave-Local-77", { nif: "654321", empresa: "uno" })).status, 200);
    assert.equal((await entrar(m, "Clave-Local-77", { nif: "654321", empresa: "dos" })).status, 401, "con la palabra del otro local, la contraseña del primero no vale");
    assert.equal((await entrar(m, "Clave-Local-77", { nif: "654321", empresa: "" })).status, 401, "sin nombre no se sabe cuál de los dos");
  } finally { m.cerrar(); }
  const h = leer("./cliente.html"), t = h.slice(h.indexOf('id="f-pw"'), h.indexOf('id="f-correo"'));
  assert.ok(t.includes("basta con una palabra"));
  const js = h.slice(h.indexOf("// ── Entrar con nombre + NIF + contraseña"), h.indexOf("// ── Cambiar mi contraseña"));
  assert.ok(!/Escribe el nombre de tu empresa/.test(js), "el nombre ya no es obligatorio en la pantalla");
});

test("fuerza bruta: 5 fallos bloquean la cuenta 15 min (y la contraseña buena tampoco entra); tope por dirección", async () => {
  const m = await montar();
  try {
    await crear(m, "Mesa-Verde-42");
    for (let i = 0; i < 5; i++) assert.equal((await entrar(m, "mala-clave-" + i)).status, 401);
    const b = await entrar(m, "Mesa-Verde-42"); assert.equal(b.status, 401); assert.match(b.json.error, /bloqueada temporalmente/);
  } finally { m.cerrar(); }
  const m2 = await montar({ PW_IP_LIMIT: "3" });
  try { for (let i = 0; i < 3; i++) assert.equal((await entrar(m2, "x" + i, { nif: "99999999R" })).status, 401); assert.equal((await entrar(m2, "otra", { nif: "99999999R" })).status, 429); } finally { m2.cerrar(); }
  const m3 = await montar({ PW_CREAR_IP_LIMIT: "2" });
  try { for (let i = 0; i < 2; i++) await crear(m3, "Mesa-Verde-4" + i, { nif: "99999999R" }); assert.equal((await crear(m3, "Mesa-Verde-49", { nif: "99999999R" })).status, 429); } finally { m3.cerrar(); }
});

test("contra bots: campo trampa y enviar demasiado rápido (o sin decirlo) fallan como un error normal y no crean nada", async () => {
  const m = await montar();
  try {
    for (const extra of [{ sitio_web: "http://spam" }, { t: 100 }, { t: undefined }]) { assert.equal((await crear(m, "Mesa-Verde-42", extra)).status, 401); assert.equal((await entrar(m, "Mesa-Verde-42", extra)).status, 401); }
    assert.equal(m.accounts.passwordTiene("C1"), false);
    assert.equal((await crear(m, "Mesa-Verde-42")).status, 200);
  } finally { m.cerrar(); }
});

test("la oficina restablece: se borra la contraseña, las sesiones y los aparatos, y el cliente crea otra; cambiar la contraseña dentro de la app", async () => {
  const m = await montar();
  try {
    const c = await crear(m, "Mesa-Verde-42"), ck = cookies(c);
    // cambiar dentro de la aplicación: pide la actual y valida la nueva
    assert.equal((await m.post("/api/password", { actual: "mala", nueva: "Nueva-Clave-88", nueva2: "Nueva-Clave-88" }, { Cookie: ck })).status, 401);
    assert.equal((await m.post("/api/password", { actual: "Mesa-Verde-42", nueva: "corta" }, { Cookie: ck })).status, 400);
    assert.equal((await m.post("/api/password", { actual: "Mesa-Verde-42", nueva: "Nueva-Clave-88", nueva2: "Nueva-Clave-88" }, { Cookie: ck })).status, 200);
    assert.equal((await entrar(m, "Mesa-Verde-42")).status, 401); assert.equal((await entrar(m, "Nueva-Clave-88")).status, 200);
    assert.equal((await m.post("/api/password", { nueva: "Otra-Mas-99" })).status, 401, "sin sesión no se puede");
    // la oficina restablece
    assert.equal(m.accounts.passwordQuitar("C1"), true);
    assert.equal((await m.get("/api/yo", { Cookie: ck })).json.cliente, null, "las sesiones y los aparatos se cerraron");
    assert.equal(m.accounts.aparatosDe("C1").length, 0);
    assert.equal((await entrar(m, "Nueva-Clave-88")).json.necesitaCrear, true);
    assert.equal((await crear(m, "Tercera-Clave-11")).status, 200);
    assert.deepEqual(m.accounts.accesosNuevos().map((x) => x.tipo), ["primera", "restablecida", "primera"]);
  } finally { m.cerrar(); }
});

test("ACCESO_MODO=oficina apaga la contraseña; el acceso con solo el NIF sigue cerrado; ficha, panel y pantalla", async () => {
  const m = await montar({ ACCESO_MODO: "oficina" });
  try { assert.equal((await crear(m, "Mesa-Verde-42")).status, 503); assert.equal((await m.get("/api/seguridad")).json.accesoPassword, false); } finally { m.cerrar(); }
  const m2 = await montar();
  try { assert.equal((await m2.get("/api/seguridad")).json.accesoPassword, true); assert.equal((await m2.post("/api/acceso", { nif: "123456" })).status, 403); } finally { m2.cerrar(); }
  const h = leer("./cliente.html"), e = leer("./empresa.html"), a = leer("./admin.js"), db = leer("./cuentas-db.js");
  const tarjeta = h.slice(h.indexOf('id="f-pw"'), h.indexOf('id="f-correo"'));
  for (const t of ['id="pw-emp"', 'id="pw-nif"', 'id="pw-pass"', 'id="pw-pass2"', 'name="sitio_web"', 'autocomplete="new-password"', "Es tu primera vez"]) assert.ok(tarjeta.includes(t), t);
  assert.doesNotMatch(tarjeta, /\son[a-z]+=/i); assert.doesNotMatch(tarjeta, /correo electrónico/i);
  for (const t of ["/api/acceso/pw/entrar", "/api/acceso/pw/crear", "/api/password", 'id="f-pass"', 'id="cambiar-pw"']) assert.ok(h.includes(t), t);
  for (const t of ['id="nuevos-panel"', "Restablecer", "/api/admin/accesos-nuevos", "password/restablecer"]) assert.ok(e.includes(t), t);
  assert.match(a, /password\\\/restablecer/); assert.match(db, /DELETE FROM accesos_nuevos WHERE customer_id = \?/); assert.match(db, /UPDATE accounts SET pw_hash = NULL, pw_at = NULL, totp_enc = NULL/);
});

test("TOPES DE PEDIDOS: por cliente y hora, por cliente y día, en total en 10 minutos, y un máximo de líneas por pedido", async () => {
  const { webOrderFromBody } = await import("./weborder.js");
  const catalogo = Array.from({ length: 250 }, (_, i) => ({ id: String(1000 + i), name: "ARTICULO " + i, price: 1, vat: 10, unitsPerBox: 1 }));
  const cliente = { id: "C1", name: "BAR LA PLAZA S.L.", address: "Calle 1, Medina", phone: "600000000" };
  const pedido = (n) => webOrderFromBody({ lines: catalogo.slice(0, n).map((p) => ({ id: p.id, qty: 1 })), deliveryDate: "2026-11-20" }, cliente, { key: "k-1234567", phone: "600000000" }, catalogo);
  assert.ok(!pedido(200).error || !/demasiadas líneas/.test(pedido(200).error), "200 líneas sí");
  assert.match(pedido(201).error ?? "", /demasiadas líneas \(máximo 200\)/, "201 no");
  const s = leer("./server.js");
  for (const t of ["PEDIDOS_DIA_LIMIT", "PEDIDOS_GLOBAL_LIMIT", "const topePedidos = (cuentaId", "demasiados-pedidos-dia", "pedidos-tope-global"]) assert.ok(s.includes(t), t);
  assert.equal((s.match(/topePedidos\(account\.id/g) ?? []).length, 2, "lo usan el catálogo y el chat");
});

test("el NIF se puede escribir con letras y números; se mandan solo los 6 primeros números", async () => {
  const h = leer("./cliente.html"), tarjeta = h.slice(h.indexOf('id="f-pw"'), h.indexOf('id="f-correo"'));
  for (const t of ["Tu DNI, NIE o CIF", 'inputmode="text"', 'autocapitalize="characters"', 'id="pw-aviso"']) assert.ok(tarjeta.includes(t), t); assert.ok(!tarjeta.includes('id="pw-nif" type="text" inputmode="numeric"')); // ya no es un teclado solo de números
  assert.match(h, /const nif6 = \(\) => \$\("pw-nif"\)\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/); assert.match(h, /nif: nif6\(\), password/);
  // el servidor reconoce al cliente solo con esos 6 dígitos, y la contraseña no puede contenerlos
  const m = await montar();
  try {
    const c = await crear(m, "Mesa-Verde-42", { nif: "123456" }); assert.equal(c.status, 200); assert.equal(c.json.cliente.nombre, "BAR LA PLAZA S.L.");
    assert.equal((await entrar(m, "Mesa-Verde-42", { nif: "123456" })).status, 200);
    const m2 = await montar(); try { assert.match((await crear(m2, "abc123456xyz", { nif: "123456" })).json.error, /NIF/); } finally { m2.cerrar(); }
  } finally { m.cerrar(); }
});
