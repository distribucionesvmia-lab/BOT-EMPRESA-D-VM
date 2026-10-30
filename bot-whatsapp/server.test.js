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
const syncDir = path.join(dir, "sync");

before(async () => {
  fs.mkdirSync(syncDir, { recursive: true });
  proc = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: {
      ...process.env, DEMO: "1", PORT: String(PORT), PUBLIC_URL: BASE, LOGIN_LIMIT: "1000", NIF_LIMIT: "1000", NIF_GLOBAL_FAILS: "1000", REGISTER_LIMIT: "1000", LINK_SECRET: "x", ADMIN_TOKEN: ADMIN,
      DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"), SYNC_DIR: syncDir,
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

// Alta de un cliente: se registra con el PIN que elige. Devuelve { cookie, pin, estado }
async function registrar(telefono, empresa, correo, pin) {
  const r = await call("POST", "/api/registro", { body: { telefono, correo, empresa, pin } });
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
  const ok = { telefono: "600000001", correo: "a@ejemplo.es", empresa: "Bar El Ejemplo", pin: "111111" };
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

test("ACCESO CON NIF: las cuentas ya están creadas y el cliente entra solo con los 6 últimos caracteres del NIF", async () => {
  // Todos los clientes activos importados tienen ya su cuenta, y el NIF no aparece en ninguna respuesta
  const cuentas = (await call("GET", "/api/admin/cuentas", { admin: true })).json;
  assert.ok(cuentas.find((c) => c.customerId === "7003"));
  assert.equal(cuentas.find((c) => c.customerId === "7002"), undefined); // de baja: sin cuenta
  assert.equal(JSON.stringify(cuentas).includes("B11111111"), false);
  // NIF B11111111 → últimos 6: 111111 (sin decir el nombre)
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
  const amb = await entrarNif("22222A");
  assert.deepEqual([amb.status, amb.json.necesitaNombre], [409, true]);
  assert.equal((await entrarNif("222222", "bar dos")).json.cliente.nombre, "BAR DOS");
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
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "111111" } })).status, 400); // coincide con un NIF
  assert.equal((await call("POST", "/api/codigo", { cookie, body: { nuevo: "Mi-Clave7" } })).status, 200);
  assert.equal((await call("GET", "/api/yo", { cookie })).json.cliente.codigoPropio, true);
  assert.equal((await entrarNif("MiClave7")).json.cliente.nombre, "CAFETERIA IMPORTADA"); // el código personal vale (sin importar mayúsculas ni guiones)
  assert.equal((await entrarNif("miclave7")).status, 200);
  assert.equal((await entrarNif("111111")).status, 401); // el NIF ya no vale para esa cuenta
  // otro cliente no puede quedarse con el mismo código
  const otro = await entrarNif("22222A", "bar uno");
  assert.equal((await call("POST", "/api/codigo", { cookie: cookieOf(otro), body: { nuevo: "MiClave7" } })).status, 400);
  // la empresa lo restablece: vuelve a valer el NIF
  const c = await cuentaDe("7001");
  assert.equal(c.ownCode, true);
  assert.equal((await call("POST", `/api/admin/cuentas/${c.id}/pin`, { admin: true, body: {} })).status, 200);
  assert.equal((await entrarNif("111111")).status, 200);
  assert.equal((await entrarNif("MiClave7")).status, 401);
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
  fs.writeFileSync(path.join(syncDir, "clientes.xlsx"), buildWorkbook([{ name: "C", rows: [cabecera, ["8001", "CLIENTE SINCRONIZADO", "", "MEDINA", "", "", "", "A12345678", "No", "No", "1"]] }]));
  fs.writeFileSync(path.join(syncDir, "productos.xlsx"), buildWorkbook([{ name: "P", rows: [["Código", "Descripción", "Precio"], ["9001", "PRODUCTO NUEVO", "3,5"]] }]));
  let r = (await call("POST", "/api/admin/sincronizacion/ahora", { admin: true, body: {} })).json;
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "sin fichero"]);
  assert.equal((await call("GET", "/api/admin/clientes/lista?q=sincronizado", { admin: true })).json.total, 1);
  const ent = await entrarNif("345678"); // los 6 últimos números de A12345678: el cliente recién sincronizado ya tiene cuenta y entra
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
