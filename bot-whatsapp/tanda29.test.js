// Enlaces de acceso configurables: validez (días, fecha, hora), usos con tope, mensaje de bienvenida, solo ver / también pedir, código, plantilla, lista y «Anular».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { opcionesInvitacion, plantillaValida, textoWhatsapp, madridAIso, PLANTILLA_DEFECTO } from "./invitaciones.js";
import { openAccountsDb } from "./cuentas-db.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const T0 = "2026-11-16T09:00:00.000Z"; // lunes 16 de noviembre de 2026, 10:00 en Madrid

test("opciones: días (1, 3, 7, 30), fecha concreta, hora de Madrid y límites", () => {
  for (const d of [1, 3, 7, 30]) assert.equal(opcionesInvitacion({ dias: d }, T0).expiresAt, new Date(new Date(T0).getTime() + d * 86_400_000).toISOString(), "dias " + d);
  assert.equal(opcionesInvitacion({}, T0).expiresAt, "2026-11-23T09:00:00.000Z"); // por defecto 7 días, 1 uso
  assert.equal(opcionesInvitacion({}, T0).usos, 1);
  assert.equal(opcionesInvitacion({ fecha: "2026-11-20" }, T0).expiresAt, "2026-11-20T22:59:00.000Z"); // fin del día en Madrid (invierno: UTC+1)
  assert.equal(opcionesInvitacion({ dias: 1, hora: "10:30" }, T0).expiresAt, "2026-11-17T09:30:00.000Z");
  assert.equal(madridAIso("2026-07-01", "10:00"), "2026-07-01T08:00:00.000Z"); // verano: UTC+2
  for (const malo of [{ dias: 0 }, { dias: 61 }, { dias: 1.5 }, { dias: "x" }, { fecha: "2026-11-15" }, { fecha: "2027-06-01" }, { fecha: "no" }, { hora: "25:00" }, { hora: "10" }, { usos: 0 }, { usos: 21 }, { usos: 2.5 }, { mensaje: "a".repeat(301) }]) assert.ok(opcionesInvitacion(malo, T0).error, JSON.stringify(malo));
  assert.ok(opcionesInvitacion({ fecha: "2026-11-16", hora: "10:00" }, T0).error); // esa hora ya pasó
});
test("opciones: solo ver, código y mensaje se limpian", () => {
  const o = opcionesInvitacion({ modo: "ver", pedirCodigo: false, mensaje: "  Hola\n\tPablo  " , usos: 5 }, T0);
  assert.deepEqual([o.soloVer, o.pedirCodigo, o.mensaje, o.usos], [true, false, "Hola Pablo", 5]);
  const p = opcionesInvitacion({ modo: "otra cosa" }, T0); assert.deepEqual([p.soloVer, p.pedirCodigo], [false, true]); // lo desconocido = pedir (lo normal)
});
test("plantilla del WhatsApp: obligatorio {enlace}, solo variables conocidas, se rellena", () => {
  assert.ok(plantillaValida("Hola").error); assert.ok(plantillaValida("{enlace} {otra}").error); assert.ok(plantillaValida("").error); assert.ok(plantillaValida("x{enlace}" + "a".repeat(500)).error);
  assert.equal(plantillaValida("Hola {nombre}: {enlace}").texto, "Hola {nombre}: {enlace}");
  const t = textoWhatsapp(PLANTILLA_DEFECTO, { nombre: "Bar Pepe", url: "https://x/entrar/abc", usos: 3, expiresAt: "2026-11-20T09:30:00.000Z" });
  assert.match(t, /^Hola Bar Pepe, este es tu enlace .*: https:\/\/x\/entrar\/abc\n\(Sirve hasta 3 veces y hasta el 20\/11\/2026 a las 10:30\.\)$/);
  assert.match(textoWhatsapp("{enlace} {usos}", { nombre: "", url: "U", usos: 1, expiresAt: T0 }), /^U una sola vez$/);
});
test("base de datos: varios usos con tope, anular, lista sin el enlace, y la sesión recuerda solo ver y mensaje", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-inv-")), a = openAccountsDb(path.join(dir, "c.sqlite"));
  try {
    const op = opcionesInvitacion({ usos: 2, modo: "ver", mensaje: "Hola, Pablo", pedirCodigo: false }, T0), v = a.invitacionCrear("C2", { ...op, now: T0 });
    assert.deepEqual(a.invitacionVer(v.token, T0), { ok: true, customerId: "C2", soloVer: true, mensaje: "Hola, Pablo", pedirCodigo: false, usosMax: 2, tipo: "cliente", nombre: "" });
    assert.equal(a.invitacionUsar(v.token, T0).ok, true); assert.equal(a.invitacionUsar(v.token, T0).ok, true); // 2 usos
    assert.deepEqual(a.invitacionUsar(v.token, T0), { ok: false, motivo: "usada" }); // el tercero, no
    assert.equal(a.invitacionesLista({ now: T0 })[0].estado, "agotado"); assert.equal(a.invitacionesLista({ now: T0 })[0].usos, 2);
    const w = a.invitacionCrear("C3", { ...opcionesInvitacion({ usos: 3 }, T0), now: T0 });
    assert.equal(a.invitacionUsar(w.token, T0).ok, true); assert.equal(a.invitacionesLista({ now: T0 }).find((x) => x.cliente === "C3").estado, "activo");
    const id = a.invitacionesLista({ now: T0 }).find((x) => x.cliente === "C3").id;
    assert.equal(a.invitacionAnular(id, T0), true); assert.equal(a.invitacionAnular(id, T0), false); // anular dos veces no vale
    assert.deepEqual(a.invitacionUsar(w.token, T0), { ok: false, motivo: "usada" }); // anulado = no entra nadie más
    assert.equal(a.invitacionesLista({ now: T0 }).find((x) => x.cliente === "C3").estado, "anulado");
    assert.equal(a.invitacionesLista({ now: "2027-01-01T00:00:00Z" }).length, 2);
    assert.doesNotMatch(JSON.stringify(a.invitacionesLista({ now: T0 })), new RegExp(w.token)); // nunca el enlace
    const x = a.invitacionCrear("C4", { ...opcionesInvitacion({ dias: 1 }, T0), now: T0 }); assert.equal(a.invitacionesLista({ now: "2026-11-30T00:00:00Z" }).find((r) => r.cliente === "C4").estado, "caducado");
  } finally { a.close?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("servidor: «solo ver» no deja enviar pedidos (catálogo ni chat), el panel lo configura y hay lista y «Anular»", () => {
  const sv = leer("./server.js"), au = leer("./auth.js"), ad = leer("./admin.js"), e = leer("./empresa.html"), ped = leer("./pedido.html"), cli = leer("./cliente.html");
  assert.match(sv, /if \(account\.soloVer\) return void sendJson\(res, 403/); assert.match(sv, /out\.order && account\.soloVer/); assert.match(sv, /soloVer: !!account\.soloVer/);
  assert.match(au, /soloVer: !!acc\.soloVer/); assert.match(au, /u\.pedirCodigo \? "\/cliente#invitacion" : "\/cliente#enlace"/);
  assert.match(ad, /opcionesInvitacion\(/); assert.match(ad, /\/api\/admin\/invitaciones"/); assert.match(ad, /anular/); assert.match(ad, /invitaciones\/plantilla/);
  assert.doesNotMatch(ad.slice(ad.indexOf("// ---- Enlace de invitación"), ad.indexOf("// ---- Errores de la app")), /sendMail|enviarPush|fetch\(/); // el sistema no envía nada
  for (const t of ["inv-dias", "inv-fecha", "inv-hora", "inv-usos", "inv-modo", "inv-codigo", "inv-msg-b", "inv-plantilla", "inv-lista", "Anular", "Solo ver el catálogo"]) assert.ok(e.includes(t), t);
  assert.match(e, /erroresApp\(\), invitaciones\(\)/);
  assert.match(ped, /function pintarSoloVer\(\)/); assert.match(ped, /data\.soloVer/); assert.match(cli, /y\?\.mensajeEnlace/); assert.match(cli, /in-enlace/);
});

test("personas nuevas: el panel ofrece alta / ver / pedir, la ficha es obligatoria para pedir y la pantalla de alta se abre con el nombre", () => {
  const e = leer("./empresa.html"), c = leer("./cliente.html"), au = leer("./auth.js"), ad = leer("./admin.js");
  for (const t of ["inv-para", "Una persona nueva (aún sin alta)", "inv-n-nombre", "inv-n-tipo", "Solo darse de alta", "Ver la app por dentro, sin pedir", "Pedir con normalidad (hay que rellenar su ficha)", "inv-n-nif", "inv-n-dir", "inv-n-pob", "/api/admin/invitaciones/persona-nueva"]) assert.ok(e.includes(t), t);
  assert.match(ad, /Para que pueda pedir hay que rellenar su ficha/); assert.match(ad, /Ya hay un cliente llamado/); assert.match(ad, /Ese DNI o CIF ya es de otro cliente/);
  assert.doesNotMatch(ad.slice(ad.indexOf("persona-nueva"), ad.indexOf("// Lista de enlaces")), /sendMail|enviarPush|fetch\(/); // el sistema no envía nada
  assert.match(au, /u\.tipo === "alta"/); assert.match(au, /"\/cliente#alta=" \+ encodeURIComponent/);
  assert.match(c, /\^#alta=\//); assert.match(c, /\$\("r-emp"\)\.value = nom/); assert.match(c, /ver\("registro"\)/);
});

test("panel de la empresa: ancho, menú lateral en pantalla grande, pestañas en fila en móvil y la pestaña elegida no se aclara al pasar el ratón", () => {
  const e = leer("./empresa.html");
  assert.match(e, /main \{ max-width:1840px;/); assert.match(e, /#app:not\(\[hidden\]\) \{ display:grid !important; grid-template-columns:248px minmax\(0, 1fr\)/); // el menú lateral no deja visible el panel antes de entrar
  assert.match(e, /@media \(min-width: 1100px\)/); assert.match(e, /@media \(max-width: 1099px\)/); assert.match(e, /#app > \.tabs \.tab\[data-t="datos"\] \{ --ico:/);
  assert.match(e, /button\.tab\[aria-selected="true"\]:hover:not\(:disabled\)/);
  assert.match(e, /\.inv-grid \{ display:grid;/); assert.match(e, /prefers-color-scheme: dark/);
  assert.doesNotMatch(e, /<link[^>]+href=|@import/); // sin recursos externos: el panel funciona sin internet
});
