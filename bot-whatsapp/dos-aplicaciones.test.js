// Prueba de extremo a extremo como en el ordenador de la oficina: DOS programas distintos (cliente en un puerto y empresa en otro, como las tareas
// «VM Cliente» y «VM Empresa») con las MISMAS bases de datos. Un cliente que pide desde otro móvil (otra sesión, otro programa) tiene que hacer
// que su pedido llegue a la aplicación de la empresa: no puede quedarse solo en el navegador de quien lo hace.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkbook } from "./xlsx.js";

const ADMIN = "clave-de-prueba-dos";
const P1 = 4100 + Math.floor(Math.random() * 400), P2 = P1 + 500;
const CLI = `http://127.0.0.1:${P1}`, EMP = `http://127.0.0.1:${P2}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-dos-"));
const aqui = path.dirname(new URL(import.meta.url).pathname);
const procs = [];
const comunes = { ...process.env, DEMO: "1", LOGIN_LIMIT: "1000", NIF_LIMIT: "1000", NIF_GLOBAL_FAILS: "1000", REGISTER_LIMIT: "1000", LINK_SECRET: "x", NIF_PEPPER: "pimienta-de-prueba",
  DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"), SYNC_DIR: path.join(dir, "sync"), EXPORT_DIR: path.join(dir, "exp"), BACKUP_DIR: path.join(dir, "resp") };

function arrancar(env) {
  const p = spawn(process.execPath, ["server.js"], { cwd: aqui, env: { ...comunes, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(p);
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("el servidor no arrancó")), 10000);
    p.stdout.on("data", (d) => String(d).includes("Bot escuchando") && (clearTimeout(t), res()));
    p.on("exit", (c) => rej(new Error("el servidor salió con código " + c)));
  });
}
before(async () => {
  fs.mkdirSync(path.join(dir, "sync"), { recursive: true });
  await arrancar({ APP_MODE: "empresa", PORT: String(P2), PUBLIC_URL: EMP, ADMIN_TOKEN: ADMIN }); // la de la empresa (puerto interno)
  await arrancar({ APP_MODE: "cliente", PORT: String(P1), PUBLIC_URL: CLI, ADMIN_TOKEN: "" }); // la pública de los clientes
});
after(() => procs.forEach((p) => p.kill()));

const cabecera = ["Cód. cliente", "Organización", "Razón social / Nombre fiscal de la organización", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto", "Sección"];
const excel = () => Buffer.from(buildWorkbook([{ name: "CLIENTES", rows: [cabecera, ["    7001", "BAR DE PRUEBA DOS", "BAR DE PRUEBA DOS SL", "MEDINA DEL CAMPO", "CL. UNO 1", "611222333", "bar@prueba.es", "B11111111", "No", "No", "1"]] }]));
const empresa = (ruta, opts = {}) => fetch(EMP + ruta, { ...opts, headers: { Authorization: `Bearer ${ADMIN}`, ...(opts.headers ?? {}) } });
const cookieDe = (r) => r.headers.get("set-cookie").split(";")[0];

test("el pedido de un cliente desde otro móvil llega a la aplicación de la empresa (dos programas, mismas bases de datos)", async () => {
  // 1) La empresa carga su lista de clientes en SU aplicación
  const imp = await empresa("/api/admin/clientes/importar", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: excel() });
  assert.equal(imp.status, 200, await imp.clone().text());

  // 2) El cliente entra en la aplicación PÚBLICA con su NIF, desde "otro móvil" (otra sesión distinta)
  const login = await fetch(CLI + "/api/acceso", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nif: "111111" }) });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = cookieDe(login);

  // 3) Hace un pedido
  const antes = await (await empresa("/api/admin/pedidos")).json();
  const ped = await fetch(CLI + "/catalogo", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ key: "clave-dos-apps-1", lines: [{ id: "1010", qty: 2 }] }) });
  assert.equal(ped.status, 200, await ped.clone().text());

  // 4) El pedido aparece en la aplicación de la empresa, con su cliente y su población
  const despues = await (await empresa("/api/admin/pedidos")).json();
  assert.equal(despues.length, antes.length + 1, "la empresa ve un pedido más");
  const nuevo = despues.find((o) => !antes.some((a) => a.ref === o.ref));
  assert.equal(nuevo.codigo, "7001");
  assert.equal(nuevo.estado, "pendiente");
  assert.ok(nuevo.lineas.some((l) => l.id === "1010" && l.cantidad === 2));

  // 5) …y sale en el Excel que se baja la empresa, con la hoja de ese cliente
  const exp = await empresa("/api/admin/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs: [nuevo.ref] }) });
  assert.equal(exp.status, 200, await exp.clone().text());
});

test("cada aplicación solo enseña lo suyo: la pública no tiene administración y la de la empresa no tiene la pantalla del cliente", async () => {
  assert.equal((await fetch(CLI + "/api/admin/pedidos", { headers: { Authorization: `Bearer ${ADMIN}` } })).status, 404); // aunque se sepa la clave
  assert.equal((await fetch(CLI + "/empresa")).status, 404);
  assert.equal((await fetch(EMP + "/cliente")).status, 404);
  assert.equal((await fetch(EMP + "/health")).status, 200);
  assert.equal((await fetch(CLI + "/health")).status, 200);
});
