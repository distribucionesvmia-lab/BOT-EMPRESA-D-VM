// Capa de conexión con el ERP/CRM del cliente.
//
// El bot solo usa estas dos funciones:
//   getCustomerByPhone(phone) -> { id, name, phone, address, usual: [{ productId, qty }] } | null
//   createOrder(order)        -> graba el pedido
//
// AHORA: datos de ejemplo (clientes-demo.json) y los pedidos van a orders.jsonl + hoja de Google.
// DESPUÉS: para conectar con el ERP real (a3ERP u otro) solo hay que cambiar el interior de
// estas dos funciones; el resto del bot no se toca.

import fs from "node:fs";

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

export async function createOrder(order) {
  fs.appendFileSync("orders.jsonl", JSON.stringify(order) + "\n"); // copia de seguridad local
  console.log("NUEVO PEDIDO:", order);
  if (!SHEET_WEBHOOK_URL) return;
  try {
    const res = await fetch(SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ secret: SHEET_SECRET, ...order }),
    });
    const body = await res.text();
    if (!res.ok || body.trim() !== "ok") console.error("Error guardando en la hoja:", res.status, body.slice(0, 200));
  } catch (err) {
    console.error("No se pudo guardar en la hoja (el pedido sigue en orders.jsonl):", err.message);
  }
}
