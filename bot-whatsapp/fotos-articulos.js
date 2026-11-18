// Fotos de los artículos desde el panel: ver qué tamaño tiene cada una (las pequeñas se ven borrosas) y cambiar una por otra mejor.
// Las fotos son ficheros «<código>.jpg|png|webp» en la carpeta IMG_DIR. La anterior NUNCA se borra: pasa a la subcarpeta «anteriores».
import fs from "node:fs";
import path from "node:path";
import { tamanoImagen } from "./fotos-pequenas.js";

export const PEQUENA = 300;   // lado mayor por debajo del cual la foto se ve borrosa
export const BUENA = 600;     // a partir de aquí se ve bien incluso en un móvil de pantalla grande
export const MAX_BYTES = 6_000_000;
export const LADO_MINI = 480;   // lado mayor máximo de una miniatura (la baldosa de la lista mide 96 px en el móvil: 480 px llega a pantallas de 5×)
export const MAX_MINI = 300_000;  // peso máximo de una miniatura
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
    try { fs.rmSync(path.join(imgDir, "mini", `${id}.jpg`), { force: true }); } catch { /* es una copia derivada: se prepara otra con la foto nueva */ }
    return { ok: true, w: d.w, h: d.h, calidad: calidad(d) };
  };
  // ── Miniaturas para el móvil: «mini/<código>.jpg» (lado mayor ≤ 400 px, JPG). Son COPIAS derivadas de la foto: las prepara el navegador del panel (Node no trae nada para reducir imágenes) y las usan las listas; la foto grande sigue en la ficha y en el zoom. ──
  const miniDir = imgDir ? path.join(imgDir, "mini") : null;
  const rutaOriginal = (id) => { const f = imgDir ? lista().get(String(id)) : null; return f ? path.join(imgDir, f) : null; };
  const rutaMini = (id) => { const r = miniDir && /^[\w.-]{1,40}$/.test(String(id)) ? path.join(miniDir, `${id}.jpg`) : null; try { return r && fs.statSync(r).isFile() ? r : null; } catch { return null; } };
  /** Guarda la miniatura de un artículo que tiene foto. */
  const guardarMini = (id, buf) => {
    if (!imgDir) return { error: "Este programa no tiene carpeta de fotos configurada (IMG_DIR)." };
    if (!/^[\w.-]{1,40}$/.test(String(id))) return { error: "Artículo no válido." };
    if (!rutaOriginal(id)) return { error: "Ese artículo no tiene foto." };
    if (!buf?.length || buf.length > MAX_MINI) return { error: `La miniatura no es válida (máximo ${MAX_MINI / 1000} KB).` };
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return { error: "La miniatura tiene que ser un JPG." };
    const d = tamanoImagen(buf); if (!d || Math.max(d.w, d.h) < 20 || Math.max(d.w, d.h) > LADO_MINI) return { error: `La miniatura mide ${d ? d.w + "×" + d.h : "algo raro"}: el lado mayor tiene que estar entre 20 y ${LADO_MINI} px.` };
    fs.mkdirSync(miniDir, { recursive: true }); fs.writeFileSync(path.join(miniDir, `${id}.jpg`), buf);
    return { ok: true, w: d.w, h: d.h, bytes: buf.length };
  };
  /** { total (con foto), conMini, pendientes: [código…] }: pendiente = tiene foto y no tiene miniatura o la miniatura es anterior a la foto. */
  const estadoMinis = () => {
    const pendientes = []; let total = 0, conMini = 0;
    for (const [id, file] of lista()) {
      total++; let o = null, m = null;
      try { o = fs.statSync(path.join(imgDir, file)).mtimeMs; } catch { continue; }
      try { m = fs.statSync(path.join(miniDir, `${id}.jpg`)).mtimeMs; } catch { /* sin miniatura */ }
      if (m != null && m >= o - 1) conMini++; else pendientes.push(id);
    }
    return { total, conMini, pendientes };
  };
  return { info, guardar, lista, guardarMini, rutaMini, rutaOriginal, estadoMinis };
}
