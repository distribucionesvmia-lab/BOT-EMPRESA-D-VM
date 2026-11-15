import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { revisar, archivosGit, PATRONES } from "./escaner-secretos.js";
import { unzip, NOMBRE_PELIGROSO } from "./xlsx-read.js";

const falso = (m) => (r) => Buffer.from(m[r] ?? "");
const motivos = (m) => revisar(Object.keys(m), falso(m)).map((h) => h.ruta);

test("escáner: archivos prohibidos por tipo y carpeta", () => {
  const m = { "datos/clientes.xlsx": "x", "a/b.sqlite": "x", "cliente.env": "x", "x/copia.bak": "x", "inicial/prueba.json": "{}", "k.pem": "x", "ok/app.js": "const a=1", "bot-whatsapp/cliente.env.example": "ADMIN_TOKEN=", ".env.example": "A=1" };
  assert.deepEqual(motivos(m).sort(), ["a/b.sqlite", "cliente.env", "datos/clientes.xlsx", "inicial/prueba.json", "k.pem", "x/copia.bak"].sort());
});

test("escáner: claves de verdad se detectan; plantillas y texto normal no", () => {
  const m = {
    "a.txt": "-----" + "BEGIN PRIVATE KEY" + "-----\nabc", "b.txt": "token ghp_" + "a".repeat(36), "c.txt": "AIza" + "B".repeat(35),
    "d.txt": "ADMIN_TOKEN=Zk39dLmP20xQvTt81aaB", "e.txt": "SMTP_PASS=pon-aqui-tu-clave", "f.txt": "ADMIN_TOKEN=", "g.txt": "const url='postgres" + "://usuario:secreta123@host/db'",
    "h.md": "Pon NIF_PEPPER=<una frase larga> en la configuración", "i.js": "const total = 12.62; // IVA 21%",
  };
  assert.deepEqual(motivos(m).sort(), ["a.txt", "b.txt", "c.txt", "d.txt", "g.txt"]);
  assert.ok(PATRONES.length >= 9);
});

test("escáner: el repositorio REAL no lleva secretos ni datos reales", { skip: (() => { try { execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: "ignore" }); return false; } catch { return "sin git"; } })() }, () => {
  const raiz = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const h = revisar(archivosGit(raiz), (r) => fs.readFileSync(raiz + "/" + r));
  assert.deepEqual(h, [], "Hay secretos o datos reales en lo que va a GitHub: " + JSON.stringify(h));
});

// ── Antivirus de subidas ──
function zip(entradas) {
  const partes = [], central = []; let off = 0;
  for (const [nombre, dato] of Object.entries(entradas)) {
    const n = Buffer.from(nombre), d = zlib.deflateRawSync(Buffer.from(dato));
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(d.length, 18); l.writeUInt32LE(dato.length, 22); l.writeUInt16LE(n.length, 26);
    partes.push(l, n, d);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(dato.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(entradas).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, e]);
}
const todo = () => true;

test("antivirus: un ZIP normal (Excel o fotos) se lee", () => {
  const r = unzip(zip({ "xl/workbook.xml": "<a/>", "fotos/1001.jpg": "x", "[Content_Types].xml": "<t/>" }), todo);
  assert.deepEqual(Object.keys(r).sort(), ["[Content_Types].xml", "fotos/1001.jpg", "xl/workbook.xml"]);
});

test("antivirus: se rechazan programas, scripts, macros y objetos incrustados", () => {
  for (const mal of ["factura.exe", "x/instalar.bat", "a.ps1", "b.vbs", "c.js", "d.lnk", "xl/vbaProject.bin", "xl/embeddings/oleObject1.bin", "foto.svg", "p.html", "m.dll", "x.jar", "r.php"]) {
    assert.throws(() => unzip(zip({ "xl/workbook.xml": "<a/>", [mal]: "MZ" }), () => false), /rechaza por seguridad/, mal);
  }
  for (const ok of ["xl/worksheets/sheet1.xml", "xl/media/image1.png", "fotos/1001.JPG", "docProps/core.xml", "xl/richData/rdrichvalue.xml", "x/sheet.json"]) assert.ok(!NOMBRE_PELIGROSO.test(ok), ok);
});

test("antivirus: rutas con .. o absolutas, y archivos rotos, se rechazan", () => {
  for (const mal of ["../../etc/passwd", "a/../../b.txt", "/etc/x", "C:/Windows/x.txt"]) assert.throws(() => unzip(zip({ [mal]: "x" }), todo), /rutas sospechosas/, mal);
  const roto = zip({ "a.txt": "x" }); roto.writeUInt32LE(0, roto.length - 22 + 16); // el índice apunta a cualquier sitio
  assert.throws(() => unzip(roto, todo), /dañado|válido/);
  assert.throws(() => unzip(Buffer.from("MZ esto no es un zip"), todo), /válido/);
});
