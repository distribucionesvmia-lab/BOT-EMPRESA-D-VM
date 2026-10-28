// Enlace personal para abrir la mini-aplicación de pedido desde WhatsApp.
// Va firmado (HMAC) y caduca: solo sirve para el teléfono al que se envió, durante 24 h.
import crypto from "node:crypto";

// En producción define LINK_SECRET en .env; si no, se genera uno al arrancar (los enlaces mueren al reiniciar)
const SECRET = process.env.LINK_SECRET ?? crypto.randomBytes(32).toString("hex");
const TTL = 24 * 60 * 60 * 1000;

const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

export function makeToken(phone, customerId, now = Date.now()) {
  const payload = { p: String(phone), c: customerId ?? null, e: now + TTL, n: crypto.randomBytes(6).toString("hex") };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** Devuelve { p: teléfono, c: código de cliente, e: caducidad, n: identificador único } o null si no es válido. */
export function readToken(token, now = Date.now()) {
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    return payload.e > now ? payload : null;
  } catch {
    return null;
  }
}
