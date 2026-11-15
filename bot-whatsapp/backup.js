// Copias de seguridad de las bases de datos (SQLite): pedidos, cuentas, clientes y catálogo.
import fs from "node:fs";
import path from "node:path";
import { madrid } from "./export-format.js";

/** Guarda una copia fechada en `dir` y conserva solo las `keep` más recientes. Devuelve la ruta de la copia. */
export function backupDb(db, { dir = process.env.BACKUP_DIR ?? "respaldos", keep = 14, now = new Date(), name = "pedidos" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = madrid(now.toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
  const file = path.join(dir, `${name}-${stamp}.sqlite`);
  fs.rmSync(file, { force: true }); // varias en el mismo minuto: la última sustituye a la anterior
  db.backupTo(file);
  const old = fs.readdirSync(dir).filter((f) => new RegExp(`^${name}-\\d{8}-\\d{4}\\.sqlite$`).test(f)).sort().slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

/** Copia de todas las bases a la vez: { pedidos, cuentas, clientes, catalogo } (cada una con su backupTo). Una que falle no impide las demás. */
export function backupAll(dbs, opts = {}) {
  const out = {}, errors = {};
  for (const [name, db] of Object.entries(dbs)) {
    try { out[name] = backupDb(db, { ...opts, name }); } catch (e) { errors[name] = e.message; }
  }
  return { files: out, errors };
}

/** Copia las copias recién hechas a una SEGUNDA carpeta (un disco USB, OneDrive, Drive…) y conserva solo las `keep` más recientes de cada base. Si el disco principal se cifra o se rompe, esta sigue ahí. */
export function copiarASegundaCarpeta(files, dir2, { keep = 14 } = {}) {
  const copiados = [], errores = {};
  if (!dir2) return { copiados, errores };
  try { fs.mkdirSync(dir2, { recursive: true }); } catch (e) { return { copiados, errores: { carpeta: e.message } }; }
  for (const [name, f] of Object.entries(files)) {
    try {
      fs.copyFileSync(f, path.join(dir2, path.basename(f))); copiados.push(path.basename(f));
      const old = fs.readdirSync(dir2).filter((x) => new RegExp(`^${name}-\\d{8}-\\d{4}\\.sqlite$`).test(x)).sort().slice(0, -keep);
      for (const x of old) fs.rmSync(path.join(dir2, x), { force: true });
    } catch (e) { errores[name] = e.message; }
  }
  return { copiados, errores };
}

const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + (m || 0); };
/**
 * Copia diaria de todas las bases a la hora indicada (hora de Madrid, 03:00 por defecto), independiente de la exportación a Excel.
 * Si la aplicación estaba parada a esa hora, la hace al arrancar. Devuelve una función para detenerla.
 */
export function scheduleBackups(getDbs, { at = process.env.BACKUP_TIME ?? "03:00", log = console, every = 60_000 } = {}) {
  let doneDate = null;
  const tick = () => {
    const [date, time] = madrid(new Date().toISOString()).split(" ");
    if (doneDate === date || toMin(time) < toMin(at)) return;
    const { files, errors } = backupAll(getDbs());
    doneDate = date;
    for (const [n, f] of Object.entries(files)) log.log(`Copia de seguridad de ${n}: ${f}`);
    for (const [n, e] of Object.entries(errors)) log.error(`No se pudo copiar la base de ${n}:`, e);
    const dir2 = process.env.BACKUP_DIR2; // segunda carpeta (USB / nube), opcional
    if (dir2) {
      const r = copiarASegundaCarpeta(files, dir2);
      if (r.copiados.length) log.log(`Copia en la segunda carpeta (${dir2}): ${r.copiados.length} archivos`);
      for (const [n, e] of Object.entries(r.errores)) log.error(`No se pudo copiar a la segunda carpeta (${n}):`, e);
    }
  };
  tick();
  const timer = setInterval(tick, every);
  timer.unref?.();
  return () => clearInterval(timer);
}
