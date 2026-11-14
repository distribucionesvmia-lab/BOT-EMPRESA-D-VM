// Exportar las estadísticas a Excel (.xlsx) o CSV. Solo LEE lo que ya calculó estadisticas.js: no toca pedidos ni datos.
// No tiene nada que ver con el Excel de pedidos para a3ERP (ese no se toca y no lleva ninguna marca).
import { buildWorkbook, STYLE } from "./xlsx.js";

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const negrita = (fila) => fila.map((v) => ({ v, s: STYLE.bold }));
const fechaEs = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const num = (n, dec = 2) => Math.round((Number(n) || 0) * 10 ** dec) / 10 ** dec;

/** Hojas (nombre, anchos, filas) a partir del resultado de calcular() más `atrasados`. `hechoEl`: texto de fecha y hora de la exportación. */
export function hojasEstadisticas(v, { hechoEl = "", contandoDesde = null } = {}) {
  const res = v.resumen?.actual ?? {}, ant = v.resumen?.anterior, vr = v.resumen?.variacion;
  const pct = (k) => (vr && vr[k] !== null && vr[k] !== undefined ? num(vr[k], 1) : "");
  const resumen = [
    [{ v: "Estadísticas de pedidos", s: STYLE.title }],
    ["Periodo", v.etiqueta ?? ""], ["Desde", fechaEs(v.desde)], ["Hasta (sin incluir)", fechaEs(v.hasta)],
    ["Recuento", contandoDesde ? `Contando desde el ${fechaEs(contandoDesde)}` : "Todos los pedidos"],
    ["Pedidos de prueba excluidos", v.excluidos ?? 0], ["Exportado", hechoEl], [],
    negrita(["Cifra", "Periodo", ant ? "Periodo anterior" : "", vr ? "Variación %" : ""]),
    ["Pedidos", res.pedidos ?? 0, ant?.pedidos ?? "", pct("pedidos")],
    ["Importe con IVA (€)", num(res.importe), ant ? num(ant.importe) : "", pct("importe")],
    ["Ticket medio (€)", num(res.ticket), ant ? num(ant.ticket) : "", pct("ticket")],
    ["Clientes distintos", res.clientes ?? 0, ant?.clientes ?? "", pct("clientes")],
    ["Artículos vendidos (uds)", res.articulos ?? 0, ant?.articulos ?? "", pct("articulos")],
  ];
  const arts = [negrita(["Posición", "Artículo", "Unidades", "Cajas", "Importe sin IVA (€)", "Pedidos en que sale"])];
  (v.ranking?.porUnidades ?? []).forEach((a, i) => arts.push([i + 1, a.nombre, a.unidades, a.cajas, num(a.importe), a.pedidos]));
  const cats = [negrita(["Categoría", "Subcategoría", "Unidades", "Importe sin IVA (€)"])];
  for (const c of v.categorias ?? []) { cats.push([{ v: c.nombre, s: STYLE.bold }, "Todas", c.unidades, num(c.importe)]); for (const s of c.subs ?? []) cats.push(["", s.nombre, s.unidades, num(s.importe)]); }
  const horas = [negrita(["Hora", "Pedidos"])];
  (v.horas ?? []).forEach((n, h) => horas.push([`${String(h).padStart(2, "0")}:00`, n]));
  const calor = [negrita(["Día", ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`), "Total"])];
  (v.calor ?? []).forEach((fila, d) => calor.push([DIAS[d], ...fila, fila.reduce((s, n) => s + n, 0)]));
  const atr = [negrita(["Cliente", "Último pedido", "Cada cuántos días suele pedir", "Días sin pedir", "Veces el ciclo"])];
  for (const a of v.atrasados ?? []) atr.push([a.nombre, fechaEs(a.ultimo), a.ciclo, a.dias, a.razon]);
  return [
    { name: "Resumen", widths: [30, 22, 20, 14], rows: resumen },
    { name: "Artículos", widths: [10, 52, 12, 10, 20, 18], rows: arts },
    { name: "Categorías", widths: [32, 36, 12, 20], rows: cats },
    { name: "Horas", widths: [10, 10], rows: horas },
    { name: "Mapa de calor", widths: [14, ...Array(25).fill(5)], rows: calor },
    { name: "Clientes que se retrasan", widths: [40, 16, 28, 16, 16], rows: atr },
  ];
}

export const xlsxDeEstadisticas = (v, op) => buildWorkbook(hojasEstadisticas(v, op));

const csvCelda = (c) => {
  let t = c && typeof c === "object" ? c.v : c; if (t === null || t === undefined) t = "";
  t = typeof t === "number" ? String(t).replace(".", ",") : String(t);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(,\d+)?$/.test(t)) t = "'" + t; // que Excel no lo tome por una fórmula
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
/** CSV para Excel en español: separador «;», decimales con coma y BOM UTF-8 (para que salgan bien las tildes). Las hojas van una tras otra. */
export function csvDeEstadisticas(v, op) {
  const bloques = hojasEstadisticas(v, op).map((h) => [csvCelda(h.name.toUpperCase()), ...h.rows.map((f) => f.map(csvCelda).join(";"))].join("\r\n"));
  return "﻿" + bloques.join("\r\n\r\n") + "\r\n";
}
