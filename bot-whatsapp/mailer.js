// Envío de correo por SMTP sin dependencias (node:net / node:tls): STARTTLS (puerto 587, el de IONOS), TLS directo (465) o sin cifrar (solo pruebas).
// Autenticación AUTH LOGIN / PLAIN. La contraseña nunca se escribe en los mensajes de error ni en el registro.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
/** Cabecera con tildes o ñ: «=?UTF-8?B?…?=» (RFC 2047); si es ASCII se deja tal cual. */
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOf = (s) => (/<([^>]+)>/.exec(s)?.[1] ?? String(s)).trim();
const wrap76 = (s) => s.match(/.{1,76}/g)?.join("\r\n") ?? "";

/** Mensaje completo (cabeceras + cuerpo en UTF-8 codificado en base64). */
export function buildMessage({ from, to, subject, text, date = new Date(), messageId }) {
  const host = addrOf(from).split("@")[1] ?? "localhost";
  const headers = [
    `From: ${from}`,
    `To: ${[].concat(to).join(", ")}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId ?? crypto.randomUUID()}@${host}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + wrap76(b64(text)) + "\r\n";
}

/** Lector de respuestas SMTP (pueden venir en varias líneas «250-…», «250 …»). */
class Conn {
  constructor(sock, timeout) { this.timeout = timeout; this.buf = ""; this.queue = []; this.waiters = []; this.err = null; this.attach(sock); }
  attach(sock) {
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (d) => { this.buf += d; this.pump(); });
    sock.on("error", (e) => this.fail(e));
    sock.on("close", () => this.fail(new Error("El servidor de correo cerró la conexión.")));
    sock.setTimeout(this.timeout, () => this.fail(new Error("El servidor de correo no responde (tiempo agotado).")));
  }
  detach() { this.sock.removeAllListeners("data"); this.sock.removeAllListeners("close"); this.sock.removeAllListeners("error"); this.sock.setTimeout(0); }
  fail(e) { this.err ??= e; for (const w of this.waiters.splice(0)) w.reject(this.err); }
  pump() {
    for (;;) {
      const lines = this.buf.split("\r\n");
      if (lines.length < 2) return;
      // una respuesta termina en la primera línea con «código + espacio»
      const end = lines.findIndex((l, i) => i < lines.length - 1 && /^\d{3} /.test(l));
      if (end < 0) return;
      const resp = lines.slice(0, end + 1);
      this.buf = lines.slice(end + 1).join("\r\n");
      const r = { code: Number(resp[0].slice(0, 3)), lines: resp.map((l) => l.slice(4)), text: resp.map((l) => l.slice(4)).join(" ") };
      const w = this.waiters.shift();
      if (w) w.resolve(r); else this.queue.push(r);
    }
  }
  read() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.err) return Promise.reject(this.err);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  write(s) { this.sock.write(s); }
  async cmd(line, ok) {
    this.write(line + "\r\n");
    const r = await this.read();
    if (!ok.includes(r.code)) throw new Error(`El servidor de correo respondió ${r.code}: ${r.text}`);
    return r;
  }
}

/**
 * Envía un correo. cfg: { host, port = 587, secure = "starttls" | "tls" | "none", user, pass, rejectUnauthorized = true, timeout = 20000 }
 * msg: { from, to (texto o lista), subject, text }. Lanza un Error claro si algo falla.
 */
export async function sendMail(cfg, msg) {
  const { host, port = 587, secure = "starttls", user, pass, rejectUnauthorized = true, timeout = 20000 } = cfg;
  if (!host) throw new Error("Falta el servidor de correo (SMTP_HOST).");
  const to = [].concat(msg.to).map(addrOf).filter(Boolean);
  if (!to.length) throw new Error("Falta el destinatario del correo.");
  const sock = await new Promise((resolve, reject) => {
    const s = secure === "tls" ? tls.connect({ host, port, servername: host, rejectUnauthorized }) : net.connect({ host, port });
    s.once(secure === "tls" ? "secureConnect" : "connect", () => resolve(s));
    s.once("error", reject);
    s.setTimeout(timeout, () => { s.destroy(); reject(new Error("No se pudo conectar con el servidor de correo (tiempo agotado).")); });
  });
  const c = new Conn(sock, timeout);
  try {
    const hello = await c.read();
    if (hello.code !== 220) throw new Error(`El servidor de correo respondió ${hello.code}: ${hello.text}`);
    let caps = (await c.cmd("EHLO localhost", [250])).lines.map((l) => l.toUpperCase());
    if (secure === "starttls") {
      if (!caps.some((l) => l.startsWith("STARTTLS"))) throw new Error("El servidor de correo no ofrece STARTTLS: no se envía sin cifrar.");
      await c.cmd("STARTTLS", [220]);
      c.detach();
      const secured = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: c.sock, servername: host, rejectUnauthorized }, () => resolve(t));
        t.once("error", reject);
      });
      c.buf = ""; c.queue = []; c.waiters = []; c.err = null;
      c.attach(secured);
      caps = (await c.cmd("EHLO localhost", [250])).lines.map((l) => l.toUpperCase());
    }
    if (user) {
      const auth = caps.find((l) => l.startsWith("AUTH")) ?? "";
      if (/\bLOGIN\b/.test(auth)) {
        await c.cmd("AUTH LOGIN", [334]);
        await c.cmd(b64(user), [334]);
        const r = await c.cmd(b64(pass ?? ""), [235, 334, 535]).catch((e) => { throw e; });
        if (r.code !== 235) throw new Error("El servidor de correo rechazó el usuario o la contraseña.");
      } else {
        const r = await c.cmd(`AUTH PLAIN ${b64(`\0${user}\0${pass ?? ""}`)}`, [235, 535]);
        if (r.code !== 235) throw new Error("El servidor de correo rechazó el usuario o la contraseña.");
      }
    }
    await c.cmd(`MAIL FROM:<${addrOf(msg.from)}>`, [250]);
    for (const r of to) await c.cmd(`RCPT TO:<${r}>`, [250, 251]);
    await c.cmd("DATA", [354]);
    const data = buildMessage({ ...msg, to }).replace(/^\./gm, ".."); // los puntos al principio de línea se duplican
    c.write(data + ".\r\n");
    const done = await c.read();
    if (done.code !== 250) throw new Error(`El servidor de correo no aceptó el mensaje (${done.code}): ${done.text}`);
    c.write("QUIT\r\n");
  } finally {
    c.sock.destroy();
  }
}

/** Configuración desde el entorno: SMTP_HOST, SMTP_PORT, SMTP_SECURE (starttls|tls|none), SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO (varias separadas por coma). null si no está configurado. */
export function mailConfigFromEnv(env = process.env) {
  if (!env.SMTP_HOST || !env.MAIL_TO) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    smtp: { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ?? (port === 465 ? "tls" : "starttls"), user: env.SMTP_USER, pass: env.SMTP_PASS, rejectUnauthorized: env.SMTP_INSECURE !== "1" },
    from: env.MAIL_FROM ?? env.SMTP_USER,
    to: env.MAIL_TO.split(",").map((x) => x.trim()).filter(Boolean),
  };
}
