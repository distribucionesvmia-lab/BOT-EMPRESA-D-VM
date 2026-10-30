// Rutas HTTP de la EMPRESA (el empresario): pedidos recibidos y su exportación a Excel, solicitudes de alta de
// clientes y cuentas. Es una aplicación aparte de la del cliente: todo va bajo /api/admin y exige la clave de la empresa.
import fs from "node:fs";
import path from "node:path";
import { send, readJson, makeAdminCheck } from "./auth.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { totals, round2 } from "./pricing.js";
import { runExport } from "./exporter.js";

const amountOf = (l) => l.amount ?? round2((l.units ?? l.qty) * (l.price ?? 0) * (1 - (l.discount ?? 0) / 100));

/** Pedido tal como lo ve el empresario: líneas, total con impuestos y estado. */
function readBuffer(req, max = 8_000_000) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { req.destroy(); resolve(null); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

function orderView(o) {
  const items = o.items.map((l) => ({ ...l, amount: amountOf(l), vat: l.vat_rate }));
  const retenido = !o.review ? !o.customer_id : true;
  return {
    ref: o.ref, fecha: o.created_at, cliente: o.name, codigo: o.customer_id, telefono: o.phone, nota: o.note,
    lineas: o.items.map((l) => ({ id: l.id, nombre: l.name, cantidad: l.qty, unidad: l.unit, cajas: l.boxes, unidades: l.units ?? l.qty, precio: l.price, descuento: l.discount, importe: amountOf(l), iva: l.vat_rate, nota: l.note })),
    total: totals(items, o.re).total,
    estado: o.export_status === "exported" ? "exportado" : retenido ? "retenido" : "pendiente",
    motivo: o.export_status === "exported" ? "" : !o.customer_id ? "Cliente sin código de ERP" : o.review ? o.reason || "Pedido dudoso: revisar antes de exportar" : "",
    exportId: o.export_id,
  };
}

/**
 * accounts: base de cuentas · customers: { list, getById, suggest } · orders: base de pedidos (db.js)
 * Devuelve route(req, res, url) → true si atendió la petición.
 */
export function createAdmin({ sync = null, accounts, customers, orders, adminToken, exportDir = () => process.env.EXPORT_DIR ?? "exportaciones" }) {
  const isAdmin = makeAdminCheck(adminToken);
  // Máximo 10 claves erróneas cada 10 minutos por IP; superado el límite se bloquea esa IP aunque acierte la clave
  const failures = new Map();
  const recentFailures = (key, now = Date.now()) => (failures.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
  const ip = (req) => (process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";

  return async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/admin/")) return false;
    const who = ip(req);
    if (recentFailures(who).length >= 10) return send(res, 429, { error: "Demasiados intentos. Espera unos minutos." }), true;
    if (!isAdmin(req)) {
      failures.set(who, [...recentFailures(who), Date.now()]);
      return send(res, 403, { error: "Acceso no autorizado." }), true;
    }
    const get = req.method === "GET", post = req.method === "POST";

    // ---- Resumen para los avisos ----
    if (p === "/api/admin/resumen" && get) {
      const list = orders.listOrders({ exportStatus: "pending", limit: 500 }).map(orderView);
      return send(res, 200, { clientes: customers.search({ limit: 1 }).total, cuentasSinConfirmar: accounts.listAccounts().filter((a) => !a.verified).length, solicitudes: accounts.listRegistrations("pending").length, pedidosPendientes: list.filter((o) => o.estado === "pendiente").length, pedidosRetenidos: list.filter((o) => o.estado === "retenido").length }), true;
    }

    // ---- Pedidos ----
    if (p === "/api/admin/pedidos" && get) return send(res, 200, orders.listOrders({ limit: 150 }).map(orderView)), true;
    if (p === "/api/admin/exportar" && post) {
      try {
        const r = runExport(orders, { dir: exportDir() });
        return send(res, 200, { exportacion: r.export && { id: r.export.id, archivo: r.export.file_name, pedidos: r.export.order_count, lineas: r.export.line_count }, retenidos: r.held }), true;
      } catch (e) {
        console.error("Error exportando:", e);
        return send(res, 500, { error: "No se pudo generar el Excel. Los pedidos siguen pendientes." }), true;
      }
    }
    if (p === "/api/admin/exportaciones" && get) return send(res, 200, orders.listExports(30).map((e) => ({ id: e.id, fecha: e.created_at, archivo: e.file_name, pedidos: e.order_count, lineas: e.line_count }))), true;
    let m = /^\/api\/admin\/exportaciones\/(\d+)\/descargar$/.exec(p);
    if (m && get) {
      const e = orders.getExport(Number(m[1]));
      const file = e && /^[\w.-]+\.xlsx$/.test(e.file_name) ? path.join(exportDir(), e.file_name) : null;
      if (!file || !fs.existsSync(file)) return send(res, 404, { error: "No existe el archivo." }), true;
      res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${e.file_name}"`, "Cache-Control": "no-store" }).end(fs.readFileSync(file));
      return true;
    }
    m = /^\/api\/admin\/pedidos\/([\w-]+)\/aprobar$/.exec(p);
    if (m && post) return send(res, orders.approveOrder(m[1]) ? 200 : 404, { ok: true }), true;

    // ---- Solicitudes de alta y cuentas de clientes ----
    if (p === "/api/admin/solicitudes" && get) {
      const regs = accounts.listRegistrations(url.searchParams.get("estado") ?? "pending");
      return send(res, 200, regs.map((r) => ({ ...r, sugerencias: customers.suggest(r.business, r.phone, r.email) }))), true;
    }
    if (p === "/api/admin/clientes" && get) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
      return send(res, 200, customers.list().filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.id) === q).slice(0, 15).map((c) => ({ id: c.id, name: c.name, phone: c.phone }))), true;
    }
    // ---- Sincronización automática con la carpeta de Drive ----
    if (p === "/api/admin/sincronizacion" && get) return send(res, 200, sync ? sync.status() : { configurado: false }), true;
    if (p === "/api/admin/sincronizacion/ahora" && post) {
      if (!sync?.configurado) return send(res, 400, { error: "La sincronización no está configurada (ver docs/GOOGLE_DRIVE.md)." }), true;
      return send(res, 200, await sync.runNow()), true;
    }
    // ---- Clientes (la lista que viene de a3ERP) ----
    if (p === "/api/admin/clientes/lista" && get) {
      const pagina = Math.max(0, Number(url.searchParams.get("pagina") ?? 0) || 0);
      const r = customers.search({ q: url.searchParams.get("q") ?? "", offset: pagina * 50, limit: 50 });
      const conCuenta = new Set(accounts.listAccounts().map((a) => String(a.customerId)));
      return send(res, 200, { total: r.total, pagina, porPagina: 50, clientes: r.rows.map((c) => ({ ...c, cuenta: conCuenta.has(c.id) })) }), true;
    }
    if (p === "/api/admin/clientes/importar" && post) {
      // El Excel que exporta a3ERP (lista de clientes). Crea los nuevos y actualiza los existentes; no toca historial ni precios.
      const buf = await readBuffer(req);
      if (!buf || !buf.length) return send(res, 400, { error: "No se recibió el archivo (máximo 8 MB)." }), true;
      try {
        const { customers: list, stats } = parseClientesXlsx(buf);
        if (!list.length) return send(res, 400, { error: "El Excel no tiene clientes." }), true;
        const r = customers.importMany(list);
        const cuentasNuevas = accounts.ensureMany(list.filter((c) => c.active !== false).map((c) => c.id)); // cada cliente activo ya tiene su cuenta
        return send(res, 200, { ok: true, ...stats, nuevos: r.added, actualizados: r.updated, cuentasNuevas }), true;
      } catch (e) {
        return send(res, 400, { error: e.message || "No se pudo leer el Excel." }), true;
      }
    }
    if (p === "/api/admin/cuentas" && get) return send(res, 200, accounts.listAccounts().map((a) => ({ ...a, cliente: customers.getById(a.customerId)?.name ?? "" }))), true;
    m = /^\/api\/admin\/(solicitudes|cuentas)\/(\d+)\/(aprobar|rechazar|pin|bloquear|confirmar)$/.exec(p);
    if (m && post) {
      const id = Number(m[2]);
      const b = (await readJson(req)) ?? {};
      if (m[1] === "solicitudes" && m[3] === "aprobar") {
        const cust = customers.getById(String(b.clienteId ?? ""));
        if (!cust) return send(res, 400, { error: "Elige un cliente de la lista." }), true;
        const r = accounts.approve(id, cust.id);
        return r.error ? send(res, 400, { error: r.error }) : send(res, 200, { ok: true, cliente: cust.name, telefono: r.account.phone, ...(r.pin ? { pin: r.pin } : {}) }), true;
      }
      if (m[1] === "solicitudes" && m[3] === "rechazar") return send(res, accounts.reject(id) ? 200 : 404, { ok: true }), true;
      if (m[1] === "cuentas" && m[3] === "pin") {
        const pin = accounts.resetPin(id);
        return send(res, pin ? 200 : 404, pin ? { ok: true, pin } : { error: "No existe la cuenta." }), true;
      }
      if (m[1] === "cuentas" && m[3] === "confirmar") return send(res, accounts.confirm(id) ? 200 : 404, { ok: true }), true;
      if (m[1] === "cuentas" && m[3] === "bloquear") return accounts.setBlocked(id, b.bloquear !== false), send(res, 200, { ok: true }), true;
    }
    return send(res, 404, { error: "No existe." }), true;
  };
}
