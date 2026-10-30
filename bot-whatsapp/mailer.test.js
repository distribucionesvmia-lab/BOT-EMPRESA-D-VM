import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sendMail, buildMessage, mailConfigFromEnv } from "./mailer.js";
import { orderMail, crearNotificador } from "./notificaciones.js";
import { openDb } from "./db.js";

// Certificado de pruebas (autofirmado)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-mail-"));
const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"]);
const CERT = gen.status === 0 ? { key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) } : null;

/** Servidor SMTP de mentira: guarda los mensajes. modo: "none" | "starttls" | "tls". */
function servidor(modo, { user = "avisos@vm.es", pass = "secreta" } = {}) {
  const mensajes = [], log = [];
  const atender = (sock) => {
    let seguro = modo === "tls", enData = false, buf = "", cuerpo = "", from = "", rcpt = [], esperaUser = false, esperaPass = false, u = "";
    const w = (t) => sock.write(t + "\r\n");
    const caps = () => { w("250-localhost"); w(`250-AUTH LOGIN PLAIN`); if (modo === "starttls" && !seguro) w("250-STARTTLS"); w("250 8BITMIME"); };
    sock.setEncoding("utf8");
    w("220 localhost ESMTP prueba");
    const linea = (l) => {
      log.push(l.length > 60 ? l.slice(0, 60) + "…" : l);
      if (enData) {
        if (l === ".") { enData = false; mensajes.push({ from, rcpt, raw: cuerpo }); cuerpo = ""; return w("250 ok guardado"); }
        cuerpo += l.replace(/^\.\./, ".") + "\r\n"; return;
      }
      if (esperaUser) { esperaUser = false; u = Buffer.from(l, "base64").toString(); esperaPass = true; return w("334 UGFzc3dvcmQ6"); }
      if (esperaPass) { esperaPass = false; return Buffer.from(l, "base64").toString() === pass && u === user ? w("235 autenticado") : w("535 credenciales no válidas"); }
      if (/^EHLO/i.test(l)) return caps();
      if (/^STARTTLS/i.test(l)) { w("220 listo para TLS"); sock.removeAllListeners("data"); const t = new tls.TLSSocket(sock, { isServer: true, ...CERT }); seguro = true; atender2(t); return; }
      if (/^AUTH LOGIN/i.test(l)) { esperaUser = true; return w("334 VXNlcm5hbWU6"); }
      if (/^AUTH PLAIN (.+)/i.test(l)) { const [, uu, pp] = Buffer.from(l.split(" ")[2], "base64").toString().split("\0"); return uu === user && pp === pass ? w("235 autenticado") : w("535 credenciales no válidas"); }
      if (/^MAIL FROM:<(.*)>/i.test(l)) { from = /<(.*)>/.exec(l)[1]; return w("250 ok"); }
      if (/^RCPT TO:<(.*)>/i.test(l)) { rcpt.push(/<(.*)>/.exec(l)[1]); return w("250 ok"); }
      if (/^DATA/i.test(l)) { enData = true; return w("354 adelante"); }
      if (/^QUIT/i.test(l)) { w("221 adiós"); return sock.end(); }
      w("500 no entiendo");
    };
    const atender2 = (s) => { sock = s; sock.setEncoding("utf8"); sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\r\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); linea(l); } }); sock.on("error", () => {}); };
    atender2(sock);
  };
  const srv = modo === "tls" ? tls.createServer({ ...CERT }, atender) : net.createServer(atender);
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, mensajes, log, port: srv.address().port })));
}
const decode = (raw) => { const [h, b] = raw.split("\r\n\r\n"); return { h, body: Buffer.from(b.replace(/\r\n/g, ""), "base64").toString("utf8") }; };
const cfg = (port, secure, extra = {}) => ({ host: "127.0.0.1", port, secure, user: "avisos@vm.es", pass: "secreta", rejectUnauthorized: false, timeout: 3000, ...extra });
const msg = { from: "Pedidos VM <avisos@vm.es>", to: ["oficina@vm.es", "otra@vm.es"], subject: "PEDIDO REALIZADO - BAÑO CAFÉ", text: "PEDIDO REALIZADO\nñandú con tildes: áéíóú\n.línea con punto al principio\n" };

test("correo: el mensaje lleva asunto con tildes codificado y el cuerpo en UTF-8", () => {
  const m = buildMessage({ ...msg, to: ["a@b.es"] });
  assert.match(m, /Subject: =\?UTF-8\?B\?/);
  assert.match(m, /Content-Transfer-Encoding: base64/);
  assert.equal(decode(m).body, msg.text);
});

for (const modo of ["none", "starttls", "tls"]) {
  test(`SMTP ${modo}: envía, autentica, respeta tildes y puntos al principio de línea`, { skip: modo !== "none" && !CERT && "falta openssl" }, async () => {
    const s = await servidor(modo);
    try {
      await sendMail(cfg(s.port, modo), msg);
      assert.equal(s.mensajes.length, 1);
      assert.equal(s.mensajes[0].from, "avisos@vm.es");
      assert.deepEqual(s.mensajes[0].rcpt, ["oficina@vm.es", "otra@vm.es"]);
      const { h, body } = decode(s.mensajes[0].raw);
      assert.match(h, /To: oficina@vm.es, otra@vm.es/);
      assert.equal(body, msg.text);
      assert.ok(!s.log.some((l) => /secreta/.test(l))); // la contraseña viaja en base64, nunca en claro
    } finally { s.srv.close(); }
  });
}

test("SMTP: contraseña mala, servidor que no ofrece STARTTLS y servidor que no responde dan errores claros (sin la contraseña)", async () => {
  let s = await servidor("none");
  await assert.rejects(sendMail(cfg(s.port, "none", { pass: "mala" }), msg), (e) => /rechazó el usuario o la contraseña/.test(e.message) && !/mala/.test(e.message));
  await assert.rejects(sendMail(cfg(s.port, "starttls"), msg), /no ofrece STARTTLS/); // nunca se envía sin cifrar si se pidió cifrado
  s.srv.close();
  s = net.createServer(() => {}); // acepta y calla
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  await assert.rejects(sendMail(cfg(s.address().port, "none", { timeout: 300 }), msg), /tiempo agotado/);
  s.close();
  await assert.rejects(sendMail({ host: "" }, msg), /SMTP_HOST/);
  await assert.rejects(sendMail(cfg(1, "none", { timeout: 500 }), { ...msg, to: [] }), /destinatario/);
});

test("configuración por variables de entorno", () => {
  assert.equal(mailConfigFromEnv({}), null);
  assert.equal(mailConfigFromEnv({ SMTP_HOST: "smtp.ionos.es" }), null); // falta el destino
  const c = mailConfigFromEnv({ SMTP_HOST: "smtp.ionos.es", SMTP_USER: "a@vm.es", SMTP_PASS: "x", MAIL_TO: "x@vm.es, y@vm.es" });
  assert.deepEqual([c.smtp.port, c.smtp.secure, c.from, c.to], [587, "starttls", "a@vm.es", ["x@vm.es", "y@vm.es"]]);
  assert.equal(mailConfigFromEnv({ SMTP_HOST: "h", MAIL_TO: "x@vm.es", SMTP_PORT: "465" }).smtp.secure, "tls");
});

const pedido = (extra = {}) => ({ key: "k" + Math.random(), phone: "1", customerId: "9001", name: "BAR EL EJEMPLO", address: "Calle 1", at: "2026-10-29T08:00:00.000Z", delivery: "2026-11-02", note: "Llamar antes",
  items: [{ id: "1", name: "AGUA 1,5 L", qty: 2, unit: "caja", boxes: 2, units: 12, price: 0.5, vat: 10, amount: 6 }, { id: "2", name: "COLA", qty: 6, unit: "ud", units: 6, price: 0.6, vat: 21, amount: 3.6, note: "bien fría" }], ...extra });

test("correo del pedido: «PEDIDO REALIZADO», nombre comercial del cliente, día de entrega y artículos", () => {
  const db = openDb(":memory:");
  const { order } = db.createOrder(pedido());
  const { subject, text } = orderMail(order);
  assert.equal(subject, "PEDIDO REALIZADO - BAR EL EJEMPLO");
  assert.match(text, /^PEDIDO REALIZADO\n/);
  assert.match(text, /Nombre comercial del cliente: BAR EL EJEMPLO/);
  assert.match(text, /Código de cliente: 9001/);
  assert.match(text, new RegExp(`Pedido: ${order.ref}`));
  assert.match(text, /Entrega: LUNES 2 DE NOVIEMBRE/);
  assert.match(text, /2 cajas \(12 uds\) · AGUA 1,5 L/);
  assert.match(text, /6 uds · COLA\n\s+Observación: bien fría/);
  assert.match(text, /Observaciones del cliente: Llamar antes/);
  assert.match(text, /Total aproximado \(con IVA\): /);
  // sin día de entrega ni nombre
  const o2 = db.createOrder(pedido({ delivery: null, name: "", customerId: null })).order;
  assert.match(orderMail(o2).text, /Entrega: sin día indicado/);
  assert.equal(orderMail(o2).subject, "PEDIDO REALIZADO - CLIENTE SIN NOMBRE");
  assert.match(orderMail(o2).text, /cliente nuevo, sin código/);
});

test("notificador: envía el aviso de un pedido nuevo una sola vez y reintenta si falla, sin afectar al pedido", async () => {
  const db = openDb(":memory:");
  const enviados = [], silencio = { log() {}, error() {} };
  let caido = true, t = Date.now();
  const n = crearNotificador({ db, config: { smtp: {}, from: "avisos@vm.es", to: ["oficina@vm.es"] }, log: silencio, now: () => new Date(t).toISOString(),
    send: async (_c, m) => { if (caido) throw new Error("servidor caído"); enviados.push(m); } });
  const { order } = db.createOrder(pedido());
  assert.equal(await n.enviar(order), false); // falla: el pedido sigue guardado
  assert.equal(db.listOrders().length, 1);
  assert.match(n.status().ultimoError.message, /servidor caído/);
  assert.equal(db.pendingNotifications().length, 1);
  caido = false;
  await n.reintentar();
  assert.equal(enviados.length, 0); // la reserva de 2 minutos impide el reintento inmediato
  t += 10 * 60_000; // pasan 10 minutos: la reserva caducó
  await n.reintentar();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].subject, "PEDIDO REALIZADO - BAR EL EJEMPLO");
  assert.deepEqual(enviados[0].to, ["oficina@vm.es"]);
  assert.equal(db.pendingNotifications().length, 0);
  await n.reintentar();
  assert.equal(enviados.length, 1); // no se repite
  assert.equal(n.status().ultimoError, null);
});

test("dos procesos no envían el mismo aviso: el segundo no consigue la reserva", () => {
  const db = openDb(":memory:");
  const { order } = db.createOrder(pedido());
  assert.equal(db.claimNotification(order.id), true);
  assert.equal(db.claimNotification(order.id), false);
  db.markNotified(order.id);
  assert.equal(db.claimNotification(order.id, new Date(Date.now() + 3_600_000).toISOString()), false); // ya enviado: nunca más
});
