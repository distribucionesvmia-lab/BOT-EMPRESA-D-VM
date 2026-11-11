// Recordatorios de reposición (F-17), versión SIN API de WhatsApp: la lista de «a quién le toca reponer» y el mensaje ya escrito.
// Es la empresa quien pulsa «Abrir WhatsApp» y envía a mano. Nada se manda solo.
// DÓNDE SE ENCHUFARÍA EL ENVÍO AUTOMÁTICO cuando exista la API de Meta: en admin.js, ruta POST /api/admin/recordatorios/enviar (hoy no existe);
// bastaría recorrer estas mismas filas y llamar a la función de envío del bot (bot-whatsapp send) con `texto` y `wa`.
import { daysBetween, weekday } from "./delivery.js";

export const MIN_PEDIDOS = 3; // para calcular el ciclo habitual hacen falta al menos 3 pedidos
export const DESDE = 0.75, HASTA = 1.0; // aparece cuando ha pasado entre el 75 % y el 100 % del ciclo

/** Mediana de días entre pedidos consecutivos (fechas AAAA-MM-DD ya ordenadas y sin repetir); null si hay menos de 3 pedidos. */
export function cicloHabitual(fechas) {
  const f = [...new Set(fechas)].sort();
  if (f.length < MIN_PEDIDOS) return null;
  const gaps = f.slice(1).map((d, i) => daysBetween(f[i], d)).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const m = gaps.length >> 1;
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
}

const digitos = (s) => String(s ?? "").replace(/\D/g, "");
/** Teléfono para wa.me (con prefijo de país); null si no hay uno usable. */
export const telefonoWa = (s) => { const d = digitos(s).replace(/^00/, ""); return d.length === 9 ? "34" + d : d.length >= 11 && d.length <= 15 ? d : null; };

export const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * Filas de «Recordatorios de hoy».
 * clientes: [{ id, name, phone, fechas: [AAAA-MM-DD…] }] · fijos: Map(idCliente → { days:[1..5], paused }) · avisadosHoy / nunca: Set de ids
 */
export function recordatoriosDeHoy({ hoy, clientes, fijos = new Map(), avisadosHoy = new Set(), nunca = new Set(), enlace = "" }) {
  const dow = weekday(hoy), filas = [];
  for (const c of clientes) {
    const id = String(c.id), wa = telefonoWa(c.phone);
    if (!wa || nunca.has(id) || avisadosHoy.has(id)) continue; // solo clientes con teléfono en la ficha
    const fechas = [...new Set(c.fechas ?? [])].sort(), ultimo = fechas[fechas.length - 1] ?? null;
    if (ultimo === hoy) continue; // hoy ya ha pedido
    const fijo = fijos.get(id), cicloD = cicloHabitual(fechas);
    let motivo = null;
    if (fijo && !fijo.paused && fijo.days.includes(dow)) motivo = "pedido fijo";
    else if (cicloD && ultimo) { const r = daysBetween(ultimo, hoy) / cicloD; if (r >= DESDE && r <= HASTA) motivo = "ciclo"; }
    if (!motivo) continue;
    const texto = `Hola ${c.name}, ¿te preparo tu pedido de siempre? Puedes revisarlo y enviarlo tú aquí: ${enlace || "(enlace de la aplicación)"}. Si no quieres recordatorios, dínoslo y los quitamos.`;
    filas.push({ id, nombre: c.name, telefono: String(c.phone), wa, ultimo, ciclo: cicloD, diasDesdeUltimo: ultimo ? daysBetween(ultimo, hoy) : null, motivo: motivo === "pedido fijo" ? `Hoy es su día de pedido fijo (${DIAS_ES[dow]})` : `Le toca reponer: han pasado ${daysBetween(ultimo, hoy)} días de un ciclo de ${cicloD}`, texto });
  }
  return filas.sort((a, b) => (a.motivo.startsWith("Hoy") ? 0 : 1) - (b.motivo.startsWith("Hoy") ? 0 : 1) || a.nombre.localeCompare(b.nombre, "es"));
}
