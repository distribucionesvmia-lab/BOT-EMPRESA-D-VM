// Temporadas de la web (Navidad, Reyes, rebajas…): un banner de fiestas que la empresa activa desde el panel (o Claude por la conexión MCP).
// NO cambia el código ni el logo ni la cabecera roja: solo añade una franja de color con un mensaje bajo la cabecera de las pantallas del cliente.
// Se guarda en `ajustes.temporada` de la base de cuentas (la comparten la app de los clientes y el panel) y caduca sola en su fecha de fin.
export const TEMPORADAS = {
  normal:  { titulo: "Normal (sin adornos)", texto: "", fondo: "#FFFFFF", color: "#1D1D1F" },
  navidad: { titulo: "Navidad", texto: "🎄 Felices fiestas de parte de Distribuciones Valentín Martín", fondo: "#0B5D3B", color: "#FFFFFF" },
  reyes:   { titulo: "Reyes", texto: "👑 ¡Feliz día de Reyes!", fondo: "#7A4B00", color: "#FFFFFF" },
  rebajas: { titulo: "Rebajas / ofertas", texto: "🏷️ Ofertas especiales esta semana", fondo: "#1F3A8A", color: "#FFFFFF" },
  verano:  { titulo: "Verano", texto: "☀️ ¡Buen verano! Refrescos y cervezas al mejor precio", fondo: "#B45309", color: "#FFFFFF" },
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Valida lo que llega del panel o de Claude. Devuelve { id, hasta, mensaje } o lanza un error en español. */
export function validarTemporada(b, hoy) {
  const id = String(b?.id ?? "normal"); if (!TEMPORADAS[id]) throw new Error("Temporada desconocida. Las que hay: " + Object.keys(TEMPORADAS).join(", ") + ".");
  const hasta = b?.hasta ? String(b.hasta) : null; if (hasta && (!FECHA.test(hasta) || Number.isNaN(Date.parse(hasta)))) throw new Error("La fecha de fin no es válida (usa AAAA-MM-DD).");
  if (hasta && hoy && hasta < hoy) throw new Error("La fecha de fin ya ha pasado.");
  const mensaje = String(b?.mensaje ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  return { id, hasta, mensaje };
}
/** La temporada activa AHORA (la que caducó cuenta como «normal»). `hoy` = día de Madrid AAAA-MM-DD. */
export function temporadaActiva(raw, hoy) {
  let v; try { v = JSON.parse(raw || "null"); } catch { v = null; }
  if (!v || !TEMPORADAS[v.id] || v.id === "normal" || (v.hasta && hoy && v.hasta < hoy)) return { id: "normal", hasta: null, titulo: TEMPORADAS.normal.titulo, texto: "", fondo: TEMPORADAS.normal.fondo, color: TEMPORADAS.normal.color };
  const t = TEMPORADAS[v.id]; return { id: v.id, hasta: v.hasta ?? null, titulo: t.titulo, texto: v.mensaje || t.texto, fondo: t.fondo, color: t.color };
}
