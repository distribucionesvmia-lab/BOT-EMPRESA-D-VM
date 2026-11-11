// Formato del Excel de pedidos para que una persona los pase a a3ERP (y los imprima para preparar el reparto). Sigue la hoja modelo de la empresa.
//
// UNA HOJA POR PEDIDO («5900 · 000004»), lista para imprimir en A4 vertical (ajustada al ancho, márgenes pequeños, área de impresión
// automática, páginas numeradas «1/3» abajo a la derecha). Cada hoja:
//   CARTEL    barra azul oscuro: «Cliente 5900» (A-C) y el nombre comercial (D-H); debajo del nombre, la población
//   CABECERA  Nº pedido · Fecha recep. · Hora (el código y el nombre del cliente ya están en el cartel)
//   LÍNEAS    Código artículo · ☐ (preparado) · Cajas · Descripción · Unidades · Precio · Dto. % · Importe
//             (filas de 17 pt, alternas en gris claro y blanco, bordes finos; cajas en negrita; unidades, precio, dto. e importe en gris;
//              si no hay cajas, las unidades van en negrita y negro). Sin figuras flotantes: la casilla ☐ es un carácter de la celda.
//   TOTALES   Total base imponible · Total IVA · Total R.E. · TOTAL PEDIDO (de la D a la H)
//   PIE       Entrega (rojo hoy, amarillo mañana, verde más de 24 h) · Observaciones del cliente (cuadro; texto en rojo si lo hay)
//             · Observaciones línea (al final de la página, solo si alguna línea las lleva: código + descripción + «*observación»)
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
const COLS = 8; // hoja de pedido: A código · B ☐ preparado · C cajas · D descripción · E unidades · F precio · G dto. · H importe
const LAST = colName(COLS - 1);
const PICK_HEAD = ["Código artículo", "", "Cajas", "Descripción", "Unidades", "Precio", "Dto. %", "Importe"];

// ── Estilos de la hoja de pedido (el diseño sale de la hoja modelo de la empresa) ──
const NAVY = "1F3864", AZUL = "D9E2F3", GRIS = "808080", FILA_GRIS = "F2F2F2", RAYA = "404040";
const S = {
  cartelL: estilo({ b: 1, sz: 22, color: "FFFFFF", fill: NAVY, h: "left", v: "center", indent: 1, shrink: 1, border: { side: "right", style: "thin", color: "FFFFFF" } }),
  cartelR: estilo({ b: 1, sz: 22, color: "FFFFFF", fill: NAVY, h: "left", v: "center", indent: 1, shrink: 1 }),
  ciudad: estilo({ b: 1, sz: 18, color: "FFFFFF", fill: NAVY, h: "left", v: "center", indent: 1 }),
  navy: estilo({ fill: NAVY }),
  head: estilo({ b: 1, fill: AZUL, h: "center", v: "center", wrap: 1 }),
  headVal: estilo({ h: "center", v: "center" }),
  totalLabel: estilo({ b: 1, h: "left", v: "center", indent: 1 }),
  totalGris: estilo({ color: GRIS, fmt: 4, h: "right", v: "center", indent: 1 }),
  totalFinal: estilo({ b: 1, fmt: 4, h: "right", v: "center", indent: 1 }),
  obsBox: estilo({ b: 1, color: "C00000", h: "left", v: "top", wrap: 1, indent: 1, border: { side: "all", style: "thin", color: "7F7F7F" } }),
  obsEmpty: estilo({ h: "left", v: "top", wrap: 1, indent: 1, border: { side: "all", style: "thin", color: "7F7F7F" } }),
  lineaObsCod: estilo({ h: "center", v: "center", border: { side: "all", style: "thin", color: RAYA } }),
  lineaObsTxt: estilo({ h: "left", v: "center", wrap: 1, indent: 1, border: { side: "all", style: "thin", color: RAYA } }),
};
// Estilo de una celda de línea: tipo + si la fila es la gris (alterna con la blanca). Bordes finos oscuros: separan líneas y columnas.
const linea = (extra, gris) => estilo({ h: "center", v: "center", ...(gris ? { fill: FILA_GRIS } : {}), border: { side: "all", style: "thin", color: RAYA }, ...extra });
const LS = (gris) => ({
  box: linea({ sz: 40, name: "Segoe UI Symbol" }, gris), // casilla casi tan grande como la celda
  cajas: linea({ b: 1, sz: 22 }, gris),
  texto: linea({}, gris),
  descripcion: linea({ h: "left", indent: 1 }, gris),
  negrita: linea({ b: 1 }, gris),
  grisNum: linea({ color: GRIS }, gris),
  unidadesNegras: linea({ b: 1, color: "000000" }, gris),
  precio: linea({ color: GRIS, fmt: "#,##0.000" }, gris),
  importe: linea({ color: GRIS, fmt: 4, h: "right", indent: 1 }, gris),
});
const LINE_STYLES = [LS(false), LS(true)];

const flatLine = (l) => [l.id, l.boxes ?? null, l.name, l.units ?? l.qty, { v: l.price ?? null, s: STYLE.price }, l.discount || null, { v: l.amount, s: STYLE.money }, l.vat_rate ?? null, l.note ?? null];

// Observaciones del cliente: primero el día de entrega que pidió, en MAYÚSCULAS y con color (rojo = hoy, amarillo = mañana,
// verde = más de 24 horas), y después su nota. Devuelve { text, style } (style null si no hay día de entrega).
const OBS_STYLE = { rojo: STYLE.obsRed, amarillo: STYLE.obsYellow, verde: STYLE.obsGreen };
function observations(o) {
  const d = deliveryInfo(o.delivery_date, o.created_at);
  return { text: [d?.texto, o.note].filter(Boolean).join(" · ") || null, style: d ? OBS_STYLE[d.color] : null };
}

const autoWidth = (vals, min, max) => Math.max(min, Math.min(max, Math.ceil(Math.max(0, ...vals.map((v) => String(v ?? "").length)) * 1.1) + 2));
const sheetName = (o) => `${o.customer_id ?? "s/c"} · ${String(o.ref ?? "").slice(-6)}`.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);

// Cuánto cabe en una página A4 vertical (en puntos de alto de fila) con estos anchos de columna: la hoja se ajusta al ancho de la página
const MARGEN = { l: 0.25, r: 0.25, t: 0.4, b: 0.6, h: 0.2, f: 0.25 };
export function capacidadPagina(widths) {
  const ancho = widths.reduce((t, w) => t + w * 7 + 5, 0) / 96; // pulgadas
  const escala = Math.min(1, (8.27 - MARGEN.l - MARGEN.r) / ancho);
  return ((11.69 - MARGEN.t - MARGEN.b) * 72) / escala;
}

/** La hoja de UN pedido: { name, widths, rows, merges, heights, print }. */
function orderSheet(o) {
  const lines = linesOf(o);
  const t = totals(lines.map((l) => ({ ...l, vat: l.vat_rate })), o.re);
  const rows = [], merges = [], heights = {};
  const nuevaFila = (celdas, alto = 15) => { // celdas: [{ v, s, from, to }] (to > from = combinada); alto en puntos
    const r = Array(COLS).fill(null);
    for (const c of celdas) {
      for (let k = c.from; k <= (c.to ?? c.from); k++) r[k] = { v: k === c.from ? c.v : null, s: c.s };
      if ((c.to ?? c.from) > c.from) merges.push(`${colName(c.from)}${rows.length + 1}:${colName(c.to)}${rows.length + 1}`);
    }
    heights[rows.length] = alto; rows.push(r);
  };
  const rellena = (desde, hasta, s) => { const x = []; for (let k = desde; k <= hasta; k++) x.push({ v: null, s, from: k }); return x; };

  // CARTEL (barra azul): «Cliente 5900» a la izquierda y el nombre comercial a la derecha; debajo del nombre, la población
  nuevaFila([{ v: `Cliente ${o.customer_id ?? "—"}`, s: S.cartelL, from: 0, to: 2 }, { v: o.name ?? "", s: S.cartelR, from: 3, to: 7 }], 38);
  if (o.city) nuevaFila([{ v: null, s: S.navy, from: 0, to: 2 }, { v: o.city, s: S.ciudad, from: 3, to: 7 }], 28);
  // CABECERA: Nº pedido · Fecha recep. · Hora (sin repetir código ni nombre de cliente)
  nuevaFila([{ v: "Nº pedido", s: S.head, from: 0, to: 2 }, { v: null, s: S.head, from: 3 }, { v: "Fecha recep.", s: S.head, from: 4 }, { v: "Hora", s: S.head, from: 5 }, { v: null, s: S.head, from: 6, to: 7 }], 30);
  nuevaFila([{ v: o.ref, s: S.headVal, from: 0, to: 2 }, { v: madridDate(o.created_at), s: S.headVal, from: 4 }, { v: madridTime(o.created_at), s: S.headVal, from: 5 }], 17);
  // LÍNEAS
  nuevaFila(PICK_HEAD.map((v, k) => ({ v: v || null, s: S.head, from: k })), 30);
  lines.forEach((l, k) => {
    const st = LINE_STYLES[k % 2], porCajas = l.boxes != null && l.boxes !== 0; // k par = blanca, k impar = gris claro
    nuevaFila([
      { v: l.id, s: st.texto, from: 0 }, { v: "☐", s: st.box, from: 1 }, { v: porCajas ? l.boxes : null, s: st.cajas, from: 2 }, { v: l.name, s: st.descripcion, from: 3 },
      { v: l.units ?? l.qty, s: porCajas ? st.grisNum : st.unidadesNegras, from: 4 }, { v: l.price ?? null, s: st.precio, from: 5 }, { v: l.discount || null, s: st.grisNum, from: 6 }, { v: l.amount, s: st.importe, from: 7 },
    ], 44); // filas más altas para que quepa la casilla grande
  });
  // TOTALES (justo debajo de las líneas, de la D a la H)
  const total = (text, value, fin) => nuevaFila([{ v: text, s: S.totalLabel, from: 3, to: 6 }, { v: value, s: fin ? S.totalFinal : S.totalGris, from: 7 }], 17);
  total("Total base imponible", t.base); total("Total IVA", t.iva); total("Total R.E.", t.re); total("TOTAL PEDIDO", t.total, true);
  // ENTREGA (con color) y OBSERVACIONES DEL CLIENTE (cuadro de texto: en rojo si hay observación)
  const d = deliveryInfo(o.delivery_date, o.created_at);
  nuevaFila([{ v: d?.texto ?? "ENTREGA: SIN DÍA ELEGIDO", s: d ? OBS_STYLE[d.color] : STYLE.bold, from: 3, to: 7 }], 20);
  nuevaFila([{ v: "Observaciones del cliente", s: STYLE.bold, from: 3, to: 7 }], 18);
  const nota = String(o.note ?? "").trim();
  nuevaFila([{ v: nota || null, s: nota ? S.obsBox : S.obsEmpty, from: 3, to: 7 }], 54);
  // OBSERVACIONES DE LÍNEA, al pie de la hoja (solo si alguna línea las lleva; si no, no se escribe nada)
  const conNota = lines.filter((l) => String(l.note ?? "").trim());
  const widths = [autoWidth(lines.map((l) => l.id), 12, 16), 9, 9, autoWidth(lines.map((l) => l.name), 26, 52), 11, 9, 7, 11];
  if (conNota.length) {
    const usado = Object.values(heights).reduce((s, h) => s + h, 0);
    const seccion = 17 + conNota.length * 34, cap = capacidadPagina(widths), margen = 40;
    let hueco = usado + seccion + margen <= cap ? cap - usado - seccion - margen : 0; // si el pedido cabe en una página, las observaciones de línea quedan abajo del todo; si no, van a continuación
    while (hueco >= 8) { const h = Math.min(hueco, 400); heights[rows.length] = h; rows.push(Array(COLS).fill(null)); hueco -= h; }
    nuevaFila([{ v: "Observaciones línea", s: S.head, from: 3 }], 17);
    for (const l of conNota) nuevaFila([{ v: l.id, s: S.lineaObsCod, from: 0 }, { v: `${l.name}\n*${String(l.note).trim()}`, s: S.lineaObsTxt, from: 3 }], 34);
  }
  return { name: sheetName(o), widths, rows, merges, heights, print: { area: `A1:${LAST}${rows.length}`, footerLeft: "", margins: MARGEN } };
}


const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const eur = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const eur3 = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const COLOR_ENTREGA = { rojo: "#ff0000;color:#fff", amarillo: "#ffff00;color:#000", verde: "#92d050;color:#000" };

/** Página lista para imprimir (A4 vertical, un pedido por página) con la misma disposición que la hoja de Excel. Se imprime sola al abrirse. */
export function imprimirHtml(orders, { autoprint = true } = {}) {
  const hojas = orders.map((o) => {
    const lines = linesOf(o);
    const t = totals(lines.map((l) => ({ ...l, vat: l.vat_rate })), o.re);
    const d = deliveryInfo(o.delivery_date, o.created_at);
    const filas = lines.map((l, k) => {
      const porCajas = l.boxes != null && l.boxes !== 0;
      return `<tr class="${k % 2 ? "g" : ""}"><td class="c">${esc(l.id)}</td><td class="chk">☐</td><td class="cajas">${porCajas ? esc(l.boxes) : ""}</td><td class="d">${esc(l.name)}</td>` +
        `<td class="n ${porCajas ? "gr" : "b"}">${esc(l.units ?? l.qty)}</td><td class="n gr">${eur3(l.price)}</td><td class="n gr">${l.discount ? esc(l.discount) : ""}</td><td class="n gr">${eur(l.amount)}</td></tr>`;
    }).join("");
    const conNota = lines.filter((l) => String(l.note ?? "").trim());
    const nota = String(o.note ?? "").trim();
    return `<section class="hoja">
<div class="cartel"><span>Cliente ${esc(o.customer_id ?? "—")}</span><b>${esc(o.name ?? "")}</b></div>${o.city ? `<div class="ciudad">${esc(o.city)}</div>` : ""}
<div class="cab"><span><small>Nº pedido</small>${esc(o.ref)}</span><span><small>Fecha recep.</small>${esc(madridDate(o.created_at))}</span><span><small>Hora</small>${esc(madridTime(o.created_at))}</span></div>
<table><thead><tr><th>Código artículo</th><th></th><th>Cajas</th><th>Descripción</th><th>Unidades</th><th>Precio</th><th>Dto. %</th><th>Importe</th></tr></thead><tbody>${filas}</tbody></table>
<table class="tot"><tr><td>Total base imponible</td><td class="n">${eur(t.base)}</td></tr><tr><td>Total IVA</td><td class="n">${eur(t.iva)}</td></tr><tr><td>Total R.E.</td><td class="n">${eur(t.re)}</td></tr><tr class="fin"><td>TOTAL PEDIDO</td><td class="n">${eur(t.total)}</td></tr></table>
<div class="entrega" style="background:${d ? COLOR_ENTREGA[d.color] : "transparent"}">${esc(d?.texto ?? "ENTREGA: SIN DÍA ELEGIDO")}</div>
<div class="obs"><b>Observaciones del cliente</b><div class="caja${nota ? " rojo" : ""}">${esc(nota)}</div></div>
${conNota.length ? `<div class="obsl"><b>Observaciones línea</b>${conNota.map((l) => `<p><span>${esc(l.id)}</span>${esc(l.name)}<br><i>*${esc(String(l.note).trim())}</i></p>`).join("")}</div>` : ""}
</section>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedidos</title><style>
@page { size: A4 portrait; margin: 10mm; }
* { box-sizing: border-box; } body { margin:0; font:12px/1.25 Calibri, Arial, sans-serif; color:#000; }
.hoja { page-break-after: always; break-after: page; } .hoja:last-child { page-break-after: auto; break-after: auto; }
.cartel { background:#1f3864; color:#fff; display:flex; gap:16px; align-items:center; padding:8px 12px; font-size:22px; } .cartel b { flex:1; }
.ciudad { background:#1f3864; color:#fff; padding:0 12px 6px 40%; font-size:15px; }
.cab { display:flex; gap:24px; padding:6px 4px; background:#dce6f4; } .cab small { display:block; font-weight:700; font-size:10px; } .cab span:first-child { flex:1; }
table { width:100%; border-collapse:collapse; } th { background:#dce6f4; padding:4px; border:1px solid #404040; font-size:11px; }
td { border:1px solid #404040; padding:0 4px; height:15mm; vertical-align:middle; } tr.g td { background:#f2f2f2; }
td.c { text-align:center; width:20mm; } td.chk { text-align:center; width:17mm; font-size:44px; line-height:1; padding:0; } td.cajas { text-align:center; width:15mm; font-weight:700; font-size:24px; }
td.d { padding-left:6px; } td.n { text-align:right; white-space:nowrap; width:20mm; } .gr { color:#808080; } .b { font-weight:700; color:#000; }
.tot { width:60%; margin-left:auto; } .tot td { border:0; height:6mm; font-weight:700; } .tot td.n { font-weight:400; color:#808080; } .tot tr.fin td.n { color:#000; font-weight:700; }
.entrega { margin:6px 0; padding:6px 10px; font-weight:700; border-radius:6px; }
.caja { border:1px solid #7f7f7f; min-height:20mm; padding:6px 8px; white-space:pre-wrap; } .caja.rojo { color:#c00000; font-weight:700; }
.obsl { margin-top:8px; font-size:11px; } .obsl p { margin:3px 0; padding:3px 6px; border:1px solid #404040; } .obsl span { display:inline-block; width:22mm; font-weight:700; } .obsl i { color:#c00000; }
</style></head><body>${hojas}${autoprint ? "<script>addEventListener('load',()=>setTimeout(()=>print(),300))</script>" : ""}</body></html>`;
}

export const FORMAT = {
  name: "pedidos-v4",
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
