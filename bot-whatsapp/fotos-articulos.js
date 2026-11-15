// Fotos de los artículos desde el panel: ver qué tamaño tiene cada una (las pequeñas se ven borrosas) y cambiar una por otra mejor.
// Las fotos son ficheros «<código>.jpg|png|webp» en la carpeta IMG_DIR. La anterior NUNCA se borra: pasa a la subcarpeta «anteriores».
import fs from "node:fs";
import path from "node:path";
import { tamanoImagen } from "./fotos-pequenas.js";

export const PEQUENA = 300;   // lado mayor por debajo del cual la foto se ve borrosa
export const BUENA = 600;     // a partir de aquí se ve bien incluso en un móvil de pantalla grande
export const MAX_BYTES = 6_000_000;
const TIPOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const calidad = (d) => { const m = Math.max(d.w, d.h); return m < PEQUENA ? "pequena" : m < BUENA ? "justa" : "buena"; };

export function crearFotos(imgDir) {
  let indice = new Map(), en = 0; const dims = new Map();
  const lista = () => {
    if (Date.now() - en > 15_000) { en = Date.now(); try { indice = new Map(fs.readdirSync(imgDir).map((f) => /^([\w.-]{1,40})\.(png|jpe?g|webp)$/i.exec(f)).filter(Boolean).map((m) => [m[1], m[0]])); } catch { indice = new Map(); } }
    return indice;
  };
  const leerDims = (file) => {
    const ruta = path.join(imgDir, file); let st; try { st = fs.statSync(ruta); } catch { return null; }
    const k = `${file}:${st.mtimeMs}:${st.size}`, c = dims.get(k); if (c !== undefined) return c;
    let d = null; try { const fd = fs.openSync(ruta, "r"); try { const b = Buffer.alloc(Math.min(st.size, 131072)); fs.readSync(fd, b, 0, b.length, 0); d = tamanoImagen(b); } finally { fs.closeSync(fd); } } catch { /* ilegible */ }
    if (dims.size > 20000) dims.clear(); dims.set(k, d); return d;
  };
  /** { existe, w, h, calidad: "pequena" | "justa" | "buena" | null } */
  const info = (id) => {
    if (!imgDir) return { existe: false, calidad: null };
    const file = lista().get(String(id)); if (!file) return { existe: false, calidad: null };
    const d = leerDims(file); return d ? { existe: true, w: d.w, h: d.h, calidad: calidad(d) } : { existe: true, calidad: null };
  };
  /** Guarda una foto nueva para el artículo. Devuelve { ok, w, h, calidad } o { error }. */
  const guardar = (id, buf, contentType, ahora = new Date()) => {
    if (!imgDir) return { error: "Este programa no tiene carpeta de fotos configurada (IMG_DIR)." };
    if (!/^[\w.-]{1,40}$/.test(String(id))) return { error: "Artículo no válido." };
    if (!buf?.length) return { error: "No ha llegado ninguna foto." };
    if (buf.length > MAX_BYTES) return { error: `La foto pesa demasiado (máximo ${MAX_BYTES / 1_000_000} MB).` };
    const ext = TIPOS[String(contentType ?? "").split(";")[0].trim().toLowerCase()];
    const d = tamanoImagen(buf); if (!ext || !d) return { error: "Tiene que ser una foto JPG, PNG o WebP." };
    // que el contenido corresponda a lo que dice ser (nada de colar otro tipo de archivo con la extensión de una foto)
    const real = buf[0] === 0xff ? "jpg" : buf[0] === 0x89 ? "png" : buf.toString("ascii", 0, 4) === "RIFF" ? "webp" : null; if (real !== ext) return { error: "El archivo no es del tipo que dice ser." };
    if (Math.max(d.w, d.h) < 50) return { error: "La foto es demasiado pequeña (menos de 50 píxeles)." };
    fs.mkdirSync(imgDir, { recursive: true });
    const sello = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, (c) => (c === "T" ? "-" : "")); // 20261115-1530
    for (const f of fs.readdirSync(imgDir)) { const m = /^([\w.-]{1,40})\.(png|jpe?g|webp)$/i.exec(f); if (m && m[1] === String(id)) { fs.mkdirSync(path.join(imgDir, "anteriores"), { recursive: true }); fs.renameSync(path.join(imgDir, f), path.join(imgDir, "anteriores", `${id}-${sello}.${m[2].toLowerCase()}`)); } }
    fs.writeFileSync(path.join(imgDir, `${id}.${ext}`), buf); en = 0;
    return { ok: true, w: d.w, h: d.h, calidad: calidad(d) };
  };
  return { info, guardar, lista };
}
