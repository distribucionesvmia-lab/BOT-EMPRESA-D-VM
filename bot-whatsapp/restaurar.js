// Restaurar las bases de datos desde las copias de seguridad diarias (carpeta «respaldos»).
//   Ver qué hay (no toca nada):           node restaurar.js --ver
//   Restaurar la copia más reciente:      node restaurar.js --restaurar            (con el programa PARADO)
//   Una copia concreta (por fecha):       node restaurar.js --restaurar --fecha 20261110
// Antes de sustituir nada se COMPRUEBA cada copia (que se abre, que no está dañada y cuántos datos tiene) y se guarda una copia de lo que hay ahora
// en «antes-de-restaurar-<fecha>»: así restaurar nunca pierde nada. Si una copia está dañada, no se toca esa base.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BASES = ["pedidos", "cuentas", "clientes", "catalogo"];
const TABLAS_CLAVE = { pedidos: ["orders", "order_lines"], cuentas: ["accounts", "registrations"], clientes: ["customers", "purchases"], catalogo: ["products", "product_changes"] };

/** Rutas de las bases en uso (las mismas variables de entorno que usa el programa). */
export const destinosDeEntorno = (env = process.env) => ({
  pedidos: env.DB_PATH ?? "pedidos.sqlite", cuentas: env.ACCOUNTS_DB ?? "cuentas.sqlite", clientes: env.CUSTOMERS_DB ?? "clientes.sqlite", catalogo: env.CATALOG_DB ?? "catalogo.sqlite",
});

/** Copias disponibles por base: { pedidos: [{ archivo, fecha: "20261110-0300", ruta }], … } de la más reciente a la más antigua. */
export function listarCopias(dir) {
  const out = Object.fromEntries(BASES.map((b) => [b, []]));
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = /^(pedidos|cuentas|clientes|catalogo)-(\d{8}-\d{4})\.sqlite$/.exec(f);
    if (m) out[m[1]].push({ archivo: f, fecha: m[2], ruta: path.join(dir, f) });
  }
  for (const b of BASES) out[b].sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
  return out;
}

/** Comprueba una copia: la abre en solo lectura, pasa la comprobación de integridad de SQLite y cuenta los datos de sus tablas principales. */
export function verificarCopia(ruta, base) {
  let db;
  try {
    db = new DatabaseSync(ruta, { readOnly: true });
    const integridad = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integridad !== "ok") return { ok: false, motivo: `la base está dañada (${integridad})` };
    const existentes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const datos = {};
    for (const t of TABLAS_CLAVE[base] ?? []) {
      if (!existentes.has(t)) return { ok: false, motivo: `falta la tabla «${t}»: no parece una copia de ${base}` };
      datos[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    }
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, motivo: `no se puede abrir (${e.message})` };
  } finally {
    try { db?.close(); } catch { /* ya cerrada */ }
  }
}

/**
 * Restaura. desde: carpeta de copias · destinos: { pedidos: ruta, … } · fecha: «20261110» (o «20261110-0300») para una copia concreta; si no, la más reciente.
 * solo: lista de bases a restaurar (por defecto todas) · simular: solo comprueba y cuenta. Devuelve { bases: { nombre: { estado, … } }, carpetaAntes }.
 */
export function restaurar({ desde, destinos, fecha = null, solo = BASES, simular = false, ahora = new Date() }) {
  const copias = listarCopias(desde), res = { bases: {}, carpetaAntes: null };
  const elegidas = {};
  for (const b of solo) {
    const c = fecha ? copias[b].find((x) => x.fecha.startsWith(fecha)) : copias[b][0];
    if (!c) { res.bases[b] = { estado: "sin copia", detalle: fecha ? `no hay copia de ${b} del ${fecha}` : `no hay ninguna copia de ${b}` }; continue; }
    const v = verificarCopia(c.ruta, b);
    if (!v.ok) { res.bases[b] = { estado: "copia dañada", archivo: c.archivo, detalle: v.motivo }; continue; }
    elegidas[b] = c;
    res.bases[b] = { estado: simular ? "se podría restaurar" : "pendiente", archivo: c.archivo, fecha: c.fecha, datos: v.datos };
  }
  if (simular || !Object.keys(elegidas).length) return res;
  // 1) guardar lo que hay ahora (con sus ficheros auxiliares), 2) sustituir
  const stamp = ahora.toISOString().replace(/[:.]/g, "-");
  res.carpetaAntes = path.join(path.dirname(path.resolve(destinos[Object.keys(elegidas)[0]])), `antes-de-restaurar-${stamp}`);
  fs.mkdirSync(res.carpetaAntes, { recursive: true });
  for (const [b, c] of Object.entries(elegidas)) {
    const dest = destinos[b];
    for (const suf of ["", "-wal", "-shm"]) if (fs.existsSync(dest + suf)) fs.copyFileSync(dest + suf, path.join(res.carpetaAntes, path.basename(dest) + suf));
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    const tmp = dest + ".restaurando";
    fs.copyFileSync(c.ruta, tmp);
    const v2 = verificarCopia(tmp, b); // se vuelve a comprobar la copia ya copiada
    if (!v2.ok) { fs.rmSync(tmp, { force: true }); res.bases[b] = { estado: "error al copiar", detalle: v2.motivo }; continue; }
    for (const suf of ["-wal", "-shm"]) fs.rmSync(dest + suf, { force: true }); // los restos de la base anterior no deben mezclarse con la restaurada
    fs.renameSync(tmp, dest);
    res.bases[b] = { ...res.bases[b], estado: "restaurada" };
  }
  return res;
}

function main() {
  const a = process.argv.slice(2), opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const desde = opt("--desde") ?? process.env.BACKUP_DIR ?? "respaldos";
  if (!a.includes("--ver") && !a.includes("--restaurar")) { console.error("Uso: node restaurar.js --ver | --restaurar [--fecha AAAAMMDD] [--desde carpeta] [--solo pedidos,clientes]"); process.exit(1); }
  const solo = opt("--solo")?.split(",") ?? BASES;
  const r = restaurar({ desde, destinos: destinosDeEntorno(), fecha: opt("--fecha") ?? null, solo, simular: a.includes("--ver") });
  for (const [b, x] of Object.entries(r.bases)) console.log(`${b.padEnd(9)} ${x.estado}${x.archivo ? ` · ${x.archivo}` : ""}${x.datos ? " · " + Object.entries(x.datos).map(([t, n]) => `${n} ${t}`).join(", ") : ""}${x.detalle ? " · " + x.detalle : ""}`);
  if (r.carpetaAntes) console.log(`\nLo que había antes está guardado en: ${r.carpetaAntes}`);
  if (a.includes("--ver")) console.log("\nNo se ha cambiado nada. Para restaurar (con el programa parado): node restaurar.js --restaurar");
  else if (Object.values(r.bases).some((x) => x.estado !== "restaurada")) process.exitCode = 2;
}
if (process.argv[1]?.endsWith("restaurar.js")) main();
