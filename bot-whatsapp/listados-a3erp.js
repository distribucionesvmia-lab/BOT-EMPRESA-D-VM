// Los dos listados en PDF de a3ERP: «Listado de descuentos artículo/cliente» y «Listado de precios especiales» (ventas por cliente).
// Se leen por la posición de cada columna (no por el texto suelto). Solo interpretan: no tocan ninguna base de datos.
import { leerPdf } from "./pdf-texto.js";

const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const numero = (t) => { const s = String(t ?? "").trim().replace(/\./g, "").replace(",", "."); if (!/^-?\d+(\.\d+)?$/.test(s)) return null; return Number(s); };
/** «31/12/9999» → null (sin fecha de fin); «01/01/1900» → null (sin fecha de inicio); si no, «AAAA-MM-DD». */
function fecha(t, tipo) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t ?? "").trim()); if (!m) return undefined;
  const y = Number(m[3]); if (tipo === "fin" && y >= 9000) return null; if (tipo === "ini" && y <= 1900) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** ¿De qué listado es? («descuentos», «precios» o null). Mira solo la primera página. */
export function tipoDeListado(buf) {
  try {
    const p = leerPdf(buf)[0], txt = sinTildes(p.lineas.map((l) => l.map((t) => t.t).join(" ")).join("\n"));
    if (/listado de descuentos articulo\/cliente/.test(txt)) return "descuentos";
    if (/listado de precios especiales/.test(txt)) return "precios";
  } catch { /* no es un PDF de estos */ }
  return null;
}

/** Columnas por la cabecera: [{ nombre, x }]; cada trozo de una fila va a la última columna que empieza a su izquierda (con 8 pt de margen). */
function columnas(linea, nombres) {
  const cols = [];
  for (const [clave, patron] of Object.entries(nombres)) { const t = linea.find((x) => patron.test(sinTildes(x.t).trim())); if (!t) return null; cols.push({ clave, x: t.x }); }
  return cols.sort((a, b) => a.x - b.x);
}
const celdas = (linea, cols) => { const r = {}; for (const t of linea) { let c = null; for (const k of cols) if (t.x + 8 >= k.x) c = k; if (c) r[c.clave] = r[c.clave] ? `${r[c.clave]} ${t.t.trim()}` : t.t.trim(); } return r; };

function recorre(buf, cabecera, interpreta, tipo) {
  const paginas = leerPdf(buf), filas = [], sinInterpretar = [], titulo = { descuentos: /listado de descuentos/, precios: /listado de precios especiales/ }[tipo];
  if (!titulo.test(sinTildes(paginas[0].lineas.map((l) => l.map((t) => t.t).join(" ")).join("\n")))) throw new Error(`Este PDF no es el «${tipo === "descuentos" ? "Listado de descuentos artículo/cliente" : "Listado de precios especiales"}» de a3ERP.`);
  let lineasDatos = 0;
  for (const [n, p] of paginas.entries()) {
    let cols = null;
    for (const l of p.lineas) {
      if (!cols) { cols = columnas(l, cabecera); continue; } // hasta no ver la cabecera de la página no hay datos
      if (l.some((t) => /^p[aá]gina:/i.test(sinTildes(t.t).trim()))) continue;
      const c = celdas(l, cols);
      if (!Object.values(c).some(Boolean)) continue;
      lineasDatos++;
      const f = interpreta(c);
      if (f) filas.push({ ...f, pagina: n + 1 }); else sinInterpretar.push(`Página ${n + 1}: ${l.map((t) => t.t.trim()).join(" · ")}`);
    }
    if (!cols) sinInterpretar.push(`Página ${n + 1}: no encuentro la cabecera de columnas`);
  }
  return { filas, stats: { paginas: paginas.length, lineas: lineasDatos, sinInterpretar } };
}

/** «Listado de descuentos artículo/cliente» → filas { articulo, nombreArticulo, cliente, nombreCliente, unidades, hasta, pct } (pct null si la línea no trae porcentaje). */
export function parseListadoDescuentos(buf) {
  const cab = { art: /^nombre articulo$/, cli: /^nombre cliente$/, uds: /^unidades$/, fecha: /^fecha$/, pct: /^% dto\.?$/ };
  return recorre(buf, cab, (c) => {
    const a = /^([^,\s]+),(.*)$/.exec(c.art ?? ""), k = /^(\d+),(.*)$/.exec(c.cli ?? ""), hasta = fecha(c.fecha, "fin"), uds = numero(c.uds);
    if (!a || !k || hasta === undefined || uds === null) return null;
    const pct = c.pct === undefined || c.pct === "" ? null : numero(c.pct);
    if (c.pct && pct === null) return null;
    return { articulo: a[1], nombreArticulo: a[2].trim(), cliente: k[1], nombreCliente: k[2].trim(), unidades: uds, hasta, pct };
  }, "descuentos");
}

/** «Listado de precios especiales» → filas { articulo, nombreArticulo, cliente, nombreCliente, unidades, desde, hasta, precio }. */
export function parseListadoPrecios(buf) {
  const cab = { art: /^articulo$/, cli: /^nombre$/, uds: /^unidades$/, ini: /^fec\.?ini\.?$/, fin: /^fec\.?fin\.?$/, precio: /^precio$/ };
  return recorre(buf, cab, (c) => {
    const a = /^(\S+)\s+(.*)$/.exec(c.art ?? ""), k = /^(\d+)\s+(.*)$/.exec(c.cli ?? ""), desde = fecha(c.ini, "ini"), hasta = fecha(c.fin, "fin"), uds = numero(c.uds);
    const m = /^([\d.,]+)\s*(eur)?$/i.exec(c.precio ?? ""), precio = m ? numero(m[1]) : null;
    if (!a || !k || desde === undefined || hasta === undefined || uds === null || precio === null) return null;
    return { articulo: a[1], nombreArticulo: a[2].trim(), cliente: k[1], nombreCliente: k[2].trim(), unidades: uds, desde, hasta, precio };
  }, "precios");
}
