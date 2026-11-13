// Avisos al móvil de los clientes (Web Push): las claves se crean una vez y se guardan en la base de cuentas, que comparten la aplicación
// del cliente (avisa de «Pedido recibido») y la de la empresa (avisos a los clientes). Un aviso nunca bloquea ni hace fallar lo que lo provoca.
import { generarClavesVapid, enviarPush } from "./webpush.js";

export function crearAvisos({ accountsDb, contacto = null, log = console }) {
  // Contacto que ve el servicio de push (exigen una dirección web o un correo válido). La aplicación del cliente conoce su PUBLIC_URL y la deja
  // guardada en la base compartida: así la aplicación de la empresa, que no la tiene, manda los avisos con el mismo contacto.
  if (process.env.PUBLIC_URL) { try { accountsDb.ajusteGuardar("contacto", process.env.PUBLIC_URL); } catch { /* sin guardar */ } }
  const contactoDe = contacto ?? (() => process.env.VAPID_SUB || process.env.PUBLIC_URL || accountsDb.ajuste("contacto") || "mailto:avisos@invalid.example");
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
    /** Avisa a todos los móviles de un cliente. Nunca lanza. */
    async aCliente(customerId, mensaje) { try { return await a(accountsDb.pushOf(customerId), mensaje); } catch (e) { log.error("Aviso push:", e.message); return { enviados: 0, fallidos: 0, caducados: 0, errores: [] }; } },
    /** Avisa a todos los clientes que tienen los avisos activados. */
    async aTodos(mensaje) { return a(accountsDb.pushOf(), mensaje); },
  };
}
