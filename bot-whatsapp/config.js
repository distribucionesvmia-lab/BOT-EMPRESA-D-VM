// Edita este archivo con los datos de tu negocio. No hace falta tocar nada más.
// "aliases": palabras con las que el cliente puede nombrar el producto (sin tildes, en minúsculas).

export const BUSINESS = {
  name: "DistribucionesVM",
  currency: "€",
  info: "📍 Calle Ejemplo 123\n🕘 Lunes a viernes, 9:00–18:00\n🚚 Envíos a toda la ciudad en 24–48 h",
  priceNote: "Importes orientativos, sin IVA ni descuentos; los confirmamos al preparar el pedido.",
  payment:"Te enviaremos el enlace o los datos de pago cuando confirmemos tu pedido.",
};

export const PRODUCTS = [
  { id: 1, name: "Agua", price: 1.0, aliases: ["agua"] },
  { id: 2, name: "Cerveza Estrella Galicia", price: 0.8, aliases: ["cerveza", "estrella", "galicia"] },
  { id: 3, name: "Refresco de cola", price: 1.2, aliases: ["cola", "refresco", "coca"] },
  { id: 4, name: "Vino tinto Rioja", price: 6.5, aliases: ["vino", "rioja"] },
];
