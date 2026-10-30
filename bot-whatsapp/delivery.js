// Día de entrega que elige el cliente al finalizar el pedido. Funciones puras (las usan el servidor, el Excel y la demo del navegador).
// Todas las fechas son del calendario de Madrid, en formato "AAAA-MM-DD".

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fecha de Madrid (AAAA-MM-DD) de un instante. */
export function madridDay(iso = new Date().toISOString()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// «Hoy» solo se ofrece a los clientes de estos municipios (código INE que viene en la ficha del cliente de a3ERP): Medina del Campo.
// Para todos los demás el primer día posible es mañana.
export const MUNICIPIOS_HOY = ["47085"];
export const puedeHoy = (customer) => MUNICIPIOS_HOY.includes(String(customer?.municipio ?? "").trim());
export const CUTOFF_HOUR = 10; // «hoy» solo se puede pedir antes de las 10:00 (hora de Madrid)
const madridHour = (iso) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
const toUtc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
export const addDays = (day, n) => new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
export const weekday = (day) => new Date(toUtc(day)).getUTCDay();
export const isWorkday = (day) => weekday(day) >= 1 && weekday(day) <= 5;

/** «jueves 30 de octubre» */
export const longDate = (day) => `${DIAS[weekday(day)]} ${+day.slice(8, 10)} de ${MESES[+day.slice(5, 7) - 1]}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Primer día posible: hoy solo si el cliente es de un municipio con entrega en el día (opts.hoy) y el pedido se hace antes de las 10:00; si no, mañana
const earliest = (nowIso, opts = {}) => (opts.hoy && madridHour(nowIso) < CUTOFF_HOUR ? madridDay(nowIso) : addDays(madridDay(nowIso), 1));

/**
 * Primer día que se puede elegir, tanto en los botones como en el calendario de «otro día» (así nunca se contradicen):
 * el primer día de servicio (lunes a viernes) a partir de hoy —si es antes de las 10:00— o de mañana.
 */
export function deliveryMin(nowIso = new Date().toISOString(), opts = {}) {
  let d = earliest(nowIso, opts);
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}

export const SERVICE_DAYS = 5; // días de servicio que se ofrecen siempre (lunes a viernes)

/**
 * Opciones que se muestran al cliente: siempre los próximos 5 días de servicio (sin sábados ni domingos). «Hoy» solo si el cliente es de un
 * municipio con entrega en el día (opts.hoy), es laborable y el pedido se hace antes de las 10:00; para los demás, lo más pronto es mañana.
 * Hoy y mañana se llaman así y el resto va con la fecha (día y mes) en lugar de «el lunes que viene».
 * → [{ date, kind: "hoy" | "manana" | "dia", label, detail }]
 */
export function deliveryOptions(nowIso = new Date().toISOString(), opts = {}) {
  const today = madridDay(nowIso), out = [], min = deliveryMin(nowIso, opts);
  for (let i = 0; out.length < SERVICE_DAYS; i++) {
    const date = addDays(today, i);
    if (date < min || !isWorkday(date)) continue;
    if (i === 0) out.push({ date, kind: "hoy", label: "Hoy", detail: longDate(date) });
    else if (i === 1) out.push({ date, kind: "manana", label: "Mañana", detail: longDate(date) });
    else out.push({ date, kind: "dia", label: cap(longDate(date)), detail: "" });
  }
  return out;
}

export const MAX_AHEAD_DAYS = 90; // el calendario deja elegir hasta 90 días por delante

/** Primer día que deja marcar el calendario de «otro día»: el primer día de servicio posterior al último botón (nunca contradice a las opciones). */
export function deliveryCalendarFrom(nowIso = new Date().toISOString(), opts = {}) {
  const o = deliveryOptions(nowIso, opts);
  let d = addDays(o[o.length - 1].date, 1);
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}

/**
 * ¿Es un día de entrega válido? Uno de los botones, o un día de servicio (lunes a viernes) desde el primero posterior al último botón
 * (calendario de «otro día») hasta dentro de 90 días. Nunca sábados ni domingos.
 */
export function deliveryAllowed(date, nowIso = new Date().toISOString(), opts = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return false;
  if (addDays(date, 0) !== date) return false; // fecha inexistente (31 de febrero…)
  if (deliveryOptions(nowIso, opts).some((o) => o.date === date)) return true;
  return isWorkday(date) && date >= deliveryCalendarFrom(nowIso, opts) && daysBetween(madridDay(nowIso), date) <= MAX_AHEAD_DAYS;
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
