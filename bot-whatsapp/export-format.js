// Formato del Excel de pedidos para que una persona los pase a a3ERP.
//
// Hoja «Pedidos»: un bloque por pedido, con tres partes:
//   CARTEL    «PEDIDO VM-…» grande, en una fila combinada de toda la anchura
//   CABECERA  Nº pedido · Código cliente · Nombre comercial · Fecha recepción · Hora pedido
//   LÍNEAS    Código artículo · Cajas · Descripción · Unidades · Precio · Dto. % · Importe · IVA % · Observaciones línea
//   PIE       Total base imponible · Total IVA · Total R.E. · TOTAL PEDIDO · Observaciones del cliente
//             (día de entrega pedido por el cliente en MAYÚSCULAS y con color: rojo hoy, amarillo mañana, verde más de 24 h)
// Hoja «Líneas»: lo mismo en formato plano (una fila por línea), pensada para filtrar o para una importación futura.
//
// Precio, descuento, cajas/unidades e impuestos vienen ya calculados y guardados en cada línea (ver pricing.js).
// Si en el futuro a3ERP exige una plantilla de importación concreta, solo hay que cambiar este fichero.

import { STYLE, colName } from "./xlsx-files.js";
import { round2, totals } from "./pricing.js";
import { deliveryInfo } from "./delivery.js";

export const madrid = (iso) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

// Fecha local de la empresa en formato a3ERP: "28/10/2026"
export function madridDate(iso) {
  const [y, m, d] = madrid(iso).split(" ")[0].split("-");
  return `${d}/${m}/${y}`;
}
export const madridTime = (iso) => madrid(iso).split(" ")[1];

// Importe de la línea; si el pedido es anterior al cálculo de precios, se calcula con lo que haya guardado
const amountOf = (l) => l.amount ?? round2((l.units ?? l.qty) * (l.price ?? 0) * (1 - (l.discount ?? 0) / 100));
const linesOf = (o) => o.items.map((l) => ({ ...l, amount: amountOf(l) }));

const HEAD = ["Nº pedido", "Código cliente", "Nombre comercial", "Fecha recepción", "Hora pedido"];
const LINE_HEAD = ["Código artículo", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe", "IVA %", "Observaciones línea"];
const WIDTHS = [18, 16, 46, 16, 12, 10, 12, 8, 40];
const COLS = LINE_HEAD.length;

const hdr = (cells) => cells.map((v) => ({ v, s: STYLE.header }));
const pad = (cells, style) => [...cells, ...Array(COLS - cells.length).fill({ v: null, s: style })];
const lineRow = (l) => [l.id, l.boxes ?? null, l.name, l.units ?? l.qty, { v: l.price ?? null, s: STYLE.price }, l.discount || null, { v: l.amount, s: STYLE.money }, l.vat_rate ?? null, l.note ?? null];

// Observaciones del cliente: primero el día de entrega que pidió, en MAYÚSCULAS y con color (rojo = hoy, amarillo = mañana,
// verde = más de 24 horas), y después su nota. Devuelve { text, style } (style null si no hay día de entrega).
const OBS_STYLE = { rojo: STYLE.obsRed, amarillo: STYLE.obsYellow, verde: STYLE.obsGreen };
function observations(o) {
  const d = deliveryInfo(o.delivery_date, o.created_at);
  return { text: [d?.texto, o.note].filter(Boolean).join(" · ") || null, style: d ? OBS_STYLE[d.color] : null };
}

/** { rows, obsIndex, colored }: las filas del pedido, la posición de la fila de observaciones y si lleva color (entrega elegida). */
function orderBlock(o) {
  const lines = linesOf(o);
  const t = totals(lines.map((l) => ({ ...l, vat: l.vat_rate })), o.re);
  const label = (text, value, strong = false) => {
    const row = Array(COLS).fill(null);
    row[2] = { v: text, s: STYLE.bold };
    row[6] = { v: value, s: strong ? STYLE.boldMoney : STYLE.money };
    return row;
  };
  const ob = observations(o);
  const obs = Array(COLS).fill(null);
  obs[0] = { v: "Observaciones del cliente", s: STYLE.bold };
  if (ob.style) for (let c = 2; c < COLS; c++) obs[c] = { v: c === 2 ? ob.text : null, s: ob.style }; // el color cubre toda la fila (columnas C a I)
  else obs[2] = ob.text;
  const rows = [
    pad([{ v: `PEDIDO ${o.ref}`, s: STYLE.banner }], STYLE.banner), // cartel grande y combinado en toda la anchura (ver build)
    hdr(HEAD),
    [o.ref, o.customer_id, o.name, madridDate(o.created_at), madridTime(o.created_at)],
    hdr(LINE_HEAD),
    ...lines.map(lineRow),
    label("Total base imponible", t.base),
    label("Total IVA", t.iva),
    label("Total R.E.", t.re),
    label("TOTAL PEDIDO", t.total, true),
    obs,
    [], // línea en blanco entre pedidos
  ];
  return { rows, obsIndex: rows.indexOf(obs), colored: !!ob.style };
}

export const FORMAT = {
  name: "pedidos-v2",
  /** orders -> { sheets: [{ name, widths, rows }], lineCount } */
  build(orders) {
    // Cada pedido empieza con un cartel grande («PEDIDO VM-2026-000001») combinado en toda la anchura y con la fila más alta,
    // para que no se confunda con una línea de pedido
    const blocks = [], merges = [], heights = {};
    for (const o of orders) {
      merges.push(`A${blocks.length + 1}:${colName(COLS - 1)}${blocks.length + 1}`);
      heights[blocks.length] = 38;
      const b = orderBlock(o);
      if (b.colored) merges.push(`C${blocks.length + b.obsIndex + 1}:${colName(COLS - 1)}${blocks.length + b.obsIndex + 1}`); // texto de entrega a lo ancho
      blocks.push(...b.rows);
    }
    const flat = [
      [...HEAD, ...LINE_HEAD, "Observaciones del pedido"].map((v) => ({ v, s: STYLE.bold })),
      ...orders.flatMap((o) =>
        linesOf(o).map((l) => { const ob = observations(o); return [o.ref, o.customer_id, o.name, madridDate(o.created_at), madridTime(o.created_at), ...lineRow(l), ob.style ? { v: ob.text, s: ob.style } : ob.text]; }),
      ),
    ];
    return {
      sheets: [
        { name: "Pedidos", widths: WIDTHS, rows: blocks, merges, heights },
        { name: "Líneas", widths: [18, 14, 30, 16, 12, 16, 8, 46, 10, 11, 8, 12, 8, 40, 30], rows: flat },
      ],
      lineCount: flat.length - 1,
    };
  },
};
