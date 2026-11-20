// Filtro por país en local (lista de rangos de IP de España, sin servicios externos): conexión desde fuera → más límites y «pase» de la oficina para aparatos nuevos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openAccountsDb } from "./cuentas-db.js";
import { createAuth } from "./auth.js";
import { nifCodes } from "./nif-codes.js";
import { crearGeo, geoPrograma, reiniciarGeo, modoGeo, resumenGeo } from "./geoip.js";
import { revisar, estadoCliente } from "./revision-seguridad.js";
import { libre } from "./puerto-libre.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const ES = "2.56.64.10", FUERA = "8.8.8.8", FUERA2 = "1.1.1.1";

test("geoip: reconoce España, fuera y redes internas (IPv4, IPv6 e IPv4 dentro de IPv6) y no se lía con basura", () => {
  reiniciarGeo(); const g = geoPrograma(); assert.ok(g && g.rangos > 3000, "la lista del programa carga"); assert.match(g.fecha, /^\d{4}-\d{2}-\d{2}$/);
  for (const [ip, c] of [[ES, "ES"], [FUERA, "fuera"], ["192.168.1.5", "local"], ["10.0.0.1", "local"], ["127.0.0.1", "local"], ["100.101.2.3", "local"], ["::1", "local"], ["fe80::1", "local"], ["::ffff:2.56.64.9", "ES"], ["::ffff:8.8.8.8", "fuera"], ["2a00:1450:4001::1", "fuera"], ["", "sin-dato"], ["?", "sin-dato"], ["no-es-una-ip", "sin-dato"], ["999.1.1.1", "sin-dato"], ["1.2.3", "sin-dato"]]) assert.equal(g.clase(ip), c, ip);
  const mini = crearGeo("# prueba\n5.5.5.0/24\n6.0.0.0/8\n", "2001:db8::/32\n");
  assert.equal(mini.clase("5.5.5.255"), "ES"); assert.equal(mini.clase("5.5.6.0"), "fuera"); assert.equal(mini.clase("6.200.1.1"), "ES"); assert.equal(mini.clase("2001:db8:ffff::1"), "ES"); assert.equal(mini.clase("2001:db9::1"), "fuera");
});

test("geoip: sin lista (o con una lista rota) el filtro se apaga solo y nunca bloquea a nadie", () => {
  const antes = process.env.GEO_DIR; process.env.GEO_DIR = "/ruta/que/no/existe"; reiniciarGeo();
  try { assert.equal(modoGeo(), "off"); assert.equal(resumenGeo().lista, false); } finally { if (antes === undefined) delete process.env.GEO_DIR; else process.env.GEO_DIR = antes; reiniciarGeo(); }
});

async function montar(env = {}) {
  const accounts = openAccountsDb(":memory:");
  const fichas = { C1: { id: "C1", name: "BAR LA PLAZA S.L.", emails: [] } };
  const customers = { findByNif: (t) => (nifCodes(t).includes("123456") ? ["C1"] : []), getById: (id) => fichas[id] ?? null, candidates: () => [], getByPhone: () => null, nameMatches: () => true, matchRegistration: () => ({ customer: null }) };
  Object.assign(process.env, { PW_IP_LIMIT: "100", LOGIN_LIMIT: "1000", PW_CREAR_IP_LIMIT: "100", OFICINA_ESPERA_S: "0", GEO_FUERA_LIMIT: "50", GEO_MODO: "aprobar", ...env }); reiniciarGeo();
  const auth = createAuth({ accounts, customers, trustProxy: true });
  const srv = http.createServer(async (req, res) => { if (!(await auth.route(req, res, new URL(req.url, "http://x")))) res.writeHead(404).end(); });
  const port = await libre(); await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const post = async (ruta, cuerpo, ip = ES, cab = {}) => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, ...cab }, body: JSON.stringify(cuerpo) }); return { status: r.status, json: await r.json().catch(() => ({})), cab: r.headers }; };
  return { accounts, post, cerrar: () => { srv.close(); for (const k of Object.keys(env)) delete process.env[k]; delete process.env.OFICINA_ESPERA_S; delete process.env.GEO_FUERA_LIMIT; delete process.env.GEO_MODO; } };
}
const entrar = (m, ip, extra = {}, cab = {}) => m.post("/api/acceso/pw/entrar", { empresa: "", nif: "123456", password: "Mesa-Verde-42", t: 5000, ...extra }, ip, cab);
const crear = (m, ip, extra = {}, cab = {}) => m.post("/api/acceso/pw/crear", { empresa: "", nif: "123456", password: "Mesa-Verde-42", password2: "Mesa-Verde-42", t: 5000, ...extra }, ip, cab);
const pase = (m, solicitud, ip = FUERA) => m.post("/api/acceso/pw/pase", { solicitud }, ip);
const galletas = (r) => r.cab.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("desde fuera de España con un aparato nuevo: la oficina da un «pase»; el pase NO abre sesión (hace falta la contraseña) y vale una sola vez", async () => {
  const m = await montar();
  try {
    // desde España todo como siempre
    assert.equal((await crear(m, ES)).status, 200);
    // fuera: sin pase → 403, se avisa a la oficina y no se mira la contraseña
    const a = await entrar(m, FUERA); assert.equal(a.status, 403); assert.equal(a.json.necesitaPase, true); assert.match(a.json.ref, /^\d{4}$/); assert.ok(a.json.solicitud.length >= 40);
    const lista = m.accounts.accesoSolicitudes().pendientes; assert.equal(lista.length, 1); assert.equal(lista[0].pase, true); assert.equal(lista[0].motivo, "Desde fuera de España"); assert.equal(lista[0].ref, a.json.ref);
    assert.equal((await pase(m, a.json.solicitud)).json.estado, "pendiente");
    // volver a pulsar «Entrar» mientras espera no crea otra solicitud ni cambia el número
    const b = await entrar(m, FUERA, { pase: a.json.solicitud }); assert.equal(b.status, 403); assert.equal(b.json.solicitud, a.json.solicitud); assert.equal(b.json.pendiente, true); assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 1);
    // la oficina da paso
    assert.equal(m.accounts.accesoSolicitudResolver(lista[0].id, "aprobada"), true);
    assert.equal((await pase(m, a.json.solicitud)).json.estado, "aprobada");
    // el pase NO abre sesión por sí solo (ni por la vía de la oficina, ni por código)
    const trampa = await m.post("/api/acceso/oficina/estado", { solicitud: a.json.solicitud }, FUERA); assert.equal(trampa.cab.getSetCookie().length, 0, "el pase no se canjea por una sesión"); assert.notEqual(trampa.json.estado, "entra");
    assert.equal(m.accounts.accesoSolicitudCodigo(lista[0].id, "x"), false, "ya no está pendiente");
    // con el pase y SIN contraseña buena no entra; con la buena sí
    assert.equal((await entrar(m, FUERA, { pase: a.json.solicitud, password: "mala-clave-1" })).status, 401);
    const ok = await entrar(m, FUERA, { pase: a.json.solicitud }); assert.equal(ok.status, 200); assert.equal(ok.json.cliente.nombre, "BAR LA PLAZA S.L."); assert.equal(ok.cab.getSetCookie().length, 3);
    // el pase se gastó: otro aparato nuevo con el mismo pase vuelve a necesitar paso
    assert.equal((await entrar(m, FUERA, { pase: a.json.solicitud })).status, 403);
    // el aparato recordado de ESE cliente puede entrar desde fuera sin pase (está de viaje)
    const apa = ok.cab.getSetCookie().find((c) => c.startsWith("vm_aparato=")).split(";")[0];
    assert.equal((await entrar(m, FUERA2, {}, { Cookie: apa })).status, 200);
  } finally { m.cerrar(); }
});

test("desde fuera también para CREAR la contraseña; la respuesta es igual si el cliente no existe; y no hay forma de adivinar nada", async () => {
  const m = await montar();
  try {
    const c = await crear(m, FUERA); assert.equal(c.status, 403); assert.equal(c.json.necesitaPase, true); assert.equal(m.accounts.passwordTiene("C1"), false);
    const falso = await crear(m, FUERA, { nif: "999999" }); assert.equal(falso.status, 403); assert.deepEqual(Object.keys(falso.json).sort(), Object.keys(c.json).sort()); assert.equal(falso.json.error, c.json.error);
    assert.equal(m.accounts.accesoSolicitudes().pendientes.length, 1, "solo el cliente real llegó a la oficina");
    assert.equal((await pase(m, falso.json.solicitud)).json.estado, "pendiente", "un pase inventado se ve como «pendiente» siempre");
    assert.equal((await pase(m, "x".repeat(43))).json.estado, "pendiente"); assert.equal((await m.post("/api/acceso/pw/pase", { solicitud: "corto" }, FUERA)).status, 400);
    m.accounts.accesoSolicitudResolver(m.accounts.accesoSolicitudes().pendientes[0].id, "aprobada");
    assert.equal((await crear(m, FUERA, { pase: c.json.solicitud })).status, 200); assert.equal(m.accounts.passwordTiene("C1"), true);
    // un pase de OTRO cliente (o rechazado) no vale
    const r = await entrar(m, "9.9.9.9"); assert.equal(r.status, 403); m.accounts.accesoSolicitudResolver(m.accounts.accesoSolicitudes().pendientes[0].id, "rechazada");
    assert.equal((await pase(m, r.json.solicitud, "9.9.9.9")).json.estado, "rechazada"); assert.equal((await entrar(m, "9.9.9.9", { pase: r.json.solicitud })).status, 403);
  } finally { m.cerrar(); }
});

test("límites más estrictos desde fuera, modo «vigilar» (solo anota) y filtro apagado", async () => {
  const m = await montar({ GEO_FUERA_LIMIT: "2" });
  try { assert.equal((await entrar(m, FUERA)).status, 403); assert.equal((await entrar(m, FUERA)).status, 403); assert.equal((await entrar(m, FUERA)).status, 429, "el 3.º intento desde fuera en 10 min"); assert.equal((await crear(m, ES)).status, 200, "desde España no cuenta"); } finally { m.cerrar(); }
  const v = await montar({ GEO_MODO: "vigilar" });
  try { assert.equal((await crear(v, FUERA)).status, 200, "en modo vigilar no se pide pase"); assert.equal(v.accounts.accesoSolicitudes().pendientes.length, 0, "en modo vigilar la oficina no recibe pases"); assert.equal(resumenGeo().fuera, 1, "pero se cuenta"); } finally { v.cerrar(); }
  const o = await montar({ GEO_MODO: "off" });
  try { assert.equal((await crear(o, FUERA)).status, 200); assert.equal(resumenGeo().fuera, 0, "apagado: ni cuenta"); } finally { o.cerrar(); }
});

test("el panel enseña «Dar paso» (sin código) para los pases, el programa lo cuenta y la revisión avisa si no ve la dirección real", () => {
  const e = leer("./empresa.html"), a = leer("./admin.js"), c = leer("./cliente.html"), s = leer("./server.js");
  assert.match(e, /Dar paso \(aún necesita su contraseña\)/); assert.match(a, /ma\[2\] === "codigo" && q\.pase/); assert.match(s, /geo: resumenGeo\(\)/);
  for (const t of ['id="pw-pase"', "necesitaPase", "/api/acceso/pw/pase", "preguntaPase"]) assert.ok(c.includes(t), t);
  assert.doesNotMatch(c.slice(c.indexOf('id="f-pw"'), c.indexOf('id="f-correo"')), /\son[a-z]+=/i);
  const ahora = Date.parse("2026-11-16T12:00:00Z"), base = { https: true, trustProxy: true, hsts: true, turnstile: true, smtp: true, modo: "contraseña", legacyAbierto: false, altaAutomatica: false, cspEstricta: true, escudo: true, at: "2026-11-16T11:55:00Z" };
  const por = (g, id = "geo") => revisar({ cliente: { ...base, geo: g }, env: {}, ahora }).lista.find((x) => x.id === id);
  assert.equal(por({ modo: "aprobar", lista: true, fecha: "2026-11-10", es: 50, fuera: 3, local: 2, sinDato: 0 }).nivel, "ok");
  assert.equal(por({ modo: "off", lista: false }).nivel, "aviso");
  assert.equal(por({ modo: "aprobar", lista: true, fecha: "2026-05-01", es: 50, fuera: 0, local: 0, sinDato: 0 }).nivel, "aviso", "lista de hace más de 120 días");
  assert.equal(por({ modo: "aprobar", lista: true, fecha: "2026-11-10", es: 0, fuera: 0, local: 40, sinDato: 0 }, "geo-ip").nivel, "aviso", "todas parecen internas: no se ve la dirección real");
  assert.equal(JSON.stringify(estadoCliente({ PUBLIC_URL: "https://x.es" }, { geo: { modo: "aprobar", lista: true, fecha: "2026-11-10", es: 1, fuera: 2, local: 3, sinDato: 4, ip: "1.2.3.4" } })).includes("1.2.3.4"), false, "el resumen solo lleva contadores, ninguna dirección");
});

test("FILTRO POR PAÍS: por defecto SOLO VIGILA (no pide pase a la oficina); «aprobar» hay que pedirlo con GEO_MODO=aprobar", () => {
  const antes = process.env.GEO_MODO; delete process.env.GEO_MODO; reiniciarGeo();
  try { const m = modoGeo(); assert.ok(m === "vigilar" || m === "off", "sin GEO_MODO: " + m); process.env.GEO_MODO = "aprobar"; assert.ok(["aprobar", "off"].includes(modoGeo())); } finally { if (antes === undefined) delete process.env.GEO_MODO; else process.env.GEO_MODO = antes; reiniciarGeo(); }
});
