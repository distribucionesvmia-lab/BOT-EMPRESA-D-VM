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
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); // el último separador es el decimal: «1.234,56» y «1,234.56»
  else if (coma >= 0) t = t.replace(",", "."); // solo coma: decimal español («1,89»)
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, ""); // varios puntos: miles («1.234.567»)
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Cada campo: expresiones que reconocen su cabecera (ya normalizada) y las que la descartan
const FIELDS = [
  ["code", [/^(cod|codigo|ref|referencia|articulo|id)( art\w*| prod\w*)?$/], [/barra|ean|proveedor/]],
  ["name", [/^(descrip|nombre|denomin)/, /^articulo$/], []],
  ["price", [/(pvp|venta)/, /^(precio|tarifa)/], [/compra|coste|costo/]],
  ["unitsPerBox", [/(ud|uds|unid\w*)\W*(por |\/ ?|x )?caja/, /^caja/, /^envase|^empaque/, /^(ud|uds|unid\w*) paquete/], []],
  ["vat", [/^(% ?)?iva|tipo iva|^impuesto/], [/recargo|r e/]],
  ["discount", [/^(dto|descuento|% ?dto)/], []],
  ["category", [/^(categoria|familia)$/], []],
  ["subcategory", [/^(subcategoria|subfamilia)$/], []],
  ["family", [/familia/], []], // código de familia de a3ERP («56.0»): sirve para asignar categoría a los artículos nuevos
  ["blocked", [/^bloqueado/], []],
  ["obsolete", [/^obsoleto|^baja$/], []],
];

/** Tipo de IVA: un porcentaje («21», «10 %») o un código de a3ERP: «ORD21», «RED10» → 21, 10 y «SRE» (superreducido) → 4 (confirmado por la gestoría). Otros códigos → null: su tipo hay que confirmarlo, no se supone. */
export function tipoIva(v) {
  if (/^sre$/i.test(String(v ?? "").trim())) return 4;
  const n = parseNumber(v);
  if (n !== null) return n;
  const m = /^[A-Za-z]+(\d{1,2})$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : null;
}

export const PRECIO_MAXIMO = 5000; // € por unidad: por encima, casi seguro es una celda mal leída

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
    // Hojas con la cabecera del nombre mal puesta (dos columnas «Cód. artículo» seguidas): la segunda es el nombre
    if (c.code >= 0 && c.name < 0 && hs.indexOf(hs[c.code], c.code + 1) > 0) c.name = hs.indexOf(hs[c.code], c.code + 1);
    if (c.code >= 0 && c.name >= 0 && c.price >= 0) (hi = i), (col = c);
  }
  if (hi < 0) throw new Error("No encuentro la cabecera: el Excel de productos debe tener las columnas «Código», «Descripción» y «Precio».");
  // Exportaciones de a3ERP con una columna de marca («+») delante del código: el código va en la columna siguiente (sin cabecera)
  const muestra = rows.slice(hi + 1, hi + 9).filter((r) => r.some((c) => String(c).trim()));
  if (col.code >= 0 && muestra.length && muestra.every((r) => /^[+\-*]?$/.test(String(r[col.code] ?? "").trim())) && !heads(rows[hi])[col.code + 1]) col.code++;
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : undefined);
  const products = [], rowOf = [], seen = new Set(); // rowOf: nº de fila de Excel de cada producto (para emparejar imágenes)
  const stats = { filas: 0, importados: 0, sinPrecio: 0, duplicados: 0, inactivos: 0, descartadas: 0, rechazados: [], avisos: [] };
  const cab = rows[hi];
  stats.columnas = Object.fromEntries(Object.keys(col).filter((k) => col[k] >= 0 && ["code", "name", "price", "unitsPerBox", "vat", "discount"].includes(k)).map((k) => [k, String(cab[col[k]] ?? "").trim() || "(sin título)"]));
  for (const [k, r] of rows.slice(hi + 1).entries()) {
    if (!r.some((c) => String(c).trim())) continue;
    stats.filas++;
    const id = String(get(r, "code") ?? "").trim(), name = String(get(r, "name") ?? "").trim();
    if (!id || !name) { stats.descartadas++; continue; }
    if (seen.has(id)) { stats.duplicados++; continue; }
    const price = parseNumber(get(r, "price"));
    if (price === null || price < 0) { stats.sinPrecio++; (stats.sinPrecioIds ??= []).push(id); continue; }
    if (price > PRECIO_MAXIMO) { stats.rechazados.push({ id, name, motivo: `precio fuera de lo normal (${price} €)` }); continue; }
    const ivaCelda = tipoIva(get(r, "vat"));
    if (ivaCelda !== null && ![4, 10, 21].includes(ivaCelda)) { stats.rechazados.push({ id, name, motivo: `IVA que no existe (${ivaCelda} %): solo hay 4, 10 y 21` }); continue; }
    seen.add(id);
    const p = { id, name, price: Math.round(price * 1e4) / 1e4, active: !(yes(get(r, "blocked")) || yes(get(r, "obsolete"))) };
    const fam = String(get(r, "family") ?? "").trim();
    if (fam) p.family = fam;
    const upb = parseNumber(get(r, "unitsPerBox")), vat = tipoIva(get(r, "vat")), dto = parseNumber(get(r, "discount"));
    if (upb !== null && Number.isInteger(upb) && upb >= 1 && upb <= 5000) p.unitsPerBox = upb;
    else if (upb !== null && upb !== 0 && upb !== 1) stats.avisos.push(`${id} ${name}: unidades por caja raras (${upb}), se ignoran`);
    if (vat !== null && vat >= 0 && vat <= 100) p.vat = vat;
    else if (String(get(r, "vat") ?? "").trim()) p.vatCode = String(get(r, "vat")).trim(); // código de IVA sin porcentaje conocido («SRE»)
    if (dto !== null && dto >= 0 && dto <= 100) p.discount = dto;
    else if (dto !== null) stats.avisos.push(`${id} ${name}: descuento imposible (${dto} %), se ignora`);
    const cat = String(get(r, "category") ?? "").trim(), sub = String(get(r, "subcategory") ?? "").trim();
    if (cat) p.category = cat;
    if (sub) p.subcategory = sub;
    products.push(p);
    rowOf.push(hi + 2 + k);
    stats.importados++;
    if (!p.active) stats.inactivos++;
  }
  return { products, stats, rowOf };
}

export const parseProductosXlsx = (buf) => parseProductos(readXlsx(buf));
