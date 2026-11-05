// Huellas del NIF en la DEMO del navegador: sha256("vm:código:6 caracteres"). No hay secreto del servidor, así que es más débil
// que en el servidor real (allí se usa HMAC con NIF_PEPPER); en la demo todos los datos son visibles para quien abra la base.
import { nifCodes, nifClean } from "../nif-codes.js";
import { sha256hex } from "./sha256.js";

export const demoNifKeys = (customerId, nif) => nifCodes(nif).map((c) => sha256hex(`vm:${customerId}:${c}`));
export const demoNifMatches = (customerId, typed, keys) => nifCodes(typed).some((c) => (keys ?? []).includes(sha256hex(`vm:${customerId}:${c}`)));
/** Junta las huellas de NIF de un cliente: las suyas, las del índice de la base y las preparadas al compilar (sin repetir). */
export const unirClavesNif = (cliente, ...fuentes) => [...new Set([...(cliente.nifKeys ?? []), ...fuentes.flatMap((f) => f?.[cliente.id] ?? [])])];
export const demoCodeKey = (code) => sha256hex(`vm:codigo:${nifClean(code)}`);
