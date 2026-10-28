#!/usr/bin/env node
// Exportación manual:  node exportar.js            -> exporta los pedidos pendientes ahora
//                      node exportar.js --lista    -> historial de exportaciones
//                      node exportar.js --aprobar VM-2026-000123  -> da por revisado un pedido retenido
import { getDb } from "./db.js";
import { runExport } from "./exporter.js";

const db = getDb();
const [arg, value] = process.argv.slice(2);

if (arg === "--lista") {
  for (const e of db.listExports()) console.log(`#${e.id}  ${e.created_at}  ${e.order_count} pedidos / ${e.line_count} líneas  ${e.file_name}  sha256:${e.sha256.slice(0, 12)}`);
} else if (arg === "--aprobar") {
  console.log(db.approveOrder(value) ? `Pedido ${value} aprobado.` : `No hay ningún pedido pendiente con la referencia ${value}.`);
} else {
  const r = runExport(db);
  console.log(r.export ? `Exportados ${r.export.order_count} pedidos (${r.export.line_count} líneas): ${r.filePath}` : "No hay pedidos pendientes de exportar.");
  if (r.held) console.log(`⚠️  ${r.held} pedido(s) retenidos: cliente nuevo o interpretación dudosa. Revísalos (--aprobar <ref>) para exportarlos.`);
}
db.close();
