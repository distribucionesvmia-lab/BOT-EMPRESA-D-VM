// Artículos «quitados del catálogo» por la oficina: los clientes no los ven ni en la pantalla ni en el chat, pero NO se borran de la base
// (el panel los sigue viendo y se pueden volver a poner). Se guardan aparte (ajuste de la base de cuentas, compartida por las dos aplicaciones)
// para que una actualización desde el Excel de a3ERP no los vuelva a activar.
const CLAVE = "articulos_ocultos";

export function leerOcultos(accounts) {
  try { const l = JSON.parse(accounts.ajuste(CLAVE) ?? "[]"); return new Set(Array.isArray(l) ? l.map(String) : []); } catch { return new Set(); }
}
export function textoOcultos(accounts) { return accounts.ajuste(CLAVE) ?? "[]"; } // sirve para saber si cambió
export function ponerOculto(accounts, id, oculto) {
  const s = leerOcultos(accounts), antes = s.size;
  if (oculto) s.add(String(id)); else s.delete(String(id));
  accounts.ajusteGuardar(CLAVE, JSON.stringify([...s].sort()));
  return s.size !== antes;
}
