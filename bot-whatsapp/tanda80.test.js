// Conexión con Claude (MCP) ampliada: clientes, estadísticas, Excel con vista previa, varias ofertas y temporadas. Panel de mentira para las herramientas
// + servidor real para la temporada (el panel la guarda y la app de los clientes la enseña, sin sesión y solo con texto y colores).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { libre } from "./puerto-libre.js";
import { validarTemporada, temporadaActiva, TEMPORADAS } from "./temporada.js";

const DIR = path.dirname(fileURLToPath(import.meta.url)), SCRIPT = path.join(DIR, "mcp", "vm-mcp.js"), TOKEN = "clave-secreta-de-prueba-80";
let panel, url; const peticiones = []; let respuesta = () => ({ estado: 200, json: { ok: true } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-t80-")), xlsx = path.join(tmp, "datos.xlsx"); fs.writeFileSync(xlsx, Buffer.from("PK-falso-pero-suficiente"));
before(async () => {
  panel = http.createServer((req, res) => { const t = []; req.on("data", (d) => t.push(d)); req.on("end", () => { const cuerpo = Buffer.concat(t); peticiones.push({ metodo: req.method, ruta: req.url, auth: req.headers.authorization, reclave: req.headers["x-vm-reclave"], tipo: req.headers["content-type"], cuerpo }); const r = respuesta(req, cuerpo); res.writeHead(r.estado, { "Content-Type": "application/json" }); res.end(JSON.stringify(r.json)); }); });
  await new Promise((r) => panel.listen(0, "127.0.0.1", r)); url = `http://127.0.0.1:${panel.address().port}`;
});
after(() => panel.close());
function cliente() {
  const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, VM_URL: url, VM_ADMIN_TOKEN: TOKEN }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", n = 0; const esperando = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); esperando.get(m.id)?.(m); } });
  const pedir = (method, params) => new Promise((res) => { const id = ++n; esperando.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  return { llamar: (name, args) => pedir("tools/call", { name, arguments: args }), cerrar: () => p.kill() };
}
const texto = (r) => r.result.content[0].text;

test("MCP: buscar clientes, ficha y estadísticas solo LEEN (GET) y no devuelven la clave", async () => {
  const c = cliente(); peticiones.length = 0;
  try {
    respuesta = (req) => req.url.startsWith("/api/admin/buscar") ? { estado: 200, json: { clientes: [{ id: "365", nombre: "BAR UNO", poblacion: "Medina" }], pedidos: [], articulos: [] } } : { estado: 200, json: { hola: "x".repeat(20000) } };
    assert.match(texto(await c.llamar("buscar_clientes", { texto: "bar uno" })), /365 · BAR UNO · Medina/);
    assert.equal(texto(await c.llamar("buscar_clientes", { texto: "b" })).includes("2 letras"), true);
    const f = texto(await c.llamar("ficha_cliente", { cliente_id: "365" })); assert.match(f, /resultado recortado/); assert.ok(f.length < 7100);
    await c.llamar("estadisticas", { rango: "7d" }); await c.llamar("estadisticas", { rango: "loquesea" });
    assert.deepEqual(peticiones.map((q) => [q.metodo, q.ruta]), [["GET", "/api/admin/buscar?q=bar%20uno"], ["GET", "/api/admin/cliente/365/ficha"], ["GET", "/api/admin/estadisticas?rango=7d"], ["GET", "/api/admin/estadisticas?rango=30d"]]);
    assert.equal((await c.llamar("ficha_cliente", { cliente_id: "../x" })).result.isError, true);
  } finally { c.cerrar(); }
});

test("MCP: ver_excel manda el archivo SIN aplicar nada; aplicar_excel exige el sí del usuario, y si el panel pide confirmar lo cuenta", async () => {
  const c = cliente(); peticiones.length = 0;
  try {
    respuesta = () => ({ estado: 200, json: { ok: true, resumen: { nuevos: 2, cambian: 1 }, aviso: ["Una línea sin precio"], aplicable: true } });
    const v = texto(await c.llamar("ver_excel", { ruta: xlsx, tipo: "consumo", solo_descuentos_e_historial: true })); assert.match(v, /VISTA PREVIA \(no se ha cambiado nada\)/); assert.match(v, /Una línea sin precio/);
    let q = peticiones[0]; assert.equal(q.ruta, "/api/admin/vista-previa/consumo?fichero=datos.xlsx&sinPrecios=1"); assert.equal(q.tipo, "application/octet-stream"); assert.equal(q.cuerpo.toString(), "PK-falso-pero-suficiente");
    peticiones.length = 0; assert.match(texto(await c.llamar("aplicar_excel", { ruta: xlsx, tipo: "clientes" })), /falta la confirmación/); assert.equal(peticiones.length, 0);
    const ap = texto(await c.llamar("aplicar_excel", { ruta: xlsx, tipo: "clientes", confirmado_por_el_usuario: true })); assert.match(ap, /^APLICADO/); assert.equal(peticiones[0].ruta, "/api/admin/aplicar/clientes?fichero=datos.xlsx"); assert.equal(peticiones[0].reclave, undefined);
    peticiones.length = 0; await c.llamar("aplicar_excel", { ruta: xlsx, tipo: "productos", confirmado_por_el_usuario: true }); assert.equal(peticiones[0].reclave, TOKEN); // la tarifa pide la clave otra vez y esta conexión ya la tiene
    respuesta = () => ({ estado: 409, json: { error: "x", confirmar: ["164 precios propios distintos de la tarifa"] } });
    const cf = texto(await c.llamar("aplicar_excel", { ruta: xlsx, tipo: "consumo", confirmado_por_el_usuario: true })); assert.match(cf, /NO se ha aplicado/); assert.match(cf, /164 precios/);
    peticiones.length = 0; await c.llamar("aplicar_excel", { ruta: xlsx, tipo: "consumo", confirmado_por_el_usuario: true, acepta_los_avisos: true }); assert.match(peticiones[0].ruta, /confirmo=1/);
    for (const mal of [{ ruta: path.join(tmp, "no-existe.xlsx"), tipo: "clientes" }, { ruta: "C:\\x\\..\\y.xlsx", tipo: "clientes" }, { ruta: xlsx, tipo: "otra" }, { ruta: path.join(tmp, "a.exe"), tipo: "clientes" }]) assert.equal((await c.llamar("ver_excel", mal)).result.isError, true);
  } finally { c.cerrar(); }
});

test("MCP: poner_ofertas pone varias de golpe solo con confirmación, cuenta los fallos y no avisa a nadie", async () => {
  const c = cliente(); peticiones.length = 0;
  try {
    const lista = [{ articulo_id: "1001", tipo: "pct", valor: 15, hasta: "2026-12-31" }, { articulo_id: "1002", tipo: "eur", valor: 0.2 }, { articulo_id: "../mal", tipo: "pct", valor: 5 }];
    assert.match(texto(await c.llamar("poner_ofertas", { ofertas: lista })), /falta la confirmación/); assert.equal(peticiones.length, 0);
    respuesta = () => ({ estado: 200, json: { ok: true } });
    const r = texto(await c.llamar("poner_ofertas", { ofertas: lista, confirmado_por_el_usuario: true })); assert.match(r, /puestas: 2 \(1001, 1002\)/); assert.match(r, /No se han podido poner 1/);
    assert.deepEqual(peticiones.map((q) => q.ruta), ["/api/admin/articulos/1001/oferta", "/api/admin/articulos/1002/oferta"]);
    assert.deepEqual(JSON.parse(peticiones[0].cuerpo), { tipo: "pct", valor: 15, hasta: "2026-12-31" });
    assert.equal((await c.llamar("poner_ofertas", { ofertas: [], confirmado_por_el_usuario: true })).result.isError, true);
  } finally { c.cerrar(); }
});

test("TEMPORADA: se valida (temporada conocida, fecha válida y no pasada, mensaje corto) y caduca sola", () => {
  assert.deepEqual(validarTemporada({ id: "navidad", hasta: "2027-01-07", mensaje: "  Felices   fiestas " }, "2026-12-01"), { id: "navidad", hasta: "2027-01-07", mensaje: "Felices fiestas" });
  assert.throws(() => validarTemporada({ id: "halloween" }, "2026-12-01"), /desconocida/); assert.throws(() => validarTemporada({ id: "navidad", hasta: "mañana" }, "2026-12-01"), /no es válida/); assert.throws(() => validarTemporada({ id: "navidad", hasta: "2026-11-01" }, "2026-12-01"), /ya ha pasado/);
  assert.equal(validarTemporada({ id: "navidad", mensaje: "x".repeat(200) }, "2026-12-01").mensaje.length, 90);
  const raw = JSON.stringify({ id: "navidad", hasta: "2027-01-07", mensaje: "" });
  assert.equal(temporadaActiva(raw, "2027-01-07").id, "navidad"); assert.equal(temporadaActiva(raw, "2027-01-08").id, "normal"); assert.equal(temporadaActiva(null, "2027-01-01").id, "normal"); assert.equal(temporadaActiva("basura{", "2027-01-01").id, "normal");
  assert.equal(temporadaActiva(raw, "2026-12-24").texto, TEMPORADAS.navidad.texto);
});

test("TEMPORADA de punta a punta: el panel la guarda (con confirmación) y la app de los clientes la enseña sin sesión, solo con texto y colores", async () => {
  const PORT = await libre(), BASE = `http://127.0.0.1:${PORT}`, d = fs.mkdtempSync(path.join(os.tmpdir(), "vm-t80s-")), ADMIN = "clave-de-prueba-80b";
  const proc = spawn(process.execPath, ["server.js"], { cwd: DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DEMO: "1", PORT: String(PORT), PUBLIC_URL: BASE, LINK_SECRET: "x", ADMIN_TOKEN: ADMIN, IMG_DIR: path.join(d, "img") + path.sep, DB_PATH: path.join(d, "p.sqlite"), CATALOG_DB: path.join(d, "c.sqlite"), CUSTOMERS_DB: path.join(d, "cl.sqlite"), ACCOUNTS_DB: path.join(d, "a.sqlite"), BACKUP_DIR: path.join(d, "b"), SYNC_DIR: path.join(d, "s"), ENTRADA_DIR: path.join(d, "e") } });
  try {
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("no arrancó")), 40000); proc.stdout.on("data", (x) => String(x).includes("Bot escuchando") && (clearTimeout(t), res())); proc.on("exit", () => rej(new Error("salió"))); });
    const adm = (m, ruta, body) => fetch(BASE + ruta, { method: m, headers: { Authorization: `Bearer ${ADMIN}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
    assert.equal((await fetch(BASE + "/api/temporada").then((r) => r.json())).id, "normal"); // sin sesión, sin adornos
    assert.equal((await fetch(BASE + "/api/admin/temporada", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403); // el panel exige la clave
    assert.equal((await adm("POST", "/api/admin/temporada", { id: "navidad" })).status, 400); // sin confirmación no se cambia
    assert.equal((await adm("POST", "/api/admin/temporada", { id: "halloween", confirmo: true })).status, 400);
    const ok = await adm("POST", "/api/admin/temporada", { id: "navidad", hasta: "2099-01-07", mensaje: "Cerramos el 24 y el 31", confirmo: true }); assert.equal(ok.status, 200);
    const pub = await fetch(BASE + "/api/temporada").then((r) => r.json()); assert.deepEqual(Object.keys(pub).sort(), ["color", "fondo", "id", "texto"]); assert.equal(pub.id, "navidad"); assert.equal(pub.texto, "Cerramos el 24 y el 31");
    for (const pag of ["/cliente", "/catalogo"]) { const h = await fetch(BASE + pag).then((r) => r.text()); assert.ok(h.length > 1000); }
    await adm("POST", "/api/admin/temporada", { id: "normal", confirmo: true }); assert.equal((await fetch(BASE + "/api/temporada").then((r) => r.json())).id, "normal");
  } finally { proc.kill(); }
});

test("TEMPORADA: las dos pantallas del cliente piden la franja (cliente.html y pedido.html) y el panel tiene su tarjeta", () => {
  const leer = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
  for (const f of ["cliente.html", "pedido.html"]) { const h = leer(f); assert.match(h, /fetch\("\/api\/temporada"/); assert.match(h, /d\.textContent\s*=\s*t\.texto/); assert.ok(!/innerHTML\s*=\s*t\.texto/.test(h)); }
  const e = leer("empresa.html"); assert.match(e, /id="tp-card"/); assert.match(e, /\/api\/admin\/temporada/);
});
