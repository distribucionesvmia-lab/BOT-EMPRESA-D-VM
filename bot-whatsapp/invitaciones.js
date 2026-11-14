// Opciones de un enlace de acceso (lo crea la oficina): cuánto vale, cuántas veces, qué ve el cliente al entrar y el texto del WhatsApp.
// Todo lo que llega del panel se valida aquí; nada de esto envía mensajes (el envío lo hace siempre una persona).
import { madridDay, addDays } from "./delivery.js";

export const MAX_DIAS = 60, MAX_USOS = 20, MAX_MENSAJE = 300, MAX_PLANTILLA = 500;
export const PLANTILLA_ALTA = "Hola {nombre}, este es tu enlace para darte de alta como cliente de Distribuciones Valentín Martín: {enlace}\n(Sirve {usos} y hasta el {caduca}.)";
export const PLANTILLA_VER = "Hola {nombre}, este es tu enlace para ver el catálogo de Distribuciones Valentín Martín: {enlace}\n(Sirve {usos} y hasta el {caduca}.)";
export const PLANTILLA_DEFECTO = "Hola {nombre}, este es tu enlace para pedir a Distribuciones Valentín Martín: {enlace}\n(Sirve {usos} y hasta el {caduca}.)";

const partes = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));

/** «2026-11-20» + «10:00» (hora de Madrid) → instante ISO. */
export function madridAIso(dia, hhmm) {
  const [y, m, d] = dia.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  for (const off of [1, 2]) { const t = new Date(Date.UTC(y, m - 1, d, h - off, mi)), p = partes(t); if (+p.hour === h && +p.minute === mi && +p.day === d) return t.toISOString(); }
  return new Date(Date.UTC(y, m - 1, d, h - 1, mi)).toISOString();
}

/** Valida lo que manda el panel. Devuelve { error } o { expiresAt, usos, mensaje, soloVer, pedirCodigo }. */
export function opcionesInvitacion(b = {}, now = new Date().toISOString()) {
  b = b && typeof b === "object" ? b : {};
  const hoy = madridDay(now), hora = b.hora == null || b.hora === "" ? null : String(b.hora);
  if (hora !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { error: "La hora de caducidad no es válida (por ejemplo, 10:00)." };
  let dia, expiresAt;
  if (b.fecha != null && b.fecha !== "") {
    dia = String(b.fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia + "T00:00:00Z"))) return { error: "La fecha de caducidad no es válida." };
    if (dia < hoy) return { error: "La fecha de caducidad ya ha pasado." };
    if (dia > addDays(hoy, MAX_DIAS)) return { error: `El enlace no puede valer más de ${MAX_DIAS} días.` };
    expiresAt = madridAIso(dia, hora ?? "23:59");
  } else {
    const dias = b.dias == null || b.dias === "" ? 7 : Number(b.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS) return { error: `Los días de validez deben estar entre 1 y ${MAX_DIAS}.` };
    expiresAt = hora ? madridAIso(addDays(hoy, dias), hora) : new Date(new Date(now).getTime() + dias * 86_400_000).toISOString();
  }
  if (expiresAt <= now) return { error: "Esa hora de caducidad ya ha pasado." };
  const usos = b.usos == null || b.usos === "" ? 1 : Number(b.usos);
  if (!Number.isInteger(usos) || usos < 1 || usos > MAX_USOS) return { error: `Los usos deben estar entre 1 y ${MAX_USOS}.` };
  const mensaje = String(b.mensaje ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (mensaje.length > MAX_MENSAJE) return { error: `El mensaje de bienvenida admite hasta ${MAX_MENSAJE} letras.` };
  return { expiresAt, usos, mensaje, soloVer: b.modo === "ver", pedirCodigo: b.pedirCodigo !== false && b.pedirCodigo !== "no" };
}

export const fechaCorta = (iso) => { const p = partes(new Date(iso)); return `${p.day}/${p.month}/${p.year}`; };
export const horaCorta = (iso) => { const p = partes(new Date(iso)); return `${p.hour}:${p.minute}`; };

/** Valida la plantilla del WhatsApp: debe llevar {enlace}; solo se admiten {nombre}, {enlace}, {usos} y {caduca}. */
export function plantillaValida(t) {
  const s = String(t ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return { error: "Escribe el texto del mensaje." };
  if (s.length > MAX_PLANTILLA) return { error: `El texto admite hasta ${MAX_PLANTILLA} letras.` };
  if (!s.includes("{enlace}")) return { error: "El texto tiene que llevar {enlace}: ahí se pone el enlace." };
  const raras = [...s.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((x) => !["nombre", "enlace", "usos", "caduca"].includes(x));
  if (raras.length) return { error: `No conozco {${raras[0]}}. Solo valen {nombre}, {enlace}, {usos} y {caduca}.` };
  return { texto: s };
}

export function textoWhatsapp(plantilla, { nombre, url, usos, expiresAt }) {
  const caduca = fechaCorta(expiresAt) + (horaCorta(expiresAt) !== "23:59" ? ` a las ${horaCorta(expiresAt)}` : "");
  return String(plantilla || PLANTILLA_DEFECTO).replace(/\{nombre\}/g, nombre || "").replace(/\{usos\}/g, usos === 1 ? "una sola vez" : `hasta ${usos} veces`).replace(/\{caduca\}/g, caduca).replace(/\{enlace\}/g, url).replace(/ +,/g, ",").replace(/Hola ,/, "Hola,");
}
