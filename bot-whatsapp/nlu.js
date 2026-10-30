// Comprensión de frases normales del cliente en el chat, sin IA generativa: reglas claras y comprobables.
//  · números en palabras («media docena», «treinta y cinco», «un par de»)
//  · día de entrega dicho con naturalidad («mañana», «el lunes», «el 5 de noviembre», «5/11», «dentro de 3 días», «cuanto antes»)
//  · «sí/vale/confirmo», «eso es todo», «quita las cervezas», «cambia el agua a 10»
// Funciones puras (el reloj se pasa como parámetro). Todo el texto llega ya sin tildes y en minúsculas (norm).
import { madridDay, addDays, daysBetween, longDate, weekday, isWorkday, deliveryOptions, deliveryAllowed, deliveryMin, deliveryCalendarFrom, CUTOFF_HOUR, MAX_AHEAD_DAYS } from "./delivery.js";

export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const UNIDADES = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const ESPECIALES = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100 };
export const NUMBER_WORDS = { ...UNIDADES, ...ESPECIALES };
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const numWord = "(?:\\d+|" + Object.keys(NUMBER_WORDS).join("|") + ")";
const toNum = (w) => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w]);

/** «media docena de huevos» → «6 huevos»; «treinta y cinco cervezas» → «35 cervezas»; «un par de aguas» → «2 aguas»; «12x cerveza» → «12 cerveza». */
export function numberWords(text) {
  let t = ` ${norm(text)} `;
  t = t.replace(/\bmedia docena( de)?\b/g, " 6 ").replace(/\bdocena y media( de)?\b/g, " 18 ");
  t = t.replace(new RegExp(`\\b(${numWord})\\s+docenas?( de)?\\b`, "g"), (_, n) => ` ${toNum(n) * 12} `).replace(/\bdocenas?( de)?\b/g, " 12 ");
  t = t.replace(/\b(?:un )?par(?:es)? de\b/g, " 2 ").replace(/\bun par\b/g, " 2 ");
  t = t.replace(new RegExp(`\\b(${Object.keys(DECENAS).join("|")}) y (${Object.keys(UNIDADES).filter((k) => !["un"].includes(k)).join("|")})\\b`, "g"), (_, d, u) => ` ${DECENAS[d] + UNIDADES[u]} `);
  t = t.replace(/(\d+)\s*x\b/g, "$1 ").replace(/\bx\s*(\d+)/g, "$1 "); // «12x cerveza», «cerveza x12»
  return t.replace(/\s+/g, " ").trim();
}

// ---- Palabras sueltas del tipo «sí», «eso es todo»… ----
const has = (t, list) => list.some((w) => t === w || t.startsWith(w + " "));
/** Afirmación corta: «sí», «vale», «ok, confirmo», «perfecto», «adelante»… (sin números, para no confundir con un pedido). */
export const isYes = (text) => { const t = norm(text).replace(/[.,!¡¿?]/g, ""); return t.length <= 28 && !/\d/.test(t) && has(t, ["si", "sii", "vale", "ok", "okay", "confirmo", "confirmar", "confirma", "correcto", "perfecto", "adelante", "de acuerdo", "enviar", "envialo", "mandalo", "dale", "claro", "todo bien", "esta bien", "genial"]); };
export const isNo = (text) => { const t = norm(text).replace(/[.,!¡¿?]/g, ""); return t === "no" || t === "nop" || (t.length <= 28 && !/\d/.test(t) && has(t, ["mejor no", "cancela", "cancelalo", "cancelar pedido", "olvidalo", "no quiero nada", "no gracias"])); };
/** «eso es todo», «nada más», «ya está», «finalizar», «listo»: el cliente ya no quiere añadir nada. */
export const isDone = (text) => { const t = norm(text).replace(/[.,!¡¿?]/g, ""); return t.length <= 32 && !/\d/.test(t) && (has(t, ["eso es todo", "eso seria todo", "nada mas", "ya esta", "ya esta todo", "ya", "finalizar", "finaliza", "terminar", "termina", "listo", "fin", "nada mas gracias", "seria todo", "es todo", "con eso", "cerrar pedido", "hacer el pedido", "mandar pedido", "enviar pedido", "confirmar pedido"]) || isYes(t) && /pedido|todo/.test(t)); };

// ---- Distancia de edición (para perdonar erratas: «cerbeza» → «cerveza») ----
export function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// ---- Día de entrega dicho con naturalidad ----
const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const pad = (n) => String(n).padStart(2, "0");
const validDate = (y, m, d) => { const iso = `${y}-${pad(m)}-${pad(d)}`; return m >= 1 && m <= 12 && d >= 1 && d <= 31 && addDays(iso, 0) === iso ? iso : null; };

/**
 * Busca un día en la frase. Devuelve null si no hay, o { date, phrase, rest } (rest = la frase sin ese trozo), o { ambiguous: true, rest }
 * si dice «la semana que viene» sin concretar. No valida si ese día se puede servir (eso lo hace explainDelivery).
 */
export function extractDelivery(rawText, nowIso = new Date().toISOString()) {
  const t = ` ${norm(rawText)} `;
  const today = madridDay(nowIso);
  const found = (date, m) => ({ date, phrase: m[0].trim(), rest: (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() });
  const art = "(?:(?:para|de|el|este|esta|hasta|a partir de)\\s+)*";
  let m;
  if ((m = new RegExp(`\\b${art}pasado manana\\b`).exec(t))) return found(addDays(today, 2), m);
  if ((m = new RegExp(`\\b${art}manana\\b`).exec(t))) return found(addDays(today, 1), m);
  if ((m = new RegExp(`\\b${art}hoy\\b`).exec(t))) return found(today, m);
  if ((m = /\b(?:lo antes posible|cuanto antes|urgente|lo mas pronto|cuando antes|para ya)\b/.exec(t))) return found(deliveryMin(nowIso), m);
  if ((m = /\b(?:para )?(?:dentro de|en) (\d{1,2}|dos|tres|cuatro|cinco|seis|siete) dias?\b/.exec(t))) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : UNIDADES[m[1]]; return found(addDays(today, n), m); }
  // «el 5 de noviembre», «5 de noviembre», «el viernes 20 de noviembre»
  if ((m = new RegExp(`\\b${art}(?:(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\\s+)?(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${Object.keys(MESES).join("|")})(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`).exec(t))) {
    const mes = MESES[m[3]], dia = Number(m[2]);
    let year = m[4] ? Number(m[4]) : Number(today.slice(0, 4));
    let date = validDate(year, mes, dia);
    if (date && !m[4] && date < today) date = validDate(year + 1, mes, dia); // sin año y ya pasó: el año que viene
    return date ? found(date, m) : { ambiguous: true, rest: t.trim() };
  }
  // «5/11», «05-11-2026»
  if ((m = /\b(?:para (?:el )?|el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(t))) {
    const dia = Number(m[1]), mes = Number(m[2]);
    let year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
    let date = validDate(year, mes, dia);
    if (date && !m[3] && date < today) date = validDate(year + 1, mes, dia);
    if (date) return found(date, m);
  }
  // «el lunes», «para el viernes», «el lunes que viene», «el próximo martes»
  if ((m = new RegExp(`\\b${art}(?:proximo\\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\\s+(?:que viene|proximo|de la semana que viene))?\\b`).exec(t))) {
    const target = DIAS[m[1]];
    let d = addDays(today, 1);
    while (weekday(d) !== target) d = addDays(d, 1); // el siguiente día con ese nombre (a partir de mañana)
    return found(d, m);
  }
  // «el día 5» (solo el día del mes)
  if ((m = new RegExp(`\\b${art}dia (\\d{1,2})\\b`).exec(t))) {
    const dia = Number(m[1]); let d = validDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), dia);
    if (!d || d < today) { const [y, mo] = addDays(today.slice(0, 7) + "-28", 8).split("-"); d = validDate(Number(y), Number(mo), dia); } // el mes siguiente
    if (d) return found(d, m);
  }
  if ((m = /\b(?:para )?(?:la )?(?:semana que viene|proxima semana|semana proxima)\b/.exec(t))) return { ambiguous: true, rest: (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
  return null;
}

/** Si ese día NO se puede servir, la explicación en lenguaje claro (con alternativas); null si vale. */
export function explainDelivery(date, nowIso = new Date().toISOString()) {
  if (deliveryAllowed(date, nowIso)) return null;
  const first = deliveryMin(nowIso), today = madridDay(nowIso);
  const firstText = `${longDate(first)}`;
  if (date < today) return `Ese día ya ha pasado. Lo más pronto que puedo apuntarte es el ${firstText}.`;
  if (date === today) return `Para recibirlo *hoy* hay que pedir antes de las ${CUTOFF_HOUR}:00. Lo más pronto es el ${firstText}.`;
  if (!isWorkday(date)) return `Los *sábados y domingos* no repartimos (${longDate(date)}). ¿Te viene bien el ${firstText} o el lunes siguiente?`;
  if (date < first) return `Ese día ya no llego. Lo más pronto es el ${firstText}.`;
  if (daysBetween(today, date) > MAX_AHEAD_DAYS) return `Solo puedo apuntar entregas de los próximos ${MAX_AHEAD_DAYS} días.`;
  return `Ese día no puedo apuntártelo. Lo más pronto es el ${firstText}.`;
}

/** Filas de la lista «¿Cuándo quieres recibirlo?» (ids d:AAAA-MM-DD y d:otro). */
export function deliveryRows(nowIso = new Date().toISOString()) {
  const rows = deliveryOptions(nowIso).map((o) => ({ id: `d:${o.date}`, title: o.kind === "dia" ? o.label : `${o.label} · ${o.detail}`.slice(0, 24), description: o.kind === "dia" ? "" : o.detail }));
  rows.push({ id: "d:otro", title: "📅 Otro día", description: "Escríbelo: «20 de noviembre», «el viernes 20»…" });
  return rows;
}

// ---- Quitar y cambiar cantidades con frases ----
/** «quita las cervezas», «borra el agua», «sin la coca cola»: { query } con las palabras del artículo, o null. */
export function parseRemove(text) {
  const m = /^(?:por favor\s+)?(?:quita|quitame|quitale|quitar|borra|borrame|borrar|elimina|eliminame|eliminar|saca|sacame|retira|no quiero|sin|ya no quiero|ya no)\s+(.+)$/.exec(norm(text));
  return m ? { query: m[1] } : null;
}
/** «cambia el agua a 10», «deja las cervezas en 3 cajas»: { query, qty, unit? } o null. */
export function parseChangeQty(text) {
  const t = numberWords(text);
  const m = new RegExp(`^(?:por favor\\s+)?(?:cambia|cambiame|cambiar|modifica|modificame|actualiza|deja|dejame|dejalo|dejalas|dejalos|pon|ponme|poner)\\s+(.+?)\\s+(?:a|en|por|con)\\s+(${numWord})\\s*(cajas?|uds?|unidades?)?$`).exec(t);
  return m ? { query: m[1], qty: toNum(m[2]), ...(m[3] ? { unit: m[3].startsWith("caja") ? "caja" : "ud" } : {}) } : null;
}
