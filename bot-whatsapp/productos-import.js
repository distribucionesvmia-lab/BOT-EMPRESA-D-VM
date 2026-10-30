// Importación de la lista de productos (Excel/Hoja de cálculo que exporta a3ERP o que prepara la empresa):
// código, descripción, precio, unidades por caja, IVA, descuento y bloqueado/obsoleto. Se reconocen las columnas por su cabecera,
// sin importar el orden, las tildes ni las mayúsculas. Solo hacen falta código, descripción y precio.
import { readXlsx } from "./xlsx-read.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
const yes = (v) => /^(si|sí|s|true|1|x)$/i.test(String(v ?? "").trim());

/** Número escrito a la española o a la inglesa: «1.234,56», «1,25», «1.25», «0,42 €» → número; vacío o texto → null. */
export function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v ?? "").replace(/[€%\s]/g, "");
  if (!t || !/^-?[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Cada campo: expresiones que reconocen su cabecera (ya normalizada) y las que la descartan
const FIELDS = [
  ["code", [/^(cod|codigo|ref|referencia|articulo|id)( art\w*| prod\w*)?$/], [/barra|ean|proveedor/]],
  ["name", [/^(descrip|nombre|denomin)/], []],
  ["price", [/(pvp|venta)/, /^(precio|tarifa)/], [/compra|coste|costo/]],
  ["unitsPerBox", [/(ud|uds|unid\w*)\W*(por |\/ ?|x )?caja/, /^caja/, /^envase|^empaque/], []],
  ["vat", [/^(% ?)?iva|tipo iva|^impuesto/], [/recargo|r e/]],
  ["discount", [/^(dto|descuento|% ?dto)/], []],
  ["blocked", [/^bloqueado/], []],
  ["obsolete", [/^obsoleto|^baja$/], []],
];

/** Filas del Excel → { products, stats }. La primera fila con cabecera de código y de descripción es la cabecera. */
export function parseProductos(rows) {
  const heads = (r) => r.map(norm);
  const find = (hs, pats, bad) => {
    for (const re of pats) {
      const i = hs.findIndex((h) => re.test(h) && !bad.some((b) => b.test(h)));
      if (i >= 0) return i;
    }
    return -1;
  };
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 30) && hi < 0; i++) {
    const hs = heads(rows[i]);
    const c = Object.fromEntries(FIELDS.map(([k, pats, bad]) => [k, find(hs, pats, bad)]));
    if (c.code >= 0 && c.name >= 0 && c.price >= 0) (hi = i), (col = c);
  }
  if (hi < 0) throw new Error("No encuentro la cabecera: el Excel de productos debe tener las columnas «Código», «Descripción» y «Precio».");
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : undefined);
  const products = [], seen = new Set();
  const stats = { filas: 0, importados: 0, sinPrecio: 0, duplicados: 0, inactivos: 0, descartadas: 0 };
  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => String(c).trim())) continue;
    stats.filas++;
    const id = String(get(r, "code") ?? "").trim(), name = String(get(r, "name") ?? "").trim();
    if (!id || !name) { stats.descartadas++; continue; }
    if (seen.has(id)) { stats.duplicados++; continue; }
    const price = parseNumber(get(r, "price"));
    if (price === null || price < 0) { stats.sinPrecio++; continue; }
    seen.add(id);
    const p = { id, name, price, active: !(yes(get(r, "blocked")) || yes(get(r, "obsolete"))) };
    const upb = parseNumber(get(r, "unitsPerBox")), vat = parseNumber(get(r, "vat")), dto = parseNumber(get(r, "discount"));
    if (upb !== null && Number.isInteger(upb) && upb >= 1) p.unitsPerBox = upb;
    if (vat !== null && vat >= 0 && vat <= 100) p.vat = vat;
    if (dto !== null && dto >= 0 && dto <= 100) p.discount = dto;
    products.push(p);
    stats.importados++;
    if (!p.active) stats.inactivos++;
  }
  return { products, stats };
}

export const parseProductosXlsx = (buf) => parseProductos(readXlsx(buf));
