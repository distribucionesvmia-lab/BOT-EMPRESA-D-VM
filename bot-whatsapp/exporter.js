// Exportación de pedidos confirmados a Excel (.xlsx) y programación diaria.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { buildWorkbook } from "./xlsx.js";
import { FORMAT, madrid } from "./export-format.js";
import { backupDb } from "./backup.js";

const EXPORT_DIR = () => process.env.EXPORT_DIR ?? "exportaciones";

/**
 * Genera el Excel con los pedidos confirmados pendientes y los marca como exportados (todo o nada).
 * Devuelve { export, held, filePath } o { export: null, held } si no había pedidos.
 */
export function runExport(db, { dir = EXPORT_DIR(), now = new Date(), format = FORMAT } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let filePath;
  const result = db.exportPending((orders) => {
    const { sheets, lineCount } = format.build(orders);
    const buf = buildWorkbook(sheets);
    const stamp = madrid(now.toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-");
    const fileName = `pedidos-${stamp}-${crypto.randomBytes(2).toString("hex")}.xlsx`;
    filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buf, { flag: "wx" }); // wx: nunca sobrescribe una exportación anterior
    return {
      format: format.name,
      fileName,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      lineCount,
      discard: () => fs.rmSync(filePath, { force: true }),
    };
  }, now.toISOString());
  return { ...result, filePath: result.export ? filePath : null };
}

const toMinutes = (hm) => {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + (m || 0);
};

/**
 * Lanza la exportación una vez al día, a partir de la hora indicada (hora de Madrid, por defecto 21:00).
 * Si la aplicación estaba parada a esa hora, exporta al arrancar. Devuelve una función para detenerla.
 */
export function scheduleDailyExport(db, { at = process.env.EXPORT_TIME ?? "21:00", log = console, every = 60_000 } = {}) {
  let doneDate = null;
  const tick = () => {
    const [date, time] = madrid(new Date().toISOString()).split(" ");
    if (doneDate === date || toMinutes(time) < toMinutes(at)) return;
    try {
      const r = runExport(db);
      doneDate = date;
      if (r.export) log.log(`Exportación #${r.export.id}: ${r.export.order_count} pedidos, ${r.export.line_count} líneas -> ${r.filePath}`);
      else log.log("Exportación diaria: no había pedidos pendientes.");
      if (r.held) log.warn(`Hay ${r.held} pedido(s) retenidos pendientes de revisión (no se han exportado).`);
      try {
        log.log(`Copia de seguridad de la base de datos: ${backupDb(db)}`);
      } catch (err) {
        log.error("No se pudo hacer la copia de seguridad de la base de datos:", err.message);
      }
    } catch (err) {
      log.error("Falló la exportación diaria (los pedidos siguen pendientes; se reintenta en 1 min):", err.message);
    }
  };
  tick();
  const timer = setInterval(tick, every);
  timer.unref?.();
  return () => clearInterval(timer);
}
