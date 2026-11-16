// «¿De qué país viene esta conexión?» SIN servicios externos: el programa lleva una lista pública de los rangos de direcciones IP de España (carpeta `geo/`,
// se renueva con `actualizar-geo.js`). Solo distingue «España», «fuera de España» y «red interna» (oficina, Tailscale…); no sabe de qué país es cada cual.
// Es una ayuda, no una garantía: una VPN o un móvil con itinerancia pueden aparecer en otro país. Por eso no se bloquea: se piden más pasos (ver auth.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = () => process.env.GEO_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "geo");

function v4Entero(s) {
  const p = String(s).split("."); if (p.length !== 4) return null;
  let n = 0; for (const x of p) { if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null; n = n * 256 + Number(x); }
  return n;
}
function v6Big(s) {
  let t = String(s).toLowerCase(); const zona = t.indexOf("%"); if (zona >= 0) t = t.slice(0, zona);
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(t); // ::ffff:1.2.3.4
  if (m) { const v = v4Entero(m[2]); if (v === null) return null; t = m[1] + Math.floor(v / 65536).toString(16) + ":" + (v % 65536).toString(16); }
  const dos = t.split("::"); if (dos.length > 2) return null;
  const parte = (x) => (x === "" ? [] : x.split(":"));
  const a = parte(dos[0]), b = dos.length === 2 ? parte(dos[1]) : [];
  const hueco = 8 - a.length - b.length; if ((dos.length === 1 && a.length !== 8) || hueco < 0) return null;
  const grupos = dos.length === 2 ? [...a, ...Array(hueco).fill("0"), ...b] : a;
  let n = 0n; for (const g of grupos) { if (!/^[0-9a-f]{1,4}$/.test(g)) return null; n = (n << 16n) | BigInt(parseInt(g, 16)); }
  return n;
}
/** Lista de «a.b.c.d/n» (una por línea; «#» comenta) → rangos ordenados [inicio, fin]. */
function leerLista(texto, v6) {
  const out = [];
  for (const linea of String(texto).split(/\r?\n/)) {
    const l = linea.trim(); if (!l || l.startsWith("#")) continue;
    const [ip, bitsT] = l.split("/"), bits = Number(bitsT);
    if (v6) { const base = v6Big(ip); if (base === null || !(bits >= 0 && bits <= 128)) continue; const host = 128n - BigInt(bits), ini = (base >> host) << host; out.push([ini, ini + (1n << host) - 1n]); }
    else { const base = v4Entero(ip); if (base === null || !(bits >= 0 && bits <= 32)) continue; const tam = 2 ** (32 - bits), ini = Math.floor(base / tam) * tam; out.push([ini, ini + tam - 1]); }
  }
  return out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}
const dentro = (rangos, n) => { let lo = 0, hi = rangos.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rangos[m][0] > n) hi = m - 1; else if (rangos[m][1] < n) lo = m + 1; else return true; } return false; };

// Redes que NO cuentan como «fuera»: la propia máquina, la oficina, Tailscale (100.64.0.0/10), enlaces locales…
const INTERNAS_V4 = leerLista("10.0.0.0/8\n127.0.0.0/8\n169.254.0.0/16\n172.16.0.0/12\n192.168.0.0/16\n100.64.0.0/10\n0.0.0.0/8", false);
const INTERNAS_V6 = leerLista("::1/128\nfc00::/7\nfe80::/10", true);

/** Crea un clasificador con las dos listas (texto). */
export function crearGeo(texto4, texto6, { fecha = null } = {}) {
  const r4 = leerLista(texto4, false), r6 = leerLista(texto6 ?? "", true);
  return {
    fecha, rangos: r4.length + r6.length,
    /** "local" (red interna) | "ES" | "fuera" | "sin-dato" (no es una dirección válida) */
    clase(ip) {
      let s = String(ip ?? "").trim(); if (!s || s === "?") return "sin-dato";
      const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s); if (mapeada) s = mapeada[1];
      if (s.includes(":")) { const n = v6Big(s); if (n === null) return "sin-dato"; if (dentro(INTERNAS_V6, n)) return "local"; return dentro(r6, n) ? "ES" : "fuera"; }
      const n = v4Entero(s); if (n === null) return "sin-dato";
      if (dentro(INTERNAS_V4, n)) return "local";
      return dentro(r4, n) ? "ES" : "fuera";
    },
  };
}

// ── Lista del programa (carpeta geo/), recargada si el archivo cambia (se mira como mucho cada 10 minutos) ──
let actual = null, miradoEn = 0, firma = "";
export function geoPrograma(ahora = Date.now()) {
  if (miradoEn && ahora - miradoEn < 600_000) return actual;
  miradoEn = ahora;
  try {
    const f4 = path.join(DIR(), "es-ipv4.txt"), f6 = path.join(DIR(), "es-ipv6.txt"), st = fs.statSync(f4), nueva = `${st.mtimeMs}|${st.size}`;
    if (nueva !== firma || !actual) {
      const t4 = fs.readFileSync(f4, "utf8"), t6 = fs.existsSync(f6) ? fs.readFileSync(f6, "utf8") : "";
      const g = crearGeo(t4, t6, { fecha: /descargado (\d{4}-\d{2}-\d{2})/i.exec(t4.split("\n")[0])?.[1] ?? st.mtime.toISOString().slice(0, 10) });
      actual = g.rangos > 500 ? g : null; firma = nueva; // una lista casi vacía no se usa: sería bloquear a todo el mundo
    }
  } catch { actual = null; }
  return actual;
}
/** Solo para pruebas: olvida la lista cargada. */
export function reiniciarGeo() { actual = null; miradoEn = 0; firma = ""; for (const k of Object.keys(cuenta)) cuenta[k] = 0; }
/** Modo del filtro: GEO_MODO = off | vigilar | aprobar (por defecto «aprobar» si hay lista; sin lista, off). */
export function modoGeo() {
  const m = String(process.env.GEO_MODO ?? "aprobar").toLowerCase();
  if (m === "off" || !geoPrograma()) return "off";
  return m === "vigilar" ? "vigilar" : "aprobar";
}
// Contadores desde que arrancó el programa (sin direcciones): sirven para saber si el programa de verdad ve la dirección real de los clientes
const cuenta = { ES: 0, fuera: 0, local: 0, "sin-dato": 0 };
export function claseDe(ip) { const g = geoPrograma(); const c = g ? g.clase(ip) : "sin-dato"; cuenta[c]++; return c; }
export function resumenGeo() { const g = geoPrograma(); return { modo: modoGeo(), lista: !!g, fecha: g?.fecha ?? null, rangos: g?.rangos ?? 0, es: cuenta.ES, fuera: cuenta.fuera, local: cuenta.local, sinDato: cuenta["sin-dato"] }; }
