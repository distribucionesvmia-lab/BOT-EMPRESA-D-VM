// Parte pura (sin Node) del acceso con NIF: qué código de 6 dígitos vale escribir para un DNI/NIF/CIF. La usan el servidor y la demo.

/** Solo letras y números, en mayúsculas: «12.345.678-Z» → «12345678Z». */
export const nifClean = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Código con el que entra el cliente: los 6 PRIMEROS DÍGITOS de su DNI/NIF/CIF (las letras se saltan: «45678912Z» → «456789»,
 * «B88922539» → «889225»). Si escribe el DNI entero, también vale: se toman igual sus 6 primeros dígitos.
 */
export function nifCodes(nif) {
  const digits = nifClean(nif).replace(/\D/g, "");
  return digits.length >= 6 ? [digits.slice(0, 6)] : [];
}
