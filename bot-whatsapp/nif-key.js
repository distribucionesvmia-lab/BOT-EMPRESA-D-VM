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
