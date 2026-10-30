// Importación del historial de compras (Excel que prepara el servidor de la oficina a partir de la copia de a3ERP):
// una fila por línea de pedido/albarán de venta → cliente, fecha, documento, artículo y cantidad. Con él el bot sabe qué suele comprar
// cada cliente (pestaña «Histórico»). Se reconocen las columnas por su cabecera. Solo se guardan los últimos pedidos de cada cliente.
import { readXlsx } from "./xlsx-read.js";
import { parseNumber } from "./productos-import.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
export const MAX_ORDERS_PER_CUSTOMER = 30;

const FIELDS = [
  ["customer", /^(cod )?cliente$|^cod(igo)?( cliente)?$|^id cliente$/],
  ["date", /^fecha/],
  ["doc", /^(doc|documento|albaran|pedido|n )|^num/],
  ["product", /^(cod )?(articulo|producto)$|^cod(igo)? (articulo|producto)|^referencia$|^ref$/],
  ["qty", /^(cantidad|unidades|uds)/],
];

/** Fecha de una celda → «AAAA-MM-DD»: acepta «30/10/2026», «2026-10-30», «30-10-26» y el número de serie de Excel (46325). */
export function parseDate(v) {
  const t = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  const n = Number(t);
  if (Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10); // serie de Excel
  return null;
}

/** Filas → { byCustomer: Map(cliente → [{ doc, date, lines:[{ productId, qty }] }]), stats }. */
export function parseHistorial(rows) {
  let hi = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 30) && hi < 0; i++) {
    const hs = rows[i].map(norm);
    const c = Object.fromEntries(FIELDS.map(([k, re]) => [k, hs.findIndex((h) => re.test(h))]));
    if (c.customer >= 0 && c.date >= 0 && c.product >= 0 && c.qty >= 0) (hi = i), (col = c);
  }
  if (hi < 0) throw new Error("No encuentro la cabecera: el Excel del historial debe tener «Cód. cliente», «Fecha», «Documento», «Cód. artículo» y «Cantidad».");
  const orders = new Map(); // cliente → Map(fecha|doc → pedido)
  const stats = { filas: 0, lineas: 0, sinFecha: 0, cantidadNoValida: 0, descartadas: 0 };
  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => String(c).trim())) continue;
    stats.filas++;
    const cid = String(r[col.customer] ?? "").trim(), pid = String(r[col.product] ?? "").trim();
    const date = parseDate(r[col.date]);
    const qty = parseNumber(r[col.qty]);
    if (!cid || !pid) { stats.descartadas++; continue; }
    if (!date) { stats.sinFecha++; continue; }
    if (qty === null || qty <= 0) { stats.cantidadNoValida++; continue; } // abonos y líneas a cero no cuentan como compra
    const doc = col.doc >= 0 ? String(r[col.doc] ?? "").trim() || date : date;
    if (!orders.has(cid)) orders.set(cid, new Map());
    const k = `${date}|${doc}`, byDoc = orders.get(cid);
    if (!byDoc.has(k)) byDoc.set(k, { doc, date, lines: [] });
    byDoc.get(k).lines.push({ productId: pid, qty: Math.max(1, Math.round(qty)) });
    stats.lineas++;
  }
  const byCustomer = new Map();
  for (const [cid, byDoc] of orders) byCustomer.set(cid, [...byDoc.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_ORDERS_PER_CUSTOMER));
  return { byCustomer, stats: { ...stats, clientes: byCustomer.size } };
}

export const parseHistorialXlsx = (buf) => parseHistorial(readXlsx(buf));
