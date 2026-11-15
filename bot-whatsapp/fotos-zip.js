// Fotos desde un ZIP, desde el panel: se sube el zip, se ENSEÑA qué foto iría a qué artículo y solo se cambia lo que la persona confirma.
// Misma lógica que importar-fotos.js (emparejar por nombre, solo lo claro, la anterior se archiva en «anteriores»).
import crypto from "node:crypto";
import { unzip } from "./xlsx-read.js";
import { tamanoImagen } from "./fotos-pequenas.js";
import { emparejar } from "./fotos-emparejar.js";
import { MAX_BYTES } from "./fotos-articulos.js";

const TIPO = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
export const MAX_ZIP = 80_000_000, MAX_FOTOS = 2000, MAX_DESCOMPRIMIDO = 300_000_000;
const lado = (d) => Math.max(d.w, d.h);

export function crearImportadorZip({ catalogDb, fotos, ahora = () => Date.now() }) {
  const pendientes = new Map(); // token → { en, parejas: Map(id → { buf, ext, nombre, clave }) }
  const limpiar = () => { for (const [t, v] of pendientes) if (ahora() - v.en > 30 * 60_000) pendientes.delete(t); while (pendientes.size > 3) pendientes.delete(pendientes.keys().next().value); };

  /** Lee el zip y devuelve la vista previa (no cambia ninguna foto). */
  function vista(zipBuf) {
    limpiar();
    let ficheros; try { ficheros = unzip(zipBuf, (n) => /\.(webp|png|jpe?g)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n) && !/\/\._/.test(n) && !/(^|\/)anteriores\//i.test(n)); } catch { return { error: "No se ha podido leer el archivo: tiene que ser un .zip con las fotos dentro." }; }
    const claves = Object.keys(ficheros); if (!claves.length) return { error: "El zip no tiene ninguna foto (JPG, PNG o WebP)." };
    if (claves.length > MAX_FOTOS) return { error: `El zip tiene demasiadas fotos (máximo ${MAX_FOTOS}).` };
    if (claves.reduce((s, k) => s + ficheros[k].length, 0) > MAX_DESCOMPRIMIDO) return { error: "Las fotos del zip pesan demasiado en total." };
    const lista = [], ignoradas = [];
    for (const clave of claves) {
      const buf = ficheros[clave], ext = clave.split(".").pop().toLowerCase(), d = tamanoImagen(buf);
      const real = buf[0] === 0xff ? "jpg" : buf[0] === 0x89 ? "png" : buf.toString("ascii", 0, 4) === "RIFF" ? "webp" : null;
      if (!d || !real || (real !== (ext === "jpeg" ? "jpg" : ext)) || buf.length > MAX_BYTES || lado(d) < 50) { ignoradas.push({ clave, motivo: !d || !real ? "no es una foto" : buf.length > MAX_BYTES ? "pesa más de 6 MB" : lado(d) < 50 ? "demasiado pequeña" : "su tipo no coincide con su nombre" }); continue; }
      lista.push({ clave, nombre: clave.split("/").pop().replace(/\.[^.]+$/, ""), buf, ext, dims: d });
    }
    const arts = catalogDb.list({ activeOnly: false }).map((x) => ({ id: String(x.id), name: x.name }));
    const { parejas, dudosas, sin } = emparejar(lista, arts);
    const guardadas = new Map(), filas = parejas.map((p) => {
      const act = fotos.info(p.id), nuevo = p.foto.dims;
      const estado = !act.existe ? "nueva" : !act.w || lado(nuevo) > lado(act) ? "mejor" : "ya_mejor";
      guardadas.set(p.id, { buf: p.foto.buf, ext: p.foto.ext, clave: p.foto.clave });
      return { id: p.id, articulo: p.nombre, foto: p.foto.clave, nuevo: `${nuevo.w}×${nuevo.h}`, actual: act.w ? `${act.w}×${act.h}` : null, estado };
    });
    const token = crypto.randomBytes(16).toString("hex"); pendientes.set(token, { en: ahora(), parejas: guardadas });
    return { token, total: lista.length, ignoradas, filas, dudosas: dudosas.map((d) => ({ foto: d.foto.clave, candidatos: d.candidatos.map((c) => `${c.id} · ${c.nombre}`) })), sin: sin.map((s) => s.clave) };
  }

  /** Pone las fotos elegidas. ids = códigos marcados; forzar = también cambia las que ya tienen una foto igual o más grande. */
  function aplicar(token, ids, { forzar = false } = {}) {
    limpiar(); const p = pendientes.get(token); if (!p) return { error: "La revisión ha caducado: sube el zip otra vez." };
    const hechas = [], saltadas = [];
    for (const id of new Set((ids ?? []).map(String))) {
      const f = p.parejas.get(id); if (!f) continue;
      if (!catalogDb.get(id)) { saltadas.push({ id, motivo: "ya no existe ese artículo" }); continue; }
      const act = fotos.info(id), d = tamanoImagen(f.buf);
      if (!forzar && act.existe && act.w && lado(d) <= lado(act)) { saltadas.push({ id, motivo: "ya tiene una foto igual o más grande" }); continue; }
      const r = fotos.guardar(id, f.buf, TIPO[f.ext], new Date(ahora())); r.error ? saltadas.push({ id, motivo: r.error }) : hechas.push(id);
    }
    pendientes.delete(token);
    return { ok: true, hechas: hechas.length, saltadas };
  }
  return { vista, aplicar };
}
