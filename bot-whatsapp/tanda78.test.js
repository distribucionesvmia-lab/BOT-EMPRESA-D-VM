// De punta a punta con el servidor real (datos ficticios): el Excel de consumo da a cada cliente SU precio en SUS artículos habituales,
// el precio especial de uno no lo ve ningún otro, y si el precio cobrado es el de la tarifa no se guarda nada.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkbook } from "./xlsx.js";
import { libre } from "./puerto-libre.js";

const ADMIN = "clave-de-prueba-78", PORT = await libre(), BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-t78-"));
let proc, A, B;
const serie = (iso) => Math.round((Date.UTC(...iso.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) - Date.UTC(1899, 11, 30)) / 86400000); // fecha → número de serie de Excel

before(async () => {
  proc = spawn(process.execPath, ["server.js"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VM_HOY: "2026-11-15", DEMO: "1", OFICINA_ESPERA_S: "0", ACCESO_SOLO_OFICINA: "0", ALTA_AUTOMATICA: "1", PORT: String(PORT), PUBLIC_URL: BASE, LOGIN_LIMIT: "1000", NIF_LIMIT: "1000", NIF_GLOBAL_FAILS: "1000", REGISTER_LIMIT: "1000", LINK_SECRET: "x", ADMIN_TOKEN: ADMIN, IMG_DIR: path.join(dir, "img") + path.sep, DB_PATH: path.join(dir, "pedidos.sqlite"), CATALOG_DB: path.join(dir, "cat.sqlite"), CUSTOMERS_DB: path.join(dir, "cli.sqlite"), ACCOUNTS_DB: path.join(dir, "cuentas.sqlite"), SYNC_DIR: path.join(dir, "sync"), BACKUP_DIR: path.join(dir, "respaldos"), ENTRADA_DIR: path.join(dir, "entrada"), PUSH_ALLOW_HTTP: "1" },
  });
  await new Promise((res, rej) => {
    let dicho = ""; const t = setTimeout(() => rej(new Error("el servidor no arrancó. Dijo: " + dicho.slice(-500))), 40000);
    proc.stderr.on("data", (d) => { dicho += String(d); });
    proc.stdout.on("data", (d) => { dicho += String(d); if (String(d).includes("Bot escuchando")) (clearTimeout(t), res()); });
    proc.on("exit", (c) => rej(new Error("el servidor salió: " + c + " " + dicho.slice(-500))));
  });
});
after(() => proc?.kill());

const json = { "Content-Type": "application/json" };
const call = async (method, url, { body, cookie, admin } = {}) => {
  const r = await fetch(BASE + url, { method, headers: { ...(body ? json : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), setCookie: r.headers.get("set-cookie") };
};
const entrar = async (telefono, empresa, pin) => { const r = await call("POST", "/api/acceso", { body: { telefono, empresa, pin } }); assert.equal(r.status, 200); return r.setCookie.split(";")[0]; };

test("CONSUMO DE PUNTA A PUNTA: cada cliente ve SU precio en SUS artículos y nadie ve el precio especial de otro", async () => {
  // dos clientes ficticios entran (alta automática del programa de pruebas)
  for (const [tel, emp, mail, pin] of [["600000001", "Bar El Ejemplo", "a@ejemplo.es", "111111"], ["600000002", "tienda ficticia", "b@ejemplo.es", "222222"]])
    assert.equal((await call("POST", "/api/registro", { body: { telefono: tel, correo: mail, empresa: emp, pin, nif: "12345678Z" } })).status, 200);
  A = await entrar("600000001", "Bar El Ejemplo", "111111"); B = await entrar("600000002", "Tienda Ficticia SL", "222222");
  assert.equal((await call("GET", "/catalogo/datos")).status, 401); // sin entrar no se ve ningún precio
  const d0A = (await call("GET", "/catalogo/datos", { cookie: A })).json, d0B = (await call("GET", "/catalogo/datos", { cookie: B })).json;
  const libres = d0A.products.filter((p) => p.price > 0 && p.count === 0 && d0B.products.find((q) => q.id === p.id)?.count === 0); // artículos que aún no son habituales de ninguno
  const tarifa = Object.fromEntries([...libres.slice(0, 2), d0A.products.find((p) => p.price > 0 && !libres.slice(0, 2).some((l) => l.id === p.id))].map((p) => [p.id, { precio: p.price, desc: p.discount ?? 0, nombre: p.name }]));
  const [x, y, z] = Object.keys(tarifa); assert.ok(x && y && z);
  const nA = (await call("GET", "/catalogo/datos", { cookie: A })).json.customer.name, nB = (await call("GET", "/catalogo/datos", { cookie: B })).json.customer.name;
  const CAB = ["Artículo", "Descripción ", "Unidades", "", "Precio", "Fecha", "Desc.1", "Nº Documento", "Base", "Nombre", "Cód Almacén", "Cliente", "Desc. Almacén", "Coste", "Obt. precio coste"];
  const fila = (art, uds, precio, desc, fecha, doc, cli, nombre) => [`   ${art}`, "ART", String(uds), "", String(precio), String(serie(fecha)), String(desc), doc, "0", nombre, "1", `  ${cli}`, "Almacén central", "1.11", "PMED"];
  const dx = tarifa[x].desc, dy = tarifa[y].desc, descA = dx + 5, espA = Math.round(tarifa[x].precio * 1.3 * 100) / 100, espB = Math.round(tarifa[y].precio * 0.7 * 100) / 100;
  const excel = Buffer.from(buildWorkbook([{ name: "H", widths: [], rows: [CAB,
    fila(x, 6, espA, descA, "2026-11-02", "D1", "9001", nA),             // A: precio ESPECIAL en x + descuento distinto del de la tarifa
    fila(y, 2, tarifa[y].precio, dy, "2026-11-02", "D1", "9001", nA),  // A: y al precio de la TARIFA → no se guarda nada
    fila(y, 12, espB, dy, "2026-10-20", "D7", "9002", nB),             // B: precio ESPECIAL en y (el mismo artículo que A paga a tarifa)
    fila(x, 3, tarifa[x].precio, dx, "2026-10-20", "D7", "9002", nB),  // B: x a tarifa
  ] }]));
  const subir = (ruta) => fetch(`${BASE}/api/admin/${ruta}/consumo?fichero=c.xlsx${ruta === "aplicar" ? "&confirmo=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${ADMIN}` }, body: excel }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const prev = await subir("vista-previa");
  assert.equal(prev.status, 200); assert.equal(prev.json.resumen.nombreNoCoincide, 0); assert.equal(prev.json.resumen.preciosPropiosNuevos, 2); assert.equal(prev.json.resumen.descuentosNuevos, 1);
  assert.equal((await call("GET", "/catalogo/datos", { cookie: A })).json.products.find((p) => p.id === x).price, tarifa[x].precio); // la vista previa no cambió nada
  const ap = await subir("aplicar"); assert.equal(ap.status, 200);

  const dA = (await call("GET", "/catalogo/datos", { cookie: A })).json, dB = (await call("GET", "/catalogo/datos", { cookie: B })).json;
  const pa = (d, id) => d.products.find((p) => p.id === id);
  // A paga su precio especial en x (con su descuento) y la tarifa en y; B paga la tarifa en x y su precio especial en y
  assert.deepEqual([pa(dA, x).price, pa(dA, x).discount, pa(dA, y).price, pa(dA, y).discount], [espA, descA, tarifa[y].precio, dy]);
  assert.deepEqual([pa(dB, x).price, pa(dB, x).discount, pa(dB, y).price, pa(dB, y).discount], [tarifa[x].precio, dx, espB, dy]);
  // artículos habituales: x e y no eran habituales de ninguno y ahora lo son de AMBOS por sus propias compras del Excel; z no aparece en el Excel
  assert.ok(pa(dA, x).count > 0 && pa(dA, y).count > 0 && pa(dB, x).count > 0 && pa(dB, y).count > 0);
  assert.equal(pa(dA, x).lastQty, 6); assert.equal(pa(dB, y).lastQty, 12);                  // «la última vez»: lo suyo
  assert.equal(pa(dA, z).price, tarifa[z].precio); assert.equal(pa(dB, z).price, tarifa[z].precio); // los demás artículos: tarifa para todos
  // el precio especial de uno no aparece en NADA de lo que recibe el otro (todo el JSON del catálogo, no solo ese artículo)
  const texto = (d) => JSON.stringify(d);
  assert.ok(!texto(dB).includes(`"price":${espA}`) && !texto(dA).includes(`"price":${espB}`));
  assert.ok(!(await call("POST", "/api/chat", { cookie: B, body: { text: "último pedido", id: "t78b" } }).then((r) => JSON.stringify(r.json))).includes(String(espA)));
  // la relación con su fecha aparece en SU historial (Mi cuenta) y no en el del otro
  const cuenta = async (c) => JSON.stringify((await call("GET", "/api/mi-cuenta", { cookie: c })).json);
  const cA = await cuenta(A), cB = await cuenta(B);
  assert.ok(cA.includes('"doc":"D1","pdf":true,"fecha":"2026-11-02"') && !cA.includes('"D7"')); assert.ok(cB.includes('"doc":"D7","pdf":true,"fecha":"2026-10-20"') && !cB.includes('"D1"'));
  // el mismo Excel otra vez: nada que cambiar
  assert.equal((await subir("vista-previa")).json.aplicable, false);
});
