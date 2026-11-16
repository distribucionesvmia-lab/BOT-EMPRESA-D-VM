// Pausa de emergencia: la oficina puede cerrar con un clic las ENTRADAS nuevas (nadie nuevo puede iniciar sesión; los que ya están dentro siguen) y/o los PEDIDOS nuevos.
// Se guarda en la tabla `ajustes` de la base de cuentas, que comparten la aplicación de los clientes y el panel de la empresa (son dos programas distintos).
export const TEXTO_PAUSA_ENTRADAS = "Ahora mismo la entrada está en pausa por seguridad. Inténtalo de nuevo en unos minutos o llámanos.";
export const TEXTO_PAUSA_PEDIDOS = "Ahora mismo no podemos recibir pedidos por la aplicación. Inténtalo de nuevo en unos minutos o llámanos.";

const SIN_PAUSA = { entradas: false, pedidos: false, desde: null, motivo: "" };
const cache = new WeakMap(); // por base de datos: se lee como mucho cada 3 segundos (cada petición la consulta)

/** Estado actual de la pausa. `fresco` salta la memoria (el panel quiere lo último). */
export function leerPausa(accounts, { fresco = false, ahora = Date.now() } = {}) {
  const c = cache.get(accounts);
  if (!fresco && c && ahora - c.t < 3000) return c.v;
  let v = SIN_PAUSA;
  try { const j = JSON.parse(accounts.ajuste("pausa") || "null"); if (j && typeof j === "object") v = { entradas: !!j.entradas, pedidos: !!j.pedidos, desde: j.desde ?? null, motivo: String(j.motivo ?? "").slice(0, 120) }; } catch { /* sin pausa */ }
  cache.set(accounts, { t: ahora, v });
  return v;
}
/** Guarda la pausa (`entradas` y `pedidos` son true/false; lo que no se dice se deja como estaba). Devuelve el estado nuevo. */
export function guardarPausa(accounts, cambios = {}, { now = new Date().toISOString() } = {}) {
  const act = leerPausa(accounts, { fresco: true }), nuevo = { entradas: cambios.entradas === undefined ? act.entradas : !!cambios.entradas, pedidos: cambios.pedidos === undefined ? act.pedidos : !!cambios.pedidos };
  const v = { ...nuevo, desde: nuevo.entradas || nuevo.pedidos ? (act.entradas || act.pedidos ? act.desde ?? now : now) : null, motivo: nuevo.entradas || nuevo.pedidos ? String(cambios.motivo ?? act.motivo ?? "").trim().slice(0, 120) : "" };
  accounts.ajusteGuardar("pausa", JSON.stringify(v)); cache.delete(accounts);
  return v;
}
