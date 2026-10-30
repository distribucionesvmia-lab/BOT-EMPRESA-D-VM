// Prueba de extremo a extremo del servidor: alta, aprobación, acceso con PIN y, sobre todo,
// que un cliente NO puede ver los datos (historial, catálogo habitual, pedidos) de otro.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";

const ADMIN = "clave-de-prueba";
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-srv-"));
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: {
      ...process.env, DEMO: "1", PORT: String(PORT), PUBLIC_URL: BASE, LINK_SECRET: "x", ADMIN_TOKEN: ADMIN,
      DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("el servidor no arrancó")), 8000);
    proc.stdout.on("data", (d) => String(d).includes("Bot escuchando") && (clearTimeout(t), res()));
    proc.on("exit", (c) => rej(new Error("el servidor salió con código " + c)));
  });
});
after(() => proc?.kill());

const json = { "Content-Type": "application/json" };
const call = async (method, url, { body, cookie, admin, headers } = {}) => {
  const r = await fetch(BASE + url, { method, headers: { ...(body ? json : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { status: r.status, json: await r.json().catch(() => null), setCookie: r.headers.get("set-cookie"), headers: r.headers };
};
const cookieOf = (r) => r.setCookie.split(";")[0];

// Alta y aprobación de un cliente: devuelve { cookie, pin }
async function darDeAlta(telefono, empresa, clienteId) {
  assert.equal((await call("POST", "/api/registro", { body: { telefono, correo: "x@ejemplo.es", empresa } })).status, 200);
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json.find((s) => s.business === empresa);
  const ok = await call("POST", `/api/admin/solicitudes/${sol.id}/aprobar`, { admin: true, body: { clienteId } });
  assert.equal(ok.status, 200);
  const login = await call("POST", "/api/acceso", { body: { telefono, pin: ok.json.pin } });
  assert.equal(login.status, 200);
  return { cookie: cookieOf(login), pin: ok.json.pin, solId: sol.id, login };
}

let A, B;
test("sin sesión no se accede a nada del cliente", async () => {
  assert.equal((await call("GET", "/api/yo")).status, 401);
  assert.equal((await call("POST", "/api/chat", { body: { text: "hola" } })).status, 401);
  assert.equal((await call("GET", "/catalogo/datos")).status, 401);
  assert.equal((await call("POST", "/catalogo", { body: { key: "abcdefgh1", lines: [] } })).status, 401);
  assert.equal((await call("GET", "/catalogo")).status, 302); // redirige a /cliente
});

test("la administración exige la clave de la empresa", async () => {
  assert.equal((await call("GET", "/api/admin/solicitudes")).status, 403);
  assert.equal((await call("GET", "/api/admin/solicitudes", { headers: { Authorization: "Bearer otra" } })).status, 403);
  assert.equal((await call("GET", "/api/admin/cuentas")).status, 403);
  assert.equal((await call("POST", "/api/admin/cuentas/1/pin", { body: {} })).status, 403);
});

test("registro: valida datos y la empresa ve la solicitud con sugerencias de cliente", async () => {
  assert.equal((await call("POST", "/api/registro", { body: { telefono: "12", correo: "x@e.es", empresa: "Bar" } })).status, 400);
  assert.equal((await call("POST", "/api/registro", { body: { telefono: "600000001", correo: "mal", empresa: "Bar El Ejemplo" } })).status, 400);
  await call("POST", "/api/registro", { body: { telefono: "600000001", correo: "a@ejemplo.es", empresa: "Bar El Ejemplo" } });
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json;
  assert.equal(sol.length, 1);
  assert.deepEqual(sol[0].sugerencias.map((s) => s.id), ["9001"]); // por nombre y teléfono
  assert.equal(sol[0].sugerencias[0].motivo, "nombre y teléfono");
});

test("aprobar con un cliente que no existe se rechaza; un teléfono aprobado entra con su PIN", async () => {
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json[0];
  assert.equal((await call("POST", `/api/admin/solicitudes/${sol.id}/aprobar`, { admin: true, body: { clienteId: "0000" } })).status, 400);
  A = await darDeAlta("600000001", "Bar El Ejemplo", "9001");
  B = await darDeAlta("600000002", "Tienda Ficticia", "9002");
  assert.match(A.pin, /^\d{6}$/);
  const c = A.login.setCookie;
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.equal((await call("GET", "/api/yo", { cookie: A.cookie })).json.cliente.nombre, "Bar El Ejemplo (ficticio)");
});

test("PIN incorrecto y teléfono desconocido dan el mismo mensaje", async () => {
  const mal = await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: "000000" } });
  const desconocido = await call("POST", "/api/acceso", { body: { telefono: "699999999", pin: "123456" } });
  assert.equal(mal.status, 401);
  assert.deepEqual(mal.json, desconocido.json);
});

test("AISLAMIENTO: cada cliente ve solo su conversación y su catálogo habitual", async () => {
  const hola = async (who) => (await call("POST", "/api/chat", { cookie: who.cookie, body: { text: "hola", id: "id-" + Math.random().toString(36).slice(2) } })).json;
  const a = await hola(A), b = await hola(B);
  assert.match(a.reply, /Bar El Ejemplo/);
  assert.doesNotMatch(a.reply, /Tienda Ficticia/);
  assert.match(b.reply, /Tienda Ficticia/);
  assert.doesNotMatch(b.reply, /Bar El Ejemplo/);
  // lo que cada uno compra habitualmente es suyo: A compra cola (1002) y B aceite (1008)
  assert.match(a.reply, /REFRESCO COLA/);
  assert.doesNotMatch(a.reply, /ACEITE OLIVA/);
  assert.match(b.reply, /ACEITE OLIVA/);
  assert.doesNotMatch(b.reply, /REFRESCO COLA/);
  const datosA = (await call("GET", "/catalogo/datos", { cookie: A.cookie })).json;
  const datosB = (await call("GET", "/catalogo/datos", { cookie: B.cookie })).json;
  assert.equal(datosA.customer.name, "Bar El Ejemplo (ficticio)");
  assert.equal(datosB.customer.name, "Tienda Ficticia");
  const habit = (d, id) => d.products.find((p) => p.id === id).count;
  assert.ok(habit(datosA, "1002") > 0 && habit(datosA, "1008") === 0);
  assert.ok(habit(datosB, "1008") > 0 && habit(datosB, "1002") === 0);
});

test("AISLAMIENTO: el navegador no puede elegir el cliente (ni por parámetro ni en el cuerpo ni con una cookie falsa)", async () => {
  const ficticias = [`vm_session=${A.cookie.split("=")[1]}x`, "vm_session=", "vm_session=inventada", "otra=1"];
  for (const c of ficticias) assert.equal((await call("GET", "/api/yo", { cookie: c })).status, 401);
  // A intenta pedir "como" el cliente 9002 de todas las formas posibles: el pedido sale siempre a nombre de 9001
  const r = await call("POST", "/catalogo?cliente=9002&customerId=9002", { cookie: A.cookie, body: { key: "clave-pedido-1", customerId: "9002", clienteId: "9002", phone: "600000002", lines: [{ id: "1010", qty: 1 }] } });
  assert.equal(r.status, 200);
  const db = openDb(path.join(dir, "pedidos.sqlite"));
  const orders = db.listOrders();
  db.close();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].customer_id, "9001");
  assert.equal(orders[0].phone, "600000001");
});

test("un pedido reenviado con la misma clave no se duplica; el cuerpo mal formado se rechaza", async () => {
  const body = { key: "clave-pedido-1", lines: [{ id: "1010", qty: 1 }] };
  assert.equal((await call("POST", "/catalogo", { cookie: A.cookie, body })).status, 409);
  assert.equal((await call("POST", "/catalogo", { cookie: A.cookie, body: { lines: [{ id: "1010", qty: 1 }] } })).status, 400); // sin clave
  assert.equal((await call("POST", "/catalogo", { cookie: A.cookie, body: { key: "clave-pedido-2", lines: [] } })).status, 400); // vacío
  const textoPlano = await fetch(BASE + "/api/chat", { method: "POST", headers: { "Content-Type": "text/plain", Cookie: A.cookie }, body: JSON.stringify({ text: "hola" }) });
  assert.equal(textoPlano.status, 415); // no se aceptan envíos que no sean JSON
});

test("un pedido hecho por el chat se guarda a nombre del cliente de la sesión", async () => {
  const say = (who, text) => call("POST", "/api/chat", { cookie: who.cookie, body: { text, id: "msg-" + Math.random().toString(36).slice(2) } });
  await say(B, "hola");
  const rep = await say(B, "repetir");
  assert.match(rep.json.reply, /Revisa tu pedido/);
  assert.equal((await say(B, "c:ok")).status, 200);
  const db = openDb(path.join(dir, "pedidos.sqlite"));
  const orders = db.listOrders();
  db.close();
  assert.equal(orders.length, 2);
  assert.deepEqual(orders.map((o) => o.customer_id).sort(), ["9001", "9002"]);
});

test("un nuevo PIN cierra las sesiones y el PIN viejo deja de valer; bloquear corta el acceso", async () => {
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  const cuentaB = cuentas.find((c) => c.customerId === "9002");
  const nuevo = await call("POST", `/api/admin/cuentas/${cuentaB.id}/pin`, { admin: true, body: {} });
  assert.equal((await call("GET", "/api/yo", { cookie: B.cookie })).status, 401);
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "600000002", pin: B.pin } })).status, 401);
  const ok = await call("POST", "/api/acceso", { body: { telefono: "600000002", pin: nuevo.json.pin } });
  assert.equal(ok.status, 200);
  const cookieB = cookieOf(ok);
  await call("POST", `/api/admin/cuentas/${cuentaB.id}/bloquear`, { admin: true, body: { bloquear: true } });
  assert.equal((await call("GET", "/api/yo", { cookie: cookieB })).status, 401);
});

test("tras varios PIN erróneos la cuenta se bloquea aunque luego se ponga el PIN bueno", async () => {
  for (let i = 0; i < 5; i++) await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: "111111" } });
  const r = await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: A.pin } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /bloqueada/i);
});

test("salir cierra la sesión", async () => {
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  const a = cuentas.find((c) => c.customerId === "9001");
  await call("POST", `/api/admin/cuentas/${a.id}/pin`, { admin: true, body: {} }); // quita el bloqueo
  const pin = (await call("POST", `/api/admin/cuentas/${a.id}/pin`, { admin: true, body: {} })).json.pin;
  const ok = await call("POST", "/api/acceso", { body: { telefono: "600000001", pin } });
  const cookie = cookieOf(ok);
  assert.equal((await call("GET", "/api/yo", { cookie })).status, 200);
  await call("POST", "/api/salir", { cookie, body: {} });
  assert.equal((await call("GET", "/api/yo", { cookie })).status, 401);
});

// ---- Aplicación de la empresa: pedidos y exportación ----
test("EMPRESA: ve los pedidos de todos los clientes, con el total, y los avisos", async () => {
  assert.equal((await call("GET", "/api/admin/pedidos")).status, 403);
  const ped = (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  assert.equal(ped.length, 2);
  assert.deepEqual(ped.map((o) => o.codigo).sort(), ["9001", "9002"]);
  assert.ok(ped.every((o) => o.estado === "pendiente" && o.total > 0 && o.lineas.length > 0));
  const res = (await call("GET", "/api/admin/resumen", { admin: true })).json;
  assert.equal(res.pedidosPendientes, 2);
  assert.equal(typeof res.solicitudes, "number");
});

test("EMPRESA: exporta a Excel una sola vez y se puede descargar", async () => {
  assert.equal((await call("POST", "/api/admin/exportar", { body: {} })).status, 403);
  const r = await call("POST", "/api/admin/exportar", { admin: true, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.exportacion.pedidos, 2);
  const otra = await call("POST", "/api/admin/exportar", { admin: true, body: {} });
  assert.equal(otra.json.exportacion, null); // no se repite
  const lista = (await call("GET", "/api/admin/exportaciones", { admin: true })).json;
  assert.equal(lista.length, 1);
  const sinClave = await fetch(`${BASE}/api/admin/exportaciones/${lista[0].id}/descargar`);
  assert.equal(sinClave.status, 403);
  const dl = await fetch(`${BASE}/api/admin/exportaciones/${lista[0].id}/descargar`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-type"), /spreadsheetml/);
  assert.equal(Buffer.from(await dl.arrayBuffer()).subarray(0, 2).toString(), "PK"); // un .xlsx es un zip
  const ped = (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  assert.ok(ped.every((o) => o.estado === "exportado"));
});

// ---- Dos aplicaciones separadas: lo del cliente no tiene nada de la empresa y al revés ----
async function arrancar(mode) {
  const port = 3990 + Math.floor(Math.random() * 9) + (mode === "empresa" ? 10 : 0);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vm-mode-"));
  const p = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, DEMO: "1", APP_MODE: mode, PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`, LINK_SECRET: "x", ADMIN_TOKEN: ADMIN, DB_PATH: path.join(d, "p.sqlite"), CATALOG_DB: path.join(d, "c.sqlite"), CUSTOMERS_DB: path.join(d, "cl.sqlite"), ACCOUNTS_DB: path.join(d, "a.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("no arrancó")), 8000);
    p.stdout.on("data", (x) => String(x).includes("Bot escuchando") && (clearTimeout(t), res()));
  });
  return { p, url: `http://127.0.0.1:${port}` };
}
const status = async (url, opts) => (await fetch(url, { redirect: "manual", ...opts })).status;

test("APP_MODE=cliente: la aplicación del cliente no tiene NADA de administración, ni con la clave", async () => {
  const { p, url } = await arrancar("cliente");
  try {
    assert.equal(await status(url + "/cliente"), 200);
    for (const ruta of ["/empresa", "/distribuidor", "/api/admin/pedidos", "/api/admin/solicitudes", "/api/admin/cuentas", "/api/admin/exportar", "/api/admin/resumen"]) {
      assert.equal(await status(url + ruta, { headers: { Authorization: `Bearer ${ADMIN}` } }), 404, ruta);
    }
  } finally {
    p.kill();
  }
});

test("APP_MODE=empresa: la aplicación de la empresa no sirve nada del cliente", async () => {
  const { p, url } = await arrancar("empresa");
  try {
    assert.equal(await status(url + "/empresa"), 200);
    assert.equal(await status(url + "/api/admin/resumen", { headers: { Authorization: `Bearer ${ADMIN}` } }), 200);
    assert.equal(await status(url + "/api/admin/resumen"), 403);
    for (const ruta of ["/cliente", "/catalogo", "/api/yo", "/api/chat"]) assert.equal(await status(url + ruta), 404, ruta);
    assert.equal(await status(url + "/api/registro", { method: "POST", headers: json, body: "{}" }), 404);
    assert.equal(await status(url + "/api/acceso", { method: "POST", headers: json, body: "{}" }), 404);
  } finally {
    p.kill();
  }
});

test("EMPRESA: adivinar la clave tiene límite de intentos", async () => {
  const { p, url } = await arrancar("empresa");
  try {
    let ultimo;
    for (let i = 0; i < 12; i++) ultimo = await status(url + "/api/admin/resumen", { headers: { Authorization: "Bearer mal" + i } });
    assert.equal(ultimo, 429);
    // y una vez bloqueada esa IP, ni la clave correcta pasa
    assert.equal(await status(url + "/api/admin/resumen", { headers: { Authorization: `Bearer ${ADMIN}` } }), 429);
  } finally {
    p.kill();
  }
});
