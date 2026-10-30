// Día de entrega que elige el cliente al finalizar el pedido. Funciones puras (las usan el servidor, el Excel y la demo del navegador).
// Todas las fechas son del calendario de Madrid, en formato "AAAA-MM-DD".

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fecha de Madrid (AAAA-MM-DD) de un instante. */
export function madridDay(iso = new Date().toISOString()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const toUtc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
export const addDays = (day, n) => new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
const weekday = (day) => new Date(toUtc(day)).getUTCDay();
const isWorkday = (day) => weekday(day) >= 1 && weekday(day) <= 5;

/** «jueves 30 de octubre» */
export const longDate = (day) => `${DIAS[weekday(day)]} ${+day.slice(8, 10)} de ${MESES[+day.slice(5, 7) - 1]}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * Opciones que se muestran al cliente: hoy y mañana (si son de lunes a viernes) y los demás días laborables hasta una semana vista,
 * con la fecha en lugar de «el lunes que viene».  → [{ date, kind: "hoy" | "manana" | "dia", label, detail }]
 */
export function deliveryOptions(nowIso = new Date().toISOString()) {
  const today = madridDay(nowIso), out = [];
  for (let i = 0; i <= 8; i++) {
    const date = addDays(today, i);
    if (!isWorkday(date)) continue;
    if (i === 0) out.push({ date, kind: "hoy", label: "Hoy", detail: longDate(date) });
    else if (i === 1) out.push({ date, kind: "manana", label: "Mañana", detail: longDate(date) });
    else out.push({ date, kind: "dia", label: cap(longDate(date)), detail: "" });
  }
  return out;
}

/**
 * Cómo aparece la entrega en el Excel (observaciones del cliente) según los días que faltan desde que se hizo el pedido:
 * el mismo día → rojo · el día siguiente → amarillo · más de 24 horas → verde. Texto en mayúsculas. null si el pedido no trae fecha.
 */
export function deliveryInfo(deliveryDate, orderAtIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate ?? ""))) return null;
  const diff = daysBetween(madridDay(orderAtIso), deliveryDate);
  const nivel = diff <= 0 ? "hoy" : diff === 1 ? "manana" : "dia";
  const fecha = longDate(deliveryDate);
  const texto = nivel === "hoy" ? `ENTREGA: HOY, ${fecha}` : nivel === "manana" ? `ENTREGA: MAÑANA, ${fecha}` : `ENTREGA: ${fecha}`;
  return { texto: texto.toLocaleUpperCase("es"), nivel, color: { hoy: "rojo", manana: "amarillo", dia: "verde" }[nivel], date: deliveryDate };
}
