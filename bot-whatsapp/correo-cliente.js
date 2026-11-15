// Correo de confirmación de pedido AL CLIENTE («Hemos recibido tu pedido…»). Es informativo (no es una factura) y de ese mismo cliente:
// va a SU correo (el que puso al darse de alta o, si no, el que figura en a3ERP), nunca lleva códigos de cliente ni de artículo ni NIF,
// se puede quitar desde «Mi cuenta» y nunca bloquea ni hace fallar el pedido. Sin SMTP_HOST no hace nada.
import { sendMail } from "./mailer.js";
import { deliveryInfo, plazoModificacion, puedeEditarPedido } from "./delivery.js";
import { totals, round2 } from "./pricing.js";
import { madridDate, madridTime } from "./export-format.js";

const eur = (n) => n.toFixed(2).replace(".", ",") + " €";
export const emailValido = (s) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(String(s ?? "").trim());

/** A qué correo va: el de su cuenta si es válido; si no, el primero válido de su ficha de a3ERP. null si no hay. */
export function elegirDestino({ account, customer }) {
  return [account?.email, ...(customer?.emails ?? [])].map((e) => String(e ?? "").trim()).find(emailValido) ?? null;
}
/** «j***@gmail.com»: para enseñarle en Mi cuenta adónde llega sin ponerlo completo en pantalla. */
export const tapar = (e) => { const [u, d] = String(e).split("@"); return u ? `${u[0]}${"*".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : ""; };

/** Asunto y texto. `ctx`: { nombre (del cliente), negocio, telefono, modificado, ahora }. */
export function correoPedido(o, { nombre = "", negocio = "Distribuciones Valentín Martín", telefono = "", modificado = false, adjunto = false, ahora = new Date().toISOString() } = {}) {
  const items = (o.items ?? []).map((l) => ({ ...l, amount: l.amount ?? round2((l.units ?? l.qty) * (l.price ?? 0) * (1 - (l.discount ?? 0) / 100)), vat: l.vat_rate }));
  const t = items.length ? totals(items, o.re) : null;
  const entrega = deliveryInfo(o.delivery_date, o.created_at), pe = puedeEditarPedido(o, ahora);
  const lineas = items.map((l) => {
    const cant = l.unit === "caja" ? `${l.boxes ?? l.qty} ${(l.boxes ?? l.qty) === 1 ? "caja" : "cajas"} (${l.units} uds)` : `${l.units ?? l.qty} uds`;
    return `  • ${cant} · ${l.name}${l.note ? `\n      Observación: ${l.note}` : ""}`;
  });
  const text = [
    `Hola${nombre ? ", " + nombre : ""}:`, "",
    modificado ? `Hemos recibido los cambios de tu pedido ${o.ref}.` : `Hemos recibido tu pedido ${o.ref} el ${madridDate(o.created_at)} a las ${madridTime(o.created_at)}.`,
    ...(entrega ? [`Entrega: ${entrega.texto.replace(/^ENTREGA: /, "")}`] : []),
    ...(o.address ? [`Dirección de entrega: ${o.address}`] : []),
    "", "Artículos:", ...(lineas.length ? lineas : ["  (sin artículos)"]),
    ...(o.note ? ["", `Tus observaciones: ${o.note}`] : []),
    ...(t ? ["", `Total con IVA: ${eur(t.total)}`] : []),
    ...(adjunto ? ["", "Te adjuntamos el PDF de tu pedido."] : []),
    ...(pe.ok && pe.texto ? ["", `${pe.texto}. Puedes hacerlo desde «Mi cuenta» en la aplicación.`] : []),
    ...(o.review ? ["", "Revisaremos tu pedido antes de prepararlo y te llamaremos si hace falta."] : []),
    "", "Este correo es solo informativo: no es una factura.",
    telefono ? `Si algo no es correcto, llámanos al ${telefono}.` : "Si algo no es correcto, contacta con nosotros.",
    "Si no quieres recibir este correo, puedes quitarlo en la aplicación: «Mi cuenta» → «Correo».",
    "", negocio, "",
  ].join("\n");
  return { subject: modificado ? `Pedido modificado ${o.ref} · ${negocio}` : `Hemos recibido tu pedido ${o.ref} · ${negocio}`, text };
}

/**
 * accounts: base de cuentas · smtp/from: de mailer (sin MAIL_TO) · customers: directorio de clientes · send: sustituible en pruebas.
 * enviar(account, order, { modificado }) devuelve 'enviado' | 'sin-correo' | 'desactivado' | 'repetido' | 'error'.
 */
export function crearCorreoCliente({ accounts, smtp, from, customers, negocio, telefono = "", send = sendMail, log = console, now = () => new Date().toISOString() }) {
  /** email: correo que el cliente ha escrito en ESTE pedido (manda sobre el de su cuenta y vale aunque tenga quitado el interruptor: lo pide él). pdf: función o Buffer con el PDF del pedido para adjuntarlo. */
  async function enviar(account, order, { modificado = false, email = null, pdf = null } = {}) {
    try {
      if (!order?.ref || !account?.customerId) return "sin-correo";
      const escrito = emailValido(email) ? String(email).trim().toLowerCase() : null;
      if (!escrito && !accounts.correoPedidoActivo(account.customerId)) return "desactivado";
      const customer = customers?.getById?.(account.customerId), to = escrito ?? elegirDestino({ account, customer });
      const clave = `${order.ref}|${modificado ? (order.modified_at ?? now()) : "nuevo"}`;
      if (!accounts.correoPedidoReservar(clave, order.ref, now())) return "repetido"; // un solo correo por pedido (o por cada modificación)
      if (!to) { accounts.correoPedidoMarcar(clave, "sin-correo"); return "sin-correo"; }
      try {
        let adj = []; try { const buf = typeof pdf === "function" ? pdf() : pdf; if (buf?.length) adj = [{ filename: `pedido-${order.ref}.pdf`, contentType: "application/pdf", data: buf }]; } catch (e) { log.error?.(`PDF del pedido ${order.ref} para el correo: ${e.message}`); } // si el PDF falla, el correo sale igual, sin adjunto
        const m = correoPedido(order, { nombre: customer?.name ?? "", negocio, telefono, modificado, adjunto: adj.length > 0, ahora: now() });
        await send(smtp, { from, to, subject: m.subject, text: m.text, attachments: adj });
        accounts.correoPedidoMarcar(clave, "enviado"); return "enviado";
      } catch (e) { accounts.correoPedidoMarcar(clave, "error", String(e.message).slice(0, 200)); log.error?.(`Correo al cliente (${order.ref}): ${e.message}`); return "error"; }
    } catch (e) { log.error?.("Correo al cliente:", e.message); return "error"; }
  }
  return { enviar, notificar: (account, order, op) => void enviar(account, order, op).catch(() => {}) };
}

/** Configuración de envío (sin MAIL_TO: ese es el destino del aviso interno a la empresa). null si no hay SMTP_HOST. */
export function smtpDesdeEntorno(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT ?? 587), from = env.MAIL_FROM ?? env.SMTP_USER;
  if (!from) return null;
  return { smtp: { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ?? (port === 465 ? "tls" : "starttls"), user: env.SMTP_USER, pass: env.SMTP_PASS, rejectUnauthorized: env.SMTP_INSECURE !== "1" }, from };
}

/** Correo con el código de un solo uso para entrar. Solo lleva el código (nunca NIF, código de cliente ni enlaces: así no se puede imitar con un enlace falso). */
export function correoCodigoAcceso({ nombre = "", codigo, minutos = 10, negocio = "Distribuciones Valentín Martín", telefono = "" }) {
  const nom = String(nombre).trim().split(/\s+/).slice(0, 3).join(" ");
  return {
    subject: `Tu código para entrar · ${negocio}`,
    text: [
      nom ? `Hola, ${nom}:` : "Hola:", "",
      `Tu código para entrar en ${negocio} es:`, "", `    ${codigo}`, "",
      `Escríbelo en la pantalla de acceso. Vale ${minutos} minutos y solo se puede usar una vez.`, "",
      "Si no has pedido entrar tú, ignora este correo: sin este código nadie puede entrar en tu cuenta.",
      "No se lo des a nadie. Nosotros nunca te lo pediremos por teléfono ni por WhatsApp.",
      ...(telefono ? ["", `¿Dudas? Llámanos al ${telefono}.`] : []), "",
      negocio,
    ].join("\n"),
  };
}
