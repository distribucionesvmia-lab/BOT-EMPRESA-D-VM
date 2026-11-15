// Pone fotos nuevas (p. ej. las de la web) a los artículos, emparejándolas por NOMBRE (las fotos no traen el código de a3ERP).
//   Ver qué pasaría (no cambia nada):  node importar-fotos.js <carpeta con las fotos> [--catalogo catalogo.sqlite] [--imagenes carpeta-de-fotos-del-programa]
//   Hacerlo:                           node importar-fotos.js <carpeta> --aplicar
// Reglas: solo se emparejan las fotos CLARAS (si hay duda, queda en el informe para revisarla a mano en el panel → Artículos → «Cambiar foto»);
// una foto solo sustituye a la actual si es MÁS GRANDE (nunca empeora una); la foto anterior NO se borra: pasa a «anteriores». Lee y escribe solo fotos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { tamanoImagen } from "./fotos-pequenas.js";
import { crearFotos } from "./fotos-articulos.js";
import { emparejar } from "./fotos-emparejar.js";

const TIPO = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
const csv = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;

export function buscarFotos(carpeta) {
  const out = [];
  const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = path.join(d, e.name); if (e.isDirectory()) rec(r); else if (/\.(webp|png|jpe?g)$/i.test(e.name)) out.push({ ruta: r, clave: path.relative(carpeta, r), nombre: e.name.replace(/\.[^.]+$/, "") }); } };
  rec(carpeta); return out;
}

/** Hace (o simula) la importación. Devuelve { filas, resumen }. */
export function importar({ carpeta, articulos, imgDir, aplicar = false, ahora = new Date() }) {
  const fotos = buscarFotos(carpeta), { parejas, dudosas, sin } = emparejar(fotos, articulos);
  const fx = crearFotos(imgDir), filas = [];
  const resumen = { cambiadas: 0, nuevas: 0, yaMejores: 0, dudosas: dudosas.length, sin: sin.length, ilegibles: 0 };
  for (const p of parejas) {
    const buf = fs.readFileSync(p.foto.ruta), nuevo = tamanoImagen(buf), ext = path.extname(p.foto.ruta).slice(1).toLowerCase();
    if (!nuevo) { resumen.ilegibles++; filas.push({ estado: "ilegible", foto: p.foto.clave, id: p.id, nombre: p.nombre }); continue; }
    const act = fx.info(p.id), lado = (d) => Math.max(d.w, d.h);
    const mejor = !act.existe || !act.w || lado(nuevo) > lado(act);
    const fila = { estado: !act.existe ? "foto nueva" : mejor ? "foto mejor" : "ya tiene una mejor o igual", foto: p.foto.clave, id: p.id, nombre: p.nombre, nuevo: `${nuevo.w}x${nuevo.h}`, actual: act.w ? `${act.w}x${act.h}` : "" };
    if (!mejor) resumen.yaMejores++; else { act.existe ? resumen.cambiadas++ : resumen.nuevas++; if (aplicar) { const r = fx.guardar(p.id, buf, TIPO[ext], ahora); if (r.error) { fila.estado = "error: " + r.error; } } }
    filas.push(fila);
  }
  for (const d of dudosas) filas.push({ estado: "dudosa (revisar a mano)", foto: d.foto.clave, nombre: d.candidatos.map((c) => `${c.id} ${c.nombre}`).join(" | ") });
  for (const s of sin) filas.push({ estado: "sin artículo parecido", foto: s.clave });
  return { filas, resumen };
}

export const informeCsv = (filas) => "﻿" + ["estado;foto;codigo;articulo;tamano_nuevo;tamano_actual", ...filas.map((f) => [f.estado, f.foto, f.id ?? "", f.nombre ?? "", f.nuevo ?? "", f.actual ?? ""].map(csv).join(";"))].join("\r\n");

function leerCatalogo(ruta) { const db = new DatabaseSync(ruta, { readOnly: true }); try { return db.prepare("SELECT id, name FROM products").all().map((r) => ({ id: String(r.id), name: r.name })); } finally { db.close(); } }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const carpeta = a.find((x, i) => !x.startsWith("--") && !["--catalogo", "--imagenes", "--informe"].includes(a[i - 1]));
  if (!carpeta || !fs.existsSync(carpeta)) { console.error("Uso: node importar-fotos.js <carpeta con las fotos> [--catalogo catalogo.sqlite] [--imagenes carpeta] [--aplicar]"); process.exit(1); }
  const cat = val("--catalogo") ?? process.env.CATALOG_DB ?? "catalogo.sqlite", imgDir = val("--imagenes") ?? process.env.IMG_DIR ?? fileURLToPath(new URL("./imagenes/", import.meta.url));
  const aplicar = a.includes("--aplicar"), { filas, resumen } = importar({ carpeta, articulos: leerCatalogo(cat), imgDir, aplicar });
  const informe = val("--informe") ?? "importar-fotos-informe.csv"; fs.writeFileSync(informe, informeCsv(filas));
  console.log(`${aplicar ? "HECHO" : "SIMULACIÓN (no se ha cambiado nada)"}:\n  fotos nuevas: ${resumen.nuevas}\n  fotos sustituidas por una más grande: ${resumen.cambiadas}\n  ya tenían una igual o mejor: ${resumen.yaMejores}\n  dudosas (a mano): ${resumen.dudosas}\n  sin artículo parecido: ${resumen.sin}\nInforme: ${informe}`);
  if (!aplicar) console.log("Para hacerlo de verdad, repite el comando añadiendo --aplicar");
}
