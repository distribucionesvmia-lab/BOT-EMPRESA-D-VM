// Avisos programados: promociones y descuentos que la empresa deja preparados para una fecha y hora (una vez o cada semana).
// Se confirman al programarlos (con el texto exacto); un aviso nunca sale tarde si el programa estuvo parado; respetan el límite de 10 avisos por hora.
import { msDeSello } from "./copias.js";
import { madrid } from "./export-format.js";

export const GRACIA_MIN = 120;   // si el programa estaba parado y pasaron más de 2 h, ese aviso ya no tiene sentido («oferta de hoy»): no se manda
export const MAX_PENDIENTES = 50;
export const LIMITE_HORA = 10;
export const ABRE = { inicio: "/cliente", catalogo: "/catalogo" };

/** Fecha y hora de Madrid («2026-11-18», «09:00») → instante real en ISO. */
export const madridAIso = (dia, hora) => new Date(msDeSello(`${dia.replaceAll("-", "")}-${hora.replace(":", "")}`)).toISOString();
const sumaDias = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Valida lo que llega del panel. Devuelve { error } o { aviso }. */
export function validarProgramado(b, { ahora = new Date(), existeCliente = () => true } = {}) {
  if (!b || typeof b !== "object") return { error: "Solicitud no válida." };
  if (b.confirmo !== true) return { error: "Falta la confirmación para programar el aviso." };
  const titulo = String(b.titulo ?? "").trim(), texto = String(b.texto ?? "").trim();
  if (!titulo || titulo.length > 50 || !texto || texto.length > 180) return { error: "Escribe un título (máximo 50 letras) y un mensaje (máximo 180)." };
  if (b.destino !== "todos" && b.destino !== "cliente") return { error: "Elige a quién enviarlo." };
  const clienteId = b.destino === "cliente" ? String(b.clienteId ?? "") : null;
  if (b.destino === "cliente" && !existeCliente(clienteId)) return { error: "Elige un cliente de la lista." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dia ?? "")) || !/^\d{2}:\d{2}$/.test(String(b.hora ?? ""))) return { error: "Elige el día y la hora." };
  const [h, mi] = b.hora.split(":").map(Number); if (h > 23 || mi > 59 || Number.isNaN(Date.parse(b.dia))) return { error: "El día o la hora no son válidos." };
  const cuando = madridAIso(b.dia, b.hora), ms = Date.parse(cuando) - ahora.getTime();
  if (ms < 60_000) return { error: "El aviso tiene que ser para dentro de al menos un minuto." };
  if (ms > 400 * 86400_000) return { error: "No se puede programar con más de un año de antelación." };
  const repetir = b.repetir === "semana" ? "semana" : b.repetir === "no" || b.repetir == null || b.repetir === "" ? "no" : null;
  if (!repetir) return { error: "Repetición no válida." };
  const abre = Object.hasOwn(ABRE, b.abre ?? "inicio") ? (b.abre ?? "inicio") : null;
  if (!abre) return { error: "Elige qué se abre al tocar el aviso." };
  return { aviso: { titulo, texto, destino: b.destino, clienteId, dia: b.dia, hora: b.hora, cuando, repetir, abre } };
}

/**
 * Manda los avisos cuya hora ha llegado. Se llama cada minuto. Devuelve { enviados, perdidos, aplazados }.
 * avisos: { aCliente(id, mensaje), aTodos(mensaje) } · accounts: base de cuentas.
 */
export async function enviarProgramados({ accounts, avisos, customers, ahora = new Date(), log = console }) {
  const out = { enviados: 0, perdidos: 0, aplazados: 0 }, nowIso = ahora.toISOString();
  for (const r of accounts.avisoProgVencidos(nowIso)) {
    const tarde = ahora.getTime() - Date.parse(r.cuando) > GRACIA_MIN * 60_000;
    const siguiente = () => { if (r.repetir !== "semana") return; const dia = sumaDias(r.dia, 7); accounts.avisoProgAdd({ ...r, dia, cuando: madridAIso(dia, r.hora), creado: nowIso }); };
    if (tarde) { if (accounts.avisoProgMarcar(r.id, "perdido", "No salió: el programa estaba parado a esa hora y ya había pasado demasiado tiempo.")) { out.perdidos++; siguiente(); } continue; }
    if (accounts.pushLogCount(new Date(ahora.getTime() - 3600_000).toISOString()) >= LIMITE_HORA) { out.aplazados++; continue; } // se vuelve a intentar el minuto siguiente
    if (!accounts.avisoProgReservar(r.id)) continue; // otro ciclo lo está mandando
    try {
      let nombre = "todos", res;
      const mensaje = { title: r.titulo, body: r.texto, url: ABRE[r.abre] ?? "/cliente", tag: "programado-" + r.id };
      if (r.destino === "cliente") {
        const c = customers.getById(r.clienteId);
        if (!c) { accounts.avisoProgMarcar(r.id, "error", "El cliente ya no existe."); siguiente(); continue; }
        nombre = `${c.id} ${c.name}`; res = await avisos.aCliente(c.id, mensaje);
      } else res = await avisos.aTodos(mensaje);
      accounts.pushLogAdd({ titulo: r.titulo, texto: r.texto, destino: nombre, enviados: res.enviados, fallidos: res.fallidos, detalle: ["Programado", ...(res.errores ?? [])].join(" · ") });
      accounts.avisoProgMarcar(r.id, "enviado", `${res.enviados} móvil${res.enviados === 1 ? "" : "es"}${res.fallidos ? `, ${res.fallidos} fallido${res.fallidos === 1 ? "" : "s"}` : ""}`);
      out.enviados++; siguiente();
    } catch (e) { log.error?.("Aviso programado:", e.message); accounts.avisoProgMarcar(r.id, "error", e.message); siguiente(); }
  }
  return out;
}
export const textoCuando = (iso) => madrid(iso).replace(" ", " · ");
