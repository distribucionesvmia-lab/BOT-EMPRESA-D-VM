#!/usr/bin/env node
// Prepara los archivos de datos del artefacto «Pedidos por WhatsApp» a partir de los tres Excel que saca extraer-a3erp.js.
//   node preparar-artefacto.js --entrada ./salida-datos --salida ./salida-datos/artefacto/datos --origen "copia a3ERP VALENTIN 20/10/2026"
// Deja productos.json (solo activos), clientes.json (solo activos, con su historial; sin NIF) y origen.json.
// El orden de las claves es fijo: el cargador del artefacto compara una huella de cada registro, y así solo se escribe lo que cambia.
import fs from "node:fs";
import path from "node:path";
import { parseClientesXlsx } from "./clientes-import.js";
import { parseProductosXlsx } from "./productos-import.js";
import { parseHistorialXlsx } from "./historial-import.js";

export function prepararDatos({ clientesXlsx, productosXlsx, historialXlsx }) {
  const prods = parseProductosXlsx(productosXlsx).products.filter((p) => p.active !== false);
  const hist = parseHistorialXlsx(historialXlsx).byCustomer;
  const productos = prods.map((p) => ({ id: String(p.id), name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, ...(p.saleMode ? { saleMode: p.saleMode } : {}), vat: p.vat ?? 21, discount: p.discount ?? 0, updatedAt: null, changes: [] }));
  const clientes = parseClientesXlsx(clientesXlsx).customers.filter((c) => c.active !== false).map((c) => ({
    id: String(c.id), name: c.name, legalName: c.legalName ?? "", city: c.city ?? "", municipio: c.municipio ?? "", phone: c.phone ?? "",
    phones: c.phones ?? [], emails: c.emails ?? [], address: c.address ?? "", active: true, recargoEquivalencia: false, specialPrices: {}, discounts: {},
    orders: hist.get(String(c.id)) ?? [],
  }));
  return { productos, clientes };
}

/** Diferencias entre dos juegos de registros (por id): lo mismo que calcula el cargador del artefacto con sus huellas. */
export function diferencias(antes, ahora) {
  const a = new Map(antes.map((r) => [String(r.id), JSON.stringify(r)]));
  const b = new Map(ahora.map((r) => [String(r.id), JSON.stringify(r)]));
  const nuevos = [...b.keys()].filter((id) => !a.has(id));
  const modificados = [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id));
  const retirados = [...a.keys()].filter((id) => !b.has(id));
  return { nuevos, modificados, retirados, iguales: b.size - nuevos.length - modificados.length };
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const entrada = arg("entrada", "./salida-datos"), salida = arg("salida", "./salida-datos/artefacto/datos"), origen = arg("origen", "copia de a3ERP");
  const rd = (f) => fs.readFileSync(path.join(entrada, f));
  const { productos, clientes } = prepararDatos({ clientesXlsx: rd("clientes.xlsx"), productosXlsx: rd("productos.xlsx"), historialXlsx: rd("historial-ventas.xlsx") });
  fs.mkdirSync(salida, { recursive: true });
  // Si ya hay datos de la copia anterior, se muestra qué cambia antes de sobrescribirlos
  for (const [nombre, nuevos] of [["productos", productos], ["clientes", clientes]]) {
    const f = path.join(salida, nombre + ".json");
    if (fs.existsSync(f)) { const d = diferencias(JSON.parse(fs.readFileSync(f, "utf8")), nuevos); console.log(`${nombre}: ${d.nuevos.length} nuevos, ${d.modificados.length} modificados, ${d.retirados.length} retirados, ${d.iguales} iguales`); }
    fs.writeFileSync(f, JSON.stringify(nuevos));
  }
  fs.writeFileSync(path.join(salida, "origen.json"), JSON.stringify({ origen }));
  console.log(`Listo: ${productos.length} productos, ${clientes.length} clientes en ${salida}`);
}
if (import.meta.url === `file://${process.argv[1]}`) { try { main(); } catch (e) { console.error("ERROR:", e.message); process.exit(1); } }
