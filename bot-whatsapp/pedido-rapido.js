// «Pedir en 10 segundos»: vista previa del pedido de siempre (líneas, total con IVA, día y dirección) para enviarlo con un toque tras confirmarlo.
// NO envía nada: el envío lo hace la pantalla por el camino de siempre (POST /catalogo, con todos sus límites y protecciones).
import { webOrderFromBody } from "./weborder.js";
import { priceOrder, totals } from "./pricing.js";

/** Día que se propone: el primero de reparto que no sea «hoy» (como el carrito: nunca «Hoy» marcado solo); si solo hay «hoy», ese. */
export const diaPropuesto = (opciones) => (opciones.find((o) => o.kind !== "hoy") ?? opciones[0])?.date ?? null;

/**
 * fuente: líneas guardadas [{id, qty, unit}] (pedido de siempre o último pedido). catalogo: lista del catálogo de ahora. opciones: días de reparto (deliveryOptions).
 * Devuelve { posible:true, lineas, articulos, base, iva, re, total, direccion, opciones, porDefecto, quitados } o { posible:false, motivo }.
 */
export function previaPedidoRapido({ fuente, catalogo, customer, opciones, phone = "" }) {
  const lista = Array.isArray(fuente) ? fuente : [];
  const enCatalogo = new Set(catalogo.map((p) => String(p.id)));
  const lineas = lista.filter((l) => enCatalogo.has(String(l?.id))).map((l) => ({ id: String(l.id), qty: Math.min(999, Math.max(1, Math.floor(Number(l.qty)) || 1)), unit: l.unit === "caja" ? "caja" : "ud" }));
  const quitados = lista.length - lineas.length;
  if (!lineas.length) return { posible: false, motivo: "Aún no tienes un pedido anterior que repetir." };
  if (!String(customer?.address ?? "").trim()) return { posible: false, motivo: "Falta tu dirección de entrega: haz el pedido desde el catálogo." };
  if (!opciones?.length) return { posible: false, motivo: "Ahora mismo no hay días de reparto disponibles." };
  const built = webOrderFromBody({ lines: lineas }, customer, { key: "web:vista-previa", phone }, catalogo);
  if (built.error) return { posible: false, motivo: built.error };
  const priced = priceOrder(built.order, customer, catalogo), t = totals(priced.items, !!customer?.recargoEquivalencia);
  const nombre = new Map(catalogo.map((p) => [String(p.id), p.name]));
  return {
    posible: true,
    // lo que se enviará (mismos datos que usa POST /catalogo) y cómo se enseña
    lineas: built.order.items.map((i) => ({ id: String(i.id), qty: i.qty, unit: i.unit === "caja" ? "caja" : "ud", nombre: nombre.get(String(i.id)) ?? i.name })),
    articulos: built.order.items.length, quitados,
    base: t.base, iva: t.iva, re: t.re, total: t.total,
    direccion: String(customer.address).trim(), opciones: opciones.map((o) => ({ date: o.date, label: o.label, detail: o.detail })), porDefecto: diaPropuesto(opciones),
  };
}
