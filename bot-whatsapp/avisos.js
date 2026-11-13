// Avisos al móvil de los clientes (Web Push): las claves se crean una vez y se guardan en la base de cuentas, que comparten la aplicación
// del cliente (avisa de «Pedido recibido») y la de la empresa (avisos a los clientes). Un aviso nunca bloquea ni hace fallar lo que lo provoca.
import { generarClavesVapid, enviarPush } from "./webpush.js";

export function crearAvisos({ accountsDb, contacto = () => process.env.VAPID_SUB || process.env.PUBLIC_URL || "mailto:avisos@invalid.example", log = console }) {
  const claves = () => JSON.parse(accountsDb.ajusteSiFalta("vapid", () => JSON.stringify(generarClavesVapid())));
  async function a(subs, mensaje) {
    const vapid = claves(); let enviados = 0, fallidos = 0, caducados = 0;
    for (let i = 0; i < subs.length; i += 10) { // de 10 en 10, para no saturar
      await Promise.all(subs.slice(i, i + 10).map(async (s) => {
        const r = await enviarPush(s, mensaje, { vapid, contacto: contacto() });
        if (r.ok) enviados++; else { fallidos++; if (r.caducada) { caducados++; accountsDb.pushRemove(s.endpoint); } }
      }));
    }
    return { enviados, fallidos, caducados };
  }
  return {
    publica: () => claves().publica,
    /** Avisa a todos los móviles de un cliente. Nunca lanza. */
    async aCliente(customerId, mensaje) { try { return await a(accountsDb.pushOf(customerId), mensaje); } catch (e) { log.error("Aviso push:", e.message); return { enviados: 0, fallidos: 0, caducados: 0 }; } },
    /** Avisa a todos los clientes que tienen los avisos activados. */
    async aTodos(mensaje) { return a(accountsDb.pushOf(), mensaje); },
  };
}
