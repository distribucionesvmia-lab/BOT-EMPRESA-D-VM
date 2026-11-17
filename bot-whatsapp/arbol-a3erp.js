// Árbol del catálogo con las familias y subfamilias de a3ERP (PDF «Listado de familias»): la categoría es la familia («10.0 AGUA») y la
// subcategoría la subfamilia («10.1 BEZOYA PET»). Solo se usa cuando casi todos los artículos ya traen su código de familia (tras subir el Excel
// de artículos); si no, el catálogo se queda con las categorías de la web, como siempre. Se aplica en memoria: no toca la base de datos.
import { categorizar } from "./categorias.js";

const limpia = (f) => String(f ?? "").trim().replace(/\.+$/, "");
const MINUSCULAS = new Set(["y", "de", "del", "la", "el", "los", "las", "con", "sin", "en", "a", "para", "por"]);
/** «VINO Y BEBIDAS ALCOHOL» → «Vino y bebidas alcohol»; lo que ya viene con minúsculas se respeta. */
export function bonito(t) {
  const s = String(t ?? "").trim(); if (!s) return s;
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

/**
 * items: artículos del catálogo ({ id, family, … }). nombres: familias-nombres.json. mapa: familias-categorias.json (solo para el icono).
 * Devuelve copias con category/subcategory/icono de a3ERP, o los mismos artículos si no hay datos de familia suficientes (minimo = parte con familia).
 */
export function conArbolA3erp(items, nombres = {}, mapa = {}, { minimo = 0.9 } = {}) {
  if (!Array.isArray(items) || !items.length) return items;
  const con = items.filter((p) => limpia(p.family)).length;
  if (con / items.length < minimo) return items;
  return items.map((p) => {
    const f = limpia(p.family); if (!f || !/^\d+\.\d+$/.test(f)) return p;
    const F = f.split(".")[0], fam = nombres[`${F}.0`];
    if (!fam) return p;
    const esRaiz = /\.0$/.test(f), sub = esRaiz ? null : nombres[f];
    const web = mapa[f] ?? mapa[`${F}.1`] ?? mapa[`${F}.0`];
    const icono = web?.category ? categorizar({ category: web.category }).icono : undefined;
    return { ...p, category: bonito(fam), subcategory: sub ? bonito(sub) : esRaiz ? "General" : `Familia ${f}`, ...(icono ? { icono } : {}) };
  });
}
