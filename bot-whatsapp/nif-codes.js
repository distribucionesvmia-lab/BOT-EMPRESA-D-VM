// Parte pura (sin Node) del acceso con NIF: qué códigos de 6 caracteres vale escribir para un NIF/CIF. La usan el servidor y la demo.

/** Solo letras y números, en mayúsculas: «12.345.678-Z» → «12345678Z». */
export const nifClean = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Códigos válidos que se pueden escribir para un NIF: los 6 últimos caracteres («45678Z») y, si acaba en letra,
 * también los 6 últimos números («345678»), por si el cliente no cuenta la letra.
 */
export function nifCodes(nif) {
  const c = nifClean(nif);
  if (c.length < 6) return [];
  const digits = c.replace(/\D/g, "").slice(-6);
  return [...new Set([c.slice(-6), digits.length === 6 ? digits : null].filter(Boolean))];
}
