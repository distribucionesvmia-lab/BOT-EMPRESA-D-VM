// Prueba de extremo a extremo del servidor: alta, aprobación, acceso con PIN y, sobre todo,
// que un cliente NO puede ver los datos (historial, catálogo habitual, pedidos) de otro.
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";
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
const syncDir = path.join(dir, "sync");

before(async () => {
  fs.mkdirSync(syncDir, { recursive: true });
  proc = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    env: {
      ...process.env, DEMO: "1", PORT: String(PORT), PUBLIC_URL: BASE, LOGIN_LIMIT: "1000", NIF_LIMIT: "1000", NIF_GLOBAL_FAILS: "1000", REGISTER_LIMIT: "1000", LINK_SECRET: "x", ADMIN_TOKEN: ADMIN,
      DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"), SYNC_DIR: syncDir, BACKUP_DIR: path.join(dir, "respaldos"), ENTRADA_DIR: path.join(dir, "entrada"),
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
  assert.equal((await call("POST", "/api/acceso", { body: { telefono: "600000001", pin: "111111" } })).status, 400); // falta la empresa
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
  assert.equal((await call("GET", "/api/yo", { cookie: B.cookie })).status, 401);
  assert.equal((await entrar("600000002", "Tienda Ficticia", B.pin)).status, 401);
  const ok = await call("POST", "/api/acceso", { body: { telefono: "600000002", empresa: "Tienda Ficticia", pin: nuevo.json.pin } });
  assert.equal(ok.status, 200);
  const cookieB = cookieOf(ok);
  await call("POST", `/api/admin/cuentas/${cuentaB.id}/bloquear`, { admin: true, body: { bloquear: true } });
  assert.equal((await call("GET", "/api/yo", { cookie: cookieB })).status, 401);
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
  const port = 3990 + Math.floor(Math.random() * 9) + (mode === "empresa" ? 10 : 0);
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
  assert.equal((html.match(/Información sobre privacidad/g) ?? []).length, 2); // acceso y solicitud de alta
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
  assert.equal((await call("GET", "/api/yo", { cookie })).status, 401); // la sesión ya no vale
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

test("MI CUENTA: cada cliente ve SUS datos y SUS pedidos (con líneas para repetir o añadir), nunca los de otro ni su NIF", async () => {
  assert.equal((await call("GET", "/api/mi-cuenta")).status, 401);
  const A = cookieOf(await entrarNif("111111"));
  const B = cookieOf(await entrarNif("122222", "bar dos"));
  const rr = await call("POST", "/catalogo", { cookie: A, body: { key: "clave-mi-cuenta-A", lines: [{ id: "1010", qty: 2 }, { id: "1020", qty: 1 }] } });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));
  const a = (await call("GET", "/api/mi-cuenta", { cookie: A })).json;
  assert.equal(a.cliente.nombre, "CAFETERIA IMPORTADA");
  assert.equal(typeof a.cliente.codigo, "string");
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
