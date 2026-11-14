// Edita este archivo con los datos de tu negocio. No hace falta tocar nada más.
// "aliases": palabras con las que el cliente puede nombrar el producto (sin tildes, en minúsculas).

// ── AYUDA («¿Necesitas ayuda?») ── RELLENAR: teléfono, WhatsApp y horario de atención. También se pueden poner como variables
// AYUDA_TEL, AYUDA_WHATSAPP y AYUDA_HORARIO en C:\vm\config. Si un dato está vacío, ese botón no se muestra; si están todos vacíos, el botón de ayuda no aparece.
const ayudaEnv = (k) => String(globalThis.process?.env?.[k] ?? "").trim();
export const AYUDA = {
  telefono: ayudaEnv("AYUDA_TEL") || "", // p. ej. "983 000 000"
  whatsapp: ayudaEnv("AYUDA_WHATSAPP") || "", // p. ej. "600 000 000" (con o sin el 34 delante)
  horario: ayudaEnv("AYUDA_HORARIO") || "", // p. ej. "Lunes a viernes, de 8:00 a 14:00"
};
// ── CONDICIONES DEL PEDIDO que se enseñan al cliente antes de enviarlo. RELLENAR en C:\vm\config: PEDIDO_MINIMO (euros sin IVA; vacío = sin mínimo) y
// PORTES_TEXTO (p. ej. "Portes gratis desde 150 €"). Lo que esté vacío no se enseña: nunca se inventa una condición.
export const condicionesPedido = () => {
  const e = (k) => String(globalThis.process?.env?.[k] ?? "").trim();
  const min = Number(e("PEDIDO_MINIMO").replace(",", "."));
  return { pago: BUSINESS.payment, minimo: Number.isFinite(min) && min > 0 ? min : 0, portes: e("PORTES_TEXTO") };
};
/** Lo que se enseña al cliente: solo los datos rellenados; null si no hay ninguno. */
export const ayudaPublica = () => {
  const dig = (s) => String(s).replace(/\D/g, "");
  const tel = dig(AYUDA.telefono), wa = dig(AYUDA.whatsapp);
  const a = {
    ...(tel.length >= 9 ? { tel: AYUDA.telefono, telHref: "tel:+" + (tel.length === 9 ? "34" + tel : tel) } : {}),
    ...(wa.length >= 9 ? { whatsappHref: "https://wa.me/" + (wa.length === 9 ? "34" + wa : wa) } : {}),
    ...(AYUDA.horario ? { horario: AYUDA.horario } : {}),
  };
  return a.telHref || a.whatsappHref ? a : null; // sin teléfono ni WhatsApp no hay nada que ofrecer
};

export const BUSINESS = {
  name: "DistribucionesVM",
  currency: "€",
  info: "📍 Calle Ejemplo 123\n🕘 Lunes a viernes, 9:00–18:00\n🚚 Envíos a toda la ciudad en 24–48 h",
  priceNote: "Los importes van sin IVA. El IVA se suma al elegir el día de entrega, donde verás el total final. Los confirmamos al preparar el pedido.",
  payment:"Te enviaremos el enlace o los datos de pago cuando confirmemos tu pedido.",
};

export const PRODUCTS = [
  { id: 1, name: "Agua", price: 1.0, aliases: ["agua"] },
  { id: 2, name: "Cerveza Estrella Galicia", price: 0.8, aliases: ["cerveza", "estrella", "galicia"] },
  { id: 3, name: "Refresco de cola", price: 1.2, aliases: ["cola", "refresco", "coca"] },
  { id: 4, name: "Vino tinto Rioja", price: 6.5, aliases: ["vino", "rioja"] },
];
