// Bench 10: enlace de invitación de la oficina.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openAccountsDb } from "./cuentas-db.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("invitaciones: token largo y aleatorio, solo se guarda su huella, un solo uso y caducidad (fechas forzadas)", () => {
  const a = openAccountsDb(":memory:"), t0 = "2026-11-16T10:00:00.000Z";
  const { token, caduca } = a.invitacionCrear("C1", { dias: 7, now: t0 });
  assert.match(token, /^[\w-]{43}$/); assert.equal(caduca, "2026-11-23T10:00:00.000Z"); assert.notEqual(a.invitacionCrear("C1", { now: t0 }).token, token);
  // ya se anuló la primera al crear la segunda (solo vale la última sin usar)
  assert.deepEqual(a.invitacionVer(token, t0), { ok: false, motivo: "usada" });
  const v = a.invitacionCrear("C2", { dias: 7, now: t0 }); assert.deepEqual(a.invitacionVer(v.token, "2026-11-20T00:00:00Z"), { ok: true, customerId: "C2" });
  // caduca
  assert.deepEqual(a.invitacionVer(v.token, "2026-11-23T10:00:00.000Z"), { ok: false, motivo: "caducada" }); assert.deepEqual(a.invitacionUsar(v.token, "2026-12-01T00:00:00Z"), { ok: false, motivo: "caducada" });
  // un solo uso
  const w = a.invitacionCrear("C3", { now: t0 }); assert.equal(a.invitacionUsar(w.token, "2026-11-17T00:00:00Z").ok, true); assert.deepEqual(a.invitacionUsar(w.token, "2026-11-17T00:00:01Z"), { ok: false, motivo: "usada" });
  assert.deepEqual(a.invitacionVer("inventado"), { ok: false, motivo: "desconocida" });
  // nunca se guarda el token: ni en claro ni como texto
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-inv-")), "c.sqlite"), b = openAccountsDb(f), t = b.invitacionCrear("C9").token;
  const filas = new DatabaseSync(f).prepare("SELECT * FROM invitaciones").all(); assert.equal(filas.length, 1); assert.equal(Object.values(filas[0]).some((x) => String(x).includes(t)), false); assert.match(filas[0].token_hash, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(f).includes(t), false); // ni en el archivo de la base
});
test("el enlace entra por la ruta /entrar (GET enseña botón, POST gasta), con límite por IP, sin caché y sin referer; la oficina lo crea con el botón y lo manda ella", () => {
  const au = leer("./auth.js"), ad = leer("./admin.js"), e = leer("./empresa.html"), c = leer("./cliente.html"), db = leer("./cuentas-db.js");
  assert.match(au, /p\.startsWith\("\/entrar\/"\)/); assert.match(au, /if \(req\.method === "GET"\) return fin\(200, "Bienvenido"/); assert.match(au, /accounts\.invitacionUsar\(token\)/); assert.match(au, /Location: "\/cliente#invitacion"/); assert.match(au, /loginLimit\(ip\(req\)\)/);
  assert.match(au, /"Referrer-Policy": "no-referrer"/); assert.match(au, /"Cache-Control": "no-store"/);
  assert.match(db, /crypto\.createHash\("sha256"\)\.update\(String\(t\)\)/); assert.match(db, /crypto\.randomBytes\(32\)\.toString\("base64url"\)/); assert.doesNotMatch(db.slice(db.indexOf("invitacionCrear"), db.indexOf("invitacionVer")), /INSERT INTO invitaciones \(token,/); // solo token_hash
  assert.match(ad, /\/invitacion\$/); assert.match(ad, /Hola, este es tu enlace para pedir a Distribuciones Valentín Martín: \$\{url\}/); assert.match(ad, /Falta la dirección pública de la aplicación del cliente/);
  assert.match(e, /Crear enlace de acceso/); assert.match(e, /Abrir en WhatsApp/); assert.match(e, /Copiar enlace/); assert.match(e, /Lo mandas tú/); assert.doesNotMatch(ad.slice(ad.indexOf("/invitacion$/"), ad.indexOf("// ---- Clientes (la lista")), /sendMail|enviarPush|fetch\(/); // el sistema no envía nada
  assert.match(c, /location\.hash === "#invitacion"/); assert.match(c, /id="c-nota" hidden/); assert.match(c, /location\.hash === "#enlace-caducado"/); assert.match(c, /Ese enlace ya no sirve/);
});

import { investigar, resumen } from "./investigar-fijo.js";
test("investigar-fijo: dice en qué copia desapareció un pedido fijo y quién lo tocó (solo lee, no cambia nada)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-resp-")), a = openAccountsDb(path.join(dir, "viva.sqlite"));
  a.setStanding("T818181", { lines: [{ id: "1", qty: 3, unit: "ud" }, { id: "2", qty: 2, unit: "caja" }], days: [2, 4] });
  a.backupTo(path.join(dir, "cuentas-20261110-0300.sqlite")); a.backupTo(path.join(dir, "cuentas-20261111-0300.sqlite"));
  a.deleteStanding("T818181"); a.hideUsual("T818181");
  a.backupTo(path.join(dir, "cuentas-20261112-0300.sqlite")); a.backupTo(path.join(dir, "cuentas-20261113-0300.sqlite"));
  const antes = fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
  const r = investigar(dir, "T818181"); assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x.fijos.length), [1, 1, 0, 0]); assert.equal(r[0].fijos[0].lineas, 2); assert.equal(r[0].fijos[0].unidades, 5); assert.deepEqual(r[0].fijos[0].dias, [2, 4]);
  assert.deepEqual(r.map((x) => x.siempre.length), [0, 0, 1, 1]); assert.equal(r[2].siempre[0].borrado, true);
  const t = resumen(r); assert.match(t, /Última copia CON pedido fijo: cuentas-20261111-0300\.sqlite · primera copia SIN él: cuentas-20261112-0300\.sqlite/); assert.match(t, /BORRADO de la portada/);
  assert.equal(investigar(dir, "OTRO")[0].fijos.length, 0); // filtra por cliente
  assert.deepEqual(fs.readdirSync(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]), antes); // no ha tocado ni un archivo
});
