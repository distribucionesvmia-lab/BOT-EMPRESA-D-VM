// Formato del Excel de pedidos para que una persona los pase a a3ERP (y los imprima para preparar el reparto).
//
// UNA HOJA POR PEDIDO («5900 · 000004»), lista para imprimir en A4 vertical (ajustada al ancho, márgenes pequeños, área de impresión
// automática, páginas numeradas «1/3» abajo a la derecha). Cada hoja:
//   CARTEL    barra azul «Cliente 5900 · NOMBRE COMERCIAL» y, debajo, la población
//   CABECERA  Nº pedido · Fecha recepción · Hora pedido (el código y el nombre del cliente ya están en el cartel)
//   LÍNEAS    ☐ (preparado) · Código artículo · Cajas · Descripción · Unidades · Precio · Dto. % · Importe
//             (filas de 17 pt, alternas en gris claro y blanco, todo centrado; cajas en negrita; unidades, precio, dto. e importe en gris;
//              si no hay cajas, las unidades van en negrita y negro)
//   PIE FINAL Entrega (rojo hoy, amarillo mañana, verde más de 24 h) · Observaciones del cliente (cuadro, texto en rojo si hay) · Totales
//   PIE HOJA  (pie de página de la impresora) las observaciones de línea, si las hay: «Línea 3 · 26700 GAZPACHO: sin hielo»; si no, en blanco
// Última hoja «Líneas»: lo mismo en formato plano (una fila por línea), pensada para filtrar o para una importación futura.
//
// Precio, descuento, cajas/unidades e impuestos vienen ya calculados y guardados en cada línea (ver pricing.js).
// Si en el futuro a3ERP exige una plantilla de importación concreta, solo hay que cambiar este fichero.

import { STYLE, estilo, colName } from "./xlsx-files.js";
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

const HEAD = ["Nº pedido", "Código cliente", "Nombre comercial", "Fecha recepción", "Hora pedido"]; // (solo en la hoja plana «Líneas»)
const LINE_HEAD = ["Código artículo", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe", "IVA %", "Observaciones línea"]; // (hoja plana)
const COLS = 8; // hoja de pedido: A ☐ · B código · C cajas · D descripción · E unidades · F precio · G dto. · H importe
const LAST = colName(COLS - 1);
const PICK_HEAD = ["Prep.", "Código artículo", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe"];

// ── Estilos de la hoja de pedido ──
const GRIS = "808080", FILA_GRIS = "F2F2F2", RAYA = "D0D0D0";
const S = {
  banner: estilo({ b: 1, sz: 22, color: "FFFFFF", fill: "1F3864", h: "left", v: "center", indent: 1, shrink: 1 }),
  city: estilo({ b: 1, sz: 13, color: "1F3864", fill: "D9E2F3", h: "left", v: "center", indent: 1 }),
  head: estilo({ b: 1, fill: "B4C6E7", h: "center", v: "center", wrap: 1 }),
  headVal: estilo({ h: "center", v: "center" }),
  totalLabel: estilo({ b: 1, h: "right", v: "center" }),
  obsBox: estilo({ b: 1, color: "C00000", h: "left", v: "top", wrap: 1, border: { side: "all", style: "thin", color: "7F7F7F" } }),
  obsEmpty: estilo({ h: "left", v: "top", wrap: 1, border: { side: "all", style: "thin", color: "7F7F7F" } }),
};
// Estilo de una celda de línea: tipo + si la fila es la gris (alterna con la blanca). Separador fino entre líneas.
const linea = (extra, gris) => estilo({ h: "center", v: "center", ...(gris ? { fill: FILA_GRIS } : {}), border: { side: "bottom", style: "thin", color: RAYA }, ...extra });
const LS = (gris) => ({
  box: linea({ sz: 14, name: "Segoe UI Symbol" }, gris),
  texto: linea({}, gris),
  negrita: linea({ b: 1 }, gris),
  grisNum: linea({ color: GRIS }, gris),
  unidadesNegras: linea({ b: 1, color: "000000" }, gris),
  precio: linea({ color: GRIS, fmt: "#,##0.000" }, gris),
  importe: linea({ color: GRIS, fmt: 4 }, gris),
});
const LINE_STYLES = [LS(false), LS(true)];

// Cartel de cada pedido (hoja plana no lo usa)
const hdr = (cells) => cells.map((v) => ({ v, s: STYLE.header }));
const flatLine = (l) => [l.id, l.boxes ?? null, l.name, l.units ?? l.qty, { v: l.price ?? null, s: STYLE.price }, l.discount || null, { v: l.amount, s: STYLE.money }, l.vat_rate ?? null, l.note ?? null];

// Observaciones del cliente: primero el día de entrega que pidió, en MAYÚSCULAS y con color (rojo = hoy, amarillo = mañana,
// verde = más de 24 horas), y después su nota. Devuelve { text, style } (style null si no hay día de entrega).
const OBS_STYLE = { rojo: STYLE.obsRed, amarillo: STYLE.obsYellow, verde: STYLE.obsGreen };
function observations(o) {
  const d = deliveryInfo(o.delivery_date, o.created_at);
  return { text: [d?.texto, o.note].filter(Boolean).join(" · ") || null, style: d ? OBS_STYLE[d.color] : null };
}

const cutText = (t, n) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const autoWidth = (vals, min, max) => Math.max(min, Math.min(max, Math.ceil(Math.max(0, ...vals.map((v) => String(v ?? "").length)) * 1.1) + 2));
const sheetName = (o) => `${o.customer_id ?? "s/c"} · ${String(o.ref ?? "").slice(-6)}`.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);

/** Pie de página de la hoja: las observaciones de línea («Línea 3 · 26700 GAZPACHO: sin hielo»), una por renglón; vacío si no hay ninguna. */
export function pieDeHoja(lines) {
  const obs = lines.map((l, k) => (String(l.note ?? "").trim() ? `Línea ${k + 1} · ${l.id} ${cutText(l.name, 24)}: ${cutText(l.note, 80)}` : null)).filter(Boolean);
  let text = "", n = 0;
  for (const o of obs) { if ((text + o).length + 1 > 240) { text += (text ? "\n" : "") + "…(más observaciones en la hoja «Líneas»)"; n++; break; } text += (text ? "\n" : "") + o; n++; }
  return { text, renglones: n };
}

/** La hoja de UN pedido: { name, widths, rows, merges, heights, print }. */
function orderSheet(o) {
  const lines = linesOf(o);
  const t = totals(lines.map((l) => ({ ...l, vat: l.vat_rate })), o.re);
  const rows = [], merges = [], heights = {};
  const blank = () => Array(COLS).fill(null);
  const mergedRow = (value, style, height) => { // una fila con la celda combinada A:H
    const r = Array(COLS).fill({ v: null, s: style }); r[0] = { v: value, s: style };
    merges.push(`A${rows.length + 1}:${LAST}${rows.length + 1}`); if (height) heights[rows.length] = height; rows.push(r);
  };
  // CARTEL: «Cliente 5900 · NOMBRE COMERCIAL» y debajo la población
  mergedRow(`Cliente ${o.customer_id ?? "—"}${o.name ? " · " + o.name : ""}`, S.banner, 38);
  if (o.city) mergedRow(o.city, S.city, 20);
  // CABECERA: Nº pedido · Fecha · Hora (sin repetir código ni nombre de cliente)
  const spanned = (cells) => { // [{ v, s, from, to }]
    const r = Array(COLS).fill(null);
    for (const c of cells) { for (let k = c.from; k <= c.to; k++) r[k] = { v: k === c.from ? c.v : null, s: c.s }; if (c.to > c.from) merges.push(`${colName(c.from)}${rows.length + 1}:${colName(c.to)}${rows.length + 1}`); }
    rows.push(r);
  };
  spanned([{ v: "Nº pedido", s: S.head, from: 0, to: 2 }, { v: "Fecha recepción", s: S.head, from: 3, to: 3 }, { v: "Hora pedido", s: S.head, from: 4, to: 7 }]);
  spanned([{ v: o.ref, s: S.headVal, from: 0, to: 2 }, { v: madridDate(o.created_at), s: S.headVal, from: 3, to: 3 }, { v: madridTime(o.created_at), s: S.headVal, from: 4, to: 7 }]);
  // LÍNEAS
  heights[rows.length] = 30; rows.push(PICK_HEAD.map((v) => ({ v, s: S.head })));
  lines.forEach((l, k) => {
    const st = LINE_STYLES[k % 2], porCajas = l.boxes != null && l.boxes !== 0; // k par = blanca, k impar = gris claro
    heights[rows.length] = 17;
    rows.push([
      { v: "☐", s: st.box }, { v: l.id, s: st.texto }, { v: porCajas ? l.boxes : null, s: st.negrita }, { v: l.name, s: st.texto },
      { v: l.units ?? l.qty, s: porCajas ? st.grisNum : st.unidadesNegras }, { v: l.price ?? null, s: st.precio }, { v: l.discount || null, s: st.grisNum }, { v: l.amount, s: st.importe },
    ]);
  });
  rows.push(blank());
  // PIE FINAL: entrega · observaciones del cliente (cuadro) · totales
  const d = deliveryInfo(o.delivery_date, o.created_at);
  mergedRow(d?.texto ?? "ENTREGA: SIN DÍA ELEGIDO", d ? OBS_STYLE[d.color] : STYLE.bold, 20);
  mergedRow("Observaciones del cliente", STYLE.bold);
  const nota = String(o.note ?? "").trim();
  mergedRow(nota || null, nota ? S.obsBox : S.obsEmpty, 36);
  rows.push(blank());
  const total = (text, value, strong) => { const r = blank(); r[0] = { v: text, s: S.totalLabel }; for (let k = 1; k < COLS - 1; k++) r[k] = { v: null, s: S.totalLabel }; r[COLS - 1] = { v: value, s: strong ? STYLE.boldMoney : STYLE.money }; merges.push(`A${rows.length + 1}:${colName(COLS - 2)}${rows.length + 1}`); rows.push(r); };
  total("Total base imponible", t.base); total("Total IVA", t.iva); total("Total R.E.", t.re); total("TOTAL PEDIDO", t.total, true);
  // Anchos «ajustados al texto»: lo justo para el contenido (código y cajas, estrechos)
  const widths = [5, autoWidth(lines.map((l) => l.id), 9, 14), 7, autoWidth(lines.map((l) => l.name), 22, 52), 10, 9, 7, 10];
  const pie = pieDeHoja(lines);
  const bottom = pie.renglones ? Math.round((0.35 + pie.renglones * 0.16) * 100) / 100 : 0.6;
  return { name: sheetName(o), widths, rows, merges, heights, print: { area: `A1:${LAST}${rows.length}`, footerLeft: pie.text, margins: { b: bottom, f: 0.2 } } };
}

export const FORMAT = {
  name: "pedidos-v3",
  /** orders -> { sheets: [{ name, widths, rows }], lineCount } */
  build(orders) {
    const flat = [
      [...HEAD, ...LINE_HEAD, "Observaciones del pedido"].map((v) => ({ v, s: STYLE.bold })),
      ...orders.flatMap((o) =>
        linesOf(o).map((l) => { const ob = observations(o); return [o.ref, o.customer_id, o.name, madridDate(o.created_at), madridTime(o.created_at), ...flatLine(l), ob.style ? { v: ob.text, s: ob.style } : ob.text]; }),
      ),
    ];
    const usados = new Set();
    const hojas = orders.map((o) => { // nombre único (Excel no admite dos hojas con el mismo nombre)
      const h = orderSheet(o); let n = h.name, k = 2; while (usados.has(n.toLowerCase())) n = `${h.name.slice(0, 28)} ${k++}`; usados.add(n.toLowerCase()); return { ...h, name: n };
    });
    return {
      sheets: [
        ...hojas,
        { name: "Líneas", widths: [18, 14, 30, 16, 12, 16, 8, 46, 10, 11, 8, 12, 8, 40, 30], rows: flat, print: { area: `A1:O${flat.length}`, footerLeft: "" } },
      ],
      lineCount: flat.length - 1,
    };
  },
};
