// Aviso por correo de cada pedido nuevo: asunto «PEDIDO REALIZADO - NOMBRE COMERCIAL DEL CLIENTE» y los datos del pedido.
// Nunca bloquea ni hace fallar el pedido: si el correo no sale (servidor caído, contraseña mal…), el pedido queda sin marcar como avisado
// y se reintenta cada pocos minutos durante una semana. Varios procesos pueden compartir la base: cada pedido se «reserva» antes de enviarlo.
import { sendMail } from "./mailer.js";
import { deliveryInfo } from "./delivery.js";
import { totals, round2 } from "./pricing.js";
import { madridDate, madridTime } from "./export-format.js";

const eur = (n) => n.toFixed(2).replace(".", ",") + " €";

/** Asunto y texto del correo de un pedido (tal como sale de la base de pedidos). */
export function orderMail(o) {
  const items = (o.items ?? []).map((l) => ({ ...l, amount: l.amount ?? round2((l.units ?? l.qty) * (l.price ?? 0) * (1 - (l.discount ?? 0) / 100)), vat: l.vat_rate }));
  const t = items.length ? totals(items, o.re) : null;
  const entrega = deliveryInfo(o.delivery_date, o.created_at);
  const lineas = items.map((l) => {
    const cant = l.unit === "caja" ? `${l.boxes ?? l.qty} ${(l.boxes ?? l.qty) === 1 ? "caja" : "cajas"} (${l.units} uds)` : `${l.units ?? l.qty} uds`;
    return `  • ${cant} · ${l.name}${l.note ? `\n      Observación: ${l.note}` : ""}`;
  });
  const nombre = String(o.name ?? "").trim() || "CLIENTE SIN NOMBRE";
  const text = [
    "PEDIDO REALIZADO",
    "",
    `Nombre comercial del cliente: ${nombre}`,
    `Código de cliente: ${o.customer_id ?? "(cliente nuevo, sin código)"}`,
    `Pedido: ${o.ref}`,
    `Fecha y hora: ${madridDate(o.created_at)} ${madridTime(o.created_at)}`,
    `Entrega: ${entrega ? entrega.texto.replace(/^ENTREGA: /, "") : "sin día indicado"}`,
    ...(o.address ? [`Dirección: ${o.address}`] : []),
    ...(t ? [`Total aproximado (con IVA): ${eur(t.total)}`] : []),
    ...(o.review ? [`⚠️ Pendiente de revisar: ${o.reason || "pedido dudoso"}`] : []),
    ...(o.note ? ["", `Observaciones del cliente: ${o.note}`] : []),
    "",
    "Artículos:",
    ...(lineas.length ? lineas : ["  (sin líneas reconocidas)"]),
    "",
  ].join("\n");
  return { subject: `PEDIDO REALIZADO - ${nombre.toUpperCase()}`, text };
}

/**
 * db: base de pedidos (con claimNotification, markNotified, pendingNotifications) · config: { smtp, from, to } (mailer.mailConfigFromEnv)
 * send: función de envío (se puede sustituir en pruebas).
 */
export function crearNotificador({ db, config, send = sendMail, log = console, now = () => new Date().toISOString(), retryMinutes = 5 }) {
  let timer = null, lastError = null, enviados = 0;
  async function enviar(order) {
    if (!db.claimNotification(order.id, now())) return false; // ya lo envía (o envió) otro proceso
    try {
      const { subject, text } = orderMail(order);
      await send(config.smtp, { from: config.from, to: config.to, subject, text });
      db.markNotified(order.id, now());
      lastError = null; enviados++;
      log.log(`Correo de aviso enviado: ${order.ref}`);
      return true;
    } catch (e) {
      lastError = { at: now(), message: e.message };
      log.error(`No se pudo enviar el correo del pedido ${order.ref} (se reintenta): ${e.message}`);
      return false;
    }
  }
  return {
    configurado: true,
    destino: config.to,
    enviar,
    /** Pedido nuevo: se envía enseguida, sin esperar y sin lanzar errores. */
    notificar: (order) => void enviar(order).catch(() => {}),
    async reintentar() {
      const desde = new Date(new Date(now()).getTime() - 7 * 86_400_000).toISOString();
      for (const o of db.pendingNotifications({ since: desde })) await enviar(o);
    },
    start() {
      if (timer) return;
      setTimeout(() => this.reintentar().catch(() => {}), 15_000).unref?.();
      timer = setInterval(() => this.reintentar().catch(() => {}), Math.max(1, retryMinutes) * 60_000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    /** Correo de prueba para comprobar la configuración. */
    async prueba() {
      await send(config.smtp, { from: config.from, to: config.to, subject: "PRUEBA - avisos de pedidos de Distribuciones VM", text: "Este es un correo de prueba. Si lo lees, los avisos de PEDIDO REALIZADO llegarán a esta dirección.\n" });
      lastError = null;
    },
    status: () => ({ configurado: true, destino: config.to, enviados, ultimoError: lastError }),
  };
}
