// Códigos de un solo uso que cambian cada 30 segundos (TOTP, RFC 6238), los mismos que genera Google Authenticator, Microsoft Authenticator, Aegis, etc.
// Sin dependencias: solo `node:crypto`.
import crypto from "node:crypto";

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = (buf) => { let bits = 0, v = 0, out = ""; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += ABC[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += ABC[(v << (5 - bits)) & 31]; return out; };
export const deBase32 = (s) => { let bits = 0, v = 0; const out = []; for (const c of String(s).toUpperCase().replace(/[\s=-]/g, "")) { const i = ABC.indexOf(c); if (i < 0) throw new Error("clave no válida"); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
export const nuevoSecreto = () => base32(crypto.randomBytes(20)); // 160 bits

/** Código de `digitos` cifras para un contador (HOTP, RFC 4226). */
export function hotp(secretoBase32, contador, digitos = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac("sha1", deBase32(secretoBase32)).update(c).digest(), o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, "0");
}
export const contadorDe = (ms, paso = 30) => Math.floor(ms / 1000 / paso);
export const totp = (secreto, ms = Date.now(), digitos = 6) => hotp(secreto, contadorDe(ms), digitos);
/** ¿Es correcto el código? Admite el anterior y el siguiente (relojes algo desfasados). Devuelve el contador que coincidió o null. */
export function verificarTotp(secreto, codigo, ms = Date.now(), ventana = 1) {
  const c = String(codigo ?? "").replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return null;
  const ahora = contadorDe(ms); let hallado = null;
  for (let d = -ventana; d <= ventana; d++) { const esperado = hotp(secreto, ahora + d); if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c)) && hallado === null) hallado = ahora + d; } // se recorren todos: mismo tiempo acierte o no
  return hallado;
}
/** Dirección «otpauth://» para las aplicaciones (se puede escribir la clave a mano si no se escanea). */
export const urlOtp = (secreto, cuenta, emisor) => `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
export const agrupar = (s) => String(s).match(/.{1,4}/g)?.join(" ") ?? "";
