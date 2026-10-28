// Capa de conexión con el ERP/CRM del cliente.
//
// El bot solo usa estas dos funciones:
//   getCustomerByPhone(phone) -> { id, name, phone, address, usual: [{ productId, qty }] } | null
//   createOrder(order)        -> graba el pedido
//
// AHORA: datos de ejemplo (historial-demo.json) y los pedidos van a SQLite (db.js) + hoja de Google (opcional).
// DESPUÉS: para conectar con el ERP real (a3ERP u otro) solo hay que cambiar el interior de
// estas dos funciones; el resto del bot no se toca.

import fs from "node:fs";
import { getDb } from "./db.js";

const { SHEET_WEBHOOK_URL, SHEET_SECRET } = process.env;

// Compara teléfonos por sus 9 últimos dígitos (WhatsApp envía "34600111222", el ERP guarda "+34 600 111 222")
const last9 = (p) => String(p).replace(/\D/g, "").slice(-9);

// historial-demo.json lo genera importar_historial.py a partir de una exportación del ERP (Excel).
// Cliente: { id, name, phone, address, orders: [{ doc, date, lines: [{ productId, qty }] }], frequent: [{ productId, qty }] }
const DATA_FILE = new URL("./historial-demo.json", import.meta.url);
let data;
const load = () =>
  (data ??= fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) : { products: null, customers: [] });

export const listCustomers = () => load().customers;

/** Catálogo de productos del ERP ([{ id, name, price }]) o null si no hay datos (el bot usa config.js). */
export async function getCatalog() {
  return load().products;
}

export async function getCustomerByPhone(phone) {
  return load().customers.find((c) => last9(c.phone) === last9(phone)) ?? null;
}

/**
 * Guarda el pedido en la base de datos propia (SQLite). Si la clave de idempotencia (order.key) ya existe,
 * no crea otro pedido y devuelve el original con duplicate=true.
 * La copia a la hoja de Google es opcional y solo se envía para pedidos nuevos.
 */
export async function createOrder(order) {
  const result = getDb().createOrder(order); // si falla, el error se propaga: el pedido NO se da por registrado
  if (result.duplicate) {
    console.log("Pedido duplicado ignorado:", order.key, "->", result.order.ref);
    return result;
  }
  console.log("NUEVO PEDIDO:", result.order.ref, order);
  if (!SHEET_WEBHOOK_URL) return result;
  try {
    const res = await fetch(SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ secret: SHEET_SECRET, ...order, ref: result.order.ref }),
    });
    const body = await res.text();
    if (!res.ok || body.trim() !== "ok") console.error("Error guardando en la hoja:", res.status, body.slice(0, 200));
  } catch (err) {
    console.error("No se pudo copiar a la hoja (el pedido sigue en la base de datos):", err.message);
  }
  return result;
}
