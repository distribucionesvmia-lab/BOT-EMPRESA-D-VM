// Pausa de emergencia y «Revisión de seguridad» del panel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { leerPausa, guardarPausa, TEXTO_PAUSA_ENTRADAS } from "./pausa.js";
import { revisar, estadoCliente } from "./revision-seguridad.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("pausa: se guarda en la base compartida, cada cambio es independiente y se puede reabrir", () => {
  const a = openAccountsDb(":memory:");
  assert.deepEqual(leerPausa(a, { fresco: true }), { entradas: false, pedidos: false, desde: null, motivo: "" });
  const v = guardarPausa(a, { entradas: true, motivo: "ataque de prueba" }, { now: "2026-11-16T10:00:00.000Z" });
  assert.equal(v.entradas, true); assert.equal(v.pedidos, false); assert.equal(v.desde, "2026-11-16T10:00:00.000Z"); assert.equal(v.motivo, "ataque de prueba");
  const w = guardarPausa(a, { pedidos: true }, { now: "2026-11-16T10:05:00.000Z" }); assert.equal(w.entradas, true, "lo que no se dice se deja como estaba"); assert.equal(w.pedidos, true); assert.equal(w.desde, "2026-11-16T10:00:00.000Z", "«desde» es de cuando empezó la primera pausa");
  const x = guardarPausa(a, { entradas: false, pedidos: false }); assert.deepEqual(x, { entradas: false, pedidos: false, desde: null, motivo: "" });
});

async function montar() {
  const accounts = openAccountsDb(":memory:");
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: [] } };
  const customers = { findByNif: (t) => (nifCodes(t).includes("123456") ? ["C1"] : []), getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null, nameMatches: () => true, matchRegistration: () => ({ customer: null }) };
  Object.assign(process.env, { PW_IP_LIMIT: "100", LOGIN_LIMIT: "1000", PW_CREAR_IP_LIMIT: "100" });
  const auth = createAuth({ accounts, customers });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  const get = async (ruta, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { headers: cab }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  return { accounts, post, get, cerrar: () => srv.close() };
}
const crear = (m, extra = {}) => m.post("/api/acceso/pw/crear", { empresa: "", nif: "123456", password: "Mesa-Verde-42", password2: "Mesa-Verde-42", t: 5000, ...extra });

test("pausa de ENTRADAS: nadie nuevo entra (ni con contraseña, ni por la oficina, ni reabriendo la sesión con el aparato); los que ya están dentro siguen", async () => {
  const m = await montar();
  try {
    const c = await crear(m); assert.equal(c.status, 200);
    const ck = c.cab.getSetCookie().map((x) => x.split(";")[0]), sesion = ck.join("; "), soloAparato = ck.find((x) => x.startsWith("vm_aparato="));
    guardarPausa(m.accounts, { entradas: true }); // (la memoria de 3 s se salta porque guardarPausa la limpia)
    for (const [ruta, cuerpo] of [["/api/acceso/pw/entrar", { empresa: "", nif: "123456", password: "Mesa-Verde-42", t: 5000 }], ["/api/acceso/pw/crear", { empresa: "", nif: "123456", password: "Otra-Clave-77", t: 5000 }], ["/api/acceso/oficina/pedir", { empresa: "Bar", nif: "123456", t: 5000 }], ["/api/acceso", { nif: "123456" }]]) {
      const r = await m.post(ruta, cuerpo); assert.equal(r.status, 503, ruta); assert.equal(r.json.error, TEXTO_PAUSA_ENTRADAS); assert.equal(r.json.pausa, true);
    }
    assert.equal((await m.get("/api/yo", { Cookie: sesion })).json.cliente?.nombre, "BAR LA PLAZA S.L.", "quien ya estaba dentro sigue dentro");
    assert.equal((await m.get("/api/yo", { Cookie: soloAparato })).json.cliente, null, "con solo el aparato recordado, la sesión no se reabre sola en pausa");
    assert.equal((await m.get("/api/seguridad")).status, 200, "la pantalla puede seguir cargando");
    guardarPausa(m.accounts, { entradas: false });
    assert.equal((await m.post("/api/acceso/pw/entrar", { empresa: "", nif: "123456", password: "Mesa-Verde-42", t: 5000 })).status, 200, "reabierto, todo vuelve");
    assert.equal((await m.get("/api/yo", { Cookie: soloAparato })).json.cliente?.nombre, "BAR LA PLAZA S.L.");
  } finally { m.cerrar(); }
});

test("pausa de PEDIDOS y panel: el servidor la aplica al catálogo y al chat; el panel la cambia con confirmación y avisa", () => {
  const s = leer("./server.js"), a = leer("./admin.js"), e = leer("./empresa.html");
  assert.match(s, /if \(leerPausa\(getAccountsDb\(\)\)\.pedidos\) return TEXTO_PAUSA_PEDIDOS/); assert.equal((s.match(/topePedidos\(account\.id/g) ?? []).length, 2, "catálogo y chat pasan por el mismo tope");
  assert.match(a, /p === "\/api\/admin\/pausa" && post/); assert.match(a, /confirmo !== true/); assert.match(a, /eventoSeguridad\("pausa-de-emergencia"/);
  for (const t of ['id="pausa-panel"', 'id="pausa-banner"', "Pausar entradas nuevas", "Pausar pedidos", "Los clientes que ya están dentro siguen", 'id="rev-panel"', "revisionSeguridad"]) assert.ok(e.includes(t), t);
  assert.doesNotMatch(e, /\son[a-z]+="/, "sin manejadores en línea (política de scripts)");
});

test("REVISIÓN DE SEGURIDAD: lo mal puesto sale en rojo con qué hacer, lo bien puesto en verde, y nunca lleva claves", () => {
  const ahora = Date.parse("2026-11-16T12:00:00Z"), cli = (x = {}) => ({ ...estadoCliente({ PUBLIC_URL: "https://pedidos.ejemplo.es", TRUST_PROXY: "1", HSTS: "1" }, { turnstile: true, smtp: true }, "2026-11-16T11:55:00Z"), ...x });
  const copiasOk = { ok: true, problemas: [] };
  const bien = revisar({ cliente: cli(), env: { ADMIN_TOKEN: "Abc9Xk2LmQ7ZpR4tVw8Y", BACKUP_DIR2: "E:\\copias" }, copias: copiasOk, ahora });
  assert.equal(bien.resumen.mal, 0); assert.equal(bien.resumen.aviso, 0); assert.ok(bien.resumen.ok >= 8);
  const por = (r, id) => r.lista.find((x) => x.id === id);
  const mal = revisar({ cliente: cli({ https: false, legacyAbierto: true, turnstile: false, trustProxy: false }), env: { ADMIN_TOKEN: "corta", PANEL_PERMITIR_PUBLICO: "1" }, copias: { ok: false, problemas: ["Pedidos: no hay ninguna copia."] }, eventos24h: { total: 25, porTipo: [{ tipo: "pw-muchos-intentos", n: 25 }] }, bloqueadas: 2, accesosNuevos7: 3, pausa: { pedidos: true }, ahora });
  for (const id of ["clave-panel", "panel-privado", "https", "legacy", "copias"]) assert.equal(por(mal, id).nivel, "mal", id);
  for (const id of ["turnstile", "copias-2", "hechos", "pausa"]) assert.equal(por(mal, id).nivel, "aviso", id);
  assert.match(por(mal, "clave-panel").arreglo, /ADMIN_TOKEN/); assert.match(por(mal, "turnstile").arreglo, /TURNSTILE_SITE/); assert.match(por(mal, "hechos").detalle, /pw-muchos-intentos: 25/);
  assert.equal(revisar({ cliente: null, env: {}, ahora }).lista.find((x) => x.id === "cliente-estado").nivel, "aviso", "sin señales de la app de clientes");
  assert.equal(revisar({ cliente: cli({ at: "2026-11-16T10:00:00Z" }), env: {}, ahora }).lista.some((x) => x.id === "cliente-estado"), true, "datos de hace más de 30 minutos");
  assert.deepEqual(bien.lista.filter((x) => x.nivel === "manual").map((x) => x.id), ["github-2fa", "bitlocker", "usb", "windows", "dobles"]);
  assert.equal(JSON.stringify(estadoCliente({ PUBLIC_URL: "https://x.es", ADMIN_TOKEN: "SECRETA-123", SMTP_PASS: "otra-secreta", NIF_PEPPER: "pimienta", TURNSTILE_SECRET: "ts" })).match(/SECRETA|otra-secreta|pimienta|"ts"/), null, "el resumen del cliente no lleva ninguna clave");
  assert.match(leer("./server.js"), /ajusteGuardar\("estado_cliente"/); assert.match(leer("./admin.js"), /\/api\/admin\/seguridad\/revision/);
});
