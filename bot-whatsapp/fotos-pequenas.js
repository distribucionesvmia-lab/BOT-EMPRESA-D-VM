// Informe de fotos pequeñas (SOLO LECTURA: no cambia ni borra ninguna foto).
// Uso:  node fotos-pequenas.js [carpeta-de-fotos] [catalogo.sqlite] [salida.csv]
// Lista los artículos cuya foto mide 200 px o menos de lado (se ven borrosas): código, nombre, categoría y tamaño. Los datos no salen del ordenador.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { categorizar } from "./categorias.js";

/** Tamaño (ancho, alto) leyendo solo la cabecera del PNG, JPEG o WEBP; null si no se reconoce. */
export function tamanoImagen(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const t = buf.toString("ascii", 12, 16);
    if (t === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (t === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

const csv = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
export function informe(carpeta, filas, { limite = 200 } = {}) {
  const porId = new Map(filas.map((p) => [String(p.id), p]));
  const out = [];
  for (const f of fs.readdirSync(carpeta)) {
    const m = /^([\w.-]{1,40})\.(png|jpe?g|webp)$/i.exec(f); if (!m) continue;
    const t = tamanoImagen(fs.readFileSync(path.join(carpeta, f)));
    if (!t || Math.max(t.w, t.h) > limite) continue;
    const p = porId.get(m[1]); const k = p ? categorizar(p) : null;
    out.push({ codigo: m[1], nombre: p?.name ?? "(sin artículo)", categoria: k ? `${k.catNombre} › ${k.subNombre}` : "", tamano: `${t.w}x${t.h}` });
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const carpeta = process.argv[2] ?? process.env.IMG_DIR ?? "imagenes", dbRuta = process.argv[3] ?? process.env.CATALOG_DB ?? "catalogo.sqlite", salida = process.argv[4] ?? "fotos-pequenas.csv";
  if (!fs.existsSync(carpeta)) { console.error(`No existe la carpeta de fotos ${carpeta}.`); process.exit(1); }
  const filas = fs.existsSync(dbRuta) ? new DatabaseSync(dbRuta, { readOnly: true }).prepare("SELECT id, name, category, subcategory FROM products").all() : [];
  const lista = informe(carpeta, filas);
  fs.writeFileSync(salida, "﻿" + ["Código;Nombre;Categoría;Tamaño", ...lista.map((r) => [r.codigo, r.nombre, r.categoria, r.tamano].map(csv).join(";"))].join("\r\n"));
  console.log(`Fotos de 200 px o menos: ${lista.length}. Guardado en ${salida} (no se ha cambiado ninguna foto).`);
}
