// Informe de clasificación del catálogo (SOLO LECTURA: no escribe nada en la base).
// Uso:  node categorias-informe.js [ruta/catalogo.sqlite]     (por defecto CATALOG_DB o catalogo.sqlite)
// Muestra cuántos productos hay en cada categoría/subcategoría y lista los que caen en «Otros…» (sin clasificar con seguridad)
// para que una persona revise si hace falta una palabra nueva en categorias.js o una categoría en la ficha de a3ERP.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { categorizar } from "./categorias.js";

const ruta = process.argv[2] ?? process.env.CATALOG_DB ?? "catalogo.sqlite";
if (!existsSync(ruta)) { console.error(`No existe ${ruta}. Indica la ruta del catálogo: node categorias-informe.js <fichero.sqlite>`); process.exit(1); }
const db = new DatabaseSync(ruta, { readOnly: true });
const prods = db.prepare("SELECT id, name, category, subcategory FROM products WHERE active = 1 OR active IS NULL").all();

const cuenta = new Map(), sinClasificar = [];
for (const p of prods) {
  const k = categorizar(p);
  const clave = `${k.catNombre} › ${k.subNombre}`;
  cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  const generico = k.cat === "otros" || /^otros?\b/i.test(k.subNombre);
  if (generico && !String(p.category ?? "").trim()) sinClasificar.push(`${p.id}\t${p.name}\t→ ${clave}`);
}
console.log(`Productos activos: ${prods.length}\n`);
for (const [c, n] of [...cuenta].sort()) console.log(`${String(n).padStart(5)}  ${c}`);
console.log(`\nSin clasificar con seguridad (caen en «Otros», sin categoría en la ficha): ${sinClasificar.length}`);
sinClasificar.slice(0, 200).forEach((l) => console.log("  " + l));
if (sinClasificar.length > 200) console.log(`  … y ${sinClasificar.length - 200} más`);
