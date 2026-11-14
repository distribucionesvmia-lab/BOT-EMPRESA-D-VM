// Mira las copias de seguridad diarias de la base de cuentas (cuentas-AAAAMMDD-HHMM.sqlite) y cuenta, copia a copia, qué había del
// «pedido fijo» y de «Tu pedido de siempre» de un cliente. Sirve para saber CUÁNDO desapareció un pedido fijo (la copia anterior a que
// faltara y la primera sin él). Solo LEE: no cambia, restaura ni borra nada.
//   node investigar-fijo.js "C:\vm\bot\bot-whatsapp\respaldos" [código de cliente]
// Sin código de cliente, enseña todos los que tengan pedido fijo en alguna copia.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const tiene = (db, tabla) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla);

/** Devuelve [{ copia, fecha, fijos:[{cliente, lineas, unidades, dias, pausado, actualizado}], siempre:[{cliente, borrado, lineas, actualizado}], cuentas:{...} }] de la más antigua a la más reciente. */
export function investigar(dir, cliente = null) {
  const copias = fs.readdirSync(dir).filter((f) => /^cuentas-\d{8}-\d{4}\.sqlite$/.test(f)).sort();
  return copias.map((f) => {
    const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
    try {
      const filtro = cliente ? " WHERE customer_id = ?" : "", args = cliente ? [String(cliente)] : [];
      const fijos = tiene(db, "standing_orders")
        ? db.prepare("SELECT customer_id, lines, days, paused, updated_at FROM standing_orders" + filtro).all(...args).map((r) => { const ls = JSON.parse(r.lines); return { cliente: r.customer_id, lineas: ls.length, unidades: ls.reduce((t, l) => t + (Number(l.qty) || 0), 0), dias: JSON.parse(r.days), pausado: !!r.paused, actualizado: r.updated_at }; })
        : [];
      const siempre = tiene(db, "usual_orders")
        ? db.prepare("SELECT customer_id, lines, hidden, updated_at FROM usual_orders" + filtro).all(...args).map((r) => ({ cliente: r.customer_id, borrado: !!r.hidden, lineas: JSON.parse(r.lines).length, actualizado: r.updated_at }))
        : [];
      const cuentas = tiene(db, "accounts") ? db.prepare("SELECT customer_id, status, deleted_at FROM accounts" + filtro).all(...args).map((r) => ({ cliente: r.customer_id, estado: r.status, eliminada: r.deleted_at ?? null })) : [];
      return { copia: f, fecha: f.slice(8, 16).replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/, "$1-$2-$3 $4:$5"), fijos, siempre, cuentas };
    } finally { db.close(); }
  });
}

export function resumen(res) {
  const out = [];
  for (const r of res) {
    out.push(`${r.copia}`);
    out.push("   pedido fijo:     " + (r.fijos.length ? r.fijos.map((x) => `cliente ${x.cliente}: ${x.lineas} líneas, ${x.unidades} uds, días ${x.dias.join("/")}${x.pausado ? " (EN PAUSA)" : ""}, guardado ${x.actualizado}`).join(" · ") : "NO HAY"));
    out.push("   pedido de siempre: " + (r.siempre.length ? r.siempre.map((x) => `cliente ${x.cliente}: ${x.borrado ? "BORRADO de la portada" : x.lineas + " líneas editadas"}, ${x.actualizado}`).join(" · ") : "sin tocar"));
    const el = r.cuentas.filter((c) => c.estado === "deleted"); if (el.length) out.push("   cuentas ELIMINADAS: " + el.map((c) => `${c.cliente} (${c.eliminada})`).join(", "));
  }
  const con = res.filter((r) => r.fijos.length), sin = res.filter((r) => !r.fijos.length);
  if (con.length && sin.length) {
    const ultima = con[con.length - 1], primera = sin.find((x) => x.copia > ultima.copia);
    out.push("", `Última copia CON pedido fijo: ${ultima.copia}` + (primera ? ` · primera copia SIN él: ${primera.copia} → desapareció entre ${ultima.fecha} y ${primera.fecha}.` : " (todas las copias posteriores lo tienen)."));
  } else if (!con.length) out.push("", "Ninguna copia tiene pedido fijo para ese cliente.");
  else out.push("", "El pedido fijo está en TODAS las copias: no ha desaparecido en el periodo que cubren.");
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2] ?? process.env.BACKUP_DIR ?? "respaldos";
  if (!fs.existsSync(dir)) { console.error(`No encuentro la carpeta de copias: ${dir}\nUso: node investigar-fijo.js "<carpeta de copias>" [código de cliente]`); process.exit(1); }
  console.log(resumen(investigar(dir, process.argv[3] ?? null)));
}
