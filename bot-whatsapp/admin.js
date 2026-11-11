// Rutas HTTP de la EMPRESA (el empresario): pedidos recibidos y su exportación a Excel, solicitudes de alta de
// clientes y cuentas. Es una aplicación aparte de la del cliente: todo va bajo /api/admin y exige la clave de la empresa.
import { deliveryInfo } from "./delivery.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send, readJson, makeAdminCheck } from "./auth.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { totals, round2 } from "./pricing.js";
import { runExport } from "./exporter.js";
import { execFile } from "node:child_process";
import { imprimirHtml } from "./export-format.js";

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
    entrega: deliveryInfo(o.delivery_date, o.created_at), ref: o.ref, fecha: o.created_at, cliente: o.name, codigo: o.customer_id, telefono: o.phone, nota: o.note,
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
export function createAdmin({ sync = null, mail = null, actualizador = null, estado = null, actualizaciones = () => [], accounts, customers, orders, adminToken, exportDir = () => process.env.EXPORT_DIR ?? "exportaciones" }) {
  const isAdmin = makeAdminCheck(adminToken);
  // Máximo 10 claves erróneas cada 10 minutos por IP; superado el límite se bloquea esa IP aunque acierte la clave
  // Cada CLAVE distinta que falla cuenta una vez: el panel lanza varias peticiones a la vez con la misma clave y un solo
  // error al teclear no debe bloquear al administrador. Las peticiones sin clave no cuentan (no adivinan nada).
  const failures = new Map();
  const recentFailures = (key, now = Date.now()) => (failures.get(key) ?? []).filter((f) => now - f.t < 10 * 60_000);
  const ip = (req) => (process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "") || req.socket.remoteAddress || "?";

  return async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/admin/")) return false;
    const who = ip(req);
    if (recentFailures(who).length >= 10) return send(res, 429, { error: "Demasiados intentos. Espera unos minutos." }), true;
    if (!isAdmin(req)) {
      const presented = req.headers.authorization;
      const prev = recentFailures(who);
      if (presented && !prev.some((f) => f.h === presented)) failures.set(who, [...prev, { t: Date.now(), h: presented }]);
      return send(res, 403, { error: "Acceso no autorizado." }), true;
    }
    const get = req.method === "GET", post = req.method === "POST";

    // ---- Resumen para los avisos ----
    if (p === "/api/admin/resumen" && get) {
      const list = orders.listOrders({ exportStatus: "pending", limit: 500 }).map(orderView);
      return send(res, 200, { clientes: customers.search({ limit: 1 }).total, cuentasSinConfirmar: accounts.listAccounts().filter((a) => !a.verified && a.status !== "deleted").length, derechosPendientes: accounts.listRightsRequests("pendiente").length, solicitudes: accounts.listRegistrations("pending").length, pedidosPendientes: list.filter((o) => o.estado === "pendiente").length, pedidosRetenidos: list.filter((o) => o.estado === "retenido").length }), true;
    }

    // ---- Últimas subidas de Excel (para la sección «Datos y Excel») ----
    if (p === "/api/admin/actualizaciones" && get) return send(res, 200, actualizaciones()), true;

    // ---- Estado del sistema y problemas detectados (para vigilarlo desde fuera) ----
    if (p === "/api/admin/estado" && get) return estado ? send(res, 200, estado()) : send(res, 404, { error: "No disponible." }), true;

    // ---- Versión del programa y «Actualizar ahora» (la tarea «VM Actualizar» del ordenador de la oficina mira GitHub cada 10 minutos) ----
    if (p === "/api/admin/actualizacion" && get) {
      const leer = (f) => { try { return fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").trim(); } catch { return ""; } };
      const dir = process.env.UPDATE_LOG_DIR ?? "C:\\vm\\logs";
      execFile("git", ["log", "-1", "--format=%h|%cI|%s"], { cwd: path.dirname(fileURLToPath(import.meta.url)), timeout: 4000 }, (err, out) => {
        const [version, fecha, resumen] = err ? [] : out.trim().split("|");
        send(res, 200, {
          version: version ?? null, fecha: fecha ?? null, resumen: resumen ?? null,
          ultimaComprobacion: leer(path.join(dir, "actualizar.ultima")) || null,
          registro: leer(path.join(dir, "actualizar.log")).split(/\r?\n/).filter(Boolean).slice(-6),
          disponible: process.platform === "win32",
        });
      });
      return true;
    }
    if (p === "/api/admin/actualizar" && post) {
      if (process.platform !== "win32") return send(res, 200, { ok: false, mensaje: "La actualización automática solo funciona en el ordenador de la oficina (Windows)." }), true;
      execFile("schtasks", ["/Run", "/TN", process.env.UPDATE_TASK ?? "VM Actualizar"], { timeout: 8000 }, (err) =>
        send(res, 200, err ? { ok: false, mensaje: "No se pudo lanzar la actualización (¿está creada la tarea «VM Actualizar»? Ver instalar-tareas.bat)." } : { ok: true, mensaje: "Buscando mejoras… si hay alguna, el programa se reinicia solo en un minuto." }));
      return true;
    }
    // ---- Pedidos ----
    if (p === "/api/admin/pedidos" && get) return send(res, 200, orders.listOrders({ limit: 150 }).map(orderView)), true;
    if (p === "/api/admin/exportar" && post) {
      // Sin cuerpo o sin «refs»: se exportan todos los pendientes; con «refs»: solo los pedidos elegidos
      const body = (await readJson(req)) ?? {};
      let refs = null;
      if (body.refs !== undefined) {
        if (!Array.isArray(body.refs) || !body.refs.length || body.refs.length > 500 || !body.refs.every((r) => /^VM-\d{4}-\d{6}$/.test(String(r)))) return send(res, 400, { error: "Elige al menos un pedido válido para exportar." }), true;
        refs = body.refs;
      }
      try {
        const r = runExport(orders, { dir: exportDir(), refs });
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
    m = /^\/api\/admin\/exportaciones\/(\d+)\/imprimir$/.exec(p);
    if (m && get) { // hoja para imprimir directamente (A4, un pedido por página), sin pasar por Excel
      const e = orders.getExport(Number(m[1]));
      if (!e) return send(res, 404, { error: "No existe la exportación." }), true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(imprimirHtml(orders.exportedOrders(e.id), { autoprint: false }));
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
    // ---- Aviso por correo de cada pedido ----
    if (p === "/api/admin/correo" && get) return send(res, 200, mail ? mail.status() : { configurado: false }), true;
    if (p === "/api/admin/correo/prueba" && post) {
      if (!mail) return send(res, 400, { error: "Los avisos por correo no están configurados (ver .env.example: SMTP_HOST y MAIL_TO)." }), true;
      try { await mail.prueba(); return send(res, 200, { ok: true }), true; } catch (e) { return send(res, 502, { error: e.message }), true; }
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
    // ---- Actualizar datos desde un Excel: vista previa de los cambios y aplicar solo las diferencias ----
    m = /^\/api\/admin\/(vista-previa|aplicar)\/(productos|clientes|historial|fotos)$/.exec(p);
    if (m && post) {
      if (!actualizador) return send(res, 400, { error: "La actualización de datos no está disponible." }), true;
      const buf = await readBuffer(req, m[2] === "fotos" ? 80_000_000 : 25_000_000); // los ZIP de fotos y los Excel con fotos pesan más que los de texto
      if (!buf || !buf.length) return send(res, 400, { error: `No se recibió el archivo (máximo ${m[2] === "fotos" ? 80 : 25} MB).` }), true;
      try {
        if (m[1] === "vista-previa") return send(res, 200, { ok: true, tipo: m[2], ...actualizador.vistaPrevia(m[2], buf) }), true;
        return send(res, 200, { ok: true, tipo: m[2], ...actualizador.aplicar(m[2], buf, { fichero: String(url.searchParams.get("fichero") ?? "").slice(0, 120), confirmo: url.searchParams.get("confirmo") === "1" }) }), true;
      } catch (e) {
        return send(res, e.confirmar ? 409 : 400, { error: e.message || "No se pudo leer el Excel.", ...(e.confirmar ? { confirmar: e.confirmar } : {}) }), true;
      }
    }
    // ---- Uso de la aplicación (contadores, sin datos personales) ----
    if (p === "/api/admin/uso" && get) return send(res, 200, accounts.resumenUso(Math.max(1, Math.min(365, Number(url.searchParams.get("dias")) || 30)))), true;
    // ---- Derechos de protección de datos que piden los clientes desde la aplicación (corregir, limitar, oponerse… y bajas de cuenta) ----
    if (p === "/api/admin/derechos" && get) return send(res, 200, accounts.listRightsRequests().map((r) => ({ id: r.id, tipo: r.tipo, texto: r.texto, estado: r.estado, creada: r.created_at, atendida: r.resolved_at, clienteId: r.customer_id, cliente: customers.getById(r.customer_id)?.name ?? r.customer_id }))), true;
    if (post && (m = /^\/api\/admin\/derechos\/(\d+)\/atender$/.exec(p))) return send(res, accounts.resolveRightsRequest(Number(m[1])) ? 200 : 404, { ok: true }), true;
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
