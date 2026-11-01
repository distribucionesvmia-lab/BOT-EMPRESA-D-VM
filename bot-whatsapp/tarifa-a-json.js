// Convierte la tarifa de productos de varias hojas (una por proveedor o familia) en una lista de productos lista para cargar.
// SOLO LECTURA del Excel; escribe un JSON donde se le indique (fuera del repositorio: son precios reales).
// Uso:  node tarifa-a-json.js <tarifa.xlsx> <salida.json>
// Reglas: se descartan los artículos sin precio numérico, bloqueados y repetidos; el «Dto%» viene como fracción (0,29 = 29 %);
// el IVA «SRE» queda sin tipo (no se supone); la categoría se fija por hoja.
import fs from "node:fs";
import { readXlsxSheets } from "./xlsx-read.js";
import { parseProductos } from "./productos-import.js";

// hoja → [categoría, subcategoría]  (las categorías del cliente: Café, Pascual, Vinos, Aguas, Despensa, Refrigerados; el resto, Hostelería y menaje)
export const HOJAS = {
  pascual: ["Pascual", ""], mocay: ["Café", ""], vinos: ["Vinos", ""], aguas: ["Aguas", ""],
  "salsas prima": ["Despensa", "Salsas Prima"], helios: ["Despensa", "Helios"], "don simon": ["Despensa", "Don Simón"], "conservas 3 kg": ["Despensa", "Conservas 3 kg"],
  especias: ["Despensa", "Especias"], aceite: ["Despensa", "Aceite"], legumbres: ["Despensa", "Legumbres"], "el pozo": ["Despensa", "El Pozo"],
  "reny picot quesos": ["Refrigerados", "Quesos Reny Picot"], "campofrio y navidul": ["Refrigerados", "Campofrío y Navidul"],
  menaje: ["Hostelería y menaje", "Menaje"], drogueria: ["Hostelería y menaje", "Droguería"], papel: ["Hostelería y menaje", "Papel"], platos: ["Hostelería y menaje", "Platos"],
  cuberteria_sartenes: ["Hostelería y menaje", "Cubertería y sartenes"], "vasos y copas": ["Hostelería y menaje", "Vasos y copas"],
};

export function tarifaAProductos(buf) {
  const out = [], vistos = new Set(), avisos = { hojaDesconocida: [], sinPrecio: 0, repetidos: 0, filasRaras: 0 };
  for (const h of readXlsxSheets(buf)) {
    const destino = HOJAS[h.name.trim().toLowerCase()];
    if (!destino) { avisos.hojaDesconocida.push(h.name.trim()); continue; }
    let r;
    try { r = parseProductos(h.rows); } catch { continue; }
    avisos.sinPrecio += r.stats.sinPrecio;
    for (const p of r.products) {
      if (!p.active) continue;
      if (!(p.price > 0) || /^[\d\s.,]*$/.test(p.name) || p.id === "0") { avisos.filasRaras++; continue; } // precio 0, nombre sin letras o código 0: restos de la hoja, no productos
      if (vistos.has(p.id)) { avisos.repetidos++; continue; }
      vistos.add(p.id);
      const q = { id: p.id, name: p.name.replace(/\s+/g, " ").trim(), price: p.price, category: destino[0] };
      if (destino[1]) q.subcategory = destino[1];
      if (p.unitsPerBox > 1) q.unitsPerBox = p.unitsPerBox;
      if (p.vat !== undefined) q.vat = p.vat;
      if (p.discount) q.discount = Math.round((p.discount <= 1 ? p.discount * 100 : p.discount) * 100) / 100;
      out.push(q);
    }
  }
  return { products: out, avisos };
}

if (process.argv[1]?.endsWith("tarifa-a-json.js")) {
  const [, , entrada, salida] = process.argv;
  if (!entrada || !salida) { console.error("Uso: node tarifa-a-json.js <tarifa.xlsx> <salida.json>"); process.exit(1); }
  const { products, avisos } = tarifaAProductos(fs.readFileSync(entrada));
  fs.writeFileSync(salida, JSON.stringify(products));
  const porCat = {}; for (const p of products) porCat[p.category] = (porCat[p.category] ?? 0) + 1;
  console.log(`Productos: ${products.length}`, porCat, `· sin IVA conocido (SRE): ${products.filter((p) => p.vat === undefined).length} · con descuento: ${products.filter((p) => p.discount).length}`);
  console.log("Descuentos distintos (%):", [...new Set(products.map((p) => p.discount).filter(Boolean))].sort((a, b) => a - b).join(", "));
  console.log("Avisos:", avisos);
}
