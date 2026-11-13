// Rutas HTTP de la EMPRESA (el empresario): pedidos recibidos y su exportación a Excel, solicitudes de alta de
// clientes y cuentas. Es una aplicación aparte de la del cliente: todo va bajo /api/admin y exige la clave de la empresa.
import { deliveryInfo, madridDay } from "./delivery.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send, readJson, makeAdminCheck } from "./auth.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { totals, round2 } from "./pricing.js";
import { runExport } from "./exporter.js";
import { backupDb } from "./backup.js";
import { detectarTipo } from "./actualizar-datos.js";
import { crearAvisos } from "./avisos.js";
import { execFile } from "node:child_process";
import { recordatoriosDeHoy } from "./recordatorios.js";
import { imprimirHtml, FORMAT, madrid } from "./export-format.js";
import { estiloCss, estiloDecimales } from "./xlsx-files.js";

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
    entrega: deliveryInfo(o.delivery_date, o.created_at), ref: o.ref, fecha: o.created_at, modificado: o.modified_at ?? null, cliente: o.name, codigo: o.customer_id, telefono: o.phone, nota: o.note,
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
// Filtros del listado de pedidos (hora de Madrid): día (o de un día a otro), tramo de horas y cliente (nombre, código o teléfono)
const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function filtroPedidos(q) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(q.get("dia") ?? "") ? q.get("dia") : null;
  const diaHasta = /^\d{4}-\d{2}-\d{2}$/.test(q.get("diaHasta") ?? "") ? q.get("diaHasta") : null;
  const h1 = /^\d{2}:\d{2}$/.test(q.get("horaDesde") ?? "") ? q.get("horaDesde") : null;
  const h2 = /^\d{2}:\d{2}$/.test(q.get("horaHasta") ?? "") ? q.get("horaHasta") : null;
  const cli = sinTildes((q.get("cliente") ?? "").slice(0, 60));
  if (!dia && !diaHasta && !h1 && !h2 && !cli) return null;
  return (o) => {
    const [d, t] = madrid(o.created_at).split(" "), hm = t.slice(0, 5);
    if (dia && d < dia) return false;
    if ((diaHasta || dia) && d > (diaHasta ?? dia)) return false;
    if (h1 && hm < h1) return false;
    if (h2 && hm > h2) return false;
    if (cli && !sinTildes(`${o.name} ${o.customer_id ?? ""} ${o.phone ?? ""}`).includes(cli)) return false;
    return true;
  };
}
// Vista previa del Excel (las mismas hojas que se escribirían en el .xlsx), con el CSS de cada estilo, para enseñarla en el panel
function vistaExcel(lista) {
  const { sheets, lineCount } = FORMAT.build(lista);
  const estilos = {};
  for (const sh of sheets) for (const row of sh.rows) for (const c of row) { const st = c && typeof c === "object" ? c.s ?? 0 : 0; if (st && !estilos[st]) estilos[st] = { css: estiloCss(st), dec: estiloDecimales(st) }; }
  return { orderCount: lista.length, lineCount, sheets, estilos };
}
export function createAdmin({ sync = null, mail = null, actualizador = null, estado = null, actualizaciones = () => [], accounts, customers, orders, adminToken, exportDir = () => process.env.EXPORT_DIR ?? "exportaciones", entradaDir = () => process.env.ENTRADA_DIR ?? "" }) {
  const isAdmin = makeAdminCheck(adminToken);
  const avisos = crearAvisos({ accountsDb: accounts });
  // ---- Bandeja de entrada: carpeta del ordenador donde se dejan los Excel (clientes, artículos, historial) y fotos (ZIP).
  // Nada se aplica solo: el panel enseña lo que hay, «Ver cambios» hace la vista previa de siempre y, al aplicar, el archivo pasa a la subcarpeta «aplicados».
  const ENTRADA_MAX = 80_000_000, tiposCache = new Map();
  const nombreValido = (n) => typeof n === "string" && n.length > 0 && n.length <= 200 && path.basename(n) === n && /\.(xlsx|zip)$/i.test(n) && !/^[.~]/.test(n);
  function listarEntrada() {
    const dir = entradaDir();
    if (!dir) return { configurada: false };
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { configurada: true, carpeta: dir, archivos: [], error: "No se puede abrir la carpeta de entrada." }; }
    const archivos = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !nombreValido(f.name)) continue;
      const st = fs.statSync(path.join(dir, f.name));
      if (!st.size || st.size > ENTRADA_MAX) continue;
      const k = `${f.name}|${st.size}|${st.mtimeMs}`;
      if (!tiposCache.has(k)) { try { tiposCache.set(k, detectarTipo(fs.readFileSync(path.join(dir, f.name)))); } catch { tiposCache.set(k, null); } if (tiposCache.size > 200) tiposCache.delete(tiposCache.keys().next().value); }
      archivos.push({ nombre: f.name, tipo: tiposCache.get(k), tamano: st.size, modificado: st.mtime.toISOString() });
    }
    archivos.sort((a, b) => (a.modificado < b.modificado ? 1 : -1));
    return { configurada: true, carpeta: dir, archivos: archivos.slice(0, 50) };
  }
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
    // ---- Recordatorios de hoy (F-17): a quién le toca reponer; la empresa envía a mano por WhatsApp ----
    if (p === "/api/admin/recordatorios" && get) {
      const hoy = madridDay(), fechas = customers.fechasPedidos?.() ?? new Map(), app = orders.orderDays?.() ?? new Map();
      const clientes = customers.list().filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name, phone: c.phone, fechas: [...(fechas.get(c.id) ?? []), ...(app.get(c.id) ?? [])] }));
      const { avisadosHoy, nunca } = accounts.reminderSets(hoy);
      return send(res, 200, { hoy, filas: recordatoriosDeHoy({ hoy, clientes, fijos: accounts.allStanding(), avisadosHoy, nunca, enlace: process.env.PUBLIC_URL ?? "" }) }), true;
    }
    if (post && (p === "/api/admin/recordatorios/avisado" || p === "/api/admin/recordatorios/no-avisar")) {
      const body = (await readJson(req)) ?? {};
      if (typeof body.id !== "string" || !body.id) return send(res, 400, { error: "Falta el cliente." }), true;
      accounts.markReminder(body.id, p.endsWith("/avisado") ? "avisado" : "nunca", madridDay());
      return send(res, 200, { ok: true }), true;
    }
    // ---- Pedidos ----
    if (p === "/api/admin/pedidos" && get) {
      const filtro = filtroPedidos(url.searchParams); // sin filtros: los 150 últimos; con filtros se busca más atrás
      const lista = filtro ? orders.listOrders({ limit: 5000 }).filter(filtro) : orders.listOrders({ limit: 150 });
      return send(res, 200, lista.slice(0, 500).map(orderView)), true;
    }
    if (p === "/api/admin/pedidos/borrar" && post) { // borra los pedidos elegidos (con copia de seguridad antes y confirmación expresa)
      const body = (await readJson(req)) ?? {};
      if (body.confirmo !== true) return send(res, 400, { error: "Falta la confirmación para borrar." }), true;
      if (!Array.isArray(body.refs) || !body.refs.length || body.refs.length > 500 || !body.refs.every((r) => /^VM-\d{4}-\d{6}$/.test(String(r)))) return send(res, 400, { error: "Elige al menos un pedido válido para borrar." }), true;
      let copia;
      try { copia = path.basename(backupDb(orders, { dir: process.env.BACKUP_DIR ?? "respaldos", name: "pedidos-antes-de-borrar" })); }
      catch (e) { console.error("Copia antes de borrar:", e); return send(res, 500, { error: "No se pudo hacer la copia de seguridad, así que NO se ha borrado nada." }), true; }
      try {
        const r = orders.deleteOrders(body.refs);
        console.log(`Pedidos borrados por la empresa: ${r.borrados} (copia: ${copia})`);
        return send(res, 200, { ok: true, borrados: r.borrados, copia }), true;
      } catch (e) { console.error("Error borrando pedidos:", e); return send(res, 500, { error: "No se pudieron borrar los pedidos. No se ha borrado nada." }), true; }
    }
    if (p === "/api/admin/exportar/vista" && post) { // ver cómo quedará el Excel SIN exportar nada (no marca pedidos)
      const body = (await readJson(req)) ?? {};
      if (body.refs !== undefined && (!Array.isArray(body.refs) || !body.refs.length || body.refs.length > 500 || !body.refs.every((r) => /^VM-\d{4}-\d{6}$/.test(String(r))))) return send(res, 400, { error: "Elige al menos un pedido válido." }), true;
      const { ready, held } = orders.previewPending({ refs: body.refs ?? null });
      if (!ready.length) return send(res, 200, { vacio: true, retenidos: held }), true;
      return send(res, 200, { ...vistaExcel(ready), retenidos: held }), true;
    }
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
    m = /^\/api\/admin\/exportaciones\/(\d+)\/vista$/.exec(p);
    if (m && get) { // el Excel de una exportación ya hecha, para verlo en pantalla
      const e = orders.getExport(Number(m[1]));
      if (!e) return send(res, 404, { error: "No existe la exportación." }), true;
      return send(res, 200, { archivo: e.file_name, ...vistaExcel(orders.exportedOrders(e.id)) }), true;
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
    // ---- Altas a mano: un producto o un cliente sueltos, sin Excel ----
    if (post && (p === "/api/admin/productos/nuevo" || p === "/api/admin/clientes/nuevo")) {
      if (!actualizador) return send(res, 404, { error: "No disponible." }), true;
      const b = (await readJson(req)) ?? {};
      try {
        const r = p.includes("productos") ? actualizador.anadirProducto(b, { actualizar: b.actualizar === true }) : actualizador.anadirCliente(b, { actualizar: b.actualizar === true });
        return send(res, 200, { ok: true, ...r }), true;
      } catch (e) { return send(res, 400, { error: e.message, ...(e.existe ? { existe: true } : {}) }), true; }
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
    // ---- Avisos al móvil de los clientes (Web Push) ----
    if (p === "/api/admin/avisos" && get) return send(res, 200, { ...accounts.pushResumen(), ultimos: accounts.pushLogList(15) }), true;
    if (p === "/api/admin/avisos/enviar" && post) {
      const b = (await readJson(req)) ?? {};
      const titulo = String(b.titulo ?? "").trim(), texto = String(b.texto ?? "").trim();
      if (b.confirmo !== true) return send(res, 400, { error: "Falta la confirmación para enviar." }), true;
      if (!titulo || titulo.length > 50 || !texto || texto.length > 180) return send(res, 400, { error: "Escribe un título (máximo 50 letras) y un mensaje (máximo 180)." }), true;
      if (b.destino !== "todos" && b.destino !== "cliente") return send(res, 400, { error: "Elige a quién enviarlo." }), true;
      const cli = b.destino === "cliente" ? customers.getById(String(b.clienteId ?? "")) : null;
      if (b.destino === "cliente" && !cli) return send(res, 400, { error: "Elige un cliente de la lista." }), true;
      if (accounts.pushLogCount(new Date(Date.now() - 3600_000).toISOString()) >= 10) return send(res, 429, { error: "Ya has enviado varios avisos en la última hora. Espera un poco para no molestar a los clientes." }), true;
      const mensaje = { title: titulo, body: texto, url: "/cliente", tag: "aviso-" + Date.now() };
      const r = cli ? await avisos.aCliente(cli.id, mensaje) : await avisos.aTodos(mensaje);
      accounts.pushLogAdd({ titulo, texto, destino: cli ? `${cli.id} ${cli.name}` : "todos", enviados: r.enviados, fallidos: r.fallidos });
      return send(res, 200, { ok: true, ...r }), true;
    }
    // ---- Bandeja de entrada (carpeta del ordenador) ----
    if (p === "/api/admin/entrada" && get) return send(res, 200, listarEntrada()), true;
    if (p === "/api/admin/entrada/archivo" && get) {
      const n = url.searchParams.get("nombre") ?? "", dir = entradaDir();
      if (!dir || !nombreValido(n) || !fs.existsSync(path.join(dir, n))) return send(res, 404, { error: "No existe ese archivo en la carpeta." }), true;
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }).end(fs.readFileSync(path.join(dir, n)));
      return true;
    }
    if (p === "/api/admin/entrada/archivar" && post) { // el archivo ya se aplicó (o no hace falta): pasa a «aplicados», con la fecha delante
      const b = (await readJson(req)) ?? {}, dir = entradaDir();
      if (!dir || !nombreValido(b.nombre) || !fs.existsSync(path.join(dir, b.nombre))) return send(res, 404, { error: "No existe ese archivo en la carpeta." }), true;
      try {
        const destino = path.join(dir, "aplicados"); fs.mkdirSync(destino, { recursive: true });
        const sello = madrid(new Date().toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-").slice(0, 13);
        fs.renameSync(path.join(dir, b.nombre), path.join(destino, `${sello}-${b.nombre}`));
        return send(res, 200, { ok: true }), true;
      } catch (e) { return send(res, 409, { error: "No se pudo mover el archivo. Si lo tienes abierto en Excel, ciérralo y vuelve a intentarlo." }), true; }
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
    if (post && p === "/api/admin/cuentas/confirmar-todas") return send(res, 200, { ok: true, confirmadas: accounts.confirmAll() }), true;
    m = /^\/api\/admin\/(solicitudes|cuentas)\/(\d+)\/(aprobar|rechazar|pin|bloquear|confirmar)$/.exec(p);
    if (m && post) {
      const id = Number(m[2]);
      const b = (await readJson(req)) ?? {};
      if (m[1] === "solicitudes" && m[3] === "aprobar" && b.nuevo && typeof b.nuevo === "object") {
        // Cliente NUEVO: se crea su ficha con todos los datos que dio al registrarse (teléfono, correo, DNI/CIF, dirección) y los que completa la empresa; después se acepta la solicitud
        const reg = accounts.listRegistrations("pending").find((r) => r.id === id);
        if (!reg) return send(res, 404, { error: "La solicitud no existe o ya se resolvió." }), true;
        if (!actualizador) return send(res, 404, { error: "No disponible." }), true;
        const n = b.nuevo;
        let creado;
        try {
          creado = actualizador.anadirCliente({ codigo: n.codigo, nombre: n.nombre || reg.business, razonSocial: n.razonSocial, nif: n.nif || reg.nif, telefono: reg.phone, correo: reg.email, direccion: n.direccion ?? reg.address, poblacion: n.poblacion, municipio: n.municipio, recargo: n.recargo === true });
        } catch (e) { return send(res, 400, { error: e.message, ...(e.existe ? { existe: true } : {}) }), true; }
        const r = accounts.approve(id, creado.id);
        return r.error ? send(res, 400, { error: r.error }) : send(res, 200, { ok: true, cliente: creado.nombre, codigo: creado.id, provisional: creado.provisional, telefono: r.account.phone, ...(r.pin ? { pin: r.pin } : {}) }), true;
      }
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
