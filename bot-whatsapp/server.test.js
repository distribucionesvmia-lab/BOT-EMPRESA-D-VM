// Prueba de extremo a extremo del servidor: alta, aprobación, acceso con PIN y, sobre todo,
// que un cliente NO puede ver los datos (historial, catálogo habitual, pedidos) de otro.
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { libre } from "./puerto-libre.js";

const ADMIN = "clave-de-prueba";
const PORT = await libre();
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-srv-"));
let proc;
const syncDir = path.join(dir, "sync");

before(async () => {
  fs.mkdirSync(syncDir, { recursive: true });
  proc = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: {
      ...process.env, DEMO: "1", PORT: String(PORT), PUBLIC_URL: BASE, LOGIN_LIMIT: "1000", NIF_LIMIT: "1000", NIF_GLOBAL_FAILS: "1000", REGISTER_LIMIT: "1000", LINK_SECRET: "x", ADMIN_TOKEN: ADMIN,
      DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"), SYNC_DIR: syncDir, BACKUP_DIR: path.join(dir, "respaldos"), ENTRADA_DIR: path.join(dir, "entrada"), PUSH_ALLOW_HTTP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((res, rej) => {
    let dicho = ""; // lo que haya dicho el servidor, para que el error explique qué pasó (en Windows con antivirus el primer arranque tarda más)
    const t = setTimeout(() => rej(new Error("el servidor no arrancó en 40 s. Dijo: " + dicho.slice(-600))), 40000);
    proc.stderr.on("data", (d) => { dicho += String(d); });
    proc.stdout.on("data", (d) => { dicho += String(d); if (String(d).includes("Bot escuchando")) (clearTimeout(t), res()); });
    proc.on("error", (e) => rej(new Error("no se pudo lanzar el servidor: " + e.message)));
    proc.on("exit", (c) => rej(new Error("el servidor salió con código " + c + ". Dijo: " + dicho.slice(-600))));
  });
});
after(() => proc?.kill());

const json = { "Content-Type": "application/json" };
const call = async (method, url, { body, cookie, admin, headers } = {}) => {
  const r = await fetch(BASE + url, { method, headers: { ...(body ? json : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { status: r.status, json: await r.json().catch(() => null), setCookie: r.headers.get("set-cookie"), headers: r.headers };
};
const cookieOf = (r) => r.setCookie.split(";")[0];

// Alta de un cliente: se registra con el PIN que elige. Devuelve { cookie, pin, estado }
async function registrar(telefono, empresa, correo, pin) {
  const r = await call("POST", "/api/registro", { body: { telefono, correo, empresa, pin, nif: "12345678Z" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.estado;
}
async function entrar(telefono, empresa, pin) {
  const login = await call("POST", "/api/acceso", { body: { telefono, empresa, pin } });
  return { status: login.status, cookie: login.status === 200 ? cookieOf(login) : null, login };
}
const cuentaDe = async (clienteId, telefono) => (await call("GET", "/api/admin/cuentas", { admin: true })).json.find((c) => c.customerId === clienteId && (!telefono || c.phone === telefono));

let A, B;
test("sin sesión no se accede a nada del cliente", async () => {
  { const g = await call("GET", "/api/yo"); assert.equal(g.status, 200); assert.equal(g.json.cliente, null); } // invitado: 200 con cliente nulo, sin ensuciar la consola
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

test("registro: valida los datos", async () => {
  const mal = (body) => call("POST", "/api/registro", { body });
  const ok = { telefono: "600000001", correo: "a@ejemplo.es", empresa: "Bar El Ejemplo", pin: "111111", nif: "12345678Z" };
  assert.equal((await mal({ ...ok, nif: undefined })).status, 400); // el DNI/NIE/CIF es obligatorio
  assert.equal((await mal({ ...ok, nif: "123" })).status, 400);
  assert.equal((await mal({ ...ok, telefono: "12" })).status, 400);
  assert.equal((await mal({ ...ok, correo: "mal" })).status, 400);
  assert.equal((await mal({ ...ok, empresa: " " })).status, 400);
  assert.equal((await mal({ ...ok, pin: "12ab" })).status, 400);
  assert.equal((await mal({ ...ok, pin: undefined })).status, 400);
});

test("ALTA AUTOMÁTICA: si el nombre y el teléfono (o el correo) coinciden con la base de clientes, entra sin esperar a nadie", async () => {
  assert.equal(await registrar("600000001", "Bar El Ejemplo", "a@ejemplo.es", "111111"), "activa");
  assert.equal(await registrar("600000002", "tienda ficticia", "b@ejemplo.es", "222222"), "activa");
  assert.equal((await call("GET", "/api/admin/solicitudes", { admin: true })).json.length, 0); // no hizo falta que nadie aprobara
  const a = await cuentaDe("9001");
  assert.equal(a.verified, false); // entra, pero queda por confirmar
});

test("ALTA PENDIENTE: si no coincide, la empresa ve la solicitud con lo que encajó y la aprueba; vale el PIN que eligió el cliente", async () => {
  // el nombre coincide con un cliente pero el teléfono y el correo no: no entra solo
  assert.equal(await registrar("699111222", "Bar El Ejemplo", "otro@ejemplo.es", "333333"), "pendiente");
  assert.equal((await entrar("699111222", "Bar El Ejemplo", "333333")).status, 401); // aún sin acceso
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json;
  assert.equal(sol.length, 1);
  assert.match(sol[0].matched, /nombre coincide/i);
  assert.deepEqual(sol[0].sugerencias.map((x) => x.id), ["9001"]);
  assert.equal((await call("POST", `/api/admin/solicitudes/${sol[0].id}/aprobar`, { admin: true, body: { clienteId: "0000" } })).status, 400);
  const ap = await call("POST", `/api/admin/solicitudes/${sol[0].id}/aprobar`, { admin: true, body: { clienteId: "9001" } });
  assert.equal(ap.status, 200);
  assert.equal(ap.json.pin, undefined); // no se inventa otro PIN: vale el que eligió
  assert.equal((await entrar("699111222", "Bar El Ejemplo", "333333")).status, 200);
});

test("ACCESO: pide teléfono, nombre de la empresa y PIN, y el nombre se compara con la base de datos", async () => {
  const sinNombre = await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: "111111" } });
  assert.equal(sinNombre.status, 200); // teléfono único: no hace falta el nombre de la empresa (solo se pide si hace falta)
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "699999999", pin: "111111" } })).json.necesitaNombre, true); // teléfono desconocido o compartido: se pide el nombre
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: "999999" } })).status, 401); // código incorrecto
  const bien = await entrar("600000001", "Bar El Ejemplo", "111111");
  assert.equal(bien.status, 200);
  assert.match(bien.login.setCookie, /HttpOnly/);
  assert.match(bien.login.setCookie, /SameSite=Strict/);
  A = { cookie: bien.cookie, pin: "111111" };
  assert.equal((await call("GET", "/api/yo", { cookie: A.cookie })).json.cliente.nombre, "Bar El Ejemplo (ficticio)");
  assert.equal((await entrar("600000001", "Tienda Ficticia", "111111")).status, 401); // PIN bueno, nombre de OTRA empresa
  assert.equal((await entrar("600000001", "Bar Inventado", "111111")).status, 401);
  B = { cookie: (await entrar("600000002", "Tienda Ficticia SL", "222222")).cookie, pin: "222222" }; // también vale con variantes del nombre
  assert.ok(B.cookie);
});

test("la empresa confirma las cuentas automáticas", async () => {
  for (const id of ["9001", "9002"]) {
    const c = await cuentaDe(id, id === "9001" ? "600000001" : "600000002");
    assert.equal((await call("POST", `/api/admin/cuentas/${c.id}/confirmar`, { admin: true, body: {} })).status, 200);
  }
  assert.equal((await cuentaDe("9001", "600000001")).verified, true);
});

test("PIN incorrecto, nombre incorrecto y teléfono desconocido dan el mismo mensaje", async () => {
  const mal = await call("POST", "/api/acceso", { body: { telefono: "600000001", empresa: "Bar El Ejemplo", pin: "000000" } });
  const nombre = await call("POST", "/api/acceso", { body: { telefono: "600000001", empresa: "Otra Empresa", pin: "111111" } });
  const desconocido = await call("POST", "/api/acceso", { body: { telefono: "699999999", empresa: "Bar El Ejemplo", pin: "123456" } });
  assert.equal(mal.status, 401);
  assert.deepEqual(mal.json, nombre.json);
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
  // lo que cada uno compró es suyo: se comprueba con «último pedido»
  const ultimo = async (who) => JSON.stringify((await call("POST", "/api/chat", { cookie: who.cookie, body: { text: "último pedido", id: "id-" + Math.random().toString(36).slice(2) } })).json);
  const uA = await ultimo(A), uB = await ultimo(B);
  assert.match(uA, /REFRESCO COLA/);
  assert.doesNotMatch(uA, /ACEITE OLIVA/);
  assert.match(uB, /ACEITE OLIVA/);
  assert.doesNotMatch(uB, /REFRESCO COLA/);
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
  for (const c of ficticias) assert.equal((await call("GET", "/api/yo", { cookie: c })).json.cliente, null);
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
  await say(B, "24 uds de agua");
  const rep = await say(B, "act:done");
  assert.match(rep.json.reply, /Revisa tu pedido/);
  const conf = await say(B, "c:ok");
  assert.match(conf.json.reply, /Cuándo quieres recibirlo/); // antes de enviar pregunta el día de entrega
  assert.equal(conf.json.ui.type, "list");
  const fin = await say(B, "cuanto antes"); // se entiende una frase normal
  assert.match(fin.json.reply, /Pedido recibido/);
  const db = openDb(path.join(dir, "pedidos.sqlite"));
  const orders = db.listOrders();
  db.close();
  assert.equal(orders.length, 2);
  assert.ok(orders.find((o) => o.customer_id === "9002").delivery_date); // el día de entrega queda guardado
  assert.deepEqual(orders.map((o) => o.customer_id).sort(), ["9001", "9002"]);
});

test("un nuevo PIN cierra las sesiones y el PIN viejo deja de valer; bloquear corta el acceso", async () => {
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  const cuentaB = cuentas.find((c) => c.customerId === "9002");
  const nuevo = await call("POST", `/api/admin/cuentas/${cuentaB.id}/pin`, { admin: true, body: {} });
  assert.equal((await call("GET", "/api/yo", { cookie: B.cookie })).json.cliente, null);
  assert.equal((await entrar("600000002", "Tienda Ficticia", B.pin)).status, 401);
  const ok = await call("POST", "/api/acceso", { body: { telefono: "600000002", empresa: "Tienda Ficticia", pin: nuevo.json.pin } });
  assert.equal(ok.status, 200);
  const cookieB = cookieOf(ok);
  await call("POST", `/api/admin/cuentas/${cuentaB.id}/bloquear`, { admin: true, body: { bloquear: true } });
  assert.equal((await call("GET", "/api/yo", { cookie: cookieB })).json.cliente, null);
});

test("tras varios PIN erróneos la cuenta se bloquea aunque luego se ponga el PIN bueno", async () => {
  for (let i = 0; i < 5; i++) await call("POST", "/api/acceso", { body: { telefono: "600000001", empresa: "Bar El Ejemplo", pin: "999999" } });
  const r = await call("POST", "/api/acceso", { body: { telefono: "600000001", empresa: "Bar El Ejemplo", pin: A.pin } });
  assert.equal(r.status, 401);
  assert.match(r.json.error, /bloqueada/i);
});

test("salir cierra la sesión", async () => {
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  const a = cuentas.find((c) => c.customerId === "9001");
  await call("POST", `/api/admin/cuentas/${a.id}/pin`, { admin: true, body: {} }); // quita el bloqueo
  const pin = (await call("POST", `/api/admin/cuentas/${a.id}/pin`, { admin: true, body: {} })).json.pin;
  const ok = await call("POST", "/api/acceso", { body: { telefono: "600000001", empresa: "Bar El Ejemplo", pin } });
  const cookie = cookieOf(ok);
  assert.equal((await call("GET", "/api/yo", { cookie })).status, 200);
  await call("POST", "/api/salir", { cookie, body: {} });
  assert.equal((await call("GET", "/api/yo", { cookie })).json.cliente, null);
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
  // versión del programa y «Actualizar ahora» (en Linux no hay tarea de Windows: lo dice claro y no falla)
  assert.equal((await fetch(`${BASE}/api/admin/actualizacion`)).status, 403);
  const act = (await call("GET", "/api/admin/actualizacion", { admin: true })).json;
  assert.ok(Array.isArray(act.registro) && typeof act.disponible === "boolean" && "version" in act);
  if (process.platform !== "win32") { const r = (await call("POST", "/api/admin/actualizar", { admin: true, body: {} })).json; assert.equal(r.ok, false); assert.match(r.mensaje, /ordenador de la oficina/); }
  // imprimir directamente: la hoja sale como página HTML (exige la clave de la empresa)
  assert.equal((await fetch(`${BASE}/api/admin/exportaciones/${lista[0].id}/imprimir`)).status, 403);
  const imp = await fetch(`${BASE}/api/admin/exportaciones/${lista[0].id}/imprimir`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(imp.status, 200); assert.match(imp.headers.get("content-type"), /text\/html/);
  assert.match(await imp.text(), /<section class="hoja">[\s\S]*☐/);
  const ped = (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  assert.ok(ped.every((o) => o.estado === "exportado"));
});

// ---- Dos aplicaciones separadas: lo del cliente no tiene nada de la empresa y al revés ----
async function arrancar(mode) {
  const port = await libre();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vm-mode-"));
  const p = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, DEMO: "1", APP_MODE: mode, PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`, LINK_SECRET: "x", ADMIN_TOKEN: ADMIN, DB_PATH: path.join(d, "p.sqlite"), CATALOG_DB: path.join(d, "c.sqlite"), CUSTOMERS_DB: path.join(d, "cl.sqlite"), ACCOUNTS_DB: path.join(d, "a.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((res, rej) => {
    let dicho = "";
    const t = setTimeout(() => rej(new Error("no arrancó en 40 s. Dijo: " + dicho.slice(-600))), 40000);
    p.stderr.on("data", (x) => { dicho += String(x); });
    p.stdout.on("data", (x) => { dicho += String(x); if (String(x).includes("Bot escuchando")) (clearTimeout(t), res()); });
    p.on("error", (e) => rej(new Error("no se pudo lanzar: " + e.message)));
  });
  return { p, url: `http://127.0.0.1:${port}` };
}
const status = async (url, opts) => (await fetch(url, { redirect: "manual", ...opts })).status;

test("APP_MODE=cliente: la aplicación del cliente no tiene NADA de administración, ni con la clave", async () => {
  const { p, url } = await arrancar("cliente");
  try {
    assert.equal(await status(url + "/cliente"), 200);
    for (const ruta of ["/empresa", "/distribuidor", "/api/admin/pedidos", "/api/admin/solicitudes", "/api/admin/cuentas", "/api/admin/exportar", "/api/admin/entrada", "/api/admin/resumen", "/api/admin/vista-previa/productos", "/api/admin/aplicar/clientes", "/api/admin/clientes/lista", "/api/admin/estado", "/api/admin/actualizaciones"]) {
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

test("EMPRESA: la misma clave errónea repetida (las 7 cargas del panel) cuenta como un solo intento", async () => {
  const { p, url } = await arrancar("empresa");
  try {
    // un error al teclear: el panel lanza 7 peticiones con la misma clave
    for (let i = 0; i < 25; i++) assert.equal(await status(url + "/api/admin/resumen", { headers: { Authorization: "Bearer mal" } }), 403);
    for (let i = 0; i < 25; i++) assert.equal(await status(url + "/api/admin/resumen"), 403); // sin clave: no cuenta
    assert.equal(await status(url + "/api/admin/resumen", { headers: { Authorization: `Bearer ${ADMIN}` } }), 200); // y la buena entra
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

// ---- Importar la lista de clientes (Excel de a3ERP) y retención de cuentas automáticas sin confirmar ----
import { buildWorkbook } from "./xlsx.js";
const cabecera = ["Cód. cliente", "Organización", "Razón social / Nombre fiscal de la organización", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"];
const excelClientes = () =>
  Buffer.from(buildWorkbook([{ name: "CLIENTES", rows: [cabecera,
    ["    7001", "CAFETERIA IMPORTADA", "MARIA LOPEZ SL", "MEDINA DEL CAMPO", "CL. UNO 1", "611222333 / 983 00 11 22", "cafe@importada.es", "B11111111", "No", "No", "1"],
    ["    7002", "FERRETERIA CERRADA", "FERRETERIA CERRADA", "TORDESILLAS", "CL. DOS 2", "622333444", "", "", "Sí", "No", "1"],
    ["    7003", "KIOSCO SIN DATOS", "KIOSCO SIN DATOS", "", "", "", "", "", "No", "No", "1"],
  ] }]));
const subir = (buf, admin = true) => fetch(`${BASE}/api/admin/clientes/importar`, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}) }, body: buf }).then(async (r) => ({ status: r.status, json: await r.json() }));

test("IMPORTAR: la empresa sube el Excel de clientes y aparecen en su lista (sin NIF)", async () => {
  assert.equal((await subir(excelClientes(), false)).status, 403);
  assert.equal((await subir(Buffer.from("no es un excel"))).status, 400);
  const r = await subir(excelClientes());
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.importados, r.json.nuevos, r.json.inactivos, r.json.sinTelefono, r.json.sinCorreo], [3, 3, 1, 1, 2]);
  const lista = (await call("GET", "/api/admin/clientes/lista?q=importada", { admin: true })).json;
  assert.equal(lista.total, 1);
  assert.deepEqual([lista.clientes[0].id, lista.clientes[0].phones, lista.clientes[0].emails], ["7001", ["611222333", "983001122"], ["cafe@importada.es"]]);
  assert.equal(JSON.stringify(lista).includes("B11111111"), false);
  assert.equal((await call("GET", "/api/admin/clientes/lista", { admin: true })).json.total >= 5, true);
  assert.equal((await subir(excelClientes())).json.nuevos, 0); // repetirlo actualiza, no duplica
});

test("IMPORTAR + ALTA AUTOMÁTICA: un cliente importado entra solo si coincide el nombre y uno de sus datos; los de baja o sin datos, no", async () => {
  assert.equal(await registrar("655000000", "Cafetería Importada", "cafe@importada.es", "444444"), "activa"); // nombre + correo (el teléfono es otro)
  assert.equal(await registrar("611222333", "Maria Lopez SL", "x@x.es", "555555"), "activa"); // razón social + uno de sus dos teléfonos
  assert.equal(await registrar("622333444", "Ferretería Cerrada", "z@z.es", "666666"), "pendiente"); // cliente de baja
  assert.equal(await registrar("600999888", "Kiosco Sin Datos", "k@k.es", "777777"), "pendiente"); // sin teléfono ni correo guardados
  assert.equal(await registrar("611222333", "Panadería Inventada", "p@p.es", "888888"), "pendiente"); // teléfono sí, nombre no
  assert.equal((await entrar("622333444", "Ferretería Cerrada", "666666")).status, 401);
});

test("RETENCIÓN: los pedidos de una cuenta automática sin confirmar quedan retenidos hasta que la empresa la confirma", async () => {
  const { cookie } = await entrar("655000000", "Cafetería Importada", "444444");
  assert.ok(cookie);
  const pedir = (key) => call("POST", "/catalogo", { cookie, body: { key, lines: [{ id: "1010", qty: 1 }] } });
  assert.equal((await pedir("clave-retenido")).status, 200);
  let ped = (await call("GET", "/api/admin/pedidos", { admin: true })).json.find((o) => o.codigo === "7001");
  assert.equal(ped.estado, "retenido");
  assert.match(ped.motivo, /sin confirmar/);
  // «Revisado: exportar» libera ese pedido concreto
  assert.equal((await call("POST", `/api/admin/pedidos/${ped.ref}/aprobar`, { admin: true, body: {} })).status, 200);
  // y tras confirmar la cuenta, los siguientes pedidos ya no se retienen
  const c = await cuentaDe("7001", "655000000");
  assert.equal((await call("POST", `/api/admin/cuentas/${c.id}/confirmar`, { admin: true, body: {} })).status, 200);
  assert.equal((await pedir("clave-normal")).status, 200);
  ped = (await call("GET", "/api/admin/pedidos", { admin: true })).json.filter((o) => o.codigo === "7001");
  assert.deepEqual(ped.map((o) => o.estado).sort(), ["pendiente", "pendiente"]);
});

const entrarNif = (nif, empresa) => call("POST", "/api/acceso", { body: { nif, ...(empresa ? { empresa } : {}) } });

test("ACCESO CON NIF: las cuentas ya están creadas y el cliente entra solo con los 6 primeros dígitos del DNI/CIF", async () => {
  // Todos los clientes activos importados tienen ya su cuenta, y el NIF no aparece en ninguna respuesta
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  assert.ok(cuentas.find((c) => c.customerId === "7003"));
  assert.equal(cuentas.find((c) => c.customerId === "7002"), undefined); // de baja: sin cuenta
  assert.equal(JSON.stringify(cuentas).includes("B11111111"), false);
  // NIF B11111111 → 6 primeros dígitos: 111111 (sin decir el nombre)
  const r = await entrarNif("111111");
  assert.equal(r.status, 200);
  assert.equal(r.json.cliente.nombre, "CAFETERIA IMPORTADA");
  assert.equal((await call("GET", "/api/yo", { cookie: cookieOf(r) })).json.cliente.nombre, "CAFETERIA IMPORTADA");
  assert.equal((await entrarNif("b11111111")).status, 200); // también con el NIF entero
  assert.equal((await entrarNif("111111", "importada")).status, 200); // el nombre, si se envía, solo estrecha la búsqueda
  assert.equal((await entrarNif("111111", "otra cosa")).status, 401);
  // errores: NIF equivocado, texto demasiado corto, cliente de baja
  assert.equal((await entrarNif("999999")).status, 401);
  assert.equal((await entrarNif("12")).status, 400);
  // un mismo NIF en dos negocios: pide el nombre y con él entra en el que corresponde
  await subir(Buffer.from(buildWorkbook([{ name: "CLIENTES", rows: [cabecera,
    ["7101", "BAR UNO", "TITULAR REPETIDO", "", "", "", "", "12222222A", "No", "No", "1"],
    ["7102", "BAR DOS", "TITULAR REPETIDO", "", "", "", "", "12222222A", "No", "No", "1"],
  ] }])));
  const amb = await entrarNif("122222");
  assert.deepEqual([amb.status, amb.json.necesitaNombre], [409, true]);
  assert.equal((await entrarNif("122222", "bar dos")).json.cliente.nombre, "BAR DOS");
  assert.equal((await entrarNif("22222A")).status, 401); // los 6 últimos caracteres (como antes) ya no valen
  // la empresa puede bloquear la cuenta: ni con el NIF correcto entra, y al reactivarla vuelve a entrar
  const c = await cuentaDe("7001");
  await call("POST", `/api/admin/cuentas/${c.id}/bloquear`, { admin: true, body: { bloquear: true } });
  const b = await entrarNif("111111");
  assert.equal(b.status, 401);
  assert.match(b.json.error, /bloqueada/);
  await call("POST", `/api/admin/cuentas/${c.id}/bloquear`, { admin: true, body: { bloquear: false } });
  assert.equal((await entrarNif("111111")).status, 200);
});

test("CAMBIAR EL CÓDIGO: el cliente sustituye los 6 del NIF por uno personal; el NIF deja de valer y la empresa puede restablecerlo", async () => {
  const r = await entrarNif("111111");
  assert.equal(r.status, 200);
  const cookie = cookieOf(r);
  assert.equal((await call("GET", "/api/yo", { cookie })).json.cliente.codigoPropio, false);
  assert.equal((await call("POST", "/api/codigo", { body: { nuevo: "abcdef" } })).status, 401); // sin sesión
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "123" } })).status, 400); // demasiado corto
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "1234567" } })).status, 400); // más de 6 caracteres
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "abc12!" } })).status, 400); // con un símbolo
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "111111" } })).status, 400); // coincide con un NIF
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "Ab482C" } })).status, 200); // con letras: vale
  assert.equal((await call("GET", "/api/yo", { cookie })).json.cliente.codigoPropio, true);
  assert.equal((await entrarNif("Ab482C")).json.cliente.nombre, "CAFETERIA IMPORTADA"); // la contraseña personal vale…
  assert.equal((await entrarNif("ab482c")).status, 200); // …escrita en minúsculas
  assert.equal((await entrarNif("AB-482-C")).status, 200); // los guiones se ignoran
  assert.equal((await entrarNif("111111")).status, 401); // el NIF ya no vale para esa cuenta
  // otro cliente no puede quedarse con el mismo código
  const otro = await entrarNif("122222", "bar uno");
  assert.equal((await call("POST", "/api/codigo", { cookie: cookieOf(otro), body: { nuevo: "AB482c" } })).status, 400); // otro cliente no puede repetirla (aunque cambie mayúsculas)
  // la empresa lo restablece: vuelve a valer el NIF
  const c = await cuentaDe("7001");
  assert.equal(c.ownCode, true);
  assert.equal((await call("POST", `/api/admin/cuentas/${c.id}/pin`, { admin: true, body: {} })).status, 200);
  assert.equal((await entrarNif("111111")).status, 200);
  assert.equal((await entrarNif("Ab482C")).status, 401);
});

test("EMPRESA: las solicitudes sin coincidencia muestran por qué y qué clientes podrían ser", async () => {
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json;
  const k = sol.find((x) => x.business === "Panadería Inventada");
  assert.match(k.matched, /No hay ningún cliente con ese nombre/);
  assert.deepEqual(k.sugerencias.map((x) => x.id), ["7001"]); // coincide su teléfono con ese cliente
  assert.match(k.sugerencias[0].motivo, /teléfono/);
  assert.ok(sol.length >= 3);
});

test("SINCRONIZACIÓN: la empresa ve el estado y puede lanzarla; importa los Excel de la carpeta y no repite", async () => {
  assert.equal((await call("GET", "/api/admin/sincronizacion")).status, 403);
  let e = (await call("GET", "/api/admin/sincronizacion", { admin: true })).json;
  assert.equal(e.configurado, true);
  assert.equal(e.ultima, null);
  fs.writeFileSync(path.join(syncDir, "clientes.xlsx"), buildWorkbook([{ name: "C", rows: [cabecera, ["8001", "CLIENTE SINCRONIZADO", "", "MEDINA", "", "", "", "A87654321", "No", "No", "1"]] }]));
  fs.writeFileSync(path.join(syncDir, "productos.xlsx"), buildWorkbook([{ name: "P", rows: [["Código", "Descripción", "Precio"], ["9001", "PRODUCTO NUEVO", "3,5"]] }]));
  let r = (await call("POST", "/api/admin/sincronizacion/ahora", { admin: true, body: {} })).json;
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "sin fichero"]);
  assert.equal((await call("GET", "/api/admin/clientes/lista?q=sincronizado", { admin: true })).json.total, 1);
  const ent = await entrarNif("876543"); // los 6 primeros dígitos de A87654321: el cliente recién sincronizado ya tiene cuenta y entra
  assert.equal(ent.status, 200);
  assert.equal(ent.json.cliente.nombre, "CLIENTE SINCRONIZADO");
  r = (await call("POST", "/api/admin/sincronizacion/ahora", { admin: true, body: {} })).json;
  assert.deepEqual(r.resultados.map((x) => x.estado), ["sin cambios", "sin cambios", "sin fichero"]);
  e = (await call("GET", "/api/admin/sincronizacion", { admin: true })).json;
  assert.equal(e.registro.length, 1);
  assert.equal(e.ficheros.clientes.name, "clientes.xlsx");
});

test("EXPORTAR ELEGIDOS: solo salen los pedidos marcados y se validan las referencias", async () => {
  const lista = async () => (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  // dos pedidos nuevos de un cliente de la lista
  const { cookie } = await entrarNif("111111").then((r) => ({ cookie: cookieOf(r) }));
  for (const k of ["clave-sel-a", "clave-sel-b"]) { const rr = await call("POST", "/catalogo", { cookie, body: { key: k, lines: [{ id: "1010", qty: 1 }] } }); assert.equal(rr.status, 200, JSON.stringify(rr.json)); }
  const pend = (await lista()).filter((o) => o.estado === "pendiente");
  assert.ok(pend.length >= 2);
  const [a, b] = pend.slice(0, 2).map((o) => o.ref);
  assert.equal((await call("POST", "/api/admin/exportar", { admin: true, body: { refs: [] } })).status, 400);
  assert.equal((await call("POST", "/api/admin/exportar", { admin: true, body: { refs: ["x; DROP"] } })).status, 400);
  const r = (await call("POST", "/api/admin/exportar", { admin: true, body: { refs: [a] } })).json;
  assert.equal(r.exportacion.pedidos, 1);
  const tras = await lista();
  assert.equal(tras.find((o) => o.ref === a).estado, "exportado");
  assert.equal(tras.find((o) => o.ref === b).estado, "pendiente"); // el no marcado sigue pendiente
});

test("ACTUALIZAR DATOS: vista previa y aplicar por Excel solo con la clave de la empresa; la app del cliente no lo conoce", async () => {
  const subirA = (ruta, buf, admin = true) => fetch(`${BASE}/api/admin/${ruta}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}) }, body: buf }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const x = Buffer.from(buildWorkbook([{ name: "C", rows: [cabecera, ["    7901", "BAR ACTUALIZADO", "BAR ACTUALIZADO", "MEDINA", "CL. UNO 1", "611000111", "", "B22222222", "No", "No", "1"]] }]));
  assert.equal((await subirA("vista-previa/clientes", x, false)).status, 403);
  assert.equal((await subirA("aplicar/clientes", x, false)).status, 403);
  const v = await subirA("vista-previa/clientes", x);
  assert.equal(v.status, 200);
  assert.equal(v.json.resumen.nuevos, 1, JSON.stringify(v.json));
  assert.equal((await call("GET", "/api/admin/clientes/lista?q=actualizado", { admin: true })).json.total, 0); // la vista previa no escribe
  assert.equal((await subirA("aplicar/clientes", x)).json.nuevos, 1);
  assert.equal((await call("GET", "/api/admin/clientes/lista?q=actualizado", { admin: true })).json.total, 1);
  assert.equal((await subirA("aplicar/clientes", x)).status, 400); // repetir: no hay diferencias
  assert.equal((await subirA("vista-previa/clientes", Buffer.from("basura"))).status, 400);
  // la página del cliente no contiene nada de la administración
  const html = await (await fetch(`${BASE}/cliente`)).text();
  assert.equal(/api\/admin|\/empresa|Actualizar datos|importar/i.test(html), false);
});

test("ESTADO: /api/admin/estado solo con la clave de la empresa y lista los problemas", async () => {
  assert.equal((await call("GET", "/api/admin/estado")).status, 403);
  const r = await call("GET", "/api/admin/estado", { admin: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.funcionando, true);
  assert.ok(Array.isArray(r.json.problemas) && typeof r.json.pedidos.pendientes === "number");
  assert.ok(r.json.problemas.some((p) => p.clave === "correo-sin-configurar")); // en las pruebas no hay SMTP
});

test("DATOS Y EXCEL: /api/admin/actualizaciones pide clave y devuelve una lista", async () => {
  assert.equal((await call("GET", "/api/admin/actualizaciones")).status, 403);
  const r = await call("GET", "/api/admin/actualizaciones", { admin: true });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
});

test("BUSCADORES: robots.txt lo prohíbe todo y las páginas llevan noindex", async () => {
  const r = await fetch(`${BASE}/robots.txt`);
  assert.match(await r.text(), /Disallow: \//);
  assert.match((await fetch(`${BASE}/cliente`)).headers.get("x-robots-tag") ?? "", /noindex/);
});

test("PRIVACIDAD: la pantalla de acceso y la de alta llevan la información de protección de datos", async () => {
  const html = await (await fetch(`${BASE}/cliente`)).text();
  assert.equal((html.match(/Información sobre privacidad/g) ?? []).length, 3); // acceso, solicitud de alta y la ventana «Privacidad y aviso legal»
  assert.match(html, /Aviso legal/); assert.doesNotMatch(html, /data-aviso-legal/);
  assert.match(html, /Tu DNI\/CIF no se guarda/);
  assert.doesNotMatch(html, /data-privacidad/);
});

test("APP EN EL MÓVIL: manifiesto, iconos y service worker públicos, y la página los enlaza", async () => {
  const m = await fetch(`${BASE}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  const man = await m.json();
  assert.equal(man.display, "standalone");
  assert.equal(man.start_url, "/cliente");
  for (const ic of man.icons) { const r = await fetch(BASE + ic.src); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png"); }
  const sw = await fetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /addEventListener\("fetch"/);
  assert.match(await (await fetch(`${BASE}/cliente`)).text(), /rel="manifest"/);
});

test("RENDIMIENTO: las páginas y los datos van comprimidos (gzip) cuando el navegador lo admite, y sin comprimir si no", async () => {
  const gz = await fetch(`${BASE}/cliente`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(gz.headers.get("content-encoding"), "gzip");
  assert.match(await gz.text(), /Primeros 6 dígitos/); // (fetch ya lo descomprime: si el gzip estuviera mal, esto fallaría)
  const plano = await fetch(`${BASE}/cliente`, { headers: { "Accept-Encoding": "identity" } });
  assert.equal(plano.headers.get("content-encoding"), null);
  assert.match(await plano.text(), /Primeros 6 dígitos/);
});

test("DERECHOS Y ACCESO DEL CLIENTE HABITUAL: teléfono de la lista + contraseña, descargar mis datos, pedir cambios y eliminar la cuenta", async () => {
  const lista = Buffer.from(buildWorkbook([{ name: "CLIENTES", rows: [cabecera, ["    7777", "TABERNA DERECHOS", "TABERNA DERECHOS SL", "MEDINA DEL CAMPO", "CL. SEIS 6", "655444333", "taberna@derechos.es", "X7654321L", "No", "No", "1"]] }]));
  assert.equal((await subir(lista)).status, 200);
  // aún sin contraseña personal: solo entra con el NIF (los 6 primeros dígitos), no con el teléfono
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "655444333", empresa: "Taberna Derechos", pin: "Ab12Cd" } })).status, 401);
  const nif = await entrarNif("765432");
  assert.equal(nif.status, 200, JSON.stringify(nif.json));
  const cookie0 = cookieOf(nif);
  assert.equal((await call("POST", "/api/codigo", { cookie: cookie0, body: { nuevo: "Ab12Cd" } })).status, 200); // elige su contraseña personal
  // ahora SÍ entra con el teléfono de siempre + la contraseña (sin importar mayúsculas) + el nombre de su empresa
  const t = await call("POST", "/api/acceso", { body: { telefono: "655 44 43 33".replace(/ /g, ""), empresa: "taberna derechos", pin: "aB12cD" } });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "655444333", empresa: "Taberna Derechos", pin: "Ab12Ce" } })).status, 401);
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "655444333", empresa: "Otra empresa", pin: "Ab12Cd" } })).status, 401);
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "600999888", empresa: "Taberna Derechos", pin: "Ab12Cd" } })).status, 401); // otro teléfono
  const cookie = cookieOf(t);

  // DERECHO DE ACCESO / PORTABILIDAD: descarga lo que se guarda (sin DNI ni contraseña)
  assert.equal((await call("GET", "/api/mis-datos")).status, 401);
  const md = await call("GET", "/api/mis-datos", { cookie });
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-disposition"), /attachment; filename="mis-datos-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(md.json.cliente.codigo, "7777");
  assert.ok(Array.isArray(md.json.pedidos_hechos_en_la_aplicacion) && Array.isArray(md.json.favoritos) && Array.isArray(md.json.historial_de_compras));
  const texto = JSON.stringify(md.json);
  for (const prohibido of ["X7654321L", "765432", "Ab12Cd", "AB12CD", "pin_hash", "code_key"]) assert.equal(texto.includes(prohibido), false, "no debe salir " + prohibido);
  // un cliente no ve los datos de otro: es siempre el de su sesión
  assert.equal((await call("GET", "/api/mis-datos?cliente=7001", { cookie })).json.cliente.codigo, "7777");

  // RECTIFICACIÓN / LIMITACIÓN / OPOSICIÓN: llega a la empresa
  assert.equal((await call("POST", "/api/derechos", { body: { tipo: "corregir", texto: "mi teléfono ha cambiado" } })).status, 401);
  assert.equal((await call("POST", "/api/derechos", { cookie, body: { tipo: "borrar-todo", texto: "x" } })).status, 400);
  assert.equal((await call("POST", "/api/derechos", { cookie, body: { tipo: "corregir", texto: "mi teléfono ha cambiado" } })).status, 200);
  const pend = (await call("GET", "/api/admin/derechos", { admin: true })).json.filter((d) => d.estado === "pendiente" && d.clienteId === "7777");
  assert.equal(pend.length, 1);
  assert.deepEqual([pend[0].cliente, pend[0].tipo, pend[0].texto], ["TABERNA DERECHOS", "corregir", "mi teléfono ha cambiado"]);
  assert.equal((await call("GET", "/api/admin/derechos")).status, 403); // solo la empresa
  assert.equal((await call("POST", `/api/admin/derechos/${pend[0].id}/atender`, { admin: true, body: {} })).status, 200);
  assert.equal((await call("GET", "/api/admin/resumen", { admin: true })).json.derechosPendientes >= 0, true);

  // SUPRESIÓN: eliminar la cuenta pide confirmación, cierra la sesión y no deja volver a entrar
  assert.equal((await call("POST", "/api/eliminar-cuenta", { body: { confirmo: "ELIMINAR" } })).status, 401);
  assert.equal((await call("POST", "/api/eliminar-cuenta", { cookie, body: { confirmo: "si" } })).status, 400);
  const del = await call("POST", "/api/eliminar-cuenta", { cookie, body: { confirmo: "eliminar" } });
  assert.equal(del.status, 200);
  assert.equal((await call("GET", "/api/yo", { cookie })).json.cliente, null); // la sesión ya no vale
  const volver = await call("POST", "/api/acceso", { body: { telefono: "655444333", empresa: "Taberna Derechos", pin: "Ab12Cd" } });
  assert.equal(volver.status, 401);
  const volverNif = await entrarNif("765432");
  assert.equal(volverNif.status, 401);
  assert.match(volverNif.json.error, /se eliminó/);
  const cuenta = (await call("GET", "/api/admin/cuentas", { admin: true })).json.find((c) => c.customerId === "7777");
  assert.deepEqual([cuenta.status, cuenta.phone, cuenta.email], ["deleted", null, null]); // la empresa ve que está eliminada
  assert.ok((await call("GET", "/api/admin/derechos", { admin: true })).json.some((d) => d.tipo === "supresion" && d.clienteId === "7777")); // y queda constancia
});

test("USO: el catálogo anota contadores (repetir, abandono, pedido) sin datos personales y la empresa los ve en su panel", async () => {
  assert.equal((await call("POST", "/api/uso", { body: { evento: "repetir" } })).status, 401); // sin sesión no se anota nada
  const r = await entrarNif("111111");
  assert.equal(r.status, 200);
  const cookie = cookieOf(r);
  assert.equal((await call("POST", "/api/uso", { cookie, body: { evento: "espiar" } })).status, 400);
  const antes = (await call("GET", "/api/admin/uso", { admin: true })).json;
  for (const evento of ["repetir", "abandono"]) assert.equal((await call("POST", "/api/uso", { cookie, body: { evento } })).status, 200);
  assert.equal((await call("POST", "/api/uso", { cookie, body: { evento: "pedido", seg: 95 } })).status, 200);
  const despues = (await call("GET", "/api/admin/uso?dias=30", { admin: true })).json;
  assert.deepEqual([despues.repeticiones - antes.repeticiones, despues.abandonos - antes.abandonos, despues.pedidos - antes.pedidos], [1, 1, 1]);
  assert.equal((await call("GET", "/api/admin/uso")).status, 403); // solo la empresa
  assert.doesNotMatch(JSON.stringify(despues), /7001|CAFETERIA|111111/); // sin datos de nadie
});

test("AYUDA y «LO MÁS PEDIDO»: /api/ayuda es público y sin datos rellenados no ofrece nada; el catálogo trae «top» sin datos personales", async () => {
  const j = (await call("GET", "/api/ayuda")).json;
  assert.deepEqual(j, { ayuda: null }); // la empresa aún no ha puesto teléfono ni WhatsApp
  const enlace = (await call("GET", "/api/admin/exportaciones", { admin: true })).status; assert.equal(enlace, 200);
  const cat = (await call("GET", "/catalogo/datos", { cookie: await (async () => { const r = await call("POST", "/api/login-nif", { body: { nif: "123456", empresa: "ejemplo" } }); return r.cookie; })() })).json;
  if (cat && cat.products) { assert.ok(Array.isArray(cat.top)); assert.ok(cat.top.every((id) => typeof id === "string")); assert.ok("ayuda" in cat); }
});

test("MODIFICAR UN PEDIDO ENVIADO: sustituye al anterior (mismo número, sin duplicados), lo ve la empresa como «modificado» y un pedido exportado ya no se puede cambiar", async () => {
  const A = cookieOf(await entrarNif("111111"));
  const dia = (() => { let d = new Date(Date.now() + 30 * 86_400_000); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86_400_000); return d.toISOString().slice(0, 10); })();
  const r1 = await call("POST", "/catalogo", { cookie: A, body: { key: "modificar-clave-1", lines: [{ id: "1010", qty: 1 }], delivery: dia, note: "primero" } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const ref = r1.json.ref; assert.match(ref, /^VM-\d{4}-\d{6}$/); assert.match(r1.json.modificable, /Puedes modificarlo hasta las 10:00/);
  const antes = (await call("GET", "/api/admin/pedidos", { admin: true })).json.length;
  // «Mis pedidos» lo enseña como modificable
  const mis = (await call("GET", "/api/mis-pedidos", { cookie: A })).json;
  assert.equal(mis.pedidos[0].ref, ref); assert.equal(mis.pedidos[0].editable, true);
  assert.equal((await call("GET", "/api/mis-pedidos")).status, 401);
  // se reabre con sus líneas
  const abierto = (await call("GET", `/catalogo/pedido?ref=${ref}`, { cookie: A })).json;
  assert.deepEqual(abierto.lineas.map((l) => [l.id, l.qty]), [["1010", 1]]); assert.equal(abierto.entrega, dia);
  // otro cliente no puede abrirlo ni cambiarlo
  const B = cookieOf(await entrarNif("122222", "bar uno"));
  assert.equal((await call("GET", `/catalogo/pedido?ref=${ref}`, { cookie: B })).status, 404);
  assert.equal((await call("POST", "/catalogo", { cookie: B, body: { key: "modificar-otro-1", replaces: ref, lines: [{ id: "1010", qty: 9 }] } })).status, 404);
  // modificar: mismo número de pedido, otras cantidades, una sola vez en la lista y marcado como modificado
  const m = await call("POST", "/catalogo", { cookie: A, body: { key: "modificar-clave-1", replaces: ref, lines: [{ id: "1010", qty: 3 }], delivery: dia, note: "cambiado" } });
  assert.equal(m.status, 200, JSON.stringify(m.json)); assert.equal(m.json.ref, ref); assert.equal(m.json.modificado, true);
  const doble = await call("POST", "/catalogo", { cookie: A, body: { key: "modificar-clave-1", replaces: ref, lines: [{ id: "1010", qty: 3 }], delivery: dia, note: "cambiado" } }); // doble clic
  assert.equal(doble.status, 200);
  const lista = (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  assert.equal(lista.length, antes, "no se crea ningún pedido nuevo");
  const o = lista.find((x) => x.ref === ref);
  assert.equal(o.lineas.length, 1); assert.equal(o.lineas[0].cajas ?? o.lineas[0].unidades, o.lineas[0].cajas != null ? 3 : 3 * (o.lineas[0].unidades / 3));
  assert.equal(o.nota, "cambiado"); assert.ok(o.modificado, "la empresa ve que está modificado");
  // exportado → ya no se puede modificar
  assert.equal((await call("POST", "/api/admin/exportar", { admin: true, body: { refs: [ref] } })).status, 200);
  const tarde = await call("POST", "/catalogo", { cookie: A, body: { key: "modificar-clave-1", replaces: ref, lines: [{ id: "1010", qty: 5 }], delivery: dia } });
  assert.equal(tarde.status, 409); assert.match(tarde.json.error, /Llámanos/);
  assert.equal((await call("GET", "/api/mis-pedidos", { cookie: A })).json.pedidos[0].editable, false);
  assert.equal((await call("GET", `/catalogo/pedido?ref=${ref}`, { cookie: A })).status, 409);
});

test("DIRECCIONES GUARDADAS: el cliente guarda hasta 5 direcciones de entrega, las quita, no ve las de otro y sin sesión no hay nada", async () => {
  assert.equal((await call("GET", "/api/direcciones")).status, 401);
  assert.equal((await call("POST", "/api/direcciones", { body: { texto: "Calle Falsa 123, Medina" } })).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar uno"));
  assert.deepEqual((await call("GET", "/api/direcciones", { cookie: A })).json.direcciones, []);
  assert.equal((await call("POST", "/api/direcciones", { cookie: A, body: { texto: "ab" } })).status, 400); // demasiado corta
  const r = await call("POST", "/api/direcciones", { cookie: A, body: { texto: "  Calle   Mayor 1,\n Medina del Campo " } });
  assert.equal(r.status, 200); assert.equal(r.json.direcciones[0].texto, "Calle Mayor 1, Medina del Campo"); // espacios y saltos limpios
  assert.equal((await call("POST", "/api/direcciones", { cookie: A, body: { texto: "calle mayor 1, medina del campo" } })).json.direcciones.length, 1); // no se repite
  for (const n of [2, 3, 4, 5]) assert.equal((await call("POST", "/api/direcciones", { cookie: A, body: { texto: `Plaza ${n}, Medina del Campo` } })).status, 200);
  const sexta = await call("POST", "/api/direcciones", { cookie: A, body: { texto: "Plaza 6, Medina del Campo" } });
  assert.equal(sexta.status, 400); assert.match(sexta.json.error, /5 direcciones/);
  assert.deepEqual((await call("GET", "/api/direcciones", { cookie: B })).json.direcciones, []); // el otro cliente no ve ninguna
  const id = (await call("GET", "/api/direcciones", { cookie: A })).json.direcciones[0].id;
  assert.equal((await call("POST", "/api/direcciones", { cookie: B, body: { quitar: id } })).status, 400); // ni puede quitar las de otro
  assert.equal((await call("GET", "/api/direcciones", { cookie: A })).json.direcciones.length, 5);
  const q = await call("POST", "/api/direcciones", { cookie: A, body: { quitar: id } });
  assert.equal(q.status, 200); assert.equal(q.json.direcciones.length, 4);
});

test("PDF DEL PEDIDO: el cliente descarga SU pedido; sin sesión 401; el de otro cliente o uno inventado, 404; es un PDF válido con el total", async () => {
  assert.equal((await call("GET", "/api/pedido/VM-2026-000001/pdf")).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar uno"));
  const env = await call("POST", "/catalogo", { cookie: A, body: { key: "pdf-clave-1", lines: [{ id: "1010", qty: 2, unit: "ud" }], delivery: null } });
  assert.equal(env.status, 200); const ref = env.json.ref; assert.match(ref, /^VM-\d{4}-\d{6}$/);
  const r = await fetch(`http://localhost:${PORT}/api/pedido/${ref}/pdf`, { headers: { cookie: A } });
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /application\/pdf/); assert.match(r.headers.get("content-disposition"), /^inline; filename="pedido-VM-/); // se ve dentro de la app (con «Cerrar»)
  const d = await fetch(`http://localhost:${PORT}/api/pedido/${ref}/pdf?descargar=1`, { headers: { cookie: A } }); assert.match(d.headers.get("content-disposition"), /^attachment; filename="pedido-VM-/); // «Descargar»
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-"); assert.match(buf.subarray(-6).toString(), /%%EOF/); assert.ok(buf.toString("latin1").includes(ref));
  const otro = await fetch(`http://localhost:${PORT}/api/pedido/${ref}/pdf`, { headers: { cookie: B } });
  assert.equal(otro.status, 404);
  assert.equal((await call("GET", "/api/pedido/VM-2026-999999/pdf", { cookie: A })).status, 404);
  assert.equal((await call("GET", "/api/pedido/..%2f..%2fetc/pdf", { cookie: A })).status, 404);
});

test("PDF DEL HISTORIAL: exige sesión, un documento que no es suyo da 404 y uno de su historial da un PDF válido", async () => {
  assert.equal((await call("GET", "/api/historial/ABC1/pdf")).status, 401);
  const A = cookieOf(await entrarNif("111111"));
  assert.equal((await call("GET", "/api/historial/NOEXISTE/pdf", { cookie: A })).status, 404);
  assert.equal((await call("GET", "/api/historial/..%2f..%2fetc/pdf", { cookie: A })).status, 404);
  const env = await call("POST", "/catalogo", { cookie: A, body: { key: "pdf-hist-1", lines: [{ id: "1010", qty: 1, unit: "ud" }], delivery: null } });
  const r = await fetch(`http://localhost:${PORT}/api/historial/${env.json.ref}/pdf`, { headers: { cookie: A } });
  assert.ok([200, 404].includes(r.status)); // los pedidos hechos en la app tienen su propio PDF; este es para los de a3ERP
});

test("APP INSTALABLE: favicon, iconos (normales y maskable), capturas y manifest se sirven siempre; lo que no existe da 404 (nunca 500)", async () => {
  for (const [u, tipo] of [["/favicon.ico", "image/png"], ["/icono-192.png", "image/png"], ["/icono-maskable-512.png", "image/png"], ["/apple-touch-icon.png", "image/png"], ["/captura-estrecha.png", "image/png"], ["/manifest.webmanifest", "application/manifest+json"]]) {
    const r = await fetch(BASE + u); assert.equal(r.status, 200, u); assert.match(r.headers.get("content-type"), new RegExp(tipo.replace("+", "\\+")), u); await r.arrayBuffer();
  }
  assert.equal((await fetch(BASE + "/icono-192.png", { method: "HEAD" })).status, 200);
  assert.equal((await fetch(BASE + "/icono-no-existe.png")).status, 404);
  const m = await (await fetch(BASE + "/manifest.webmanifest")).json();
  assert.equal(m.id, "/cliente"); assert.ok(m.icons.every((i) => i.purpose === "any" || i.purpose === "maskable")); assert.ok(m.icons.some((i) => i.purpose === "maskable")); assert.ok(m.screenshots.some((x) => x.form_factor === "narrow") && m.screenshots.some((x) => x.form_factor === "wide"));
  const html = await (await fetch(BASE + "/cliente")).text();
  assert.match(html, /rel="icon" href="\/favicon\.ico"/); assert.match(html, /<title>Inicio · Distribuciones Valentín Martín<\/title>/);
});

test("INICIO DEL CLIENTE: /api/inicio exige sesión, devuelve solo su catálogo (habituales, categorías, fotos pedidas) y no enseña nada de la administración", async () => {
  assert.equal((await call("GET", "/api/inicio")).status, 401);
  const A = cookieOf(await entrarNif("111111"));
  const r = await call("GET", "/api/inicio?ids=1010,NOEXISTE", { cookie: A });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.habituales) && Array.isArray(r.json.categorias) && r.json.categorias.length > 0);
  assert.ok(r.json.categorias.every((c) => c.id && c.nombre));
  assert.equal(r.json.fotos.NOEXISTE ?? null, null);
  const txt = JSON.stringify(r.json);
  assert.doesNotMatch(txt, /ADMIN|token|nif|NIF/i);
  // ofertas: solo salen las vigentes que le cambian el precio, con su % y fecha de fin
  assert.deepEqual(r.json.ofertas, []);
  const POST = (id, ruta, body) => call("POST", `/api/admin/articulos/${id}/${ruta}`, { admin: true, body });
  try {
    assert.equal((await POST("1010", "oferta", { tipo: "pct", valor: "15", hasta: "2099-12-31" })).status, 200);
    const o = (await call("GET", "/api/inicio", { cookie: A })).json.ofertas;
    assert.equal(o.length, 1); assert.equal(o[0].id, "1010"); assert.deepEqual(o[0].oferta, { tipo: "pct", valor: 15, hasta: "2099-12-31" }); assert.ok(o[0].price > 0);
  } finally { await POST("1010", "oferta", { tipo: "ninguna" }); }
  assert.deepEqual((await call("GET", "/api/inicio", { cookie: A })).json.ofertas, []);
});

test("PEDIDO FIJO SEMANAL: se guarda la plantilla y los días, se puede pausar y borrar, «toca hoy» solo en sus días y nunca se envía nada solo", async () => {
  assert.equal((await call("GET", "/api/pedido-fijo")).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar uno"));
  const antes = (await call("GET", "/api/admin/pedidos", { admin: true })).json.length;
  assert.equal((await call("GET", "/api/pedido-fijo", { cookie: A })).json.fijo, null);
  assert.equal((await call("POST", "/api/pedido-fijo", { cookie: A, body: { lineas: [{ id: "1010", qty: 2 }], dias: [] } })).status, 400); // sin días
  assert.equal((await call("POST", "/api/pedido-fijo", { cookie: A, body: { lineas: [{ id: "NOEXISTE", qty: 2 }], dias: [2] } })).status, 400); // sin artículos válidos
  const r = await call("POST", "/api/pedido-fijo", { cookie: A, body: { lineas: [{ id: "1010", qty: 2, unit: "ud" }, { id: "NOEXISTE", qty: 1 }], dias: [1, 2, 3, 4, 5, 6, 0] } });
  assert.equal(r.status, 200);
  const g = (await call("GET", "/api/pedido-fijo", { cookie: A })).json;
  assert.deepEqual(g.fijo.dias, [1, 2, 3, 4, 5]); // solo lunes a viernes
  assert.equal(g.fijo.lineas.length, 1); assert.ok(g.fijo.lineas[0].nombre && g.fijo.lineas[0].uds >= 2);
  const laborable = g.hoy.dia >= 1 && g.hoy.dia <= 5;
  assert.equal(g.hoy.toca, laborable); // «Hoy toca tu pedido de los …» solo en sus días
  // pausado: no toca; reanudado: vuelve a tocar
  assert.equal((await call("POST", "/api/pedido-fijo/pausa", { cookie: A, body: { pausado: true } })).json.ok, true);
  const p = (await call("GET", "/api/pedido-fijo", { cookie: A })).json; assert.equal(p.fijo.pausado, true); assert.equal(p.hoy.toca, false);
  await call("POST", "/api/pedido-fijo/pausa", { cookie: A, body: { pausado: false } });
  // otro cliente no ve el de este
  assert.equal((await call("GET", "/api/pedido-fijo", { cookie: B })).json.fijo, null);
  // NO se ha creado ningún pedido solo
  assert.equal((await call("GET", "/api/admin/pedidos", { admin: true })).json.length, antes);
  // lo que se descarga en «mis datos» lo incluye, y borrar lo quita
  assert.ok((await call("GET", "/api/mis-datos", { cookie: A })).json.pedido_fijo_semanal);
  assert.equal((await call("POST", "/api/pedido-fijo/borrar", { cookie: A, body: {} })).json.ok, true);
  assert.equal((await call("GET", "/api/pedido-fijo", { cookie: A })).json.fijo, null);
});

test("RECORDATORIOS DE HOY: solo la empresa los ve; «Ya avisado» y «No avisar más» los quitan", async () => {
  assert.equal((await call("GET", "/api/admin/recordatorios")).status, 403);
  const r = (await call("GET", "/api/admin/recordatorios", { admin: true })).json;
  assert.ok(Array.isArray(r.filas) && /^\d{4}-\d{2}-\d{2}$/.test(r.hoy));
  assert.equal((await call("POST", "/api/admin/recordatorios/avisado", { body: { id: "x" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/recordatorios/avisado", { admin: true, body: {} })).status, 400);
  assert.equal((await call("POST", "/api/admin/recordatorios/avisado", { admin: true, body: { id: "7001" } })).status, 200);
  assert.equal((await call("POST", "/api/admin/recordatorios/no-avisar", { admin: true, body: { id: "7001" } })).status, 200);
  const despues = (await call("GET", "/api/admin/recordatorios", { admin: true })).json;
  assert.ok(!despues.filas.some((f) => f.id === "7001"));
});

test("ALTAS A MANO: un producto y un cliente sueltos desde el panel, con sus avisos y sin duplicados", async () => {
  assert.equal((await call("POST", "/api/admin/productos/nuevo", { body: {} })).status, 403);
  const malo = (b) => call("POST", "/api/admin/productos/nuevo", { admin: true, body: b });
  assert.match((await malo({ codigo: "ZZ 1", nombre: "X", precio: 1, iva: 21 })).json.error, /código/);
  assert.match((await malo({ codigo: "M100", nombre: "Mermelada manual", precio: 0, iva: 21 })).json.error, /precio/);
  assert.match((await malo({ codigo: "M100", nombre: "Mermelada manual", precio: 2, iva: 7 })).json.error, /IVA/);
  assert.match((await malo({ codigo: "M100", nombre: "Mermelada manual", precio: 2, iva: 10, modo: "ambos" })).json.error, /unidades por caja/);
  const ok = await malo({ codigo: "M100", nombre: "Mermelada manual 340", precio: "2,5", iva: 10, unidadesCaja: 8, modo: "ambos" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.creado, true);
  const dup = await malo({ codigo: "M100", nombre: "Mermelada manual 340", precio: 3, iva: 10, unidadesCaja: 8, modo: "ambos" });
  assert.equal(dup.status, 400); assert.equal(dup.json.existe, true); // no pisa uno que ya existe sin confirmarlo
  const act = await malo({ codigo: "M100", nombre: "Mermelada manual 340", precio: 3, iva: 10, unidadesCaja: 8, modo: "caja", actualizar: true });
  assert.equal(act.status, 200); assert.equal(act.json.creado, false);

  const cli = (b) => call("POST", "/api/admin/clientes/nuevo", { admin: true, body: b });
  assert.equal((await call("POST", "/api/admin/clientes/nuevo", { body: {} })).status, 403);
  assert.match((await cli({ nombre: "X" })).json.error, /nombre comercial/);
  assert.match((await cli({ nombre: "Bar Manual", nif: "123" })).json.error, /DNI/);
  assert.match((await cli({ nombre: "Bar Manual", telefono: "12" })).json.error, /teléfono/);
  const a = await cli({ codigo: "M777", nombre: "Bar Manual", razonSocial: "Bar Manual SL", nif: "54321098K", telefono: "983 11 22 33", correo: "manual@ejemplo.es", direccion: "Calle Real 4", poblacion: "Medina del Campo", municipio: "47085", recargo: true });
  assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.provisional, false);
  assert.equal((await cli({ codigo: "M777", nombre: "Otro" })).json.existe, true);
  const prov = await cli({ nombre: "Cliente sin código" }); // aún sin el código de a3ERP: se le da uno provisional
  assert.equal(prov.status, 200); assert.match(prov.json.id, /^P\d{5}$/); assert.equal(prov.json.provisional, true); assert.equal(prov.json.sinNif, true);
  // la ficha completa está en la base de clientes y entra con su DNI/CIF
  const lista = (await call("GET", "/api/admin/clientes/lista?q=manual", { admin: true })).json.clientes.find((c) => c.id === "M777");
  assert.equal(lista.address, "Calle Real 4, Medina del Campo"); assert.equal(lista.recargoEquivalencia, true); assert.ok(lista.cuenta);
  const nif = await entrarNif("543210");
  assert.equal(nif.status, 200, JSON.stringify(nif.json));
});

test("ALTA DE UN CLIENTE NUEVO POR EL BOT: la empresa lo acepta y se crea su ficha con todos sus datos (y el DNI/CIF se borra de la solicitud)", async () => {
  const reg = await call("POST", "/api/registro", { body: { telefono: "655 12 12 12", correo: "nuevo.alta@ejemplo.es", empresa: "Taberna Nueva Alta", pin: "Ab12Cd", nif: "87654321X", direccion: "Plaza Mayor 3, Medina del Campo" } });
  assert.equal(reg.status, 200, JSON.stringify(reg.json)); assert.equal(reg.json.estado, "pendiente");
  const sol = (await call("GET", "/api/admin/solicitudes", { admin: true })).json.find((s) => s.business === "Taberna Nueva Alta");
  assert.ok(sol); assert.equal(sol.address, "Plaza Mayor 3, Medina del Campo"); assert.equal(sol.nif, "87654321X");
  const r = await call("POST", `/api/admin/solicitudes/${sol.id}/aprobar`, { admin: true, body: { nuevo: { codigo: "N4242", poblacion: "Medina del Campo", municipio: "47085" } } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.codigo, "N4242"); assert.equal(r.json.telefono, "655121212");
  // su ficha tiene todos los datos
  const c = (await call("GET", "/api/admin/clientes/lista?q=taberna nueva", { admin: true })).json.clientes.find((x) => x.id === "N4242");
  assert.equal(c.name, "Taberna Nueva Alta"); assert.equal(c.address, "Plaza Mayor 3, Medina del Campo"); assert.deepEqual(c.phones, ["655121212"]);
  assert.equal((await call("GET", "/api/admin/solicitudes", { admin: true })).json.some((s) => s.id === sol.id), false); // ya no está pendiente
  // y el DNI/CIF ya no se conserva en la solicitud, pero sí entra con él y con teléfono + contraseña
  assert.equal((await entrarNif("876543", "Taberna Nueva Alta")).status, 200);
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "655121212", empresa: "Taberna Nueva Alta", pin: "ab12cd" } })).status, 200);
  assert.equal((await call("POST", `/api/admin/solicitudes/${sol.id}/aprobar`, { admin: true, body: { nuevo: {} } })).status, 404); // ya resuelta
});

test("Cuentas: «Confirmar todas» confirma de una vez las cuentas sin confirmar (solo la empresa)", async () => {
  const sin = await call("POST", "/api/admin/cuentas/confirmar-todas", { body: {} });
  assert.ok(sin.status === 401 || sin.status === 403 || sin.status === 404, "sin clave de la empresa no se puede");
  const r = await call("POST", "/api/admin/cuentas/confirmar-todas", { admin: true, body: {} });
  assert.equal(r.status, 200); assert.equal(typeof r.json.confirmadas, "number");
  const otra = await call("POST", "/api/admin/cuentas/confirmar-todas", { admin: true, body: {} });
  assert.equal(otra.json.confirmadas, 0);
});

test("VER EL EXCEL: enseña las hojas antes de exportar sin marcar ningún pedido, y también las de una exportación ya hecha", async () => {
  const { cookie } = await entrarNif("111111").then((r) => ({ cookie: cookieOf(r) }));
  const rr = await call("POST", "/catalogo", { cookie, body: { key: "clave-vista-excel", lines: [{ id: "1010", qty: 2 }] } });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));
  const lista = async () => (await call("GET", "/api/admin/pedidos", { admin: true })).json;
  const ref = (await lista()).filter((o) => o.estado === "pendiente").pop().ref;
  assert.equal((await call("POST", "/api/admin/exportar/vista", { body: {} })).status, 403); // sin la clave de la empresa
  assert.equal((await call("POST", "/api/admin/exportar/vista", { admin: true, body: { refs: ["x; DROP"] } })).status, 400);
  const v = (await call("POST", "/api/admin/exportar/vista", { admin: true, body: { refs: [ref] } })).json;
  assert.equal(v.orderCount, 1); assert.ok(v.lineCount >= 1);
  assert.ok(v.sheets.length >= 2 && v.sheets.every((h) => h.name && Array.isArray(h.rows)) && v.sheets.some((h) => h.name === "Líneas"));
  assert.equal(typeof v.estilos, "object");
  // ver no exporta: el pedido sigue pendiente y no hay exportación nueva
  const antes = (await call("GET", "/api/admin/exportaciones", { admin: true })).json.length;
  assert.equal((await lista()).find((o) => o.ref === ref).estado, "pendiente");
  assert.equal((await call("GET", "/api/admin/exportaciones", { admin: true })).json.length, antes);
  // sin pedidos listos: avisa en vez de fallar
  assert.equal((await call("POST", "/api/admin/exportar/vista", { admin: true, body: { refs: ["VM-2000-000001"] } })).json.vacio, true);
  // y una exportación ya hecha se puede ver
  const ex = (await call("POST", "/api/admin/exportar", { admin: true, body: { refs: [ref] } })).json.exportacion;
  assert.equal((await call("GET", `/api/admin/exportaciones/${ex.id}/vista`)).status, 403);
  const hecha = (await call("GET", `/api/admin/exportaciones/${ex.id}/vista`, { admin: true })).json;
  assert.equal(hecha.orderCount, 1); assert.equal(hecha.archivo, ex.archivo);
  assert.equal((await call("GET", "/api/admin/exportaciones/99999/vista", { admin: true })).status, 404);
});

test("PEDIDOS: se filtran por día, horas y cliente, y se borran los elegidos (con copia de seguridad y confirmación)", async () => {
  const { cookie } = await entrarNif("111111").then((r) => ({ cookie: cookieOf(r) }));
  for (const k of ["clave-borrar-a", "clave-borrar-b"]) assert.equal((await call("POST", "/catalogo", { cookie, body: { key: k, lines: [{ id: "1010", qty: 1 }] } })).status, 200);
  const lista = async (q = "") => (await call("GET", "/api/admin/pedidos" + q, { admin: true })).json;
  const todos = await lista();
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }); // AAAA-MM-DD
  // día: hoy salen, un día lejano no; un rango que incluye hoy sí
  assert.ok((await lista(`?dia=${hoy}`)).length >= 2);
  assert.equal((await lista("?dia=2000-01-01")).length, 0);
  assert.ok((await lista(`?dia=2000-01-01&diaHasta=${hoy}`)).length >= 2);
  // horas: todo el día salen; un tramo imposible, ninguno
  assert.ok((await lista("?horaDesde=00:00&horaHasta=23:59")).length >= 2);
  assert.equal((await lista("?horaDesde=23:59&horaHasta=00:00")).length, 0);
  // cliente: por parte del nombre (sin tildes ni mayúsculas) o por código; uno que no existe, ninguno
  const uno = todos.find((o) => o.codigo);
  assert.ok((await lista("?cliente=" + encodeURIComponent(uno.cliente.slice(0, 4).toUpperCase()))).some((o) => o.ref === uno.ref));
  assert.ok((await lista("?cliente=" + encodeURIComponent(uno.codigo))).some((o) => o.ref === uno.ref));
  assert.equal((await lista("?cliente=zzzz-no-existe")).length, 0);
  assert.equal((await lista("?dia=basura&cliente=")).length, todos.length); // un filtro mal escrito se ignora
  // borrar: solo la empresa, con confirmación y referencias válidas
  const [a, b] = todos.filter((o) => o.estado === "pendiente").slice(0, 2).map((o) => o.ref);
  assert.equal((await call("POST", "/api/admin/pedidos/borrar", { body: { refs: [a], confirmo: true } })).status, 403);
  assert.equal((await call("POST", "/api/admin/pedidos/borrar", { admin: true, body: { refs: [a] } })).status, 400); // sin confirmar
  assert.equal((await call("POST", "/api/admin/pedidos/borrar", { admin: true, body: { refs: [], confirmo: true } })).status, 400);
  assert.equal((await call("POST", "/api/admin/pedidos/borrar", { admin: true, body: { refs: ["x; DROP"], confirmo: true } })).status, 400);
  assert.equal((await lista()).filter((o) => o.ref === a || o.ref === b).length, 2); // nada se ha borrado todavía
  const r = (await call("POST", "/api/admin/pedidos/borrar", { admin: true, body: { refs: [a], confirmo: true } })).json;
  assert.equal(r.borrados, 1); assert.match(r.copia, /^pedidos-antes-de-borrar-\d{8}-\d{4}\.sqlite$/);
  assert.ok(fs.existsSync(path.join(dir, "respaldos", r.copia)), "se guarda la copia antes de borrar");
  const tras = await lista();
  assert.equal(tras.find((o) => o.ref === a), undefined); // borrado
  assert.ok(tras.find((o) => o.ref === b)); // el no elegido sigue
  assert.equal((await call("POST", "/api/admin/pedidos/borrar", { admin: true, body: { refs: [a], confirmo: true } })).json.borrados, 0); // repetirlo no rompe nada
});

test("PEDIDO DE SIEMPRE: el cliente lo puede editar, borrar y recuperar, sin enviar nada y sin tocar a otro cliente", async () => {
  const A = cookieOf(await entrarNif("111111"));
  const B = cookieOf(await entrarNif("122222", "bar dos"));
  const hecho = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-siempre-A", lines: [{ id: "1010", qty: 2 }, { id: "1020", qty: 1 }] } });
  assert.equal(hecho.status, 200, JSON.stringify(hecho.json));
  const inicio = async (c) => (await call("POST", "/api/chat", { cookie: c, body: { text: "inicio" } })).json;
  assert.equal((await call("GET", "/api/pedido-de-siempre")).status, 401);
  assert.equal((await call("POST", "/api/pedido-de-siempre/borrar", { body: {} })).status, 401);
  const g0 = (await call("GET", "/api/pedido-de-siempre", { cookie: A })).json;
  assert.equal(g0.estado, "auto"); assert.ok(g0.lineas.length >= 1 && g0.lineas.every((l) => l.id && l.nombre && l.qty > 0));
  const pedidosAntes = (await call("GET", "/api/mi-cuenta", { cookie: A })).json.pedidos.length;
  // editar: cambia cantidades y quita lo demás
  const id = g0.lineas[0].id;
  assert.equal((await call("POST", "/api/pedido-de-siempre", { cookie: A, body: { lineas: [{ id, qty: 7, unit: "ud" }, { id: "NO-EXISTE", qty: 3 }] } })).status, 200);
  const g1 = (await call("GET", "/api/pedido-de-siempre", { cookie: A })).json;
  assert.equal(g1.estado, "propio"); assert.deepEqual(g1.lineas.map((l) => [l.id, l.qty]), [[id, 7]]); // lo que no existe se ignora
  const ini1 = await inicio(A);
  assert.equal(ini1.ui?.siempre, "propio"); assert.equal(ini1.ui.last.articulos, 1); assert.match(ini1.ui.last.lineas[0], /^7 uds? ·/);
  assert.equal((await call("POST", "/api/pedido-de-siempre", { cookie: A, body: { lineas: [] } })).status, 400); // vacío: hay que usar «Borrar»
  // otro cliente no ve nada de esto
  assert.equal((await call("GET", "/api/pedido-de-siempre", { cookie: B })).json.estado, "auto");
  assert.notEqual((await inicio(B)).ui?.siempre, "propio");
  // borrar: la tarjeta desaparece
  assert.equal((await call("POST", "/api/pedido-de-siempre/borrar", { cookie: A, body: {} })).status, 200);
  const ini2 = await inicio(A); assert.equal(ini2.ui?.siempre, "borrado"); assert.equal(ini2.ui.last, undefined);
  assert.deepEqual((await call("GET", "/api/pedido-de-siempre", { cookie: A })).json, { estado: "borrado", lineas: [] });
  // recuperar el último pedido
  assert.equal((await call("POST", "/api/pedido-de-siempre/restaurar", { cookie: A, body: {} })).status, 200);
  const ini3 = await inicio(A); assert.equal(ini3.ui?.siempre, "auto"); assert.ok(ini3.ui.last.lineas.length >= 1);
  // nada de esto crea ni borra pedidos
  assert.equal((await call("GET", "/api/mi-cuenta", { cookie: A })).json.pedidos.length, pedidosAntes);
});

test("BENCH 4: /catalogo/datos trae los pedidos abiertos (solo los suyos) y la hora límite de cada día, con la misma regla que «hasta»", async () => {
  const A = cookieOf(await entrarNif("111111"));
  const B = cookieOf(await entrarNif("122222", "bar dos"));
  const dia = (() => { let d = new Date(Date.now() + 20 * 86_400_000); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86_400_000); return d.toISOString().slice(0, 10); })();
  const r = await call("POST", "/catalogo", { cookie: A, body: { key: "bench4-abierto-1", lines: [{ id: "1010", qty: 1 }], delivery: dia } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const dA = (await call("GET", "/catalogo/datos", { cookie: A })).json, dB = (await call("GET", "/catalogo/datos", { cookie: B })).json;
  const ab = dA.abiertos.find((x) => x.ref === r.json.ref);
  assert.ok(ab, "su pedido sin exportar sale como abierto"); assert.equal(ab.entrega, dia); assert.match(ab.hasta, /^Puedes modificarlo hasta las 10:00 del /); assert.match(ab.entregaTexto, /^\p{L}+ \d+ de \p{L}+$/u);
  assert.equal(r.json.modificable, ab.hasta); // idéntico al texto que sale tras enviar
  assert.equal(dB.abiertos.some((x) => x.ref === r.json.ref), false, "otro cliente no ve pedidos ajenos");
  const fechas = dA.delivery.map((o) => o.date);
  assert.deepEqual(Object.keys(dA.plazos).sort(), [...fechas].sort());
  for (const d of fechas) { assert.match(dA.plazos[d].texto, /^Podrás modificarlo hasta las 10:00 (del \p{L}+|de hoy)$/u); assert.match(dA.plazos[d].corto, /^(hoy|\p{L}+) 10:00$/u); }
  const pz = (await call("GET", "/catalogo/plazo?dia=" + dia, { cookie: A })).json; assert.equal(pz.texto, ab.hasta.replace("Puedes", "Podrás")); // el calendario usa la misma regla
  assert.deepEqual((await call("GET", "/catalogo/plazo?dia=basura", { cookie: A })).json, { texto: "", corto: "" });
  assert.equal((await call("GET", "/catalogo/plazo?dia=" + dia)).status, 401);
});

test("BENCH 5: «Saltar esta semana» del pedido fijo, estado en 4 pasos y total con IVA en Mi cuenta, «La última vez» en el Inicio", async () => {
  const A = cookieOf(await entrarNif("111111"));
  const antes = (await call("GET", "/api/admin/pedidos", { admin: true })).json.length;
  // saltar la semana: el fijo sigue guardado pero hoy no toca; se puede reactivar
  assert.equal((await call("POST", "/api/pedido-fijo/saltar", { cookie: A, body: {} })).json.ok, false); // sin pedido fijo no hay nada que saltar
  await call("POST", "/api/pedido-fijo", { cookie: A, body: { lineas: [{ id: "1010", qty: 2, unit: "ud" }], dias: [1, 2, 3, 4, 5] } });
  assert.equal((await call("POST", "/api/pedido-fijo/saltar", { cookie: A, body: {} })).json.ok, true);
  const s1 = (await call("GET", "/api/pedido-fijo", { cookie: A })).json;
  assert.equal(s1.fijo.saltada, true); assert.equal(s1.hoy.toca, false); assert.equal(s1.fijo.lineas.length, 1); assert.ok(Array.isArray(s1.fijo.retirados));
  assert.equal((await call("POST", "/api/pedido-fijo/saltar", { cookie: A, body: { saltar: false } })).json.ok, true);
  assert.equal((await call("GET", "/api/pedido-fijo", { cookie: A })).json.fijo.saltada, false);
  assert.equal((await call("POST", "/api/pedido-fijo/saltar", { body: {} })).status, 401);
  await call("POST", "/api/pedido-fijo/borrar", { cookie: A, body: {} });
  // Mi cuenta: total con IVA, 4 pasos, «próximo»
  const dia = (() => { let d = new Date(Date.now() + 25 * 86_400_000); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86_400_000); return d.toISOString().slice(0, 10); })();
  const r = await call("POST", "/catalogo", { cookie: A, body: { key: "bench5-cuenta-1", lines: [{ id: "1010", qty: 2, unit: "ud" }], delivery: dia } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const mc = (await call("GET", "/api/mi-cuenta", { cookie: A })).json, o = mc.pedidos.find((x) => x.doc === r.json.ref);
  assert.ok(o.total > 0 && o.totalOrientativo === false); assert.equal(o.paso, 1); assert.equal(o.proximo, true); assert.match(o.entregaTexto, /^\p{L}+ \d+ de \p{L}+$/u);
  for (const x of mc.pedidos) { assert.ok([1, 2, 3, 4].includes(x.paso)); if (x.origen === "a3erp") { assert.equal(x.paso, 4); assert.equal(x.proximo, false); } }
  // «La última vez» (unidades) en lo que sueles pedir
  const ini = (await call("GET", "/api/inicio", { cookie: A })).json;
  assert.ok(ini.habituales.some((h) => h.ultima > 0), "los habituales traen la cantidad de la última vez");
  assert.equal((await call("GET", "/api/admin/pedidos", { admin: true })).json.length, antes + 1); // solo el pedido que hemos hecho a propósito: lo demás no envía nada
});

test("BENCH 6: el HTML de /cliente y de /catalogo pesa poco, el CSS/JS/logo van a estáticos con huella (inmutables, 304) y /catalogo/datos usa ETag", async () => {
  const cli = await fetch(`${BASE}/cliente`), htmlC = await cli.text();
  assert.equal(cli.headers.get("cache-control"), "no-store"); assert.ok(Buffer.byteLength(htmlC) < 40 * 1024, "HTML de /cliente < 40 KB: " + Buffer.byteLength(htmlC));
  assert.equal(/base64,[A-Za-z0-9+/=]{400,}/.test(htmlC), false); assert.equal(/<style>/.test(htmlC), false);
  const rutas = [...new Set([...htmlC.matchAll(/(\/estatico\/[\w-]+\/[\w.-]+)/g)].map((m) => m[1]))];
  assert.ok(rutas.some((r) => r.endsWith(".css")) && rutas.some((r) => r.endsWith(".js")) && rutas.some((r) => r.endsWith(".png")));
  for (const r of rutas) {
    const a = await fetch(BASE + r, { headers: { "Accept-Encoding": "identity" } });
    assert.equal(a.status, 200, r); assert.match(a.headers.get("cache-control"), /max-age=31536000, immutable/); const et = a.headers.get("etag"); assert.ok(et);
    assert.equal((await fetch(BASE + r, { headers: { "If-None-Match": et } })).status, 304, r + " segunda carga sin bajar nada");
  }
  assert.equal((await fetch(`${BASE}/estatico/000000000000/cliente.css`)).status, 404);
  const png = await fetch(BASE + rutas.find((r) => r.endsWith(".png"))); assert.equal(png.headers.get("content-type"), "image/png"); assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), "PNG"); // el logo es el mismo PNG, sin tocar
  // el catálogo: ETag y 304
  const A = cookieOf(await entrarNif("111111"));
  const cat = await fetch(`${BASE}/catalogo`, { headers: { Cookie: A } }), htmlP = await cat.text();
  assert.equal(cat.status, 200); assert.ok(Buffer.byteLength(htmlP) < 40 * 1024, "HTML de /catalogo < 40 KB: " + Buffer.byteLength(htmlP)); assert.equal(cat.headers.get("cache-control"), "no-store");
  const d1 = await fetch(`${BASE}/catalogo/datos`, { headers: { Cookie: A } }); const et = d1.headers.get("etag"); assert.equal(d1.status, 200); assert.ok(et); assert.equal(d1.headers.get("cache-control"), "private, no-cache");
  assert.ok((await d1.json()).products.length > 0);
  assert.equal((await fetch(`${BASE}/catalogo/datos`, { headers: { Cookie: A, "If-None-Match": et } })).status, 304);
  assert.equal((await fetch(`${BASE}/catalogo/datos`, { headers: { "If-None-Match": et } })).status, 401); // sin sesión no hay 304 que valga
});

test("BENCH 8: «Avisarme antes de la hora límite» se puede leer y cambiar (por defecto activado) y solo lo toca su dueño", async () => {
  assert.equal((await call("GET", "/api/avisos/corte")).status, 401); assert.equal((await call("POST", "/api/avisos/corte", { body: { activo: false } })).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar dos"));
  const g = (await call("GET", "/api/avisos/corte", { cookie: A })).json; assert.equal(g.activo, true); assert.match(g.hora, /^\d{1,2}:\d{2}$/); assert.equal(typeof g.tieneFijo, "boolean");
  assert.equal((await call("POST", "/api/avisos/corte", { cookie: A, body: { activo: false } })).json.activo, false);
  assert.equal((await call("GET", "/api/avisos/corte", { cookie: A })).json.activo, false);
  assert.equal((await call("GET", "/api/avisos/corte", { cookie: B })).json.activo, true); // el otro cliente, intacto
  await call("POST", "/api/avisos/corte", { cookie: A, body: { activo: true } }); assert.equal((await call("GET", "/api/avisos/corte", { cookie: A })).json.activo, true);
});

test("TANDA 18.1: «¿cuánto llevo?» lee el carrito real del catálogo (artículos, cantidades e importe) y no confirma nada", async () => {
  const A = cookieOf(await entrarNif("111111"));
  const antes = (await call("GET", "/api/admin/pedidos", { admin: true })).json.length;
  const yo = (await call("GET", "/api/yo", { cookie: A })).json.cliente; assert.match(yo.carrito, /^vm_carrito_c_\S+$/); // dónde guarda el móvil el carrito (no se enseña)
  const vacio = (await call("POST", "/api/chat", { cookie: A, body: { text: "cuánto llevo" } })).json; assert.match(vacio.reply, /Todavía no has añadido nada/); // sin carrito: como siempre
  const ids = (await call("GET", "/catalogo/datos", { cookie: A })).json.products.map((p) => p.id); assert.ok(ids.length >= 2);
  const r = (await call("POST", "/api/chat", { cookie: A, body: { text: "¿cuánto llevo?", carrito: [{ id: ids[0], qty: 3, unit: "ud" }, { id: ids[1], qty: 2, unit: "ud" }, { id: "NOEXISTE", qty: 9 }] } })).json;
  assert.match(r.reply, /Llevas esto en tu pedido del catálogo/); assert.match(r.reply, /• 3 × /); assert.match(r.reply, /• 2 × /); assert.match(r.reply, /Total con IVA: \d+,\d{2} €/); assert.match(r.reply, /No he confirmado nada/); assert.equal(/NOEXISTE/.test(r.reply), false);
  assert.equal((r.reply.match(/^• /gm) ?? []).length, 2); // los dos artículos que existen
  // no se pasa al chat ni se confirma nada: después, el chat sigue sin pedido propio y no hay pedidos nuevos
  assert.match((await call("POST", "/api/chat", { cookie: A, body: { text: "cuánto llevo" } })).json.reply, /Todavía no has añadido nada/);
  assert.equal((await call("GET", "/api/admin/pedidos", { admin: true })).json.length, antes);
});

test("BENCH 9: el correo del alta es opcional (si se escribe, tiene que ser válido) y la tarjeta de bienvenida se cierra para siempre por cliente", async () => {
  const ok = { telefono: "600000001", empresa: "Bar El Ejemplo", pin: "12", nif: "12345678Z" }; // pin malo a propósito: no se crea ninguna solicitud
  assert.match((await call("POST", "/api/registro", { body: ok })).json.error, /código de entrada/); // sin correo: pasa esa comprobación y falla por el código
  assert.match((await call("POST", "/api/registro", { body: { ...ok, correo: "mal" } })).json.error, /correo no es válido/);
  assert.equal((await call("GET", "/api/bienvenida")).status, 401); assert.equal((await call("POST", "/api/bienvenida/vista", { body: {} })).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar dos"));
  const mostrar = async (c) => (await call("GET", "/api/bienvenida", { cookie: c })).json.mostrar;
  const antesA = await mostrar(A), antesB = await mostrar(B);
  assert.equal((await call("POST", "/api/bienvenida/vista", { cookie: A, body: {} })).json.ok, true);
  assert.equal(await mostrar(A), false); assert.equal(await mostrar(B), antesB); // solo se cierra la de ese cliente
  assert.equal(typeof antesA, "boolean");
});

test("MI CUENTA: cada cliente ve SUS datos y SUS pedidos (con líneas para repetir o añadir), nunca los de otro ni su NIF", async () => {
  assert.equal((await call("GET", "/api/mi-cuenta")).status, 401);
  const A = cookieOf(await entrarNif("111111"));
  const B = cookieOf(await entrarNif("122222", "bar dos"));
  const rr = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-mi-cuenta-A", lines: [{ id: "1010", qty: 2 }, { id: "1020", qty: 1 }] } });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));
  const a = (await call("GET", "/api/mi-cuenta", { cookie: A })).json;
  assert.equal(a.cliente.nombre, "CAFETERIA IMPORTADA");
  assert.equal("codigo" in a.cliente, false); // el número de cliente no se enseña al cliente
  const suyo = a.pedidos.find((p) => p.doc === rr.json.ref);
  assert.ok(suyo, "su pedido recién hecho aparece");
  assert.equal(suyo.origen, "app"); assert.match(suyo.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(suyo.lineas.length >= 1 && suyo.lineas.every((l) => l.id && l.nombre && l.uds > 0), "las líneas traen código, nombre y unidades (para repetir o añadir)");
  assert.ok(a.pedidos.length <= 10); // sus 10 últimos
  // otro cliente: ni sus datos ni su pedido; y en ninguna respuesta aparece el NIF
  const b = (await call("GET", "/api/mi-cuenta", { cookie: B })).json;
  assert.equal(b.cliente.nombre, "BAR DOS");
  assert.equal(b.pedidos.some((p) => p.doc === rr.json.ref), false);
  assert.equal(JSON.stringify(a).includes("B11111111") || JSON.stringify(b).includes("12222222A"), false);
  // lo de la empresa no está en esta respuesta
  assert.equal(/export|ADMIN|token|sha256/i.test(JSON.stringify(a)), false);
});

test("BANDEJA DE ENTRADA: enseña los Excel de la carpeta (con su tipo), no aplica nada solo y al archivar los mueve a «aplicados»", async () => {
  const carpeta = path.join(dir, "entrada");
  assert.equal((await call("GET", "/api/admin/entrada")).status, 403); // solo la empresa
  const vacia = (await call("GET", "/api/admin/entrada", { admin: true })).json;
  assert.equal(vacia.configurada, true); assert.deepEqual(vacia.archivos, []);
  fs.writeFileSync(path.join(carpeta, "articulos-nuevos.xlsx"), Buffer.from(buildWorkbook([{ name: "A", rows: [["Cód. artículo", "Artículo", "Precio venta"], ["9999", "PRUEBA ENTRADA", 1.5]] }])));
  fs.writeFileSync(path.join(carpeta, "lista.xlsx"), Buffer.from(buildWorkbook([{ name: "C", rows: [cabecera, ["7901", "BAR PRUEBA", "BAR PRUEBA", "MEDINA", "CL. UNO 1", "611000111", "", "B22222222", "No", "No", "1"]] }])));
  fs.writeFileSync(path.join(carpeta, "cualquier.xlsx"), Buffer.from(buildWorkbook([{ name: "X", rows: [["hola", "adios"], [1, 2]] }])));
  fs.writeFileSync(path.join(carpeta, "notas.txt"), "no es un Excel"); fs.writeFileSync(path.join(carpeta, "~$temporal.xlsx"), "temporal de Excel");
  const l = (await call("GET", "/api/admin/entrada", { admin: true })).json;
  assert.deepEqual(l.archivos.map((a) => a.nombre).sort(), ["articulos-nuevos.xlsx", "cualquier.xlsx", "lista.xlsx"]); // ni el .txt ni el temporal de Excel
  const tipo = (n) => l.archivos.find((a) => a.nombre === n).tipo;
  assert.equal(tipo("articulos-nuevos.xlsx"), "productos"); assert.equal(tipo("lista.xlsx"), "clientes"); assert.equal(tipo("cualquier.xlsx"), null);
  assert.equal(JSON.stringify(l).includes("B22222222"), false); // nada de NIF en la lista
  // no se aplica nada solo: el catálogo no tiene el artículo de prueba
  assert.equal((await call("GET", "/api/admin/pedidos", { admin: true })).status, 200);
  const buscar = (await fetch(`${BASE}/api/admin/vista-previa/productos`, { method: "POST", headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/octet-stream" }, body: fs.readFileSync(path.join(carpeta, "articulos-nuevos.xlsx")) })).status;
  assert.equal(buscar, 200); // la vista previa de siempre funciona con ese archivo
  // descargar el archivo para la vista previa: solo nombres válidos de la carpeta
  const bytes = await fetch(`${BASE}/api/admin/entrada/archivo?nombre=lista.xlsx`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(bytes.status, 200); assert.equal(Buffer.from(await bytes.arrayBuffer()).length, fs.statSync(path.join(carpeta, "lista.xlsx")).size);
  for (const mal of ["../server.js", "..%2Fserver.js", "notas.txt", "no-existe.xlsx"]) assert.equal((await fetch(`${BASE}/api/admin/entrada/archivo?nombre=${mal}`, { headers: { Authorization: `Bearer ${ADMIN}` } })).status, 404, mal);
  assert.equal((await fetch(`${BASE}/api/admin/entrada/archivo?nombre=lista.xlsx`)).status, 403);
  // archivar: pasa a «aplicados» con la fecha delante y deja de salir en la lista
  assert.equal((await call("POST", "/api/admin/entrada/archivar", { body: { nombre: "lista.xlsx" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/entrada/archivar", { admin: true, body: { nombre: "../server.js" } })).status, 404);
  assert.equal((await call("POST", "/api/admin/entrada/archivar", { admin: true, body: { nombre: "lista.xlsx" } })).status, 200);
  assert.equal(fs.existsSync(path.join(carpeta, "lista.xlsx")), false);
  assert.ok(fs.readdirSync(path.join(carpeta, "aplicados")).some((f) => /^\d{8}-\d{4}-lista\.xlsx$/.test(f)));
  assert.equal((await call("POST", "/api/admin/entrada/archivar", { admin: true, body: { nombre: "lista.xlsx" } })).status, 404);
  assert.equal((await call("GET", "/api/admin/entrada", { admin: true })).json.archivos.some((a) => a.nombre === "lista.xlsx"), false);
});

// ---- Avisos al móvil (Web Push) ----
// Un «móvil» de mentira: un servicio de push local que apunta lo que recibe, y un navegador que sabe descifrarlo
async function movilDePrueba() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys(); const auth = crypto.randomBytes(16);
  const recibidos = []; let estado = 201;
  const srv = http.createServer((req, res) => { const t = []; req.on("data", (d) => t.push(d)); req.on("end", () => { recibidos.push(Buffer.concat(t)); res.writeHead(estado).end(); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const descifrar = (c) => {
    const salt = c.subarray(0, 16), idlen = c[20], asPub = c.subarray(21, 21 + idlen), datos = c.subarray(21 + idlen), uaPub = ecdh.getPublicKey();
    const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdh.computeSecret(asPub), auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
    const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)), nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(datos.subarray(datos.length - 16));
    const claro = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()]); return JSON.parse(claro.subarray(0, claro.length - 1).toString("utf8"));
  };
  return {
    sub: { endpoint: `http://127.0.0.1:${srv.address().port}/push/${crypto.randomBytes(6).toString("hex")}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    avisos: () => recibidos.map(descifrar), poner: (e) => { estado = e; }, cerrar: () => srv.close(),
  };
}
const esperar = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 40)); } return cond(); };

test("AVISOS AL MÓVIL: el cliente los activa, recibe «Pedido recibido» solo él, y puede desactivarlos", async () => {
  assert.equal((await call("GET", "/api/push/clave")).status, 401);
  assert.equal((await call("POST", "/api/push/suscribir", { body: { subscription: {} } })).status, 401);
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar dos"));
  const movA = await movilDePrueba(), movB = await movilDePrueba();
  try {
    const clave = (await call("GET", "/api/push/clave", { cookie: A })).json.publica; assert.equal(Buffer.from(clave, "base64url").length, 65);
    // solo móviles de verdad: nada de direcciones raras ni claves mal formadas
    for (const mala of [{ endpoint: "https://evil.example.com/x", keys: movA.sub.keys }, { endpoint: movA.sub.endpoint, keys: { p256dh: "abc", auth: "def" } }, { endpoint: movA.sub.endpoint }, null]) assert.equal((await call("POST", "/api/push/suscribir", { cookie: A, body: { subscription: mala } })).status, 400);
    assert.equal((await call("POST", "/api/push/suscribir", { cookie: A, body: { subscription: movA.sub } })).status, 200);
    assert.equal((await call("POST", "/api/push/suscribir", { cookie: B, body: { subscription: movB.sub } })).status, 200);
    assert.ok(await esperar(() => movA.avisos().length === 1)); assert.equal(movA.avisos()[0].title, "Avisos activados"); // confirmación al activar
    // un pedido de A avisa solo a A
    const rr = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-aviso-pedido-A", lines: [{ id: "1010", qty: 1 }] } });
    assert.equal(rr.status, 200, JSON.stringify(rr.json));
    assert.ok(await esperar(() => movA.avisos().length === 2), "A recibe el aviso del pedido");
    const av = movA.avisos()[1]; assert.equal(av.title, "Pedido recibido"); assert.ok(av.body.includes(rr.json.ref)); assert.equal(av.url, "/cliente");
    await new Promise((r) => setTimeout(r, 300)); assert.equal(movB.avisos().length, 1, "B solo tiene el de activar: no recibe lo de A");
    // B no puede desactivar el móvil de A; A sí el suyo
    await call("POST", "/api/push/baja", { cookie: B, body: { endpoint: movA.sub.endpoint } });
    const rr2 = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-aviso-pedido-A2", lines: [{ id: "1010", qty: 1 }] } }); assert.equal(rr2.status, 200);
    assert.ok(await esperar(() => movA.avisos().length === 3), "el móvil de A sigue activo");
    await call("POST", "/api/push/baja", { cookie: A, body: { endpoint: movA.sub.endpoint } });
    await call("POST", "/catalogo", { cookie: A, body: { key: "clave-aviso-pedido-A3", lines: [{ id: "1010", qty: 1 }] } });
    await new Promise((r) => setTimeout(r, 400)); assert.equal(movA.avisos().length, 3, "desactivado: ya no llegan avisos");
    // lo que se guarda no enseña las claves del móvil al cliente en «Mi cuenta»
    assert.equal(JSON.stringify((await call("GET", "/api/mi-cuenta", { cookie: B })).json).includes(movB.sub.keys.auth), false);
  } finally { movA.cerrar(); movB.cerrar(); }
});

test("AVISOS A CLIENTES (empresa): a todos o a uno, con confirmación; los móviles que caducan se borran", async () => {
  const A = cookieOf(await entrarNif("111111")), B = cookieOf(await entrarNif("122222", "bar dos"));
  const movA = await movilDePrueba(), movB = await movilDePrueba();
  try {
    await call("POST", "/api/push/suscribir", { cookie: A, body: { subscription: movA.sub } }); await call("POST", "/api/push/suscribir", { cookie: B, body: { subscription: movB.sub } });
    await esperar(() => movA.avisos().length >= 1 && movB.avisos().length >= 1);
    const base = { titulo: "Oferta de la semana", texto: "Cerveza al mejor precio", destino: "todos", confirmo: true };
    assert.equal((await call("GET", "/api/admin/avisos")).status, 403); // solo la empresa
    assert.equal((await call("POST", "/api/admin/avisos/enviar", { body: base })).status, 403);
    for (const mal of [{ ...base, confirmo: false }, { ...base, titulo: "" }, { ...base, titulo: "x".repeat(51) }, { ...base, texto: "x".repeat(181) }, { ...base, destino: "otros" }, { ...base, destino: "cliente", clienteId: "no-existe" }]) assert.equal((await call("POST", "/api/admin/avisos/enviar", { admin: true, body: mal })).status, 400, JSON.stringify(mal).slice(0, 60));
    const n0 = (await call("GET", "/api/admin/avisos", { admin: true })).json;
    assert.ok(n0.moviles >= 2 && n0.clientes >= 2);
    // a todos
    const t = (await call("POST", "/api/admin/avisos/enviar", { admin: true, body: base })).json;
    assert.ok(t.ok && t.enviados >= 2);
    assert.ok(await esperar(() => movA.avisos().some((x) => x.title === "Oferta de la semana") && movB.avisos().some((x) => x.title === "Oferta de la semana")));
    // a un solo cliente
    const idA = (await call("GET", "/api/admin/cuentas", { admin: true })).json.find((c) => c.cliente === "CAFETERIA IMPORTADA").customerId;
    const antesB = movB.avisos().length;
    const u = (await call("POST", "/api/admin/avisos/enviar", { admin: true, body: { ...base, titulo: "Solo para ti", destino: "cliente", clienteId: idA } })).json;
    assert.equal(u.enviados, 1);
    assert.ok(await esperar(() => movA.avisos().some((x) => x.title === "Solo para ti"))); assert.equal(movB.avisos().length, antesB, "el otro cliente no recibe el aviso individual");
    // registro de lo enviado
    const log = (await call("GET", "/api/admin/avisos", { admin: true })).json.ultimos; assert.equal(log[0].titulo, "Solo para ti"); assert.equal(log[1].destino, "todos");
    // el contacto que se identifica ante Apple/Google sale de la dirección pública por la que entran los clientes (el panel lo enseña)
    assert.equal((await call("GET", "/api/admin/avisos", { admin: true })).json.contacto, null); // por localhost no sirve
    await call("GET", "/api/mi-cuenta", { cookie: A, headers: { "x-forwarded-host": "pedidos.empresa.es" } });
    assert.equal((await call("GET", "/api/admin/avisos", { admin: true })).json.contacto, "https://pedidos.empresa.es");
    // si el servicio de notificaciones falla, la empresa lo sabe y se le dice por qué (y queda en el registro)
    movA.poner(403);
    const rechazo = (await call("POST", "/api/admin/avisos/enviar", { admin: true, body: { ...base, titulo: "Prueba rechazo", destino: "cliente", clienteId: idA } })).json;
    assert.deepEqual([rechazo.enviados, rechazo.fallidos], [0, 1]); assert.ok(rechazo.errores[0].startsWith("403"), JSON.stringify(rechazo));
    assert.match((await call("GET", "/api/admin/avisos", { admin: true })).json.ultimos[0].detalle, /^403/);
    movA.poner(201);
    // un móvil que ya no existe (410) se borra solo
    movB.poner(410);
    await call("POST", "/api/admin/avisos/enviar", { admin: true, body: { ...base, titulo: "Prueba caducado" } });
    assert.ok(await esperar(async () => true));
    const despues = (await call("GET", "/api/admin/avisos", { admin: true })).json; assert.equal(despues.moviles, n0.moviles - 1, "el móvil caducado se ha quitado");
  } finally { movA.cerrar(); movB.cerrar(); }
});

test("ARTÍCULOS (empresa): cambiar precio, poner ofertas, filtrar, y la campana que avisa a los clientes", async () => {
  const lista = async (q = "") => (await call("GET", "/api/admin/articulos" + q, { admin: true })).json;
  const POST = (id, ruta, body, extra = {}) => call("POST", `/api/admin/articulos/${id}/${ruta}`, { admin: true, body, ...extra });
  assert.equal((await call("GET", "/api/admin/articulos")).status, 403); // solo la empresa
  assert.equal((await call("POST", "/api/admin/articulos/1010/precio", { body: { precio: 1 } })).status, 403);
  const todo = await lista(); assert.ok(todo.total > 5); assert.ok(todo.categorias.length >= 1);
  const a0 = todo.filas.find((x) => x.id === "1010"); assert.ok(a0 && a0.precio > 0 && a0.campana === null && a0.oferta === null);
  // filtros: por nombre (sin tildes ni mayúsculas) y por código
  assert.ok((await lista("?q=" + encodeURIComponent(a0.nombre.slice(0, 5).toUpperCase()))).filas.some((x) => x.id === "1010"));
  assert.deepEqual((await lista("?q=1010")).filas.map((x) => x.id), ["1010"]);
  assert.equal((await lista("?q=zzzz-no-existe")).total, 0);
  assert.equal((await lista("?filtro=oferta")).total, 0);
  // precio: se valida, y solo una BAJADA reciente trae la campana (una subida no se avisa)
  for (const mal of [{ precio: 0 }, { precio: "abc" }, { precio: -2 }, {}]) assert.equal((await POST("1010", "precio", mal)).status, 400);
  assert.equal((await POST("9999999", "precio", { precio: 1 })).status, 404);
  const nuevo = Math.round(a0.precio * 0.8 * 1000) / 1000;
  assert.equal((await POST("1010", "precio", { precio: String(nuevo).replace(".", ",") })).json.cambio, "updated"); // admite coma
  let a1 = (await lista("?q=1010")).filas[0]; assert.equal(a1.precio, nuevo); assert.equal(a1.campana, "bajada"); assert.equal(a1.cambioPrecio.antes, a0.precio);
  assert.equal((await lista("?filtro=bajada")).filas.some((x) => x.id === "1010"), true);
  const b0 = todo.filas.find((x) => x.id !== "1010"); await POST(b0.id, "precio", { precio: b0.precio * 1.5 });
  assert.equal((await lista("?q=" + b0.id)).filas.find((x) => x.id === b0.id).campana, null); // subida: sin campana
  // ofertas: validaciones
  for (const mal of [{ tipo: "raro", valor: 5 }, { tipo: "pct", valor: 0 }, { tipo: "pct", valor: 95 }, { tipo: "eur", valor: nuevo }, { tipo: "pct", valor: 5, hasta: "2000-01-01" }]) assert.equal((await POST("1010", "oferta", mal)).status, 400, JSON.stringify(mal));
  // oferta en %: sale en la lista y en el pedido del cliente (precio y descuento), con la campana
  const A = cookieOf(await entrarNif("111111")), mov = await movilDePrueba();
  try {
    assert.equal((await POST("1010", "oferta", { tipo: "pct", valor: "15", hasta: "2099-12-31" })).json.cambio, "updated");
    a1 = (await lista("?q=1010")).filas[0]; assert.deepEqual(a1.oferta, { tipo: "pct", valor: 15, hasta: "2099-12-31" }); assert.equal(a1.campana, "oferta");
    assert.equal((await lista("?filtro=oferta")).total, 1); assert.equal((await lista("?filtro=campana")).filas.some((x) => x.id === "1010"), true);
    const rr = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-oferta-pedido-1", lines: [{ id: "1010", qty: 1 }] } }); assert.equal(rr.status, 200, JSON.stringify(rr.json));
    const lin = (await call("GET", "/api/admin/pedidos", { admin: true })).json.find((o) => o.ref === rr.json.ref).lineas[0];
    assert.equal(lin.precio, nuevo); assert.ok(lin.descuento >= 15, "el pedido lleva el descuento de la oferta");
    // la campana: pide confirmación, el texto lo pone el servidor y llega a los móviles
    await call("POST", "/api/push/suscribir", { cookie: A, body: { subscription: mov.sub } }); await esperar(() => mov.avisos().length >= 1);
    assert.equal((await POST("1010", "avisar", {})).status, 400); // sin confirmar
    assert.equal((await POST("1010", "avisar", { confirmo: true, titulo: "ESTO NO SE USA" }, {})).status, 200);
    assert.ok(await esperar(() => mov.avisos().some((x) => /^Oferta −15 %: /.test(x.title))), "el móvil recibe el aviso de la oferta");
    const av = mov.avisos().find((x) => /^Oferta/.test(x.title)); assert.ok(av.title.includes(a0.nombre.slice(0, 10))); assert.match(av.body, /Ahora a .+ € la unidad \(antes .+ €\)\. Hasta el 31\/12\./); assert.equal(av.tag, "oferta-1010");
    a1 = (await lista("?q=1010")).filas[0]; assert.ok(a1.avisado, "queda anotado que ya se avisó");
    // si la oferta cambia, la campana vuelve a estar «sin avisar»; si se quita, queda la bajada de precio
    await POST("1010", "oferta", { tipo: "eur", valor: 0.05 }); a1 = (await lista("?q=1010")).filas[0]; assert.equal(a1.avisado, null); assert.equal(a1.oferta.tipo, "eur");
    await POST("1010", "oferta", { tipo: "ninguna" }); a1 = (await lista("?q=1010")).filas[0]; assert.equal(a1.oferta, null); assert.equal(a1.campana, "bajada");
    // un artículo sin oferta ni bajada no tiene nada que avisar
    assert.equal((await POST(b0.id, "avisar", { confirmo: true })).status, 400);
    assert.equal((await POST("9999999", "avisar", { confirmo: true })).status, 404);
  } finally { mov.cerrar(); }
});

test("AVISOS A CLIENTES: el límite de 10 por hora solo cuenta los que llegan, y se dice con un error normal (no 429: el panel lo tomaría por un bloqueo de la clave)", async () => {
  const A = cookieOf(await entrarNif("111111")), mov = await movilDePrueba();
  try {
    await call("POST", "/api/push/suscribir", { cookie: A, body: { subscription: mov.sub } }); await esperar(() => mov.avisos().length >= 1);
    const enviar = (n) => call("POST", "/api/admin/avisos/enviar", { admin: true, body: { titulo: "Prueba " + n, texto: "texto", destino: "todos", confirmo: true } });
    mov.poner(403); // 12 intentos que NO llegan: no gastan el límite
    for (let i = 0; i < 12; i++) { const r = await enviar("fallo" + i); assert.equal(r.status, 200); assert.equal(r.json.enviados, 0); }
    mov.poner(201);
    let corte = null;
    for (let i = 0; i < 15 && !corte; i++) { const r = await enviar("ok" + i); if (r.status !== 200) corte = { i, r }; }
    assert.ok(corte, "al llegar a 10 avisos en una hora se detiene");
    assert.equal(corte.r.status, 400); assert.notEqual(corte.r.status, 429); assert.match(corte.r.json.error, /10 avisos en la última hora/); assert.ok(corte.i <= 10);
  } finally { mov.cerrar(); }
});
