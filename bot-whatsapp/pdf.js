// PDF del pedido del cliente, sin dependencias: texto en Helvetica (codificación WinAnsi), tabla de líneas, totales y varias páginas si hace falta.
import { totals } from "./pricing.js";

const W = 595, H = 842, M = 40; // A4 en puntos
const WIN = { "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "·": 0xb7, "…": 0x85 };
const bytes = (t) => Buffer.from([...String(t ?? "").replace(/[\r\n\t]+/g, " ")].map((c) => { const n = c.codePointAt(0); return WIN[c] ?? (n >= 32 && n <= 255 ? n : 63); }));
const esc = (b) => Buffer.from([...b].flatMap((x) => (x === 0x28 || x === 0x29 || x === 0x5c ? [0x5c, x] : [x])));
const ancho = (t, pt) => [...String(t)].reduce((s, c) => s + (/[0-9€]/.test(c) ? 556 : /[ .,:]/.test(c) ? 278 : c === "-" ? 333 : /[A-Z]/.test(c) ? 667 : 520), 0) * pt / 1000;
const fmt = (n) => Number(n ?? 0).toFixed(2).replace(".", ",") + " €";
const fecha = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const parte = (texto, max) => { const out = []; let l = ""; for (const w of String(texto ?? "").split(/\s+/).filter(Boolean)) { if (ancho(l + " " + w, 9) > max && l) { out.push(l); l = w; } else l = l ? l + " " + w : w; } if (l) out.push(l); return out.length ? out : [""]; };

/** Construye el PDF (Buffer). `datos`: { empresa, cliente, ref, fecha, entrega, direccion, nota, lineas:[{cant, nombre, precio, importe}], totales:{base, iva, re, total}, conRe } */
export function pdfPedido(d) {
  const paginas = []; let cur = []; let y = H - M;
  const txt = (x, yy, t, { b = false, pt = 10, der = false, gris = false } = {}) => { const bt = esc(bytes(t)); const xx = der ? x - ancho(t, pt) : x; cur.push(Buffer.concat([Buffer.from(`BT /${b ? "F2" : "F1"} ${pt} Tf ${gris ? "0.4 0.4 0.4" : "0 0 0"} rg ${xx.toFixed(2)} ${yy.toFixed(2)} Td (`), bt, Buffer.from(") Tj ET\n")])); };
  const linea = (y1, y2 = y1) => cur.push(Buffer.from(`0.8 0.8 0.8 RG 0.5 w ${M} ${y1} m ${W - M} ${y2} l S\n`));
  const nueva = () => { if (cur.length) paginas.push(cur); cur = []; y = H - M; };
  const cabeceraTabla = () => { txt(M, y, "Cant.", { b: true, pt: 9 }); txt(M + 38, y, "Formato", { b: true, pt: 9 }); txt(M + 130, y, "Producto", { b: true, pt: 9 }); txt(W - M - 70, y, "Precio ud.", { b: true, pt: 9, der: true }); txt(W - M - 38, y, "Dto.", { b: true, pt: 9, der: true }); txt(W - M, y, "Importe", { b: true, pt: 9, der: true }); y -= 6; linea(y); y -= 14; };
  txt(M, y, d.empresa || "Distribuciones", { b: true, pt: 16 }); y -= 18;
  for (const l of d.datosEmpresa ?? []) { if (l) { txt(M, y, l, { pt: 9, gris: true }); y -= 12; } } // nombre fiscal, CIF, dirección y teléfono de la empresa (los de la configuración)
  y -= 6; txt(M, y, "Resumen de tu pedido", { pt: 12 }); y -= 24;
  const info = [["Pedido", d.ref], ["Fecha", fecha(d.fecha)], ["Cliente", d.cliente], ["Nº de cliente", d.codigoCliente], ["Teléfono", d.telefonoCliente], ["Entrega", fecha(d.entrega) || "Por confirmar"], ["Dirección", d.direccion]];
  for (const [k, v] of info) { if (!v) continue; txt(M, y, k, { b: true, pt: 10 }); for (const l of parte(v, W - 2 * M - 80)) { txt(M + 80, y, l, { pt: 10 }); y -= 14; } }
  y -= 8; linea(y); y -= 16; cabeceraTabla();
  for (const l of d.lineas) {
    const nombre = parte(l.nombre, 205), codigoFila = l.codigo ? nombre.length : -1, formato = parte(l.formato ?? "", 88); if (codigoFila >= 0) nombre.push("Cód. " + l.codigo); const alto = Math.max(nombre.length, formato.length, 1) * 12 + 4;
    if (y - alto < M + 30) { nueva(); cabeceraTabla(); }
    txt(M, y, String(l.cant), { pt: 9 }); formato.forEach((n, i) => txt(M + 38, y - i * 12, n, { pt: 9 })); nombre.forEach((n, i) => txt(M + 130, y - i * 12, n, { pt: i === codigoFila ? 8 : 9, gris: i === codigoFila }));
    txt(W - M - 70, y, fmt(l.precio), { pt: 9, der: true }); txt(W - M - 38, y, l.dto ? String(l.dto).replace(".", ",") + " %" : "—", { pt: 9, der: true }); txt(W - M, y, fmt(l.importe), { pt: 9, der: true });
    y -= alto;
  }
  if (y < M + 120) { nueva(); }
  y -= 4; linea(y); y -= 18;
  const fila = (k, v, b = false) => { txt(W - M - 130, y, k, { b, pt: b ? 11 : 10, der: true }); txt(W - M, y, v, { b, pt: b ? 11 : 10, der: true }); y -= b ? 18 : 15; };
  fila("Base imponible", fmt(d.totales.base)); fila("IVA", fmt(d.totales.iva)); if (d.conRe) fila("Recargo de equivalencia", fmt(d.totales.re)); fila("Total con IVA", fmt(d.totales.total), true);
  if (d.nota) { y -= 8; txt(M, y, "Observaciones", { b: true, pt: 10 }); y -= 14; for (const l of parte(d.nota, W - 2 * M)) { txt(M, y, l, { pt: 10 }); y -= 14; } }
  txt(M, M - 10, "Documento informativo del pedido. No es una factura.", { pt: 8, gris: true });
  paginas.push(cur);
  // objetos: 1 catálogo, 2 páginas, 3 y 4 fuentes; después, por cada página, su contenido y su página
  const objs = [null, null, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")];
  const kids = [];
  paginas.forEach((p, i) => {
    const cont = Buffer.concat(p); const idC = 5 + i * 2, idP = idC + 1;
    objs[idC - 1] = Buffer.concat([Buffer.from(`<< /Length ${cont.length} >>\nstream\n`), cont, Buffer.from("endstream")]);
    objs[idP - 1] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idC} 0 R >>`);
    kids.push(`${idP} 0 R`);
  });
  objs[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"); objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`);
  const partes = [Buffer.from("%PDF-1.4\n")]; const pos = [];
  let off = partes[0].length;
  objs.forEach((o, i) => { pos.push(off); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]); partes.push(b); off += b.length; });
  const xref = ["xref", `0 ${objs.length + 1}`, "0000000000 65535 f "].concat(pos.map((p) => String(p).padStart(10, "0") + " 00000 n ")).join("\n");
  partes.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`));
  return Buffer.concat(partes);
}

/** Una línea para la tabla: cantidad, formato (Caja de 12 · 24 uds), precio por unidad SIN descuento, % de descuento e importe (el que se factura). Sirve para pedidos guardados y para los del historial. */
export function lineaPdf(i) {
  const ud = Number(i.units ?? (i.unit === "caja" ? (i.boxes ?? i.qty) * (i.upb ?? 1) : i.qty)) || 0;
  const cajas = i.unit === "caja" ? Number(i.boxes ?? i.qty) : 0;
  const porCaja = cajas && ud ? Math.round(ud / cajas) : (i.upb ?? 0);
  return {
    cant: cajas ? `${cajas} ${cajas === 1 ? "caja" : "cajas"}` : `${ud} ${ud === 1 ? "ud" : "uds"}`,
    formato: cajas ? `Caja de ${porCaja || "?"} · ${ud} uds` : "Unidades",
    nombre: i.name ?? i.product_id, codigo: String(i.product_id ?? i.id ?? ""), precio: i.price, dto: Number(i.discount) > 0 ? Number(i.discount) : 0, importe: i.amount,
  };
}

/** Datos del PDF a partir de un pedido guardado (`getOrderByRef`). `empresa`, `cliente`; opcional: datosEmpresa (líneas con nombre fiscal, CIF, dirección y teléfono), codigoCliente, telefonoCliente. */
export function datosPdf(o, { empresa, cliente, datosEmpresa, codigoCliente, telefonoCliente }) {
  const items = (o.items ?? []).map((i) => ({ ...i, amount: i.amount ?? 0 }));
  const t = totals(items, !!o.re);
  return {
    empresa, cliente, datosEmpresa, codigoCliente, telefonoCliente, ref: o.ref, fecha: o.created_at, entrega: o.delivery_date, direccion: o.address, nota: o.note, conRe: !!o.re, totales: t,
    lineas: items.map(lineaPdf),
  };
}
