// Comprobación del acceso con los ÚLTIMOS 6 caracteres del NIF/CIF.
// El NIF completo nunca se guarda: de cada cliente solo se conserva una huella (HMAC-SHA256) de esos 6 caracteres,
// calculada con un secreto del servidor (NIF_PEPPER) y el código del cliente. Con la base de datos sola no se puede
// recuperar el NIF; además cada cuenta se bloquea tras unos pocos fallos (ver cuentas-db.js).
import crypto from "node:crypto";
import { nifClean, nifCodes } from "./nif-codes.js";

const pepper = () => process.env.NIF_PEPPER ?? "vm-pepper-solo-desarrollo";

export { nifClean, nifCodes };

const keyOf = (customerId, code) => crypto.createHmac("sha256", pepper()).update(`${customerId}:${code}`).digest("hex");

/** Huellas que se guardan para un cliente a partir de su NIF. */
export const nifKeys = (customerId, nif) => nifCodes(nif).map((c) => keyOf(customerId, c));

/** ¿Lo escrito corresponde a alguna de las huellas guardadas? (comparación en tiempo constante) */
export function nifMatches(customerId, typed, keys) {
  const stored = (keys ?? []).map((k) => Buffer.from(k, "hex"));
  let ok = false;
  for (const code of nifCodes(typed)) {
    const k = Buffer.from(keyOf(customerId, code), "hex");
    for (const s of stored) if (s.length === k.length && crypto.timingSafeEqual(s, k)) ok = true;
  }
  return ok;
}

/** Huella del código personal que el cliente elige para sustituir a los 6 del NIF (único entre todos los clientes). */
export const codeKey = (code) => crypto.createHmac("sha256", pepper()).update(`codigo:${nifClean(code)}`).digest("hex");
export const validCode = (code) => /^[A-Z0-9]{6}$/.test(nifClean(code)); // la contraseña personal: exactamente 6 letras o números (mayúsculas y minúsculas valen igual)

/** Huella del código de 6 cifras que da la oficina para entrar (solo se guarda esto, nunca el código; va atada al cliente). */
export const claveCodigoOficina = (customerId, code) => crypto.createHmac("sha256", pepper()).update(`oficina:${customerId}:${String(code).replace(/\D/g, "")}`).digest("hex");
// Secretos de los clientes (p. ej. el de la verificación en dos pasos): se guardan CIFRADOS (AES-256-GCM) con una llave derivada de NIF_PEPPER, que no está en la base de datos ni en las copias.
let llaveSellos = null, llaveDe = "";
const llaveSello = () => { const p = pepper(); if (llaveDe !== p) { llaveSellos = crypto.scryptSync(p, "vm-secretos-cliente-v1", 32); llaveDe = p; } return llaveSellos; };
export const sellar = (txt) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", llaveSello(), iv), ct = Buffer.concat([c.update(String(txt), "utf8"), c.final()]); return `v1$${iv.toString("base64")}$${c.getAuthTag().toString("base64")}$${ct.toString("base64")}`; };
export const abrirSello = (sello) => { try { const [v, iv, tag, ct] = String(sello).split("$"); if (v !== "v1") return null; const d = crypto.createDecipheriv("aes-256-gcm", llaveSello(), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"); } catch { return null; } };
/** (en desuso) Huella del código de 6 cifras que se mandaba por correo para entrar (solo se guarda esto, nunca el código; va atada al cliente). */
export const claveCodigoCorreo = (customerId, code) => crypto.createHmac("sha256", pepper()).update(`correo:${customerId}:${String(code).replace(/\D/g, "")}`).digest("hex");
