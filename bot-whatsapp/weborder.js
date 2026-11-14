import { deliveryAllowed, madridDay, puedeHoy } from "./delivery.js";
import { categorizar, arbolCategorias } from "./categorias.js";
import { soloCaja, precioEfectivo, promoVigente } from "./pricing.js";
import { limpiarNombre } from "./nombres.js";
import fs from "node:fs";

// Nombres limpios (Mayúscula inicial, unidades, marca aparte): solo si la empresa lo activa con NOMBRES_LIMPIOS=1 tras revisar los ejemplos (node nombres-informe.js)
let _excepciones = null;
const excepcionesNombres = () => { if (_excepciones) return _excepciones; try { _excepciones = process.env.NOMBRES_EXCEPCIONES ? JSON.parse(fs.readFileSync(process.env.NOMBRES_EXCEPCIONES, "utf8")) : {}; } catch { _excepciones = {}; } return _excepciones; };

const normNombre = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
/** Quita repetidos del catálogo: el mismo código solo una vez, y los artículos con el mismo nombre, precio, descuento y unidades por caja (se queda el primero). */
export function catalogoSinDuplicados(catalog) {
  const ids = new Set(), claves = new Set();
  return catalog.filter((p) => {
    const id = String(p.id); if (ids.has(id) || !String(p.name ?? "").trim()) return false; // sin nombre no hay nada que enseñar
    ids.add(id);
    const k = [normNombre(p.name), p.price, p.discount ?? 0, p.unitsPerBox ?? 0].join("|");
    if (claves.has(k)) return false; claves.add(k); return true;
  });
}
/** Accesos directos del catálogo (Limpieza, Papel y desechables, Cervezas): la subcategoría que mejor encaja con cada uno, si existe. */
export function accesosDe(tree) {
  const quiero = [["Limpieza", /limpieza|higiene/i], ["Papel y desechables", /papel|desechable|servilleta/i], ["Cervezas", /^cervezas?$/i]];
  const out = [];
  for (const [titulo, re] of quiero) {
    let mejor = null;
    for (const c of tree ?? []) for (const s of c.subs ?? []) if (re.test(s.nombre) && (!mejor || s.count > mejor.count)) mejor = { cat: c.id, sub: s.id, count: s.count };
    if (mejor) out.push({ nombre: titulo, ...mejor });
  }
  return out;
}

// Lógica de la mini-aplicación de pedido, sin red ni disco (la comparten el servidor y la demo del navegador).

/** Catálogo que ve el cliente: sus habituales primero, con las unidades de la última vez y las unidades por caja. */
/** La oferta de la empresa que de verdad le cambia el precio a este cliente: { tipo, valor, hasta? } o null (si ya tiene un descuento mayor, no se enseña). */
function oferta(p, customer) {
  const o = promoVigente(p); if (!o) return null;
  const sin = precioEfectivo({ ...p, promo: null }, customer, String(p.id)), con = precioEfectivo(p, customer, String(p.id));
  return sin.price !== con.price || sin.discount !== con.discount ? { tipo: o.tipo, valor: Number(o.valor), ...(o.hasta ? { hasta: o.hasta } : {}) } : null;
}
/** Clave para ordenar por nombre sin fijarse en comillas, acentos ni mayúsculas (el nombre original no se toca). */
export const claveOrdenNombre = (n) => String(n ?? "").replace(/[´`"“”«»‘’']/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export function webProducts(customer, catalog, habitualProducts, imgOf = () => null, iaOf = () => false) {
  const habit = new Map(habitualProducts(customer).map((p) => [p.id, p]));
  const limpio = process.env.NOMBRES_LIMPIOS === "1";
  return catalog
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      ...(limpio ? (({ nombre, marca, cambiado }) => (cambiado ? { nombreCorto: nombre, ...(marca ? { marca } : {}) } : {}))(limpiarNombre(p.name, { excepciones: excepcionesNombres() })) : {}),
      // Mismo criterio que pricing.js (priceLine): precio y descuento especiales del cliente si los hay, si no los de la ficha
      price: precioEfectivo(p, customer, String(p.id)).price,
      discount: precioEfectivo(p, customer, String(p.id)).discount,
      ...(oferta(p, customer) ? { oferta: oferta(p, customer) } : {}), // la oferta de la empresa, solo si a este cliente le cambia el precio
      vat: p.vat ?? 21, // tipo de IVA (para enseñar el total con IVA)
      unitsPerBox: Number.isInteger(p.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null,
      ...(soloCaja(p) ? { soloCaja: true } : {}), // solo se vende por cajas enteras: en pantalla no hay «Uds»
      ...(({ cat, sub }) => ({ cat, sub }))(categorizar(p)), // categoría y subcategoría (ids) para navegar el catálogo
      ...((img) => (img ? { img } : {}))(imgOf(String(p.id))), // foto del producto (si hay)
      ...(imgOf(String(p.id)) && iaOf(String(p.id)) ? { ia: true } : {}), // la foto está generada con IA (se avisa en pequeño)
      lastQty: habit.get(p.id)?.lastQty ?? null,
      count: habit.get(p.id)?.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count || claveOrdenNombre(a.name).localeCompare(claveOrdenNombre(b.name), "es"))
    .filter((p, i, todos) => todos.findIndex((x) => x.id === p.id) === i && String(p.name ?? "").trim()) // mismo código solo una vez; sin nombre, no hay tarjeta
    .reduce((acc, p) => { // mismo nombre, precio y caja → se enseña uno: el que el cliente ya compra o, si no, el de código menor
      const k = [normNombre(p.name), p.price, p.discount ?? 0, p.unitsPerBox ?? 0].join("|"), j = acc.claves.get(k);
      const mejor = (a, b) => b.count > a.count || (b.count === a.count && b.id.localeCompare(a.id, undefined, { numeric: true }) < 0);
      if (j === undefined) { acc.claves.set(k, acc.lista.length); acc.lista.push(p); } else if (mejor(acc.lista[j], p)) acc.lista[j] = p;
      return acc;
    }, { lista: [], claves: new Map() }).lista;
}

/** Árbol de categorías del catálogo que ve el cliente (con cuántos productos tiene cada una). */
export const webTree = (catalog) => arbolCategorias(catalogoSinDuplicados(catalog)); // los mismos repetidos que se quitan de la lista, para que los contadores cuadren

/** Pone el histórico indicado ({ código de cliente: [pedidos] }) a los clientes de la lista que lo tengan (sustituye al que traían). */
export function conHistorial(clientes, historial = {}) {
  const k = (id) => String(id).trim().replace(/^0+(?=\d)/, ""); // «0429» y «429» son el mismo cliente
  const por = new Map(Object.entries(historial).map(([id, o]) => [k(id), o]));
  return clientes.map((c) => (por.has(k(c.id)) ? { ...c, orders: por.get(k(c.id)) } : c));
}

/**
 * Suma al historial de a3ERP los pedidos que el cliente ha hecho por la aplicación o el chat (y que a3ERP aún no ha facturado):
 * solo los de fecha igual o posterior al último pedido de a3ERP, para no contarlos dos veces cuando después aparezcan en su historial.
 */
export const HISTORIAL_VER_MAS = 30; // «Ver más» en Mi cuenta: hasta 30 pedidos
export const HISTORIAL_MAX = 10; // pedidos que se guardan como historial de cada cliente: al llegar el 11.º se va el más antiguo
const masRecientes = (orders, max = HISTORIAL_MAX) => [...orders].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, max);
export function withOwnOrders(customer, ownOrders = [], max = HISTORIAL_MAX) {
  if (!customer) return customer;
  const orders = customer.orders ?? [];
  const lastA3 = orders.reduce((m, o) => (String(o.date) > m ? String(o.date) : m), "");
  const seen = new Set(orders.map((o) => String(o.doc)));
  const own = ownOrders.filter((o) => o.date >= lastA3 && !seen.has(String(o.doc)) && o.lines.length);
  return { ...customer, orders: masRecientes([...own, ...orders], max) }; // historial = sus 10 últimos pedidos (los de a3ERP y los hechos por la aplicación)
}

/** Últimos pedidos del cliente (los más recientes primero) con sus líneas, para volver a comprarlos o modificarlos. */
export function webHistory(customer, catalogList, limit = HISTORIAL_MAX) {
  const names = new Map(catalogList.map((p) => [String(p.id), p.name]));
  return [...(customer.orders ?? [])]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((o) => ({ doc: String(o.doc), date: o.date, lines: o.lines.filter((l) => names.has(String(l.productId)) && l.qty > 0).map((l) => ({ id: String(l.productId), name: names.get(String(l.productId)), qty: l.qty })) }))
    .filter((o) => o.lines.length)
    .slice(0, limit);
}

/**
 * Valida lo que envía la mini-app y arma el pedido (sin precios: los pone priceOrder).
 * Devuelve { order } o { error } si el pedido está vacío.
 */
export function webOrderFromBody(body, customer, { key, phone, at = new Date().toISOString() }, catalogList) {
  const catalog = new Map(catalogList.map((p) => [String(p.id), p]));
  const merged = new Map();
  for (const l of Array.isArray(body?.lines) ? body.lines : []) {
    const p = catalog.get(String(l?.id));
    const qty0 = Math.floor(Number(l?.qty));
    // Unidades o cajas; las cajas solo valen para artículos que se venden en cajas
    const hayCajas = Number.isInteger(p?.unitsPerBox) && p.unitsPerBox > 1;
    const unit = (l?.unit === "caja" || soloCaja(p)) && hayCajas ? "caja" : "ud";
    // Un artículo de solo caja nunca se vende suelto: si llega en unidades, se pasan a cajas enteras (hacia arriba)
    const qty = soloCaja(p) && l?.unit !== "caja" ? Math.ceil(qty0 / p.unitsPerBox) : qty0;
    const lineNote = typeof l?.note === "string" ? l.note.trim().slice(0, 120) : "";
    if (p && qty >= 1 && qty <= 999) {
      const k = `${p.id}|${unit}`;
      const prev = merged.get(k);
      merged.set(k, { id: p.id, name: p.name, price: p.price, qty: (prev?.qty ?? 0) + qty, unit, ...((lineNote || prev?.note) && { note: lineNote || prev.note }) });
    }
  }
  const items = [...merged.values()];
  if (!items.length) return { error: "El pedido está vacío" };
  const nota = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : "";
  // Dirección de entrega: la de siempre, o la que escribe el cliente («otra dirección»). Un cliente nuevo (sin dirección guardada) tiene que ponerla.
  const otra = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const habitual = String(customer.address ?? "").trim();
  if (!habitual && !otra) return { error: "Indica a dónde te lo llevamos." };
  if (otra && otra.length < 5) return { error: "La dirección de entrega es demasiado corta." };
  const note = otra ? `ENTREGA EN ${habitual ? "OTRA DIRECCIÓN" : "ESTA DIRECCIÓN (cliente nuevo)"}: ${otra}${nota ? " · " + nota : ""}` : nota; // llega así al panel de la empresa y al Excel
  // Día de entrega elegido (uno de los botones o cualquier día del calendario): debe ser una fecha real, de hoy en adelante
  let delivery = null;
  if (body?.delivery != null && body.delivery !== "") {
    const hoy = puedeHoy(customer); // el mismo día solo en los municipios que lo tienen
    if (!deliveryAllowed(body.delivery, at, { hoy })) {
      return { error: body.delivery === madridDay(at) ? (hoy ? "Para recibirlo hoy hay que pedir antes de las 10:00. Elige otro día." : "Para tu zona no hay entrega en el mismo día. Elige otro día.") : "Elige un día de entrega válido." };
    }
    delivery = body.delivery;
  }
  return {
    order: {
      at,
      key,
      phone,
      customerId: customer.id,
      name: customer.name,
      address: otra || customer.address,
      city: customer.city ?? "",
      text: items.map((i) => `${i.qty} ${i.unit === "caja" ? "cajas de " : ""}${i.name}`).join(" + ") + (note ? ` · Nota: ${note}` : ""),
      items,
      total: null, // lo calcula priceOrder (cajas × unidades por caja, precios especiales, descuentos)
      review: false,
      note,
      delivery,
    },
  };
}
