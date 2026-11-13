import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp", "vm-mcp.js");
const TOKEN = "clave-secreta-de-prueba-123";
let panel, url; const peticiones = []; let respuesta = (req, cuerpo) => ({ estado: 200, json: { ok: true } });

before(async () => {
  panel = http.createServer((req, res) => { const t = []; req.on("data", (d) => t.push(d)); req.on("end", () => { const cuerpo = t.length ? JSON.parse(Buffer.concat(t).toString()) : null; peticiones.push({ metodo: req.method, ruta: req.url, auth: req.headers.authorization, cuerpo }); const r = respuesta(req, cuerpo); res.writeHead(r.estado, { "Content-Type": "application/json" }).end(JSON.stringify(r.json)); }); });
  await new Promise((r) => panel.listen(0, "127.0.0.1", r)); url = `http://127.0.0.1:${panel.address().port}`;
});
after(() => panel.close());

// Un «Claude» de mentira: arranca el programa MCP y le habla por la entrada y salida estándar
function cliente(env = {}) {
  const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, VM_URL: url, VM_ADMIN_TOKEN: TOKEN, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", n = 0; const esperando = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); esperando.get(m.id)?.(m); } });
  const pedir = (method, params) => new Promise((res) => { const id = ++n; esperando.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  return { pedir, llamar: (name, args) => pedir("tools/call", { name, arguments: args }), cerrar: () => p.kill(), enviarCrudo: (t) => p.stdin.write(t) };
}
const texto = (r) => r.result.content[0].text;

test("MCP: se presenta bien (initialize, lista de herramientas) y no suelta la clave", async () => {
  const c = cliente();
  try {
    const i = await c.pedir("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "prueba", version: "1" } });
    assert.equal(i.result.protocolVersion, "2025-03-26"); assert.equal(i.result.serverInfo.name, "vm-pedidos"); assert.ok(i.result.capabilities.tools);
    assert.equal((await c.pedir("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-06-18"); // una versión que no conoce: propone la suya
    const l = await c.pedir("tools/list"); const nombres = l.result.tools.map((t) => t.name);
    assert.deepEqual(nombres, ["estado_avisos", "buscar_articulos", "enviar_aviso", "poner_oferta", "quitar_oferta", "cambiar_precio", "avisar_oferta_articulo"]);
    for (const t of l.result.tools) { assert.equal(t.inputSchema.type, "object"); assert.ok(t.description.length > 30); }
    // las que cambian algo exigen la confirmación del usuario en su esquema
    for (const n of nombres.filter((x) => !["estado_avisos", "buscar_articulos"].includes(x))) assert.ok(l.result.tools.find((t) => t.name === n).inputSchema.required.includes("confirmado_por_el_usuario"), n);
    assert.equal(JSON.stringify(l).includes(TOKEN), false);
    assert.deepEqual((await c.pedir("ping")).result, {});
    assert.equal((await c.pedir("cosa/rara")).error.code, -32601);
  } finally { c.cerrar(); }
});

test("MCP: enviar un aviso exige la confirmación del usuario y manda al panel el texto exacto con la clave de la empresa", async () => {
  const c = cliente(); peticiones.length = 0;
  try {
    const sin = await c.llamar("enviar_aviso", { titulo: "Oferta", texto: "Cerveza al 15 %", destino: "todos" });
    assert.match(texto(sin), /NO se ha hecho nada: falta la confirmación/); assert.equal(peticiones.length, 0, "sin confirmar no se toca el panel");
    const falsa = await c.llamar("enviar_aviso", { titulo: "Oferta", texto: "x", confirmado_por_el_usuario: "sí" }); assert.match(texto(falsa), /falta la confirmación/); assert.equal(peticiones.length, 0);
    respuesta = () => ({ estado: 200, json: { ok: true, enviados: 12, fallidos: 1, caducados: 0, errores: ["410"] } });
    const r = await c.llamar("enviar_aviso", { titulo: "Oferta de la semana", texto: "Cerveza al 15 % hasta el viernes", destino: "todos", confirmado_por_el_usuario: true });
    assert.match(texto(r), /Aviso enviado a 12 móvil/); assert.match(texto(r), /1 no se han podido entregar/);
    assert.equal(peticiones.length, 1); const q = peticiones[0];
    assert.deepEqual([q.metodo, q.ruta, q.auth], ["POST", "/api/admin/avisos/enviar", "Bearer " + TOKEN]);
    assert.deepEqual(q.cuerpo, { titulo: "Oferta de la semana", texto: "Cerveza al 15 % hasta el viernes", destino: "todos", confirmo: true });
    assert.equal(JSON.stringify(r).includes(TOKEN), false);
    // a un cliente, y las validaciones antes de llamar al panel
    peticiones.length = 0;
    await c.llamar("enviar_aviso", { titulo: "Hola", texto: "Para ti", destino: "cliente", cliente_id: "9001", confirmado_por_el_usuario: true }); assert.deepEqual([peticiones[0].cuerpo.destino, peticiones[0].cuerpo.clienteId], ["cliente", "9001"]);
    peticiones.length = 0;
    for (const mal of [{ titulo: "", texto: "x" }, { titulo: "x".repeat(51), texto: "x" }, { titulo: "x", texto: "y".repeat(181) }, { titulo: "x", texto: "y", destino: "cliente" }, { titulo: "x", texto: "y", destino: "cliente", cliente_id: "../../etc" }]) { const e = await c.llamar("enviar_aviso", { ...mal, confirmado_por_el_usuario: true }); assert.equal(e.result.isError, true, JSON.stringify(mal)); }
    assert.equal(peticiones.length, 0);
    respuesta = () => ({ estado: 200, json: { ok: true, enviados: 0, fallidos: 0, errores: [] } }); assert.match(texto(await c.llamar("enviar_aviso", { titulo: "x", texto: "y", confirmado_por_el_usuario: true })), /No había ningún móvil/);
    respuesta = () => ({ estado: 200, json: { ok: true, enviados: 0, fallidos: 2, errores: ['403 {"reason":"BadJwtToken"}'] } }); assert.match(texto(await c.llamar("enviar_aviso", { titulo: "x", texto: "y", confirmado_por_el_usuario: true })), /NO ha llegado a ningún móvil.*BadJwtToken/);
  } finally { c.cerrar(); respuesta = () => ({ estado: 200, json: { ok: true } }); }
});

test("MCP: ofertas, precio y campana (cada una exige confirmación) y las consultas", async () => {
  const c = cliente(); peticiones.length = 0;
  try {
    for (const [n, a] of [["poner_oferta", { articulo_id: "1010", tipo: "pct", valor: 15 }], ["quitar_oferta", { articulo_id: "1010" }], ["cambiar_precio", { articulo_id: "1010", precio: 1.2 }], ["avisar_oferta_articulo", { articulo_id: "1010" }]]) assert.match(texto(await c.llamar(n, a)), /falta la confirmación/, n);
    assert.equal(peticiones.length, 0);
    const ok = { confirmado_por_el_usuario: true };
    await c.llamar("poner_oferta", { articulo_id: "1010", tipo: "pct", valor: 15, hasta: "2099-12-31", ...ok }); assert.deepEqual([peticiones.at(-1).ruta, peticiones.at(-1).cuerpo], ["/api/admin/articulos/1010/oferta", { tipo: "pct", valor: 15, hasta: "2099-12-31" }]);
    await c.llamar("quitar_oferta", { articulo_id: "1010", ...ok }); assert.deepEqual(peticiones.at(-1).cuerpo, { tipo: "ninguna" });
    await c.llamar("cambiar_precio", { articulo_id: "1010", precio: 1.2, ...ok }); assert.deepEqual([peticiones.at(-1).ruta, peticiones.at(-1).cuerpo], ["/api/admin/articulos/1010/precio", { precio: 1.2 }]);
    respuesta = () => ({ estado: 200, json: { ok: true, enviados: 3, fallidos: 0, titulo: "Oferta −15 %: AGUA" } }); assert.match(texto(await c.llamar("avisar_oferta_articulo", { articulo_id: "1010", ...ok })), /«Oferta −15 %: AGUA» enviado a 3/); assert.deepEqual([peticiones.at(-1).ruta, peticiones.at(-1).cuerpo], ["/api/admin/articulos/1010/avisar", { confirmo: true }]);
    const n = peticiones.length; assert.equal((await c.llamar("cambiar_precio", { articulo_id: "../x", precio: 1, ...ok })).result.isError, true); assert.equal(peticiones.length, n); // un código raro no llega al panel
    // consultas
    respuesta = (req) => (req.url.startsWith("/api/admin/avisos") ? { estado: 200, json: { clientes: 5, moviles: 6, contacto: "https://pedidos.empresa.es", ultimos: [{ titulo: "Hola", destino: "todos", enviados: 6, fallidos: 0 }] } } : { estado: 200, json: { total: 2, filas: [{ id: "1010", nombre: "AZUCAR 1 KG", precio: 1.15, oferta: { tipo: "pct", valor: 15, hasta: "2099-12-31" }, campana: "oferta", avisado: null }, { id: "1001", nombre: "AGUA", precio: 0.42 }] } });
    assert.match(texto(await c.llamar("estado_avisos")), /Clientes con avisos activados: 5 \(6 móviles\).*pedidos\.empresa\.es.*«Hola»/s);
    const b = texto(await c.llamar("buscar_articulos", { texto: "azucar", filtro: "oferta" })); assert.match(b, /1010 · AZUCAR 1 KG · 1,15 € · OFERTA −15 % hasta 2099-12-31 · tiene campana/); assert.match(peticiones.at(-1).ruta, /q=azucar/); assert.match(peticiones.at(-1).ruta, /filtro=oferta/);
  } finally { c.cerrar(); respuesta = () => ({ estado: 200, json: { ok: true } }); }
});

test("MCP: errores claros (clave rechazada, error del panel, panel apagado, sin clave) y la clave puede leerse de empresa.env", async () => {
  respuesta = () => ({ estado: 403, json: { error: "Clave incorrecta" } });
  let c = cliente(); try { const r = await c.llamar("estado_avisos"); assert.equal(r.result.isError, true); assert.match(texto(r), /no ha aceptado la clave/); } finally { c.cerrar(); }
  respuesta = () => ({ estado: 400, json: { error: "Ya has enviado 10 avisos en la última hora." } });
  c = cliente(); try { const r = await c.llamar("enviar_aviso", { titulo: "x", texto: "y", confirmado_por_el_usuario: true }); assert.equal(r.result.isError, true); assert.match(texto(r), /10 avisos en la última hora/); } finally { c.cerrar(); }
  c = cliente({ VM_URL: "http://127.0.0.1:1" }); try { const r = await c.llamar("estado_avisos"); assert.equal(r.result.isError, true); assert.match(texto(r), /No se puede conectar con el panel.*Tailscale/); } finally { c.cerrar(); }
  c = cliente({ VM_ADMIN_TOKEN: "" }); try { assert.match(texto(await c.llamar("estado_avisos")), /Falta la clave de la empresa/); } finally { c.cerrar(); }
  // la clave se lee de empresa.env (solo ADMIN_TOKEN) si no se da directamente
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-mcp-")), "empresa.env"); fs.writeFileSync(f, `PORT=3001\nADMIN_TOKEN=${TOKEN}\nSMTP_PASS=otra-cosa-secreta\n`);
  respuesta = () => ({ estado: 200, json: { clientes: 1, moviles: 1, contacto: null, ultimos: [] } }); peticiones.length = 0;
  c = cliente({ VM_ADMIN_TOKEN: "", VM_ENV_FILE: f }); try { const r = await c.llamar("estado_avisos"); assert.match(texto(r), /Clientes con avisos activados: 1/); assert.match(texto(r), /NINGUNA dirección válida/); assert.equal(peticiones[0].auth, "Bearer " + TOKEN); assert.equal(JSON.stringify(r).includes("otra-cosa-secreta"), false); } finally { c.cerrar(); respuesta = () => ({ estado: 200, json: { ok: true } }); }
  // lo que no entiende no lo tumba
  c = cliente(); try { c.enviarCrudo("esto no es json\n"); assert.deepEqual((await c.pedir("ping")).result, {}); assert.equal((await c.llamar("herramienta_inventada", {})).error.code, -32602); } finally { c.cerrar(); }
});
