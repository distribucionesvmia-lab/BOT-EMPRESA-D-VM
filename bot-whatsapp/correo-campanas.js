// Correos a clientes desde el panel («Avisos a clientes» → Correos): a todos o a uno, ahora o programados (una vez o cada semana), con texto configurable.
//  · PROMOCIÓN / OFERTA: solo a quien ha aceptado recibir ofertas por correo (permiso del cliente en «Mi cuenta» o marcado por la empresa en su ficha). Empieza por «Publicidad»
//    y lleva en cada correo el enlace para darse de baja (también la cabecera List-Unsubscribe de un clic). Lo exige la ley (LSSI, art. 20 y 21).
//  · AVISO DE SERVICIO (cambios de reparto, festivos…): a todos los que tengan correo, sin publicidad.
// Nunca sale tarde (más de 2 h parado = no sale), respeta un límite diario (Gmail ronda los 500) y no repite al que ya lo recibió.
import { sendMail } from "./mailer.js";
import { elegirDestino, emailValido } from "./correo-cliente.js";
import { madridAIso } from "./avisos-programados.js";

export const GRACIA_MIN = 120;
export const MAX_PENDIENTES = 30;
export const limiteDia = () => Math.max(1, Number(process.env.CORREO_LIMITE_DIA) || 400);
export const TIPOS = { promo: "Promoción u oferta", servicio: "Aviso de servicio" };
const sumaDias = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Valida lo que llega del panel. Devuelve { error } o { campana }. «ahora: true» = enviar ya (sin día ni hora). */
export function validarCampana(b, { ahora = new Date(), existeCliente = () => true } = {}) {
  if (!b || typeof b !== "object") return { error: "Solicitud no válida." };
  if (b.confirmo !== true) return { error: "Falta la confirmación para enviar los correos." };
  const asunto = String(b.asunto ?? "").replace(/\s+/g, " ").trim(), texto = String(b.texto ?? "").replace(/\r\n/g, "\n").trim();
  if (!asunto || asunto.length > 90) return { error: "Escribe un asunto (máximo 90 letras)." };
  if (!texto || texto.length > 2000) return { error: "Escribe el mensaje (máximo 2000 letras)." };
  if (!Object.hasOwn(TIPOS, b.tipo)) return { error: "Elige si es una promoción o un aviso de servicio." };
  if (b.destino !== "todos" && b.destino !== "cliente") return { error: "Elige a quién enviarlo." };
  const clienteId = b.destino === "cliente" ? String(b.clienteId ?? "") : null;
  if (b.destino === "cliente" && !existeCliente(clienteId)) return { error: "Elige un cliente de la lista." };
  const base = { asunto, texto, tipo: b.tipo, destino: b.destino, clienteId };
  if (b.ahora === true) { const d = madridDia(ahora); return { campana: { ...base, dia: d.dia, hora: d.hora, cuando: ahora.toISOString(), repetir: "no", ahora: true } }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dia ?? "")) || !/^\d{2}:\d{2}$/.test(String(b.hora ?? ""))) return { error: "Elige el día y la hora." };
  const [h, mi] = b.hora.split(":").map(Number); if (h > 23 || mi > 59 || Number.isNaN(Date.parse(b.dia))) return { error: "El día o la hora no son válidos." };
  const cuando = madridAIso(b.dia, b.hora), ms = Date.parse(cuando) - ahora.getTime();
  if (ms < 60_000) return { error: "El correo tiene que ser para dentro de al menos un minuto." };
  if (ms > 400 * 86400_000) return { error: "No se puede programar con más de un año de antelación." };
  const repetir = b.repetir === "semana" ? "semana" : b.repetir === "no" || b.repetir == null || b.repetir === "" ? "no" : null;
  if (!repetir) return { error: "Repetición no válida." };
  return { campana: { ...base, dia: b.dia, hora: b.hora, cuando, repetir, ahora: false } };
}
const madridDia = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value])); return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }; };

/**
 * A quién le tocaría: { destinatarios: [{ id, nombre, email }], sinCorreo, sinPermiso, total }.
 * contactos: Map id → { id, name, emails } (customersDb.contactos) · cuentas: lista de cuentas (para su correo propio).
 */
export function audiencia({ accounts, contactos, cuentas = accounts.listAccounts(), campana }) {
  const porCliente = new Map(cuentas.map((a) => [String(a.customerId), a])), acepta = accounts.ofertasAceptan(), vistos = new Set(), out = { destinatarios: [], sinCorreo: 0, sinPermiso: 0, total: 0 };
  const ids = campana.destino === "cliente" ? [String(campana.clienteId)] : [...contactos.keys()];
  for (const id of ids) {
    const c = contactos.get(id); if (!c) continue; out.total++;
    const email = elegirDestino({ account: porCliente.get(id), customer: c });
    if (!email) { out.sinCorreo++; continue; }
    if (campana.tipo === "promo" && !acepta.has(id)) { out.sinPermiso++; continue; }
    const k = email.toLowerCase(); if (vistos.has(k)) continue; vistos.add(k);
    out.destinatarios.push({ id, nombre: c.name, email });
  }
  return out;
}

const personaliza = (t, nombre) => String(t).replaceAll("{nombre}", nombre || "cliente");
/** Asunto, texto y cabeceras de un correo concreto. base: dirección pública de la app del cliente (para el enlace de baja y del catálogo). */
export function mensajeCampana(c, { nombre, base = "", token = "", negocio = "Distribuciones Valentín Martín", telefono = "" }) {
  const promo = c.tipo === "promo", baja = base && token ? `${base}/baja/${token}` : "";
  const text = [
    ...(promo ? ["Publicidad", ""] : []),
    `Hola, ${nombre}:`, "", personaliza(c.texto, nombre), "",
    ...(base ? [`Haz tu pedido en: ${base}/catalogo`, ""] : []),
    negocio, ...(telefono ? [`Teléfono: ${telefono}`] : []), "",
    promo ? `Recibes este correo porque has aceptado recibir ofertas de ${negocio}. Si ya no quieres recibirlas, puedes darte de baja aquí, en un clic: ${baja}`
      : `Este es un aviso sobre el servicio de ${negocio}.`, "",
  ].join("\n");
  return { subject: personaliza(c.asunto, nombre), text, headers: promo && baja ? [`List-Unsubscribe: <${baja}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click", "Precedence: bulk"] : [] };
}

/**
 * Manda las campañas cuya hora ha llegado (se llama cada minuto y al pulsar «Enviar ahora»). Devuelve { enviadas, perdidas, aplazadas }.
 * base(): dirección pública de la app del cliente · smtp/from: de mailer.
 */
export async function enviarCampanas({ accounts, contactos, smtp, from, base = () => "", negocio, telefono = "", send = sendMail, ahora = new Date(), pausaMs = 250, log = console }) {
  const out = { enviadas: 0, perdidas: 0, aplazadas: 0 }, nowIso = ahora.toISOString();
  accounts.campanaCorreoColgadas(new Date(ahora.getTime() - 30 * 60_000).toISOString(), nowIso);
  for (const r of accounts.campanaCorreoVencidas(nowIso)) {
    const siguiente = () => { if (r.repetir !== "semana") return; const dia = sumaDias(r.dia, 7); accounts.campanaCorreoAdd({ ...r, dia, cuando: madridAIso(dia, r.hora), creado: nowIso }); };
    if (ahora.getTime() - Date.parse(r.cuando) > GRACIA_MIN * 60_000) { if (accounts.campanaCorreoMarcar(r.id, "perdido", "No salió: el programa estaba parado a esa hora y ya había pasado demasiado tiempo.")) { out.perdidas++; siguiente(); } continue; }
    if (!accounts.campanaCorreoReservar(r.id)) continue;
    try {
      const baseUrl = String(base() ?? "").replace(/\/$/, "");
      if (r.tipo === "promo" && !/^https?:\/\//.test(baseUrl)) { accounts.campanaCorreoMarcar(r.id, "error", "Falta la dirección pública de la aplicación del cliente (CLIENTE_URL): sin ella no se puede poner el enlace de baja que exige la ley."); siguiente(); continue; }
      const aud = audiencia({ accounts, contactos: contactos(), campana: r });
      const hoyYa = accounts.correosEnviadosDesde(new Date(ahora.getTime() - 86400_000).toISOString()), cupo = Math.max(0, limiteDia() - hoyYa);
      let ok = 0, mal = 0, porLimite = 0, porFallo = 0, saltados = 0; const motivos = new Set();
      for (const d of aud.destinatarios) {
        if (accounts.campanaCorreoYaEnviado(r.id, d.id)) { saltados++; continue; }
        if (ok >= cupo) { porLimite++; continue; }
        const m = mensajeCampana(r, { nombre: d.nombre, base: baseUrl, token: r.tipo === "promo" ? accounts.bajaToken(d.id) : "", negocio, telefono });
        try { await send(smtp, { from, to: d.email, subject: m.subject, text: m.text, headers: m.headers }); accounts.campanaCorreoEnvio(r.id, d.id, "enviado"); ok++; }
        catch (e) { accounts.campanaCorreoEnvio(r.id, d.id, "error", String(e.message).slice(0, 160)); mal++; motivos.add(String(e.message).replace(/\s+/g, " ").slice(0, 260)); log.error?.(`Correo de campaña ${r.id}: ${e.message}`); if (/rechaz|credencial|certificate|no se pudo conectar|tiempo agotado/i.test(e.message) && ok === 0 && mal >= 3) { porFallo += aud.destinatarios.length - ok - mal - saltados - porLimite; break; } } // si el servidor falla desde el principio, no se sigue
        if (pausaMs) await new Promise((x) => setTimeout(x, pausaMs));
      }
      const partes = [`${ok} enviado${ok === 1 ? "" : "s"}`, ...(mal ? [`${mal} con error`] : []), ...(porLimite ? [`${porLimite} sin enviar por el límite diario`] : []), ...(porFallo ? [`${porFallo} sin enviar porque el servidor de correo falla`] : []), ...(aud.sinCorreo ? [`${aud.sinCorreo} sin correo`] : []), ...(aud.sinPermiso ? [`${aud.sinPermiso} no han aceptado ofertas`] : [])];
      accounts.campanaCorreoMarcar(r.id, mal && !ok ? "error" : "enviado", partes.join(" · ") + (motivos.size ? ` — Motivo del error: ${[...motivos].slice(0, 2).join(" / ")}` : "")); out.enviadas++; siguiente();
    } catch (e) { log.error?.("Campaña de correo:", e.message); accounts.campanaCorreoMarcar(r.id, "error", e.message); siguiente(); }
  }
  return out;
}
export { emailValido };
