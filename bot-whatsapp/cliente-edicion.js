// Edición a mano de la ficha de un cliente (datos de contacto y de entrega). El nombre y el NIF NO se editan aquí (los manda a3ERP).
// Lo que se escribe a mano se guarda aparte y se vuelve a poner después de cada importación de a3ERP, para que el Excel no lo borre.
import { emailValido } from "./correo-cliente.js";

const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const telefono9 = (p) => String(p ?? "").replace(/\D/g, "").replace(/^(0034|34)(?=\d{9}$)/, "").slice(-9);

/** Valida lo que llega del panel. Devuelve { error } o { patch }. `telefonos` y `correos` son la lista COMPLETA que se quiere ver. */
export function validarEdicion(b) {
  if (!b || typeof b !== "object") return { error: "Solicitud no válida." };
  const patch = {};
  if ("razon" in b) { patch.legalName = texto(b.razon, 80); }
  if ("direccion" in b) { patch.address = texto(b.direccion, 160); }
  if ("poblacion" in b) { patch.city = texto(b.poblacion, 60); }
  if ("municipio" in b) { const m = texto(b.municipio, 5); if (m && !/^\d{5}$/.test(m)) return { error: "El código de municipio tiene 5 cifras (Medina del Campo es 47085)." }; patch.municipio = m; }
  if ("recargo" in b) patch.recargo = b.recargo === true;
  if ("ofertas" in b) patch.ofertas = b.ofertas === true; // permiso para recibir OFERTAS por correo (lo marca la empresa solo si el cliente se lo ha dado)
  if ("notas" in b) { patch.notes = String(b.notas ?? "").trim().slice(0, 500); }
  if ("telefonos" in b) {
    if (!Array.isArray(b.telefonos) || b.telefonos.length > 10) return { error: "Los teléfonos no son válidos (máximo 10)." };
    const out = [];
    for (const t of b.telefonos) { const n = telefono9(t); if (!/^\d{9}$/.test(n)) return { error: `«${texto(t, 20)}» no es un teléfono válido (9 cifras).` }; if (!out.includes(n)) out.push(n); }
    patch.phones = out;
  }
  if ("correos" in b) {
    if (!Array.isArray(b.correos) || b.correos.length > 10) return { error: "Los correos no son válidos (máximo 10)." };
    const out = [];
    for (const c of b.correos) { const e = texto(c, 120).toLowerCase(); if (!emailValido(e)) return { error: `«${texto(c, 40)}» no es un correo válido.` }; if (!out.includes(e)) out.push(e); }
    patch.emails = out;
  }
  if (!Object.keys(patch).length) return { error: "No hay nada que guardar." };
  return { patch };
}
