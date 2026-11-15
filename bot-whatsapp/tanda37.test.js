// Correos a clientes desde el panel: promociones solo a quien lo ha aceptado, «Publicidad» + baja, avisos de servicio, programados, límite diario y sin repetir.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAccountsDb } from "./cuentas-db.js";
import { validarCampana, audiencia, mensajeCampana, enviarCampanas, GRACIA_MIN } from "./correo-campanas.js";
import { buildMessage } from "./mailer.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const AHORA = new Date("2026-11-14T10:00:00Z");
const montar = () => {
  const accounts = openAccountsDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vm-camp-")), "a.sqlite")), enviados = [];
  const contactos = new Map([["1", { id: "1", name: "BAR UNO", emails: ["uno@x.es"] }], ["2", { id: "2", name: "BAR DOS", emails: ["dos@x.es"] }], ["3", { id: "3", name: "BAR TRES", emails: [] }], ["4", { id: "4", name: "BAR CUATRO", emails: ["uno@x.es"] }]]);
  return { accounts, contactos, enviados, send: async (smtp, m) => void enviados.push(m) };
};
const base = { asunto: "Oferta de la semana", texto: "Cerveza al mejor precio, {nombre}", tipo: "promo", destino: "todos", dia: "2026-11-18", hora: "09:00", confirmo: true };
const ctx = (m, extra = {}) => ({ accounts: m.accounts, contactos: () => m.contactos, smtp: {}, from: "p@vm.es", base: () => "https://pedidos.vm.test", negocio: "Distribuciones VM", send: m.send, pausaMs: 0, log: { error() {} }, ...extra });

test("VALIDACIÓN: confirmación, asunto, mensaje, tipo, destino, hora de Madrid, «ahora» y repetición", () => {
  const ok = validarCampana(base, { ahora: AHORA }).campana; assert.equal(ok.cuando, "2026-11-18T08:00:00.000Z"); assert.equal(ok.ahora, false);
  assert.equal(validarCampana({ ...base, ahora: true, dia: undefined, hora: undefined }, { ahora: AHORA }).campana.ahora, true);
  assert.match(validarCampana({ ...base, confirmo: false }, { ahora: AHORA }).error, /confirmación/); assert.match(validarCampana({ ...base, asunto: "" }, { ahora: AHORA }).error, /asunto/);
  assert.match(validarCampana({ ...base, asunto: "x".repeat(91) }, { ahora: AHORA }).error, /asunto/); assert.match(validarCampana({ ...base, texto: "" }, { ahora: AHORA }).error, /mensaje/);
  assert.match(validarCampana({ ...base, tipo: "spam" }, { ahora: AHORA }).error, /promoción o un aviso/); assert.match(validarCampana({ ...base, destino: "otros" }, { ahora: AHORA }).error, /quién/);
  assert.match(validarCampana({ ...base, destino: "cliente", clienteId: "9" }, { ahora: AHORA, existeCliente: () => false }).error, /cliente/);
  assert.match(validarCampana({ ...base, dia: "2026-11-14", hora: "11:00" }, { ahora: AHORA }).error, /minuto/); assert.match(validarCampana({ ...base, dia: "2028-01-01" }, { ahora: AHORA }).error, /año/);
  assert.match(validarCampana({ ...base, repetir: "diario" }, { ahora: AHORA }).error, /Repetición/);
});

test("PERMISO: las promociones solo van a quien las ha aceptado; los avisos de servicio, a todos con correo; sin duplicar direcciones", () => {
  const m = montar(); m.accounts.ofertasSet("1", true, "cliente"); m.accounts.ofertasSet("4", true, "empresa");
  const promo = audiencia({ accounts: m.accounts, contactos: m.contactos, campana: { tipo: "promo", destino: "todos" } });
  assert.deepEqual(promo.destinatarios.map((d) => d.id), ["1"]); // el 4 comparte correo con el 1: una sola vez
  assert.equal(promo.sinPermiso, 1); assert.equal(promo.sinCorreo, 1); // el 2 tiene correo pero no ha aceptado; el 3 no tiene correo
  const serv = audiencia({ accounts: m.accounts, contactos: m.contactos, campana: { tipo: "servicio", destino: "todos" } });
  assert.deepEqual(serv.destinatarios.map((d) => d.id).sort(), ["1", "2"]); assert.equal(serv.sinPermiso, 0);
  // a un cliente concreto: también necesita permiso si es promoción
  assert.equal(audiencia({ accounts: m.accounts, contactos: m.contactos, campana: { tipo: "promo", destino: "cliente", clienteId: "2" } }).destinatarios.length, 0);
  assert.equal(audiencia({ accounts: m.accounts, contactos: m.contactos, campana: { tipo: "promo", destino: "cliente", clienteId: "1" } }).destinatarios.length, 1);
  // y darse de baja lo quita
  m.accounts.ofertasSet("1", false, "cliente"); assert.equal(audiencia({ accounts: m.accounts, contactos: m.contactos, campana: { tipo: "promo", destino: "todos" } }).destinatarios.length, 1); // solo el 4 (otro cliente con ese correo: marcado por la empresa)
  assert.equal(m.accounts.ofertasDe("1").acepta, false); assert.equal(m.accounts.ofertasDe("9"), null);
});

test("TEXTO: «Publicidad» al principio, enlace de baja y cabecera de un clic en las promociones; sin publicidad en los avisos de servicio", () => {
  const p = mensajeCampana({ asunto: "Oferta para {nombre}", texto: "Hola a todos, {nombre}", tipo: "promo" }, { nombre: "BAR UNO", base: "https://pedidos.vm.test", token: "tok123", negocio: "Distribuciones VM", telefono: "983 000 000" });
  assert.ok(p.text.startsWith("Publicidad\n")); assert.equal(p.subject, "Oferta para BAR UNO"); assert.match(p.text, /Hola, BAR UNO:/); assert.match(p.text, /Hola a todos, BAR UNO/); assert.match(p.text, /https:\/\/pedidos\.vm\.test\/catalogo/);
  assert.match(p.text, /darte de baja aquí, en un clic: https:\/\/pedidos\.vm\.test\/baja\/tok123/); assert.match(p.text, /Teléfono: 983 000 000/);
  assert.deepEqual(p.headers, ["List-Unsubscribe: <https://pedidos.vm.test/baja/tok123>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click", "Precedence: bulk"]);
  const s = mensajeCampana({ asunto: "Mañana no hay reparto", texto: "Festivo local.", tipo: "servicio" }, { nombre: "BAR UNO", base: "https://pedidos.vm.test" });
  assert.ok(!/Publicidad/.test(s.text)); assert.ok(!/baja/.test(s.text)); assert.deepEqual(s.headers, []); assert.match(s.text, /aviso sobre el servicio/);
  assert.match(buildMessage({ from: "a@x.es", to: "b@y.es", subject: "S", text: "t", headers: p.headers }), /List-Unsubscribe: <https:\/\/pedidos\.vm\.test\/baja\/tok123>\r\nList-Unsubscribe-Post/);
  assert.doesNotMatch(buildMessage({ from: "a@x.es", to: "b@y.es", subject: "S", text: "t", headers: ["Malo: x\r\nBcc: robo@x.es"] }), /Bcc:/); // no se cuelan cabeceras
});

test("ENVÍO: solo a quien corresponde, con su enlace de baja, a su hora, una vez, y nunca tarde", async () => {
  const m = montar(); m.accounts.ofertasSet("1", true, "cliente");
  m.accounts.campanaCorreoAdd({ ...validarCampana(base, { ahora: AHORA }).campana, clienteId: null });
  assert.deepEqual(await enviarCampanas({ ...ctx(m), ahora: new Date("2026-11-18T07:59:00Z") }), { enviadas: 0, perdidas: 0, aplazadas: 0 }); assert.equal(m.enviados.length, 0);
  const r = await enviarCampanas({ ...ctx(m), ahora: new Date("2026-11-18T08:00:30Z") }); assert.equal(r.enviadas, 1);
  assert.equal(m.enviados.length, 1); assert.equal(m.enviados[0].to, "uno@x.es"); assert.match(m.enviados[0].text, /Cerveza al mejor precio, BAR UNO/); assert.match(m.enviados[0].text, new RegExp(`/baja/${m.accounts.bajaToken("1")}`));
  assert.match(m.accounts.campanaCorreoHistorial()[0].resultado, /1 enviado/); assert.match(m.accounts.campanaCorreoHistorial()[0].resultado, /no han aceptado ofertas/);
  assert.equal(m.accounts.bajaPorToken(m.accounts.bajaToken("1")), "1"); assert.equal(m.accounts.bajaPorToken("inventado"), null);
  assert.equal((await enviarCampanas({ ...ctx(m), ahora: new Date("2026-11-18T08:01:30Z") })).enviadas, 0); assert.equal(m.enviados.length, 1);
  // programa parado: no sale tarde
  m.accounts.campanaCorreoAdd({ ...validarCampana(base, { ahora: AHORA }).campana, clienteId: null });
  const r2 = await enviarCampanas({ ...ctx(m), ahora: new Date(Date.parse("2026-11-18T08:00:00Z") + (GRACIA_MIN + 5) * 60_000) }); assert.equal(r2.perdidas, 1); assert.equal(m.enviados.length, 1);
  // cancelado: no sale
  const id = m.accounts.campanaCorreoAdd({ ...validarCampana(base, { ahora: AHORA }).campana, clienteId: null }); assert.equal(m.accounts.campanaCorreoCancelar(id), true);
  assert.equal((await enviarCampanas({ ...ctx(m), ahora: new Date("2026-11-18T08:00:30Z") })).enviadas, 0);
});

test("ENVÍO: sin la dirección pública no se mandan promociones; el límite diario corta; un fallo del servidor no se repite; la semanal deja la siguiente", async () => {
  let m = montar(); m.accounts.ofertasSet("1", true, "cliente");
  m.accounts.campanaCorreoAdd({ ...validarCampana(base, { ahora: AHORA }).campana, clienteId: null });
  await enviarCampanas({ ...ctx(m, { base: () => "" }), ahora: new Date("2026-11-18T08:00:30Z") }); assert.equal(m.enviados.length, 0); assert.match(m.accounts.campanaCorreoHistorial()[0].resultado, /CLIENTE_URL/); assert.equal(m.accounts.campanaCorreoHistorial()[0].estado, "error");
  // límite diario
  process.env.CORREO_LIMITE_DIA = "1"; m = montar(); m.accounts.ofertasSet("1", true, "cliente"); m.accounts.ofertasSet("2", true, "cliente");
  m.accounts.campanaCorreoAdd({ ...validarCampana(base, { ahora: AHORA }).campana, clienteId: null });
  await enviarCampanas({ ...ctx(m), ahora: new Date("2026-11-18T08:00:30Z") }); assert.equal(m.enviados.length, 1); assert.match(m.accounts.campanaCorreoHistorial()[0].resultado, /1 sin enviar por el límite diario/); delete process.env.CORREO_LIMITE_DIA;
  // servidor de correo caído: se apunta, sin repetir
  m = montar(); m.accounts.ofertasSet("1", true, "cliente");
  m.accounts.campanaCorreoAdd({ ...validarCampana({ ...base, tipo: "servicio" }, { ahora: AHORA }).campana, clienteId: null });
  await enviarCampanas({ ...ctx(m, { send: async () => { throw new Error("servidor caído"); } }), ahora: new Date("2026-11-18T08:00:30Z") }); assert.equal(m.accounts.campanaCorreoHistorial()[0].estado, "error"); assert.match(m.accounts.campanaCorreoHistorial()[0].resultado, /con error/);
  // semanal
  m = montar(); m.accounts.ofertasSet("1", true, "cliente");
  m.accounts.campanaCorreoAdd({ ...validarCampana({ ...base, dia: "2026-10-22", repetir: "semana" }, { ahora: new Date("2026-10-20T10:00:00Z") }).campana, clienteId: null });
  await enviarCampanas({ ...ctx(m), ahora: new Date("2026-10-22T07:00:30Z") });
  const sig = m.accounts.campanaCorreoPendientes().find((x) => x.repetir === "semana"); assert.ok(sig); assert.equal(sig.dia, "2026-10-29"); assert.equal(sig.cuando, "2026-10-29T08:00:00.000Z");
});

test("PANEL, MI CUENTA Y BAJA: sección «Correos», permiso en Mi cuenta (por defecto NO), casilla en la ficha y página de baja", () => {
  const h = leer("./empresa.html"), c = leer("./cliente.html"), a = leer("./admin.js"), au = leer("./auth.js"), sv = leer("./server.js");
  for (const id of ["av-t-correo", "av-correo", "co-tipo", "co-destino", "co-asunto", "co-texto", "co-cuando", "co-dia", "co-repetir", "co-vista", "co-prueba", "co-enviar", "co-lista", "co-hist"]) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(h, /Promoción u oferta \(publicidad\)/); assert.match(h, /Aviso de servicio \(sin publicidad\)/); assert.match(h, /Ha aceptado recibir ofertas y promociones por correo/); assert.match(h, /ofertas: iOf\.checked/); assert.match(h, /¿\$\{prog \? "Programar" : "Enviar"\} este correo\?/);
  assert.match(c, /async function pintarOfertas\(box\)/); assert.match(c, /Quiero recibir ofertas y promociones por correo/); assert.match(c, /\/api\/correo\/ofertas/);
  for (const r of ['"/api/admin/correos" && get', '"/api/admin/correos/audiencia" && post', '"/api/admin/correos/programar" && post', "cancelar$/.exec(p)"]) assert.ok(a.includes(r), r);
  assert.match(au, /p\.startsWith\("\/baja\/"\)/); assert.match(au, /Darme de baja de las ofertas/); assert.match(au, /accounts\.ofertasSet\(id, false, "cliente"\)/);
  assert.match(sv, /"\/api\/correo\/ofertas" && req\.method === "POST"/); assert.match(sv, /CORREOS_PROGRAMADOS !== "0" && smtpDesdeEntorno\(\)/);
});
