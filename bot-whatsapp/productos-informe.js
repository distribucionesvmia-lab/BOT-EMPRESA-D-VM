// Informe de una tarifa de productos con varias hojas (SOLO LECTURA: no importa ni escribe nada).
// Uso:  node productos-informe.js <tarifa.xlsx>
// Cuenta por hoja los artículos, los que no tienen precio numérico, los bloqueados, los códigos de IVA, los duplicados y las imágenes.
import fs from "node:fs";
import { readXlsxSheets } from "./xlsx-read.js";
import { parseProductos } from "./productos-import.js";

const ruta = process.argv[2];
if (!ruta) { console.error("Uso: node productos-informe.js <tarifa.xlsx>"); process.exit(1); }
const buf = fs.readFileSync(ruta);
const hojas = readXlsxSheets(buf);
const ivas = new Map(), vistos = new Map();
let total = 0, ok = 0, sinPrecio = 0, bloqueados = 0;
console.log(`Libro: ${hojas.length} hojas\n`);
for (const h of hojas) {
  let r;
  try { r = parseProductos(h.rows); } catch { console.log(`${h.name.trim().padEnd(26)} (sin cabecera de productos)`); continue; }
  const idx = h.rows.findIndex((x) => x.some((c) => /^t?ipo iva/i.test(String(c)))) >= 0;
  total += r.stats.filas; ok += r.stats.importados; sinPrecio += r.stats.sinPrecio; bloqueados += r.stats.inactivos;
  for (const p of r.products) vistos.set(p.id, [...(vistos.get(p.id) ?? []), h.name.trim()]);
  // códigos de IVA tal como vienen (ORD21, RED10, SRE…): se cuentan aparte porque el importador actual espera un número
  const head = h.rows.find((x) => x.some((c) => /^tipo iva/i.test(String(c)))) ?? [], c = head.findIndex((x) => /^tipo iva/i.test(String(x)));
  if (c >= 0) for (const row of h.rows.slice(1)) if (String(row[0]).trim() && row[c]) ivas.set(row[c], (ivas.get(row[c]) ?? 0) + 1);
  console.log(`${h.name.trim().padEnd(26)} filas ${String(r.stats.filas).padStart(5)} · con precio ${String(r.stats.importados).padStart(5)} · sin precio ${String(r.stats.sinPrecio).padStart(4)} · bloqueados ${r.stats.inactivos} · repetidos ${r.stats.duplicados} · descartadas ${r.stats.descartadas}`);
}
console.log(`\nTOTAL filas ${total} · importables ${ok} · sin precio numérico ${sinPrecio} · bloqueados ${bloqueados}`);
console.log("Códigos de IVA en el Excel:", Object.fromEntries(ivas), "(el importador actual espera un porcentaje; ORD21/RED10/SRE se tienen que traducir con una regla confirmada)");
const dup = [...vistos].filter(([, h]) => h.length > 1);
console.log(`Artículos repetidos en varias hojas: ${dup.length}`, dup.slice(0, 5).map(([id, h]) => `${id} (${h.join(", ")})`).join("; "));
const media = (buf.toString("latin1").match(/xl\/media\//g) ?? []).length / 2;
console.log(`Imágenes incrustadas aprox.: ${Math.round(media)} (no se leen en este informe)`);
