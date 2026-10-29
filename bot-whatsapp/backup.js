// Copias de seguridad de la base de datos de pedidos (SQLite).
import fs from "node:fs";
import path from "node:path";
import { madrid } from "./export-format.js";

/** Guarda una copia fechada en `dir` y conserva solo las `keep` más recientes. Devuelve la ruta de la copia. */
export function backupDb(db, { dir = process.env.BACKUP_DIR ?? "respaldos", keep = 14, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = madrid(now.toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
  const file = path.join(dir, `pedidos-${stamp}.sqlite`);
  fs.rmSync(file, { force: true }); // varias en el mismo minuto: la última sustituye a la anterior
  db.backupTo(file);
  const old = fs.readdirSync(dir).filter((f) => /^pedidos-\d{8}-\d{4}\.sqlite$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
