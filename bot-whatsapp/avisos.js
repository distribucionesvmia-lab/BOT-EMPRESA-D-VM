// Avisos al móvil de los clientes (Web Push): las claves se crean una vez y se guardan en la base de cuentas, que comparten la aplicación
// del cliente (avisa de «Pedido recibido») y la de la empresa (avisos a los clientes). Un aviso nunca bloquea ni hace fallar lo que lo provoca.
import { generarClavesVapid, enviarPush } from "./webpush.js";

/** El servicio de push (Apple sobre todo) exige un contacto real: un correo «mailto:» o una dirección https pública (nada de localhost, IP ni dominios de ejemplo). */
export function contactoValido(c) {
  const t = String(c ?? "").trim();
  if (/^mailto:[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return !/@(localhost|example\.(com|org|net)|invalid)(\.|$)|\.(invalid|example|local|test|localhost)$/i.test(t);
  try {
    const u = new URL(t);
    return u.protocol === "https:" && /\.[a-z]{2,}$/i.test(u.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) && !/(^|\.)(localhost|local|invalid|example|test)$/i.test(u.hostname);
  } catch { return false; }
}
/** La dirección pública (https) desde la que entra el cliente, sacada de la petición (detrás de Tailscale/Cloudflare llega en las cabeceras). null si no sirve. */
export function origenPublico(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const o = `https://${host}`; return host && contactoValido(o) ? o : null;
}

export function crearAvisos({ accountsDb, contacto = null, log = console }) {
  // Contacto que ve el servicio de push (exigen una dirección web o un correo válido). La aplicación del cliente conoce su PUBLIC_URL y la deja
  // guardada en la base compartida: así la aplicación de la empresa, que no la tiene, manda los avisos con el mismo contacto.
  if (contactoValido(process.env.PUBLIC_URL)) { try { accountsDb.ajusteGuardar("contacto", process.env.PUBLIC_URL); } catch { /* sin guardar */ } }
  // Orden: VAPID_SUB (si el administrador lo pone) → el contacto guardado por la aplicación del cliente → PUBLIC_URL si es una dirección pública válida.
  // (La aplicación de la empresa tiene PUBLIC_URL=http://localhost:3001: no vale, y por eso usa el que guardó la del cliente.)
  const contactoDe = contacto ?? (() => [process.env.VAPID_SUB, accountsDb.ajuste("contacto"), process.env.PUBLIC_URL].find(contactoValido) || "mailto:avisos@invalid.example");
  const claves = () => JSON.parse(accountsDb.ajusteSiFalta("vapid", () => JSON.stringify(generarClavesVapid())));
  async function a(subs, mensaje) {
    const vapid = claves(); let enviados = 0, fallidos = 0, caducados = 0; const errores = new Set();
    for (let i = 0; i < subs.length; i += 10) { // de 10 en 10, para no saturar
      await Promise.all(subs.slice(i, i + 10).map(async (s) => {
        const r = await enviarPush(s, mensaje, { vapid, contacto: contactoDe() });
        if (r.ok) enviados++; else { fallidos++; errores.add([r.estado || "sin conexión", r.motivo].filter(Boolean).join(" ")); if (r.caducada) { caducados++; accountsDb.pushRemove(s.endpoint); } }
      }));
    }
    return { enviados, fallidos, caducados, errores: [...errores] };
  }
  return {
    publica: () => claves().publica,
    /** El contacto que se manda ahora al servicio de push (o null si no hay uno válido). */
    contacto: () => { const c = contactoDe(); return contactoValido(c) ? c : null; },
    /** Guarda como contacto la dirección pública por la que está entrando un cliente (si es válida y cambió). Devuelve true si la petición traía una válida. */
    recordarOrigen(req) { const o = origenPublico(req); if (!o) return false; if (accountsDb.ajuste("contacto") !== o && !contactoValido(process.env.VAPID_SUB)) { try { accountsDb.ajusteGuardar("contacto", o); } catch { /* sin guardar */ } } return true; },
    /** Avisa a todos los móviles de un cliente. Nunca lanza. */
    async aCliente(customerId, mensaje) { try { return await a(accountsDb.pushOf(customerId), mensaje); } catch (e) { log.error("Aviso push:", e.message); return { enviados: 0, fallidos: 0, caducados: 0, errores: [] }; } },
    /** Avisa a todos los clientes que tienen los avisos activados. */
    async aTodos(mensaje) { return a(accountsDb.pushOf(), mensaje); },
  };
}
