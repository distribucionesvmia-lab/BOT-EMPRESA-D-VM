// Informe de nombres limpios (SOLO LECTURA: no escribe en la base). Se ejecuta en el ordenador de la oficina con el catálogo real.
// Uso:  node nombres-informe.js [ruta/catalogo.sqlite] [ruta/excepciones.json]
// Enseña 40 ejemplos «antes → después» repartidos por todo el catálogo y cuántos nombres cambian; los datos no salen del ordenador.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { limpiarNombre } from "./nombres.js";

const ruta = process.argv[2] ?? process.env.CATALOG_DB ?? "catalogo.sqlite";
const rutaEx = process.argv[3] ?? process.env.NOMBRES_EXCEPCIONES ?? "";
if (!existsSync(ruta)) { console.error(`No existe ${ruta}. Indica la ruta: node nombres-informe.js <catalogo.sqlite>`); process.exit(1); }
const excepciones = rutaEx && existsSync(rutaEx) ? JSON.parse(readFileSync(rutaEx, "utf8")) : {};
const db = new DatabaseSync(ruta, { readOnly: true });
const prods = db.prepare("SELECT id, name FROM products WHERE active = 1 OR active IS NULL ORDER BY id").all();
const res = prods.map((p) => ({ id: p.id, ...limpiarNombre(p.name, { excepciones }) }));
const cambiados = res.filter((r) => r.cambiado);
console.log(`Productos activos: ${res.length} · nombres que cambian: ${cambiados.length} (${res.length ? Math.round((100 * cambiados.length) / res.length) : 0} %)\n`);
const paso = Math.max(1, Math.floor(cambiados.length / 40));
console.log("40 ejemplos (uno de cada tantos, para que haya de todo):");
cambiados.filter((_, i) => i % paso === 0).slice(0, 40).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.original}\n    → ${r.marca ? `[${r.marca}] ` : ""}${r.nombre}`));
console.log("\nSi alguno está mal, apúntalo en el fichero de excepciones (original → nombre bueno): ver nombres-excepciones.ejemplo.json");
