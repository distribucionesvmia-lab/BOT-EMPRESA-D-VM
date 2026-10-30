// Capa de datos del bot: productos, clientes y pedidos.
//   getCatalog() / catalogVersion()   productos (base catalogo.sqlite)
//   getCustomerByPhone / ById / findCustomers   clientes e historial (base clientes.sqlite)
//   createOrder(order)                graba el pedido (base pedidos.sqlite + hoja de Google opcional)
// Las dos primeras bases las alimenta el ERP (hoy, datos.js; después, la sincronización con a3ERP): el bot solo las lee.

import fs from "node:fs";
import { getDb } from "./db.js";
import { importData } from "./seed.js";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { findCustomers as findCustomersIn } from "./identify.js";

const { SHEET_WEBHOOK_URL, SHEET_SECRET } = process.env;

// Dos bases de datos de solo lectura para el bot (se actualizan con datos.js o con una sincronización):
//   catalogo.sqlite  productos y precios      clientes.sqlite  clientes, descuentos e historial de compras
// La primera vez, si están vacías, se cargan de historial-demo.json (generado por importar_historial.py) o,
// en modo demo, de datos FICTICIOS de ejemplo/.
const SEED_FILE = new URL("./historial-demo.json", import.meta.url);
const EXAMPLE_FILE = new URL("./ejemplo/historial-ficticio.json", import.meta.url);
let catalogDb, customersDb;
function dbs() {
  if (!catalogDb) {
    catalogDb = openCatalogDb();
    customersDb = openCustomersDb();
    if (!catalogDb.count() && !customersDb.count()) {
      const file = fs.existsSync(SEED_FILE) ? SEED_FILE : process.env.DEMO === "1" && fs.existsSync(EXAMPLE_FILE) ? EXAMPLE_FILE : null;
      if (file) importData(JSON.parse(fs.readFileSync(file, "utf8")), catalogDb, customersDb);
    }
  }
  return { catalogDb, customersDb };
}

/** Las dos bases (productos y clientes) para la sincronización automática. */
export const getDatabases = () => dbs();

export const listCustomers = () => dbs().customersDb.list();

/** Catálogo de productos activos ([{ id, name, price, unitsPerBox?, vat, discount }]) o null si no hay datos (el bot usa config.js). */
export async function getCatalog() {
  const list = dbs().catalogDb.list();
  return list.length ? list : null;
}
/** Cambia cuando se actualiza el catálogo: el servidor recarga los precios sin reiniciar. */
export const catalogVersion = () => dbs().catalogDb.version();

export async function getCustomerByPhone(phone) {
  return dbs().customersDb.getByPhone(phone);
}
export async function getCustomerById(id) {
  return dbs().customersDb.getById(id);
}
/** Clientes que encajan con el nombre o código que escribe el cliente. */
export const findCustomers = (query) => dbs().customersDb.find(query);

// Cuentas de acceso de los clientes (teléfono + PIN) en su propia base: cuentas.sqlite
let accountsDb;
export const getAccountsDb = () => (accountsDb ??= openAccountsDb());

/** Lo que necesitan las cuentas y la administración: ficha, comprobación de altas, búsqueda e importación de clientes. */
export const customerDirectory = {
  list: () => dbs().customersDb.list(),
  getById: (id) => dbs().customersDb.getById(id),
  /** Comprueba una solicitud de alta contra los clientes guardados (ver clientes-db.js). */
  matchRegistration: (x) => dbs().customersDb.matchRegistration(x),
  /** Clientes que podrían ser el que pide acceso, con el motivo (nombre, teléfono, correo). */
  suggest: (business, phone, email) => dbs().customersDb.matchRegistration({ business, phone, email }).suggestions,
  search: (opts) => dbs().customersDb.search(opts),
  /** Acceso con NIF: clientes que encajan con el nombre escrito (flexible) y comprobación de los 6 últimos caracteres. */
  candidates: (query) => dbs().customersDb.candidates(query),
  findByNif: (typed) => dbs().customersDb.findByNif(typed),
  checkNif: (id, typed) => dbs().customersDb.checkNif(id, typed),
  /** ¿El nombre escrito coincide con el del cliente (nombre comercial o razón social)? Un cliente de baja nunca coincide. */
  nameMatches: (customer, typed) => !!customer && findCustomersIn([customer], typed).length > 0,
  /** Crea o actualiza clientes (la lista que se importa del Excel de a3ERP). */
  importMany: (list) => dbs().customersDb.upsertCustomers(list),
};

/**
 * Guarda el pedido en la base de datos propia (SQLite). Si la clave de idempotencia (order.key) ya existe,
 * no crea otro pedido y devuelve el original con duplicate=true.
 * La copia a la hoja de Google es opcional y solo se envía para pedidos nuevos.
 */
let orderHook = null;
/** Función que se llama con cada pedido NUEVO ya guardado (el aviso por correo). Sus errores nunca afectan al pedido. */
export const setOrderHook = (fn) => (orderHook = fn);

export async function createOrder(order) {
  const result = getDb().createOrder(order); // si falla, el error se propaga: el pedido NO se da por registrado
  if (!result.duplicate) try { orderHook?.(result.order); } catch (e) { console.error("Aviso del pedido:", e.message); }
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
