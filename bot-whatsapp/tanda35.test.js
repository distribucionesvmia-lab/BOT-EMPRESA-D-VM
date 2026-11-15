// Correo de confirmación de pedido al cliente: destino, contenido (sin códigos), un solo correo por pedido, preferencia y fallos sin efecto sobre el pedido.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAccountsDb } from "./cuentas-db.js";
import { elegirDestino, tapar, emailValido, correoPedido, crearCorreoCliente, smtpDesdeEntorno } from "./correo-cliente.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const pedido = (extra = {}) => ({ ref: "VM-2026-000123", created_at: "2026-11-16T07:30:00.000Z", delivery_date: "2026-11-17", customer_id: "7001", name: "BAR PRUEBA", address: "Calle Uno 1", note: "Llamar antes", re: false, review: false, status: "active", export_status: "pending",
  items: [{ id: "ART-9988", name: "AGUA 1,5 L", qty: 2, unit: "caja", boxes: 2, units: 12, price: 0.5, discount: 0, vat_rate: 10 }, { id: "ART-1", name: "CAFÉ 1 KG", qty: 3, unit: "ud", units: 3, price: 9, discount: 0, vat_rate: 10 }], ...extra });
const montar = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-cc-")), accounts = openAccountsDb(path.join(dir, "a.sqlite")), enviados = []; return { accounts, enviados, send: async (smtp, m) => void enviados.push(m) }; };
const cuenta = { customerId: "7001", email: "bar@ejemplo.es" }, clientes = { getById: (id) => (id === "7001" ? { id, name: "BAR PRUEBA", emails: ["erp@ejemplo.es"] } : null) };

test("DESTINO: su correo de la cuenta, si no el de a3ERP, nunca uno inválido; se tapa al enseñarlo", () => {
  assert.equal(elegirDestino({ account: cuenta, customer: clientes.getById("7001") }), "bar@ejemplo.es");
  assert.equal(elegirDestino({ account: { email: null }, customer: clientes.getById("7001") }), "erp@ejemplo.es");
  assert.equal(elegirDestino({ account: { email: "no es un correo" }, customer: { emails: ["tampoco@"] } }), null);
  assert.equal(elegirDestino({ account: {}, customer: null }), null);
  assert.ok(emailValido("a@b.es") && !emailValido("a b@c.es") && !emailValido("a@b") && !emailValido("a@b.es,otro@c.es"));
  assert.equal(tapar("bar@ejemplo.es"), "b**@ejemplo.es"); assert.ok(!tapar("maria.lopez@gmail.com").includes("lopez"));
});

test("CONTENIDO: resumen del pedido para el cliente, informativo, SIN códigos de cliente ni de artículo", () => {
  const m = correoPedido(pedido(), { nombre: "BAR PRUEBA", telefono: "983 000 000", ahora: "2026-11-16T08:00:00.000Z" });
  assert.match(m.subject, /Hemos recibido tu pedido VM-2026-000123/); assert.match(m.text, /2 cajas \(12 uds\) · AGUA 1,5 L/); assert.match(m.text, /3 uds · CAFÉ 1 KG/);
  assert.match(m.text, /Total con IVA: 36,30 €/); assert.match(m.text, /Calle Uno 1/); assert.match(m.text, /Llamar antes/); assert.match(m.text, /983 000 000/);
  assert.match(m.text, /solo informativo: no es una factura/); assert.match(m.text, /«Mi cuenta» → «Correo»/); assert.match(m.text, /Puedes modificarlo hasta las 10:00/);
  for (const prohibido of ["7001", "ART-9988", "ART-1"]) assert.ok(!m.text.includes(prohibido) && !m.subject.includes(prohibido), "no debe salir " + prohibido);
  const mod = correoPedido(pedido(), { modificado: true }); assert.match(mod.subject, /Pedido modificado VM-2026-000123/); assert.match(mod.text, /cambios de tu pedido/);
  assert.match(correoPedido(pedido({ review: true }), {}).text, /Revisaremos tu pedido/);
  assert.match(correoPedido(pedido({ re: true }), { ahora: "2026-11-16T08:00:00.000Z" }).text, /Total con IVA: 36,[4-9]\d €/); // con recargo de equivalencia el total sube
});

test("ENVÍO: un solo correo por pedido, otro por cada modificación, respeta la preferencia y no falla nunca", async () => {
  const { accounts, enviados, send } = montar(), cc = crearCorreoCliente({ accounts, smtp: { host: "x" }, from: "pedidos@x.es", customers: clientes, negocio: "Distribuciones VM", send, log: { error() {} } });
  assert.equal(await cc.enviar(cuenta, pedido()), "enviado"); assert.equal(enviados.length, 1); assert.equal(enviados[0].to, "bar@ejemplo.es"); assert.equal(enviados[0].from, "pedidos@x.es");
  assert.equal(await cc.enviar(cuenta, pedido()), "repetido"); assert.equal(enviados.length, 1); // el mismo pedido no se manda dos veces
  assert.equal(await cc.enviar(cuenta, pedido({ modified_at: "2026-11-16T10:30:00.000Z" }), { modificado: true }), "enviado"); assert.equal(enviados.length, 2); // una modificación sí
  accounts.correoPedidoSet("7001", false); assert.equal(accounts.correoPedidoActivo("7001"), false);
  assert.equal(await cc.enviar(cuenta, pedido({ ref: "VM-2026-000124" })), "desactivado"); assert.equal(enviados.length, 2); // si lo quitó, no se manda
  accounts.correoPedidoSet("7001", true);
  assert.equal(await cc.enviar({ customerId: "9999", email: null }, pedido({ ref: "VM-2026-000125" })), "sin-correo");
  const caido = crearCorreoCliente({ accounts, smtp: {}, from: "a@b.es", customers: clientes, negocio: "VM", send: async () => { throw new Error("servidor caído"); }, log: { error() {} } });
  assert.equal(await caido.enviar(cuenta, pedido({ ref: "VM-2026-000126" })), "error"); // un fallo no se propaga: el pedido ya está guardado
  assert.doesNotThrow(() => caido.notificar(cuenta, pedido({ ref: "VM-2026-000127" })));
  await new Promise((r) => setTimeout(r, 20));
  const r = accounts.correoPedidosResumen("2000-01-01T00:00:00Z"); assert.equal(r.enviados, 2); assert.equal(r.sinCorreo, 1); assert.equal(r.errores, 2); assert.match(r.ultimoError.mensaje, /servidor caído/);
  assert.ok(!JSON.stringify(accounts.correoPedidosResumen("2000-01-01T00:00:00Z")).includes("@"), "el registro no guarda direcciones");
});

test("CONFIGURACIÓN: para escribir al cliente basta SMTP (no hace falta MAIL_TO) y CORREO_CLIENTES=0 / sin SMTP lo apaga", () => {
  assert.equal(smtpDesdeEntorno({}), null); assert.equal(smtpDesdeEntorno({ SMTP_HOST: "smtp.gmail.com" }), null); // sin remitente no se envía
  const c = smtpDesdeEntorno({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@gmail.com", SMTP_PASS: "x" }); assert.equal(c.smtp.host, "smtp.gmail.com"); assert.equal(c.smtp.port, 587); assert.equal(c.from, "a@gmail.com"); assert.equal(c.smtp.secure, "starttls");
  assert.equal(smtpDesdeEntorno({ SMTP_HOST: "h", MAIL_FROM: "z@z.es", SMTP_PORT: "465" }).smtp.secure, "tls");
  const sv = leer("./server.js"); assert.match(sv, /process\.env\.CORREO_CLIENTES === "0" \? null : smtpDesdeEntorno\(\)/); assert.match(sv, /correoCliente\(\)\?\.notificar\(account, guardado, \{ modificado \}\)/);
});

test("MI CUENTA y PANEL: interruptor «Correo con la confirmación de mis pedidos» y recuento de envíos en la tarjeta del correo", () => {
  const c = leer("./cliente.html"), e = leer("./empresa.html"), a = leer("./admin.js");
  assert.match(c, /function pintarCorreo\(box\)/); assert.match(c, /Correo con la confirmación de mis pedidos/); assert.match(c, /pintarCorreo\(correoCaja\)/); assert.match(c, /no es una factura/);
  assert.match(e, /async function correoClientes\(\)/); assert.match(e, /cliente\.env/); assert.match(a, /"\/api\/admin\/correo-clientes" && get/);
});

test("CORREO: la contraseña de aplicación de Google se limpia (espacios y comillas) y el error dice qué respondió el servidor sin enseñar la contraseña", async () => {
  const { limpiaCredencial, errorDeCredenciales } = await import("./mailer.js");
  assert.equal(limpiaCredencial("  abcd efgh ijkl mnop \r", { sinEspacios: true }), "abcdefghijklmnop"); assert.equal(limpiaCredencial('"abcd efgh"'), "abcd efgh"); assert.equal(limpiaCredencial("'x@y.es'"), "x@y.es"); assert.equal(limpiaCredencial(undefined), "");
  const e1 = errorDeCredenciales({ code: 535, text: "5.7.8 Username and Password not accepted. For more information, go to" }, { host: "smtp.gmail.com", user: "pedidos@gmail.com", pass: "claveSecreta12" });
  assert.match(e1.message, /rechazó el usuario o la contraseña/); assert.match(e1.message, /535 5\.7\.8 Username and Password not accepted/); assert.match(e1.message, /«pedidos@gmail\.com»/); assert.match(e1.message, /tiene 14 caracteres/); assert.match(e1.message, /exactamente 16 letras y aquí se leen 14/);
  assert.ok(!e1.message.includes("claveSecreta12"), "la contraseña no sale nunca");
  assert.match(errorDeCredenciales({ code: 534, text: "5.7.9 Application-specific password required" }, { host: "smtp.gmail.com", user: "a@gmail.com", pass: "abcdefghijklmnop" }).message, /CONTRASEÑA DE APLICACIÓN/);
  assert.match(errorDeCredenciales({ code: 534, text: "5.7.14 Please log in via your web browser" }, { host: "smtp.gmail.com", user: "a@gmail.com", pass: "abcdefghijklmnop" }).message, /bloqueado el acceso/);
  assert.doesNotMatch(errorDeCredenciales({ code: 535, text: "mal" }, { host: "smtp.otro.es", user: "a@b.es", pass: "x" }).message, /16 letras/); // la pista de 16 letras es solo de Google
});
