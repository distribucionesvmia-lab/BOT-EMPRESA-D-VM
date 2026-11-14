// «Hoy es tu día»: aviso al móvil (Web Push) antes de la hora límite a los clientes con pedido fijo.
// Sale solo el día que le toca su pedido fijo, a la hora AVISO_CORTE_HORA (por defecto 8:30) y hasta las 10:00 (la misma hora de corte que
// «Puedes modificarlo hasta las 10:00»: LIMITE_EDICION_HORA). NUNCA envía ningún pedido: el aviso solo abre el pedido fijo para revisarlo.
import { madridDay, weekday, addDays, longDate, deliveryOptions, puedeHoy, LIMITE_EDICION_HORA } from "./delivery.js";

/** «8:30», «08:30» o «8.30» → minutos desde medianoche; si no vale, 8:30. */
export function horaAviso(texto) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(texto ?? "").trim());
  const h = m ? Number(m[1]) : 8, mi = m ? Number(m[2]) : 30;
  return h >= 0 && h < LIMITE_EDICION_HORA && mi >= 0 && mi < 60 ? h * 60 + mi : 8 * 60 + 30; // siempre antes de la hora límite
}
const minutosMadrid = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return Number(p.hour) * 60 + Number(p.minute); };
const lunesDe = (day) => addDays(day, -((weekday(day) + 6) % 7));

/** Cuándo se lo llevamos: «hoy», «mañana» o «el jueves 19 de noviembre». */
export const cuando = (reparto, hoy) => (reparto === hoy ? "hoy" : reparto === addDays(hoy, 1) ? "mañana" : "el " + longDate(reparto));

/**
 * Avisa a quien toque. `nowIso` se puede forzar (pruebas). `soloClientes`: lista de ids a los que limitar (pruebas: nunca a clientes reales).
 * Devuelve [{ cliente, enviado, motivo }] con lo que ha hecho con cada pedido fijo.
 */
export async function avisarCortes({ nowIso = new Date().toISOString(), hora = process.env.AVISO_CORTE_HORA, accounts, db, customers, avisos, soloClientes = null }) {
  const hoy = madridDay(nowIso), dow = weekday(hoy), min = minutosMadrid(nowIso), desde = horaAviso(hora), res = [];
  if (dow < 1 || dow > 5 || min < desde || min >= LIMITE_EDICION_HORA * 60) return res; // solo laborables, desde la hora del aviso y antes de la hora límite
  for (const [id, f] of accounts.allStanding()) {
    if (soloClientes && !soloClientes.includes(String(id))) continue;
    const no = (motivo) => res.push({ cliente: id, enviado: false, motivo });
    if (f.paused) { no("pausado"); continue; }
    if (f.skipWeek && f.skipWeek === lunesDe(hoy)) { no("semana saltada"); continue; }
    if (!f.days.includes(dow)) { no("hoy no toca"); continue; }
    if (!accounts.corteActivo(id)) { no("desactivado por el cliente"); continue; }
    if (!accounts.pushOf(id).length) { no("sin avisos activados"); continue; }
    if (accounts.corteAvisado(id, hoy)) { no("ya avisado hoy"); continue; }
    const cliente = customers.getById(id); if (!cliente) { no("cliente desconocido"); continue; }
    const reparto = deliveryOptions(nowIso, { hoy: puedeHoy(cliente) })[0]?.date; if (!reparto) { no("sin día de reparto"); continue; }
    if (db.recentOrders(id, 10).some((o) => o.status !== "cancelled" && (o.delivery_date === reparto || madridDay(o.created_at) === hoy))) { no("ya tiene pedido para ese reparto"); continue; }
    const r = await avisos.aCliente(id, { title: "Hoy es tu día", body: `Envía antes de las ${LIMITE_EDICION_HORA}:00 y te lo llevamos ${cuando(reparto, hoy)}.`, url: "/cliente#revisar-fijo", tag: "corte-" + hoy });
    if (r.enviados > 0) { accounts.corteMarcar(id, hoy); res.push({ cliente: id, enviado: true, reparto }); } else no("no se pudo entregar");
  }
  return res;
}
