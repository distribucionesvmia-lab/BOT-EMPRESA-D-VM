// Aprende qué categoría corresponde a cada código de familia de a3ERP («56.0», «1.1»…), mirando los productos que ya tienen
// categoría en la lista actual. Se usa para clasificar solo los productos NUEVOS de las actualizaciones.
//   node familias-aprender.js ARTICULOS.xlsx lista-actual.json familias-categorias.json
// Si una familia tiene productos en varias categorías, gana la más frecuente. Se puede corregir a mano el JSON resultante.
import fs from "node:fs";
import { leerExcel } from "./actualizar-productos.js";

export function aprenderFamilias(productosExcel, actual) {
  const cat = new Map(actual.filter((p) => p.category).map((p) => [String(p.id), p]));
  const cuenta = new Map();
  for (const p of productosExcel) {
    const a = cat.get(String(p.id));
    if (!p.family || !a) continue;
    const k = `${a.category}\u0000${a.subcategory ?? ""}`, m = cuenta.get(p.family) ?? new Map();
    m.set(k, (m.get(k) ?? 0) + 1); cuenta.set(p.family, m);
  }
  const out = {};
  for (const [fam, m] of [...cuenta].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const [k] = [...m].sort((a, b) => b[1] - a[1])[0];
    const [category, subcategory] = k.split("\u0000");
    out[fam] = { category, ...(subcategory ? { subcategory } : {}) };
  }
  return out;
}

if (process.argv[1]?.endsWith("familias-aprender.js")) {
  const [, , xlsx, lista, salida] = process.argv;
  if (!xlsx || !lista || !salida) { console.error("Uso: node familias-aprender.js ARTICULOS.xlsx lista-actual.json familias-categorias.json"); process.exit(1); }
  const mapa = aprenderFamilias(leerExcel(fs.readFileSync(xlsx)).productos, JSON.parse(fs.readFileSync(lista, "utf8")));
  fs.writeFileSync(salida, JSON.stringify(mapa, null, 1));
  console.log(`${Object.keys(mapa).length} familias guardadas en ${salida}`);
}
