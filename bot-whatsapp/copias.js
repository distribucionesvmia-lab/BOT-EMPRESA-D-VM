// Estado y comprobación de las copias de seguridad. SOLO LEE: nunca crea, cambia ni borra copias ni bases en uso.
import fs from "node:fs";
import { BASES, listarCopias, verificarCopia } from "./restaurar.js";

export const MAX_HORAS_COPIA = 26; // las copias son diarias (03:00): pasadas 26 h falta una
export const NOMBRE_BASE = { pedidos: "Pedidos", cuentas: "Cuentas de clientes", clientes: "Clientes", catalogo: "Catálogo y precios" };

/** «20261110-0300» (hora de Madrid, como se nombran las copias) → milisegundos reales. Mejor que la hora del archivo, que cambia si se copia la carpeta. */
export function msDeSello(f) {
  const [y, m, d, h, mi] = [f.slice(0, 4), f.slice(4, 6), f.slice(6, 8), f.slice(9, 11), f.slice(11, 13)].map(Number), guess = Date.UTC(y, m - 1, d, h, mi);
  const pt = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return guess - (Date.UTC(+pt.year, +pt.month - 1, +pt.day, +pt.hour, +pt.minute) - guess);
}

/** La copia más reciente de cada base con su edad (por la hora del archivo), tamaño y si ya es demasiado antigua. */
export function estadoCopias(dir, { ahora = Date.now(), maxHoras = MAX_HORAS_COPIA } = {}) {
  const copias = listarCopias(dir), bases = {}, problemas = [];
  for (const b of BASES) {
    const ultima = copias[b][0];
    if (!ultima) { bases[b] = { base: b, nombre: NOMBRE_BASE[b], hay: false, cuantas: 0, aviso: "Todavía no hay ninguna copia." }; problemas.push(`${NOMBRE_BASE[b]}: no hay ninguna copia.`); continue; }
    let st = null; try { st = fs.statSync(ultima.ruta); } catch { /* desapareció entre medias */ }
    const horas = st ? Math.max(0, Math.floor((ahora - msDeSello(ultima.fecha)) / 3600000)) : null;
    const f = ultima.fecha, fecha = `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)} ${f.slice(9, 11)}:${f.slice(11, 13)}`;
    const vieja = horas === null || horas > maxHoras;
    bases[b] = { base: b, nombre: NOMBRE_BASE[b], hay: true, archivo: ultima.archivo, fecha, horas, bytes: st?.size ?? 0, cuantas: copias[b].length, vieja, aviso: vieja ? `La última copia tiene ${horas ?? "?"} horas (debería haber una cada día).` : null };
    if (vieja) problemas.push(`${NOMBRE_BASE[b]}: ${bases[b].aviso}`);
  }
  return { carpeta: dir, existe: fs.existsSync(dir), ok: problemas.length === 0, maxHoras, bases: BASES.map((b) => bases[b]), problemas };
}

/** Abre la última copia de cada base en solo lectura, pasa la comprobación de integridad de SQLite y cuenta sus datos (prueba de «restaurar» sin restaurar nada). */
export function comprobarCopias(dir, opts = {}) {
  const estado = estadoCopias(dir, opts), copias = listarCopias(dir);
  const bases = estado.bases.map((e) => {
    if (!e.hay) return { ...e, comprobada: false, correcta: false, motivo: "No hay copia que comprobar." };
    const v = verificarCopia(copias[e.base][0].ruta, e.base);
    return { ...e, comprobada: true, correcta: v.ok, motivo: v.ok ? null : v.motivo, datos: v.ok ? v.datos : null };
  });
  const malas = bases.filter((b) => !b.correcta).map((b) => `${b.nombre}: ${b.motivo ?? b.aviso}`);
  return { ...estado, bases, comprobadoEn: new Date(opts.ahora ?? Date.now()).toISOString(), todasCorrectas: bases.every((b) => b.correcta), problemas: [...new Set([...estado.problemas, ...malas])], ok: estado.ok && malas.length === 0 };
}
