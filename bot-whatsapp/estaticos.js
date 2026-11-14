// Saca el CSS, el JavaScript y el logo (base64) de una página HTML a ficheros estáticos con la huella en la ruta
// (/estatico/<huella>/<nombre>), para que el navegador los guarde mucho tiempo (max-age largo, immutable) y el HTML,
// que sigue siendo «no-store», pese solo unos pocos KB. Los ficheros fuente (pedido.html, cliente.html) NO cambian:
// esto se hace al servirlos, y si cambia una sola letra sale otra huella (y por tanto otra ruta).
import crypto from "node:crypto";

const huella = (x) => crypto.createHash("sha256").update(x).digest("hex").slice(0, 12);
const REGISTRO = new Map(); // ruta → { tipo, cuerpo }
const PAGINAS = new Map(); // huella del HTML original → HTML ya empaquetado
const MIN_JS = 800; // los scripts pequeños (como el de la letra) se quedan en la página: un fichero más costaría más que lo que ahorra

const registra = (nombre, tipo, cuerpo) => {
  const buf = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, "utf8");
  const ruta = `/estatico/${huella(buf)}/${nombre}`;
  REGISTRO.set(ruta, { tipo, cuerpo: buf });
  return ruta;
};

/** Devuelve el HTML con sus <style>, <script> grandes y el logo sacados a ficheros estáticos. `nombre`: prefijo de los ficheros (p. ej. «pedido»). */
export function empaquetar(html, nombre) {
  const k = nombre + ":" + huella(html);
  const hecho = PAGINAS.get(k);
  if (hecho) return hecho;
  let out = String(html);
  // 1. Logo y demás imágenes en base64: un fichero por imagen (el mismo para todas las veces que sale)
  const imgs = new Map();
  out = out.replace(/data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]{400,})/g, (m, ext, b64) => {
    if (!imgs.has(m)) imgs.set(m, registra(`${nombre}-imagen.${ext === "jpeg" ? "jpg" : ext}`, `image/${ext}`, Buffer.from(b64, "base64")));
    return imgs.get(m);
  });
  // 2. Hojas de estilo y scripts en línea (sin atributos)
  let n = 0;
  out = out.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => `<link rel="stylesheet" href="${registra(`${nombre}${++n > 1 ? "-" + n : ""}.css`, "text/css; charset=utf-8", css)}">`);
  n = 0;
  out = out.replace(/<script>([\s\S]*?)<\/script>/g, (m, js) => (js.length < MIN_JS ? m : `<script src="${registra(`${nombre}-${++n}.js`, "text/javascript; charset=utf-8", js)}"></script>`));
  PAGINAS.set(k, out);
  if (PAGINAS.size > 20) PAGINAS.delete(PAGINAS.keys().next().value); // la web cambia poco: no hace falta guardar más
  return out;
}

/** Fichero estático empaquetado (o null si esa ruta no existe: p. ej. versión vieja de la página). */
export const estatico = (ruta) => REGISTRO.get(ruta) ?? null;
