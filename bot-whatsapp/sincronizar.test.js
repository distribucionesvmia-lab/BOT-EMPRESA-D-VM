import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { buildWorkbook } from "./xlsx.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { pickFiles, fileState, sincronizar } from "./sincronizar.js";
import { localSource, driveSource, parseCredentials } from "./drive.js";

const cabC = ["Cód. cliente", "Organización", "Razón social", "Población", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto"];
const clientes = (n, extra = []) => buildWorkbook([{ name: "C", rows: [cabC, ...Array.from({ length: n }, (_, i) => [String(i + 1), `CLIENTE ${i + 1}`, "", "MEDINA", "", "", "", `0000${String(i + 1).padStart(4, "0")}Z`, "No", "No"]), ...extra] }]);
const productos = (rows) => buildWorkbook([{ name: "P", rows: [["Código", "Descripción", "Precio"], ...rows] }]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-sync-"));
const deps = (source) => ({ source, state: fileState(path.join(tmp(), "estado.json")), catalogDb: openCatalogDb(":memory:"), customersDb: openCustomersDb(":memory:"), accountsDb: openAccountsDb(":memory:") });

test("pickFiles: el más reciente de cada tipo según el nombre", () => {
  const f = [
    { name: "clientes-viejo.xlsx", modified: "2026-01-01" }, { name: "Clientes 30-10.xlsx", modified: "2026-10-30" },
    { name: "productos.xlsx", modified: "2026-05-01" }, { name: "Tarifa artículos.xlsx", modified: "2026-09-01" }, { name: "otro.xlsx", modified: "2026-10-31" },
  ];
  const p = pickFiles(f);
  assert.equal(p.clientes.name, "Clientes 30-10.xlsx");
  assert.equal(p.productos.name, "Tarifa artículos.xlsx");
});

test("carpeta local: importa clientes y productos, crea las cuentas, no repite si no cambian y recoge los cambios", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), clientes(3));
  fs.writeFileSync(path.join(dir, "productos.xlsx"), productos([["1", "AGUA", "0,5"], ["2", "COLA", "0,6"]]));
  const d = deps(localSource(dir));
  let r = await sincronizar(d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "sin fichero"]);
  assert.equal(d.customersDb.count(), 3);
  assert.equal(d.accountsDb.listAccounts().length, 3); // cuentas ya creadas
  assert.equal(d.customersDb.checkNif("1", "00001Z"), true); // el NIF se guarda solo como huella
  assert.equal(d.catalogDb.count(), 2);
  // sin cambios: no se vuelve a importar
  r = await sincronizar(d);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["sin cambios", "sin cambios", "sin fichero"]);
  // cambia el precio de un producto y llega un cliente nuevo
  await new Promise((s) => setTimeout(s, 20));
  fs.writeFileSync(path.join(dir, "productos.xlsx"), productos([["1", "AGUA", "0,55"], ["2", "COLA", "0,6"]]));
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), clientes(4));
  r = await sincronizar(d);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "sin fichero"]);
  assert.equal(d.catalogDb.get("1").price, 0.55);
  assert.equal(d.customersDb.count(), 4);
  assert.equal(d.accountsDb.listAccounts().length, 4);
  assert.equal(d.state.get().log.length, 2);
});

test("un fichero malo falla solo y se reintenta; un fichero de clientes incompleto se rechaza", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), clientes(30));
  fs.writeFileSync(path.join(dir, "productos.xlsx"), Buffer.from("esto no es un excel"));
  const d = deps(localSource(dir));
  let r = await sincronizar(d);
  assert.equal(r.ok, false);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "error", "sin fichero"]); // los clientes entran aunque los productos fallen
  assert.equal(d.customersDb.count(), 30);
  // fichero de clientes con solo 5 de 30
  await new Promise((s) => setTimeout(s, 20));
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), clientes(5));
  r = await sincronizar(d);
  assert.equal(r.resultados[0].estado, "error");
  assert.match(r.resultados[0].detalle, /incompleto/);
  assert.equal(d.customersDb.count(), 30); // nada cambió
  // la firma del fichero rechazado no se guarda: se vuelve a intentar
  r = await sincronizar(d);
  assert.equal(r.resultados[0].estado, "error");
});

test("carpeta sin ficheros: lo dice claramente", async () => {
  const r = await sincronizar(deps(localSource(tmp())));
  assert.deepEqual(r.resultados.map((x) => x.estado), ["sin fichero", "sin fichero", "sin fichero"]);
});

// ---- Google Drive con un servidor de pruebas que imita la API (firma del JWT, listado, descarga y exportación) ----
test("Google Drive: firma el JWT, lista la carpeta, descarga el Excel y exporta las hojas de Google", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const archivos = {
    c1: { name: "clientes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-10-30T10:00:00Z", md5Checksum: "aaa", data: clientes(2) },
    p1: { name: "Productos (hoja de Google)", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-10-30T11:00:00Z", data: productos([["7", "ZUMO", "1,2"]]) },
    t1: { name: "notas.txt", mimeType: "text/plain", modifiedTime: "2026-10-30T12:00:00Z", data: Buffer.from("x") },
  };
  const visto = { tokens: 0, bad: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const [h, c, s] = new URLSearchParams(body).get("assertion").split(".");
        const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"));
        const claim = JSON.parse(Buffer.from(c, "base64url"));
        if (!ok || claim.iss !== "sa@proyecto.iam.gserviceaccount.com" || !/drive\.readonly$/.test(claim.scope)) return visto.bad++, res.writeHead(400).end("{}");
        visto.tokens++;
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      });
      return;
    }
    if (req.headers.authorization !== "Bearer tok") return res.writeHead(401).end();
    if (u.pathname === "/drive/v3/files") {
      assert.match(u.searchParams.get("q"), /'CARPETA12345' in parents and trashed = false/);
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ files: Object.entries(archivos).map(([id, f]) => ({ id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum })) }));
    }
    const m = /^\/drive\/v3\/files\/(\w+)(\/export)?$/.exec(u.pathname);
    if (m && archivos[m[1]]) {
      if (m[2]) assert.match(u.searchParams.get("mimeType"), /spreadsheetml/);
      else assert.equal(u.searchParams.get("alt"), "media");
      return res.writeHead(200).end(archivos[m[1]].data);
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const creds = parseCredentials(JSON.stringify({ client_email: "sa@proyecto.iam.gserviceaccount.com", private_key: privateKey }));
    const src = driveSource({ folderId: "CARPETA12345", credentials: creds, apiBase: base, tokenUrl: `${base}/token` });
    const lista = await src.list();
    assert.deepEqual(lista.map((f) => f.name).sort(), ["Productos (hoja de Google)", "clientes.xlsx"]); // el .txt se ignora
    const d = deps(src);
    const r = await sincronizar(d);
    assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "sin fichero"]);
    assert.equal(d.customersDb.count(), 2);
    assert.equal(d.catalogDb.get("7").price, 1.2);
    assert.equal(visto.tokens, 1); // el token se reutiliza
    assert.equal(visto.bad, 0);
    assert.deepEqual((await sincronizar(d)).resultados.map((x) => x.estado), ["sin cambios", "sin cambios", "sin fichero"]);
  } finally {
    srv.close();
  }
});

test("Google Drive: errores claros (credenciales, carpeta no compartida) y nada se rompe", async () => {
  assert.throws(() => parseCredentials("no json"), /JSON/);
  assert.throws(() => parseCredentials("{}"), /client_email/);
  assert.throws(() => driveSource({ folderId: "x", credentials: {} }), /carpeta/);
  const srv = http.createServer((req, res) => (req.url === "/token" ? res.writeHead(200).end(JSON.stringify({ access_token: "t" })) : res.writeHead(404).end()));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const src = driveSource({ folderId: "CARPETA12345", credentials: { client_email: "a@b", private_key: privateKey }, apiBase: base, tokenUrl: `${base}/token` });
    const r = await sincronizar(deps(src));
    assert.equal(r.ok, false);
    assert.match(r.resultados[0].detalle, /compartida con la cuenta de servicio/);
  } finally {
    srv.close();
  }
});

// ---- Historial de compras (lo que prepara el servidor de la oficina a partir de la copia de a3) ----
const historial = (rows) => buildWorkbook([{ name: "H", rows: [["Cód. cliente", "Fecha", "Documento", "Cód. artículo", "Cantidad"], ...rows] }]);

test("historial: el Excel de compras alimenta el histórico de cada cliente (y se lee después de los clientes)", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "clientes.xlsx"), clientes(2));
  fs.writeFileSync(path.join(dir, "productos.xlsx"), productos([["1001", "AGUA", "0,5"], ["1002", "COLA", "0,6"]]));
  fs.writeFileSync(path.join(dir, "historial-ventas.xlsx"), historial([
    ["1", "28/10/2026", "A-100", "1001", "24"], ["1", "28/10/2026", "A-100", "1002", "12"], ["1", "2026-10-01", "A-090", "1001", "6"],
    ["2", "15/10/2026", "A-095", "1002", "48"],
    ["99", "15/10/2026", "A-096", "1002", "5"], // cliente que no existe
    ["1", "15/10/2026", "A-097", "1001", "-3"], // abono: no cuenta
    ["1", "sin fecha", "A-098", "1001", "3"],
  ]));
  const d = deps(localSource(dir));
  const r = await sincronizar(d);
  assert.deepEqual(r.resultados.map((x) => x.estado), ["importado", "importado", "importado"]);
  assert.match(r.resultados[2].detalle, /2 clientes \(4 líneas\).*1 clientes desconocidos/);
  const c1 = d.customersDb.getById("1");
  assert.deepEqual(c1.orders.map((o) => [o.doc, o.date, o.lines.length]), [["A-100", "2026-10-28", 2], ["A-090", "2026-10-01", 1]]); // el más reciente primero
  assert.deepEqual(d.customersDb.getById("2").orders[0].lines, [{ productId: "1002", qty: 48 }]);
  // una versión nueva sustituye el historial de esos clientes
  await new Promise((s) => setTimeout(s, 20));
  fs.writeFileSync(path.join(dir, "historial-ventas.xlsx"), historial([["1", "29/10/2026", "A-101", "1002", "10"]]));
  await sincronizar(d);
  assert.deepEqual(d.customersDb.getById("1").orders.map((o) => o.doc), ["A-101"]);
  assert.equal(d.customersDb.getById("2").orders.length, 1); // los que no vienen no se tocan
});

test("historial sin clientes cargados se rechaza con un mensaje claro; cabecera desconocida también", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "historial.xlsx"), historial([["1", "28/10/2026", "A-1", "1001", "2"]]));
  let r = await sincronizar(deps(localSource(dir)));
  assert.equal(r.resultados[2].estado, "error");
  assert.match(r.resultados[2].detalle, /importó antes el Excel de clientes/);
  fs.writeFileSync(path.join(dir, "historial.xlsx"), buildWorkbook([{ name: "H", rows: [["a", "b"], ["1", "2"]] }]));
  r = await sincronizar(deps(localSource(dir)));
  assert.match(r.resultados[2].detalle, /cabecera/);
});

test("pickFiles: «historial-clientes» es historial, no la lista de clientes", () => {
  const p = pickFiles([{ name: "historial-clientes.xlsx", modified: "2026-10-30" }, { name: "clientes.xlsx", modified: "2026-10-01" }, { name: "compras 2026.xlsx", modified: "2026-10-20" }]);
  assert.equal(p.clientes.name, "clientes.xlsx");
  assert.equal(p.historial.name, "historial-clientes.xlsx");
});
