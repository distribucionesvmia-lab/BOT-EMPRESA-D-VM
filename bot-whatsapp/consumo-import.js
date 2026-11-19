// Importación del «consumo de clientes» (Excel que saca la oficina de a3ERP: «Consumo clientes … último servicio»):
// una fila por cliente y artículo con lo último que se le sirvió → unidades, PRECIO (de tarifa, antes de descuento), % de DESCUENTO,
// fecha y nº de documento. De ahí salen tres cosas: el descuento propio de cada cliente en cada artículo, su precio propio si no es el
// de la tarifa, y los artículos que ha comprado (historial). El COSTE que trae el Excel NO se lee ni se guarda nunca.
import { readXlsx } from "./xlsx-read.js";
import { parseNumber } from "./productos-import.js";
import { parseDate } from "./historial-import.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
const CAMPOS = [
  ["cliente", /^(cod )?cliente$/],
  ["articulo", /^(cod )?(articulo|producto)$/],
  ["qty", /^(cantidad|unidades|uds)/],
  ["price", /^precio( venta| unitario)?$/],
  ["pct", /^desc( \d+)?$|^descuento( \d+)?$/],
  ["date", /^fecha/],
  ["doc", /^(doc|documento|albaran|pedido|n )|^num/],
  ["nombre", /^nombre( cliente)?$|^razon social$|^cliente nombre$/], // para comprobar que el código es de ESE cliente
];
/** ¿Esta fila de cabecera es la de un Excel de consumo? (la usa también `detectarTipo`). */
export const esCabeceraConsumo = (fila) => {
  const h = fila.map(norm), tiene = (re) => h.some((c) => re.test(c));
  return CAMPOS.filter(([k]) => ["cliente", "articulo", "price", "pct", "date"].includes(k)).every(([, re]) => tiene(re));
};

/**
 * Filas → { items: Map(cliente → Map(artículo → { price, pct, qty, date, doc })), nombres: Map(cliente → nombre que trae el Excel), stats }.
 * Si un cliente repite un artículo, vale la fila de fecha más reciente. Las filas sin fecha o sin unidades no cuentan como compra.
 */
export function parseConsumo(rows) {
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 30) && hi < 0; i++) {
    const hs = rows[i].map(norm);
    const c = Object.fromEntries(CAMPOS.map(([k, re]) => [k, hs.findIndex((h) => re.test(h))]));
    if (c.cliente >= 0 && c.articulo >= 0 && c.qty >= 0 && c.price >= 0 && c.date >= 0) (hi = i), (col = c);
  }
  if (hi < 0) throw new Error("No encuentro la cabecera: el Excel de consumo debe tener «Cliente», «Artículo», «Unidades», «Precio», «Desc.», «Fecha» y «Nº Documento».");
  const items = new Map(), nombres = new Map();
  const stats = { filas: 0, descartadas: 0, sinFecha: 0, sinUnidades: 0, sinPrecio: 0 };
  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => String(c).trim())) continue;
    stats.filas++;
    const cid = String(r[col.cliente] ?? "").trim(), pid = String(r[col.articulo] ?? "").trim();
    if (!cid || !pid) { stats.descartadas++; continue; }
    const date = parseDate(r[col.date]), qty = parseNumber(r[col.qty]);
    if (!date) { stats.sinFecha++; continue; }
    if (qty === null || qty <= 0) { stats.sinUnidades++; continue; }
    const price = parseNumber(r[col.price]), pct = col.pct >= 0 ? parseNumber(r[col.pct]) ?? 0 : 0;
    const ok = price !== null && price > 0; // precio 0: regalo o dato incompleto → no se toca ni el precio ni el descuento, solo cuenta como compra
    if (!ok) stats.sinPrecio++;
    const doc = col.doc >= 0 ? String(r[col.doc] ?? "").trim() || date : date;
    if (!items.has(cid)) items.set(cid, new Map());
    const nom = col.nombre >= 0 ? String(r[col.nombre] ?? "").trim() : ""; if (nom && !nombres.has(cid)) nombres.set(cid, nom);
    const m = items.get(cid), antes = m.get(pid);
    if (!antes || date >= antes.date) m.set(pid, { price: ok ? Math.round(price * 10000) / 10000 : null, pct: ok ? Math.min(100, Math.max(0, Math.round(pct * 100) / 100)) : null, qty: Math.max(1, Math.round(qty)), date, doc });
  }
  return { items, nombres, stats: { ...stats, clientes: items.size } };
}

export const parseConsumoXlsx = (buf) => parseConsumo(readXlsx(buf));
