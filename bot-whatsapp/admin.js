// Rutas HTTP de la EMPRESA (el empresario): pedidos recibidos y su exportación a Excel, solicitudes de alta de
// clientes y cuentas. Es una aplicación aparte de la del cliente: todo va bajo /api/admin y exige la clave de la empresa.
import crypto from "node:crypto";
import { deliveryInfo, madridDay } from "./delivery.js";
import { leerExcluidos, resolverExcluidos, excluidosValidos, prepararPedidos, rangoDe, calcular, atrasados, patronesCliente } from "./estadisticas.js";
import { xlsxDeEstadisticas, csvDeEstadisticas } from "./estadisticas-export.js";
import { opcionesInvitacion, plantillaValida, textoWhatsapp, PLANTILLA_DEFECTO, PLANTILLA_ALTA, PLANTILLA_VER } from "./invitaciones.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { send, readJson, makeAdminCheck } from "./auth.js";
import { ipDe, eventoSeguridad } from "./seguridad.js";
import { etiquetaAccion } from "./actividad.js";
import { claveCodigoOficina } from "./nif-key.js";
import { leerPausa, guardarPausa } from "./pausa.js";
import { revisar } from "./revision-seguridad.js";
import { crear2fa } from "./panel-2fa.js";
import { crearAutoBases } from "./auto-bases.js";
import { parseClientesXlsx } from "./clientes-import.js";
import { totals, round2, promoVigente, precioEfectivo, hoyMadrid } from "./pricing.js";
import { categorizar } from "./categorias.js";
import { runExport } from "./exporter.js";
import { backupDb } from "./backup.js";
import { estadoCopias, comprobarCopias } from "./copias.js";
import { sendMail } from "./mailer.js";
import { validarProgramado, MAX_PENDIENTES } from "./avisos-programados.js";
import { validarEdicion } from "./cliente-edicion.js";
import { crearFotos, MAX_BYTES as FOTO_MAX } from "./fotos-articulos.js";
import { crearImportadorZip, MAX_ZIP } from "./fotos-zip.js";
import { elegirDestino, smtpDesdeEntorno } from "./correo-cliente.js";
import { validarCampana, audiencia, mensajeCampana, enviarCampanas, limiteDia, MAX_PENDIENTES as MAX_CAMPANAS, TIPOS as TIPOS_CORREO } from "./correo-campanas.js";
import { detectarTipo } from "./actualizar-datos.js";
import { crearAvisos } from "./avisos.js";
import { execFile } from "node:child_process";
import { recordatoriosDeHoy } from "./recordatorios.js";
import { imprimirHtml, FORMAT, madrid, tipoDocumento } from "./export-format.js";
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
    documento: tipoDocumento(o.customer_id), // ALBARÁN o FACTURA (según el modelo de pedido del cliente), o null
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
    if (cli && !sinTildes(`${o.name} ${o.customer_id ?? ""} ${o.phone ?? ""} ${o.ref ?? ""}`).includes(cli)) return false;
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
export function createAdmin({ imgDir = null, sync = null, mail = null, actualizador = null, estado = null, actualizaciones = () => [], accounts, customers, orders, adminToken, exportDir = () => process.env.EXPORT_DIR ?? "exportaciones", entradaDir = () => process.env.ENTRADA_DIR ?? "", catalogDb = null, respaldar = () => {} }) {
  const isAdmin = makeAdminCheck(adminToken);
  const dosFactores = crear2fa(accounts, { token: () => adminToken }); // segundo factor del panel (código del móvil), si se ha activado
  /** Acciones peligrosas (borrar pedidos, restablecer contraseñas, cambiar la tarifa): hay que volver a escribir la clave del panel (cabecera X-VM-Reclave). true = ya se ha contestado. */
  const exigeReclave = (req, res, who) => {
    const v = String(req.headers["x-vm-reclave"] ?? "").trim();
    if (v && isAdmin({ headers: { authorization: "Bearer " + v } })) return false;
    if (v) { const prev = recentFailures(who); if (!prev.some((f) => f.h === "r:" + v)) { failures.set(who, [...prev, { t: Date.now(), h: "r:" + v }]); eventoSeguridad("panel-reclave-incorrecta", who); } } // una clave equivocada cuenta como cualquier otro intento
    send(res, 401, { necesitaReconfirmar: true, error: v ? "La clave no es correcta." : "Para esta acción hay que volver a escribir la clave del panel." });
    return true;
  };
  const fotos = crearFotos(imgDir);
  const fotosZip = catalogDb ? crearImportadorZip({ catalogDb, fotos }) : null;
  const avisos = crearAvisos({ accountsDb: accounts });
  const estCache = new Map(); // estadísticas ya calculadas (se renuevan solas cuando cambian los pedidos)
  // ---- Artículos: precio, ofertas y la campana que avisa a los clientes ----
  const eurTxt = (n) => { let t = Number(n).toFixed(3).replace(/0$/, ""); return t.replace(".", ",") + " €"; };
  const fechaTxt = (f) => f.split("-").reverse().slice(0, 2).join("/");
  /** Qué se puede avisar de un artículo ahora: una oferta vigente o una bajada de precio de los últimos 7 días. { tipo, clave, titulo, texto } o null. */
  function campanaDe(p, cambio, hoy = hoyMadrid()) {
    const o = promoVigente(p, hoy);
    if (o) {
      const antes = precioEfectivo({ ...p, promo: null }, null, String(p.id)), ahora = precioEfectivo(p, null, String(p.id));
      const neto = (x) => x.price * (1 - x.discount / 100);
      return { tipo: "oferta", clave: `promo:${o.tipo}:${o.valor}:${o.hasta ?? ""}`, titulo: `Oferta ${o.tipo === "pct" ? "−" + String(o.valor).replace(".", ",") + " %" : "−" + eurTxt(o.valor)}: ${p.name}`.slice(0, 80), texto: `Ahora a ${eurTxt(neto(ahora))} la unidad (antes ${eurTxt(neto(antes))}).${o.hasta ? ` Hasta el ${fechaTxt(o.hasta)}.` : ""}`.slice(0, 180) };
    }
    if (cambio && cambio.despues < cambio.antes && Date.now() - Date.parse(cambio.at) <= 7 * 86_400_000) return { tipo: "bajada", clave: `precio:${cambio.despues}`, titulo: `Bajada de precio: ${p.name}`.slice(0, 80), texto: `Ahora a ${eurTxt(cambio.despues)} (antes ${eurTxt(cambio.antes)}).` };
    return null;
  }
  // ---- Bandeja de entrada: carpeta del ordenador donde se dejan los Excel (clientes, artículos, historial) y fotos (ZIP).
  // Nada se aplica solo: el panel enseña lo que hay, «Ver cambios» hace la vista previa de siempre y, al aplicar, el archivo pasa a la subcarpeta «aplicados».
  const ENTRADA_MAX = 80_000_000, tiposCache = new Map();
  const nombreValido = (n) => typeof n === "string" && n.length > 0 && n.length <= 200 && path.basename(n) === n && /\.(xlsx|zip)$/i.test(n) && !/^[.~]/.test(n);
  // Subcarpetas BASE-ARTICULOS, BASE-CLIENTES y BASE-HISTORICO (da igual mayúsculas, guiones, tildes o palabras detrás: «BASE-HISTORICO PEDIDOS» vale).
  // Pueden estar dentro de la carpeta de entrada (ENTRADA_DIR) o en BASES_DIR (p. ej. C:\vm); en Windows, si no se ha puesto, se busca junto a la carpeta de datos.
  // Lo que se deja ahí se entiende como de ese tipo; igualmente se mira el contenido, y si no cuadra se avisa y no se carga solo. Cada una tiene su propia subcarpeta «aplicados».
  const SUBS = [["basearticulos", "productos"], ["baseproductos", "productos"], ["baseclientes", "clientes"], ["basehistorico", "historial"], ["basehistorial", "historial"]];
  const normSub = (n) => String(n ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const tipoDeSub = (n) => { const s = normSub(n); return SUBS.find(([pre]) => s.startsWith(pre))?.[1] ?? null; };
  const basesDir = () => {
    if (process.env.BASES_DIR) return process.env.BASES_DIR;
    if (process.platform !== "win32" || !process.env.CUSTOMERS_DB) return "";
    const d = path.dirname(path.dirname(path.resolve(process.env.CUSTOMERS_DB)));
    try { return fs.readdirSync(d, { withFileTypes: true }).some((x) => x.isDirectory() && tipoDeSub(x.name)) ? d : ""; } catch { return ""; }
  };
  /** Carpetas donde se buscan las BASE-… (sin repetir). */
  const raicesBases = () => { const out = []; for (const r of [entradaDir(), basesDir()]) if (r && !out.some((x) => path.resolve(x) === path.resolve(r))) out.push(r); return out; };
  /** Carpeta de la bandeja que se pide («» = la de entrada, o el nombre de una subcarpeta BASE-… que exista). null si no existe o no es una de las permitidas. */
  function carpetaEntrada(dir, nombre) {
    if (!nombre) return dir ? { ruta: dir, nombre: "", tipo: null } : null;
    for (const raiz of raicesBases()) {
      try {
        const d = fs.readdirSync(raiz, { withFileTypes: true }).find((x) => x.isDirectory() && x.name === nombre && tipoDeSub(x.name));
        if (d) return { ruta: path.join(raiz, d.name), nombre: d.name, tipo: tipoDeSub(d.name) };
      } catch { /* carpeta no accesible */ }
    }
    return null;
  }
  function archivosDe(carpeta) {
    const out = [];
    for (const f of fs.readdirSync(carpeta.ruta, { withFileTypes: true })) {
      if (!f.isFile() || !nombreValido(f.name)) continue;
      const st = fs.statSync(path.join(carpeta.ruta, f.name));
      if (!st.size || st.size > ENTRADA_MAX) continue;
      const k = `${carpeta.nombre}/${f.name}|${st.size}|${st.mtimeMs}`;
      if (!tiposCache.has(k)) { try { tiposCache.set(k, detectarTipo(fs.readFileSync(path.join(carpeta.ruta, f.name)))); } catch { tiposCache.set(k, null); } if (tiposCache.size > 200) tiposCache.delete(tiposCache.keys().next().value); }
      const visto = tiposCache.get(k);
      let tipo = visto, aviso = null;
      if (carpeta.tipo) { // en una subcarpeta BASE-…: manda lo que dice la carpeta, salvo que el contenido diga claramente otra cosa
        if (!visto) tipo = carpeta.tipo;
        else if (visto !== carpeta.tipo) { tipo = null; aviso = `Está en ${carpeta.nombre} pero parece de «${visto}». Revísalo antes de subirlo.`; }
      }
      out.push({ nombre: f.name, carpeta: carpeta.nombre, tipoCarpeta: carpeta.tipo, tipo, ...(aviso ? { aviso } : {}), tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return out;
  }
  function listarEntrada() {
    const dir = entradaDir(), raices = raicesBases();
    if (!raices.length) return { configurada: false };
    if (dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { configurada: true, carpeta: dir, archivos: [], error: "No se puede abrir la carpeta de entrada." }; } }
    const carpetas = dir ? [{ ruta: dir, nombre: "", tipo: null }] : [], subcarpetas = [];
    for (const raiz of raices) {
      let ds = []; try { ds = fs.readdirSync(raiz, { withFileTypes: true }); } catch { continue; }
      for (const d of ds) if (d.isDirectory() && tipoDeSub(d.name) && !carpetas.some((c) => c.nombre === d.name)) { carpetas.push({ ruta: path.join(raiz, d.name), nombre: d.name, tipo: tipoDeSub(d.name) }); subcarpetas.push({ nombre: d.name, tipo: tipoDeSub(d.name) }); }
    }
    let archivos = [];
    for (const c of carpetas) { try { archivos.push(...archivosDe(c)); } catch { /* una subcarpeta que no se puede leer no impide ver las demás */ } }
    archivos.sort((a, b) => (a.modificado < b.modificado ? 1 : -1));
    for (const c of carpetas) { const primero = archivos.find((a) => a.carpeta === c.nombre); if (primero && c.nombre) primero.ultimo = true; } // el más reciente de cada subcarpeta BASE-… es el que toca subir
    return { configurada: true, carpeta: dir || raices[0], subcarpetas, archivos: archivos.slice(0, 60), auto: autoBases.estado() };
  }
  const archivarEnCarpeta = (c, nombre) => { // pasa el archivo a la subcarpeta «aplicados» de SU carpeta, con la fecha delante
    const destino = path.join(c.ruta, "aplicados"); fs.mkdirSync(destino, { recursive: true });
    const sello = madrid(new Date().toISOString()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1-").slice(0, 13);
    fs.renameSync(path.join(c.ruta, nombre), path.join(destino, `${sello}-${nombre}`));
  };
  // Actualización AUTOMÁTICA: lo que se deja en BASE-… se aplica solo (con copia de seguridad antes y las mismas protecciones de siempre). Ver auto-bases.js.
  const autoBases = crearAutoBases({
    activa: () => !!actualizador && process.env.ACTUALIZACION_AUTO !== "0",
    listar: () => listarEntrada(),
    leer: (nombre, carpeta) => { const c = carpetaEntrada(entradaDir(), carpeta); return c ? fs.readFileSync(path.join(c.ruta, nombre)) : null; },
    archivar: (nombre, carpeta) => { const c = carpetaEntrada(entradaDir(), carpeta); if (c) archivarEnCarpeta(c, nombre); },
    actualizador, respaldar,
    leerAjuste: (k) => accounts.ajuste(k), guardarAjuste: (k, v) => accounts.ajusteGuardar(k, v),
    registrar: (accion) => { try { accounts.actividadRegistrar({ ip: "automático", accion, ruta: "auto-bases", estado: 200 }); } catch { /* el registro nunca bloquea */ } },
    log: console,
  });
  // Máximo 10 claves erróneas cada 10 minutos por IP; superado el límite se bloquea esa IP aunque acierte la clave
  // Cada CLAVE distinta que falla cuenta una vez: el panel lanza varias peticiones a la vez con la misma clave y un solo
  // error al teclear no debe bloquear al administrador. Las peticiones sin clave no cuentan (no adivinan nada).
  const failures = new Map();
  const recentFailures = (key, now = Date.now()) => (failures.get(key) ?? []).filter((f) => now - f.t < 10 * 60_000);
  const ip = (req) => ipDe(req);

  const route = async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/admin/")) return false;
    const who = ip(req);
    if (recentFailures(who).length >= 10) return eventoSeguridad("panel-bloqueado-por-claves-erroneas", who), send(res, 429, { error: "Demasiados intentos. Espera unos minutos." }), true;
    if (!isAdmin(req)) {
      const presented = req.headers.authorization;
      const prev = recentFailures(who);
      if (presented && !prev.some((f) => f.h === presented)) { failures.set(who, [...prev, { t: Date.now(), h: presented }]); eventoSeguridad("panel-clave-incorrecta", who); }
      return send(res, 403, { error: "Acceso no autorizado." }), true;
    }
    // Segundo factor: con la clave bien pero SIN el permiso del código del móvil, solo se puede preguntar si hace falta y ponerlo
    if (dosFactores.activo() && p !== "/api/admin/2fa/estado" && p !== "/api/admin/2fa/entrar" && !dosFactores.permitida(req)) return send(res, 401, { error: "Falta el código de verificación del móvil.", necesita2fa: true }), true;
    { // registro de actividad: lo que cambia algo, con la hora y la dirección (sin datos de clientes ni contenido)
      const accion = etiquetaAccion(req.method, p);
      if (accion) res.on("finish", () => { try { accounts.actividadRegistrar({ ip: who, accion, ruta: p, estado: res.statusCode }); } catch {} });
    }
    const get = req.method === "GET", post = req.method === "POST";

    // ---- Resumen para los avisos ----
    if (p === "/api/admin/resumen" && get) {
      const list = orders.listOrders({ exportStatus: "pending", limit: 500 }).map(orderView);
      return send(res, 200, { clientes: customers.search({ limit: 1 }).total, cuentasSinConfirmar: accounts.listAccounts().filter((a) => !a.verified && a.status !== "deleted").length, derechosPendientes: accounts.listRightsRequests("pendiente").length, solicitudes: accounts.listRegistrations("pending").length, pedidosPendientes: list.filter((o) => o.estado === "pendiente").length, pedidosRetenidos: list.filter((o) => o.estado === "retenido").length }), true;
    }

    // ---- Seguridad: lo que el programa ha parado y lo que se ha hecho en el panel ----
    if (p === "/api/admin/seguridad" && get) return send(res, 200, { ...accounts.seguridadResumen({ horas: 24 * 7 }), actividad: accounts.actividadLista(Number(url.searchParams.get("limite") ?? 100)) }), true;

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
    const recordatorios = () => {
      const hoy = madridDay(), fechas = customers.fechasPedidos?.() ?? new Map(), app = orders.orderDays?.() ?? new Map();
      const clientes = customers.list().filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name, phone: c.phone, fechas: [...(fechas.get(c.id) ?? []), ...(app.get(c.id) ?? [])] }));
      const { avisadosHoy, nunca } = accounts.reminderSets(hoy);
      return { hoy, filas: recordatoriosDeHoy({ hoy, clientes, fijos: accounts.allStanding(), avisadosHoy, nunca, enlace: process.env.PUBLIC_URL ?? "" }) };
    };
    if (p === "/api/admin/recordatorios" && get) return send(res, 200, recordatorios()), true;
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
      if (exigeReclave(req, res, who)) return true;
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
    if (p === "/api/admin/imprimir" && post) { // IMPRIMIR DIRECTO: la hoja para imprimir de los pedidos marcados (o de todos los pendientes) SIN exportar ni marcar nada
      const body = (await readJson(req)) ?? {};
      if (body.refs !== undefined && (!Array.isArray(body.refs) || !body.refs.length || body.refs.length > 500 || !body.refs.every((r) => /^VM-\d{4}-\d{6}$/.test(String(r))))) return send(res, 400, { error: "Elige al menos un pedido válido." }), true;
      const { ready, held } = orders.previewPending({ refs: body.refs ?? null });
      if (!ready.length) return send(res, 200, { vacio: true, retenidos: held }), true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Pedidos": String(ready.length) }).end(imprimirHtml(ready, { autoprint: false }));
      return true;
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
    if (p === "/api/admin/correo-clientes" && get) return send(res, 200, accounts.correoPedidosResumen(new Date(Date.now() - 7 * 86400_000).toISOString())), true; // confirmaciones de pedido por correo a los clientes (últimos 7 días)
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
    // ---- Enlace de invitación: la oficina lo crea para un cliente y lo manda ELLA por WhatsApp; el sistema no envía nada ----
    // Opciones por enlace (invitaciones.js): días o fecha (y hora) de caducidad, usos con tope, mensaje de bienvenida, solo ver o también pedir, y si se le pide poner su código.
    { const mi = /^\/api\/admin\/clientes\/([^/]+)\/invitacion$/.exec(p);
      if (mi && post) {
        const cli = customers.getById(decodeURIComponent(mi[1]));
        if (!cli) return send(res, 404, { error: "No encontramos ese cliente." }), true;
        const base = String(process.env.CLIENTE_URL || accounts.ajuste("contacto") || (process.env.APP_MODE !== "empresa" ? process.env.PUBLIC_URL : "") || "").replace(/^(https?:\/\/[^/]+).*$/i, "$1");
        if (!/^https?:\/\//.test(base)) return send(res, 409, { error: "Falta la dirección pública de la aplicación del cliente: ponla en CLIENTE_URL (en C:\\vm\\config) o abre una vez la aplicación del cliente desde su dirección pública." }), true;
        const op = opcionesInvitacion((await readJson(req)) ?? {});
        if (op.error) return send(res, 400, { error: op.error }), true;
        const { token, caduca } = accounts.invitacionCrear(cli.id, op);
        const url = `${base}/entrar/${token}`, tel = String(cli.phone ?? cli.phones?.[0] ?? "").replace(/\D/g, "").replace(/^(0034|34)/, "");
        const texto = textoWhatsapp(accounts.ajuste("plantilla_enlace"), { nombre: cli.name, url, usos: op.usos, expiresAt: caduca });
        return send(res, 200, { ok: true, cliente: cli.name, url, caduca, usos: op.usos, soloVer: op.soloVer, pedirCodigo: op.pedirCodigo, texto, whatsapp: `https://wa.me/${/^\d{9}$/.test(tel) ? "34" + tel : ""}?text=${encodeURIComponent(texto)}`, tieneTelefono: /^\d{9}$/.test(tel) }), true;
      } }
    // Enlace para una PERSONA NUEVA (aún sin alta). Tres tipos: «alta» (abre su solicitud con el nombre puesto; no crea nada),
    // «ver» (entra a ver la app sin poder pedir; se crea un cliente provisional solo con el nombre) y «pedir» (como un cliente normal:
    // por obligación hay que rellenar su ficha —teléfono, DNI/CIF, dirección y población— y se crea como cliente provisional P0000x).
    if (p === "/api/admin/invitaciones/persona-nueva" && post) {
      const b = (await readJson(req)) ?? {}, tipo = ["alta", "ver", "pedir"].includes(b.tipo) ? b.tipo : null;
      if (!tipo) return send(res, 400, { error: "Elige qué quieres que pueda hacer: darse de alta, ver la app o pedir." }), true;
      const nombre = String(b.nombre ?? "").replace(/\s+/g, " ").trim();
      if (nombre.length < 2 || nombre.length > 80) return send(res, 400, { error: "Escribe el nombre de la persona o del negocio (de 2 a 80 letras)." }), true;
      const base = String(process.env.CLIENTE_URL || accounts.ajuste("contacto") || (process.env.APP_MODE !== "empresa" ? process.env.PUBLIC_URL : "") || "").replace(/^(https?:\/\/[^/]+).*$/i, "$1");
      if (!/^https?:\/\//.test(base)) return send(res, 409, { error: "Falta la dirección pública de la aplicación del cliente: ponla en CLIENTE_URL (en C:\\vm\\config) o abre una vez la aplicación del cliente desde su dirección pública." }), true;
      const op = opcionesInvitacion({ ...b, modo: tipo === "pedir" ? "pedir" : "ver", pedirCodigo: tipo === "pedir" ? b.pedirCodigo : false });
      if (op.error) return send(res, 400, { error: op.error }), true;
      const sinTildes = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      let customerId = "", telefono = String(b.telefono ?? "");
      if (tipo !== "alta") {
        if (!actualizador) return send(res, 404, { error: "No disponible." }), true;
        if (customers.search({ q: nombre, limit: 30 }).rows.some((c) => sinTildes(c.name) === sinTildes(nombre))) return send(res, 409, { error: `Ya hay un cliente llamado «${nombre}». Usa su enlace normal (elige «Un cliente que ya tengo») para no duplicarlo.` }), true;
        if (tipo === "pedir") { // con permiso para pedir hace falta la ficha completa
          const falta = [["telefono", "el teléfono"], ["nif", "el DNI, NIE o CIF"], ["direccion", "la dirección"], ["poblacion", "la población"]].filter(([k]) => !String(b[k] ?? "").trim()).map(([, t]) => t);
          if (falta.length) return send(res, 400, { error: `Para que pueda pedir hay que rellenar su ficha: falta ${falta.join(", ")}.` }), true;
          const seis = String(b.nif).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/\D/g, "").slice(0, 6);
          if (seis.length === 6 && customers.findByNif(seis).length) return send(res, 409, { error: "Ese DNI o CIF ya es de otro cliente. Usa el enlace de ese cliente." }), true;
        }
        try {
          const c = actualizador.anadirCliente({ nombre, telefono: b.telefono, nif: tipo === "pedir" ? b.nif : "", direccion: b.direccion, poblacion: b.poblacion, municipio: b.municipio, correo: b.correo, razonSocial: b.razonSocial, recargo: b.recargo === true }, { actualizar: false });
          customerId = c.id;
        } catch (e) { return send(res, 400, { error: e.message }), true; }
      }
      const { token, caduca } = accounts.invitacionCrear(customerId, { ...op, tipo: tipo === "alta" ? "alta" : "cliente", nombre });
      const url = `${base}/entrar/${token}`, tel = telefono.replace(/\D/g, "").replace(/^(0034|34)/, "");
      const plantilla = accounts.ajuste("plantilla_enlace") || (tipo === "alta" ? PLANTILLA_ALTA : tipo === "ver" ? PLANTILLA_VER : PLANTILLA_DEFECTO);
      const texto = textoWhatsapp(plantilla, { nombre, url, usos: op.usos, expiresAt: caduca });
      return send(res, 200, { ok: true, cliente: nombre, codigoCliente: customerId || null, tipo, url, caduca, usos: op.usos, soloVer: tipo !== "pedir", pedirCodigo: op.pedirCodigo, texto, whatsapp: `https://wa.me/${/^\d{9}$/.test(tel) ? "34" + tel : ""}?text=${encodeURIComponent(texto)}`, tieneTelefono: /^\d{9}$/.test(tel) }), true;
    }
    // Lista de enlaces (sin el enlace en sí: no se guarda) y «Anular»
    // ---- Entrada de clientes aprobada por la oficina: quién la ha pedido (con la referencia que ve él en su pantalla), aprobar, rechazar o dar un código ----
    if (p === "/api/admin/accesos" && get) {
      const vista = (x) => ({ ...x, cliente: customers.getById(x.customerId)?.name ?? `Cliente ${x.customerId}`, telefono: customers.getById(x.customerId)?.phone ?? "" });
      const r = accounts.accesoSolicitudes();
      return send(res, 200, { pendientes: r.pendientes.map(vista), recientes: r.recientes.map(vista) }), true;
    }
    { const ma = /^\/api\/admin\/accesos\/(\d+)\/(aprobar|rechazar|codigo)$/.exec(p);
      if (ma && post) {
        const id = Number(ma[1]), q = accounts.accesoSolicitudes().pendientes.find((x) => x.id === id);
        if (!q) return send(res, 404, { error: "Esa solicitud ya no está pendiente (la aprobó otra persona, caducó o se pidió otra)." }), true;
        if (ma[2] === "codigo" && q.pase) return send(res, 409, { error: "A este acceso solo se le puede «dar paso»: el cliente sigue necesitando su contraseña." }), true;
        if (ma[2] === "codigo") { // código de 6 cifras para decírselo al cliente por teléfono o WhatsApp; solo se guarda su huella (se puede generar otro)
          const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
          if (!accounts.accesoSolicitudCodigo(id, claveCodigoOficina(q.customerId, codigo))) return send(res, 409, { error: "No se pudo generar el código: la solicitud ya no está pendiente." }), true;
          return send(res, 200, { ok: true, codigo, cliente: customers.getById(q.customerId)?.name ?? "", ref: q.ref }), true;
        }
        if (!accounts.accesoSolicitudResolver(id, ma[2] === "aprobar" ? "aprobada" : "rechazada")) return send(res, 409, { error: "Esa solicitud ya no está pendiente." }), true;
        return send(res, 200, { ok: true }), true;
      } }
    // ---- Revisión de seguridad: lo que está bien y lo que hay que arreglar, con qué hacer ----
    if (p === "/api/admin/seguridad/revision" && get) {
      let cliente = null; try { cliente = JSON.parse(accounts.ajuste("estado_cliente") || "null"); } catch { /* sin datos */ }
      let copias = null; try { copias = estadoCopias(process.env.BACKUP_DIR ?? "respaldos"); } catch { /* sin carpeta */ }
      return send(res, 200, revisar({ cliente, env: process.env, copias, eventos24h: accounts.seguridadResumen({ horas: 24 }), bloqueadas: accounts.listAccounts().filter((a) => a.locked || a.status === "blocked").length, accesosNuevos7: accounts.accesosNuevos({ dias: 7 }).filter((x) => x.tipo === "primera").length, pausa: leerPausa(accounts, { fresco: true }), panel2fa: { activo: dosFactores.activo(), ilegible: dosFactores.ilegible() } })), true;
    }
    // ---- Segundo factor del panel (código del móvil) ----
    if (p === "/api/admin/2fa/estado" && get) return send(res, 200, { activo: dosFactores.activo(), ilegible: dosFactores.ilegible(), emergencia: dosFactores.recuperacionRestante(), permiso: dosFactores.permitida(req) }), true;
    if (p === "/api/admin/2fa/entrar" && post) {
      const b = (await readJson(req)) ?? {};
      if (!dosFactores.activo()) return send(res, 200, { ok: true, sinFactor: true }), true;
      if (!dosFactores.puedeProbar(who)) return eventoSeguridad("panel-2fa-bloqueado", who), send(res, 429, { error: "Demasiados códigos incorrectos. Espera 15 minutos." }), true;
      if (!dosFactores.verificar(b.codigo)) { dosFactores.fallo(who); eventoSeguridad("panel-2fa-incorrecto", who); return send(res, 401, { codigoIncorrecto: true, error: "El código no es correcto o ya se usó. Espera al siguiente de la aplicación." }), true; }
      dosFactores.acierto(who); return send(res, 200, { ok: true, token: dosFactores.abrirSesion(), emergencia: dosFactores.recuperacionRestante() }), true;
    }
    if (p === "/api/admin/2fa/preparar" && post) { if (dosFactores.activo()) return send(res, 409, { error: "El segundo factor ya está activado." }), true; return send(res, 200, dosFactores.preparar()), true; }
    if (p === "/api/admin/2fa/activar" && post) {
      const b = (await readJson(req)) ?? {};
      if (b.confirmo !== true) return send(res, 400, { error: "Hace falta confirmar." }), true;
      if (!dosFactores.puedeProbar(who)) return send(res, 429, { error: "Demasiados códigos incorrectos. Espera 15 minutos." }), true;
      const rec = dosFactores.activar(b.codigo); if (!rec) { dosFactores.fallo(who); return send(res, 400, { error: "El código no es correcto. Mira que la aplicación tenga la clave de arriba y escribe el código actual." }), true; }
      dosFactores.acierto(who); eventoSeguridad("panel-2fa-activado", "segundo factor activado"); return send(res, 200, { ok: true, emergencia: rec, token: dosFactores.abrirSesion() }), true; // los códigos de emergencia solo se enseñan ahora
    }
    if (p === "/api/admin/2fa/desactivar" && post) {
      const b = (await readJson(req)) ?? {};
      if (!dosFactores.activo()) return send(res, 409, { error: "El segundo factor no está activado." }), true;
      if (!dosFactores.puedeProbar(who)) return send(res, 429, { error: "Demasiados códigos incorrectos. Espera 15 minutos." }), true;
      if (!dosFactores.verificar(b.codigo)) { dosFactores.fallo(who); return send(res, 401, { error: "El código no es correcto." }), true; }
      dosFactores.desactivar(); eventoSeguridad("panel-2fa-desactivado", "segundo factor desactivado"); return send(res, 200, { ok: true }), true;
    }
    // ---- Pausa de emergencia: cierra las entradas nuevas y/o los pedidos nuevos hasta que se reactive ----
    if (p === "/api/admin/pausa" && get) return send(res, 200, leerPausa(accounts, { fresco: true })), true;
    if (p === "/api/admin/pausa" && post) {
      const b = (await readJson(req)) ?? {};
      if (b.confirmo !== true) return send(res, 400, { error: "Hace falta confirmar." }), true;
      for (const k of ["entradas", "pedidos"]) if (k in b && typeof b[k] !== "boolean") return send(res, 400, { error: "Valor no válido." }), true;
      const v = guardarPausa(accounts, { entradas: b.entradas, pedidos: b.pedidos, motivo: b.motivo });
      eventoSeguridad("pausa-de-emergencia", `${v.entradas ? "entradas pausadas" : "entradas abiertas"}, ${v.pedidos ? "pedidos pausados" : "pedidos abiertos"}`);
      return send(res, 200, v), true;
    }
    // ---- Contraseñas de los clientes: quién se ha activado (creó su contraseña) y restablecer si hace falta ----
    if (p === "/api/admin/accesos-nuevos" && get) return send(res, 200, { lista: accounts.accesosNuevos({ dias: 30 }).map((x) => ({ ...x, cliente: customers.getById(x.customerId)?.name ?? `Cliente ${x.customerId}`, telefono: customers.getById(x.customerId)?.phone ?? "" })) }), true;
    if (post) { const mr = /^\/api\/admin\/cliente\/([\w-]{1,20})\/password\/restablecer$/.exec(p);
      if (mr) { if (exigeReclave(req, res, who)) return true; if (!customers.getById(mr[1])) return send(res, 404, { error: "No existe ese cliente." }), true; accounts.passwordQuitar(mr[1]); return send(res, 200, { ok: true }), true; } }
    if (p === "/api/admin/invitaciones" && get) {
      const nom = (x) => (x.tipo === "alta" ? x.nombre : customers.getById(x.cliente)?.name ?? x.nombre ?? "Cliente " + x.cliente);
      return send(res, 200, { enlaces: accounts.invitacionesLista().map((x) => ({ ...x, nombre: nom(x) })), plantilla: accounts.ajuste("plantilla_enlace") || PLANTILLA_DEFECTO, plantillaDefecto: PLANTILLA_DEFECTO }), true;
    }
    { const ma = /^\/api\/admin\/invitaciones\/(\d+)\/anular$/.exec(p);
      if (ma && post) return accounts.invitacionAnular(ma[1]) ? send(res, 200, { ok: true }) : send(res, 409, { error: "Ese enlace ya estaba usado, caducado o anulado." }), true; }
    if (p === "/api/admin/invitaciones/plantilla" && post) {
      const b = (await readJson(req)) ?? {}, v = b?.restaurar ? { texto: "" } : plantillaValida(b?.texto); // «volver al de siempre» = sin texto propio (así cada tipo de enlace usa el suyo)
      if (v.error) return send(res, 400, { error: v.error }), true;
      accounts.ajusteGuardar("plantilla_enlace", v.texto);
      return send(res, 200, { ok: true, plantilla: v.texto || PLANTILLA_DEFECTO }), true;
    }
    // ---- Copias de seguridad: solo se LEEN (estado de la última copia y comprobación de que se podría restaurar); nada se restaura ni se borra desde aquí ----
    if (p === "/api/admin/copias" && get) return send(res, 200, estadoCopias(process.env.BACKUP_DIR ?? "respaldos")), true;
    if (p === "/api/admin/copias/comprobar" && post) return send(res, 200, comprobarCopias(process.env.BACKUP_DIR ?? "respaldos")), true;
    // ---- Estadísticas y patrones: se calcula aquí, se guarda unos segundos y solo LEE los pedidos (nunca cambia ni borra nada) ----
    if (p.startsWith("/api/admin/estadisticas") || p === "/api/admin/hoy" || p === "/api/admin/buscar" || /^\/api\/admin\/cliente\/[\w-]{1,20}\/ficha$/.test(p)) {
      const ahora = new Date().toISOString(), hoy = madridDay(ahora), recuento = () => accounts.ajuste("stats_desde") || null;
      const exCfg = leerExcluidos(accounts), rev = orders.ordersRevision(), exK = JSON.stringify(exCfg) + "|" + rev;
      let exRes = estCache.get("ex"); // quién es de prueba: se vuelve a resolver cuando entra, cambia o se cancela un pedido o cuando se cambia la lista
      if (!exRes || exRes.k !== exK) estCache.set("ex", (exRes = { k: exK, v: resolverExcluidos(exCfg, customers) }));
      const esPruebaId = (id) => { // comprobación directa y barata para un cliente concreto (en directo, buscador)
        const cid = String(id), nm = sinTildes(customers.getById(cid)?.name ?? "");
        return exRes.v.ids.has(cid) || exCfg.codigos.includes(cid) || [...exRes.v.nombres].some((n) => nm.includes(n)) || exCfg.nifs.some((n) => { try { return customers.checkNif?.(cid, n); } catch { return false; } });
      };
      const base = () => { // pedidos válidos desde el último reinicio, sin los de prueba (se vuelve a calcular solo si entra, cambia o se cancela algún pedido)
        const rec = recuento(), k = `${rev}|${rec}|${exRes.k}`, b = estCache.get("base");
        if (b && b.k === k) return b;
        const prep = prepararPedidos(orders.ordersForStats(rec), exRes.v), nuevo = { k, rec, ...prep };
        estCache.set("base", nuevo); estCache.delete("calc"); return nuevo;
      };
      const nombreDe = (id) => customers.getById(id)?.name ?? "Cliente " + id;
      if (p === "/api/admin/estadisticas" && get) {
        const q = Object.fromEntries(url.searchParams), b = base(), r = rangoDe(q, ahora, b.rec);
        if (r.error) return send(res, 400, { error: r.error }), true;
        const k = `${b.k}|${hoy}|${q.rango ?? "30d"}|${q.desde ?? ""}|${q.hasta ?? ""}`, calcCache = estCache.get("calc") ?? estCache.set("calc", new Map()).get("calc");
        let v = calcCache.get(k);
        if (!v) {
          v = { ...calcular(b.validos, b.excluidos, r, (id) => { try { return catalogDb?.get(id) ?? null; } catch { return null; } }), atrasados: atrasados(b.validos, ahora), generado: ahora };
          if (calcCache.size > 30) calcCache.clear(); calcCache.set(k, v);
        }
        return send(res, 200, { ...v, desdeRecuento: b.rec, sePuedeDeshacer: accounts.ajuste("stats_desde_prev") !== null, excluidosConfig: exCfg, totalPedidosContados: b.validos.length }), true;
      }
      if (p === "/api/admin/estadisticas/exportar" && get) { // descarga el periodo elegido (sin pedidos de prueba, desde el último reinicio); solo lee
        const q = Object.fromEntries(url.searchParams), b = base(), r = rangoDe(q, ahora, b.rec), formato = q.formato === "csv" ? "csv" : "xlsx";
        if (r.error) return send(res, 400, { error: r.error }), true;
        if (q.formato && !["csv", "xlsx"].includes(q.formato)) return send(res, 400, { error: "Formato no válido (xlsx o csv)." }), true;
        const v = { ...calcular(b.validos, b.excluidos, r, (id) => { try { return catalogDb?.get(id) ?? null; } catch { return null; } }, 100000), atrasados: atrasados(b.validos, ahora, 200) };
        const op = { hechoEl: madrid(ahora), contandoDesde: b.rec }, nombre = `estadisticas-${hoy}.${formato}`;
        const cuerpo = formato === "csv" ? Buffer.from(csvDeEstadisticas(v, op), "utf8") : xlsxDeEstadisticas(v, op);
        res.writeHead(200, { "Content-Type": formato === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${nombre}"`, "Cache-Control": "no-store", "Content-Length": cuerpo.length }).end(cuerpo);
        return true;
      }
      if (p === "/api/admin/estadisticas/vivo" && get) {
        const filas = accounts.presenciaAhora();
        const personas = filas.filter((f) => !esPruebaId(f.customer_id))
          .map((f) => ({ id: f.customer_id, nombre: nombreDe(f.customer_id), pantalla: f.pantalla, lineas: f.lineas, hace: Math.max(0, Math.round((Date.now() - Date.parse(f.at)) / 1000)) }));
        return send(res, 200, { viendo: personas.length, conCarrito: personas.filter((x) => x.lineas > 0).length, lineas: personas.reduce((s, x) => s + x.lineas, 0), personas: personas.slice(0, 30), actualizado: ahora }), true;
      }
      if (p === "/api/admin/estadisticas/clientes" && get) { // buscador de cliente (los de prueba no salen)
        const q = String(url.searchParams.get("q") ?? "").trim(); if (q.length < 2) return send(res, 200, []), true;
        return send(res, 200, customers.search({ q, limit: 40 }).rows.filter((c) => !esPruebaId(c.id)).slice(0, 12).map((c) => ({ id: c.id, nombre: c.name, poblacion: c.city ?? "" }))), true;
      }
      if (p === "/api/admin/estadisticas/cliente" && get) {
        const id = String(url.searchParams.get("id") ?? ""); if (!/^[\w-]{1,20}$/.test(id)) return send(res, 400, { error: "Cliente no válido." }), true;
        const b = base();
        return send(res, 200, { id, nombre: nombreDe(id), esPrueba: esPruebaId(id), desdeRecuento: b.rec, ...patronesCliente(b.validos.filter((o) => String(o.customer_id) === id), ahora) }), true;
      }
      if (p === "/api/admin/estadisticas/reiniciar" && post) { // NO borra nada: solo anota desde cuándo se cuenta
        const body = (await readJson(req)) ?? {};
        if (body.confirmo !== true) return send(res, 400, { error: "Falta la confirmación." }), true;
        accounts.ajusteGuardar("stats_desde_prev", accounts.ajuste("stats_desde") ?? ""); accounts.ajusteGuardar("stats_desde", ahora);
        estCache.delete("base"); estCache.delete("calc");
        return send(res, 200, { ok: true, desde: ahora }), true;
      }
      if (p === "/api/admin/estadisticas/deshacer" && post) {
        const prev = accounts.ajuste("stats_desde_prev"); if (prev === null) return send(res, 409, { error: "No hay ningún reinicio que deshacer." }), true;
        accounts.ajusteGuardar("stats_desde", prev); accounts.ajusteBorrar("stats_desde_prev"); estCache.delete("base"); estCache.delete("calc");
        return send(res, 200, { ok: true, desde: prev || null }), true;
      }
      if (p === "/api/admin/estadisticas/excluidos" && post) {
        const v = excluidosValidos((await readJson(req)) ?? {}); if (v.error) return send(res, 400, { error: v.error }), true;
        accounts.ajusteGuardar("stats_excluidos", JSON.stringify(v.excluidos)); estCache.delete("base"); estCache.delete("calc"); estCache.delete("ex");
        return send(res, 200, { ok: true, excluidos: v.excluidos }), true;
      }
      // ---- «Hoy»: lo que hay que mirar al abrir el panel (solo lee) ----
      if (p === "/api/admin/hoy" && get) {
        const pend = orders.listOrders({ exportStatus: "pending", limit: 500 }).map(orderView), b = base(), r = rangoDe({ rango: "hoy" }, ahora, b.rec);
        const listos = pend.filter((o) => o.estado === "pendiente"), ret = pend.filter((o) => o.estado === "retenido");
        const dia = r.error ? null : calcular(b.validos, b.excluidos, r, () => null, 0);
        const horasDesde = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3600000));
        const regs = accounts.listRegistrations("pending"), vista = (o) => ({ ref: o.ref, cliente: o.cliente, codigo: o.codigo, total: o.total, fecha: o.fecha, motivo: o.motivo });
        let problemas = []; try { problemas = estado?.().problemas ?? []; } catch { /* sin vigilancia */ }
        return send(res, 200, {
          fecha: ahora, hoy,
          dia: dia && { pedidos: dia.resumen.actual.pedidos, importe: dia.resumen.actual.importe, ayer: dia.resumen.anterior ? { pedidos: dia.resumen.anterior.pedidos, importe: dia.resumen.anterior.importe } : null },
          pedidos: { pendientes: listos.length, retenidos: ret.length, masAntiguoHoras: pend.length ? Math.max(...pend.map((o) => horasDesde(o.fecha))) : 0, listos: listos.slice(0, 6).map(vista), retenidosLista: ret.slice(0, 6).map(vista) },
          altas: { pendientes: regs.length, lista: regs.slice(0, 5).map((x) => ({ id: x.id, negocio: x.business, telefono: x.phone, creada: x.createdAt })) },
          accesos: accounts.accesoSolicitudes().pendientes.slice(0, 5).map((x) => ({ id: x.id, cliente: customers.getById(x.customerId)?.name ?? `Cliente ${x.customerId}`, ref: x.ref, creada: x.creada })),
          cuentasSinConfirmar: accounts.listAccounts().filter((a) => !a.verified && a.status !== "deleted").length, derechosPendientes: accounts.listRightsRequests("pendiente").length,
          atrasados: atrasados(b.validos, ahora, 6), recordatorios: recordatorios().filas.length, avisosHoy: accounts.avisoProgPendientes().filter((x) => x.dia === hoy).length, problemas, copias: { ok: estadoCopias(process.env.BACKUP_DIR ?? "respaldos").ok },
        }), true;
      }
      // ---- Ficha de un cliente: todo lo suyo en un sitio (sin NIF: no se guarda) ----
      { const mf = /^\/api\/admin\/cliente\/([\w-]{1,20})\/ficha$/.exec(p);
        // Editar la ficha a mano (teléfonos, correos, dirección…): se guarda aparte y las importaciones de a3ERP no lo borran
        // Olvidar los aparatos de confianza de un cliente (si perdió el móvil o se sospecha de un acceso): tendrán que volver a pedir permiso
        { const mo = /^\/api\/admin\/cliente\/([\w-]{1,20})\/aparatos\/olvidar$/.exec(p);
          if (mo && post) return send(res, 200, { ok: true, olvidados: accounts.aparatosBorrar(mo[1]) }), true; }
        if (mf && post) {
          const id = mf[1], c0 = customers.getById(id); if (!c0) return send(res, 404, { error: "No existe ese cliente." }), true;
          const v = validarEdicion((await readJson(req)) ?? {}); if (v.error) return send(res, 400, { error: v.error }), true;
          const { ofertas, ...resto } = v.patch; if (Object.keys(resto).length) customers.editar(id, resto);
          if (typeof ofertas === "boolean") accounts.ofertasSet(id, ofertas, "empresa");
          const avisos = []; // teléfono o correo que ya tiene otro cliente: se permite (hay teléfonos compartidos), pero se avisa
          for (const t of v.patch.phones ?? []) { const otros = customers.search({ q: t, limit: 5 }).rows.filter((r) => String(r.id) !== id && (String(r.phones ?? "").includes(t) || String(r.phone ?? "").includes(t))); if (otros.length) avisos.push(`El teléfono ${t} también lo tiene ${otros.map((r) => r.name).join(", ")}.`); }
          for (const e of v.patch.emails ?? []) { const otros = customers.search({ q: e, limit: 5 }).rows.filter((r) => String(r.id) !== id && String(r.emails ?? "").toLowerCase().includes(e)); if (otros.length) avisos.push(`El correo ${e} también lo tiene ${otros.map((r) => r.name).join(", ")}.`); }
          return send(res, 200, { ok: true, avisos }), true;
        }
        if (mf && get) {
          const id = mf[1], c0 = customers.getById(id), cu = accounts.listAccounts().find((a) => String(a.customerId) === id), todos = orders.listOrders({ limit: 5000 }).filter((o) => String(o.customer_id) === id), fijo = accounts.getStanding(id);
          if (!c0 && !todos.length && !cu) return send(res, 404, { error: "No existe ese cliente." }), true;
          // un cliente puede tener pedidos y no estar ya en la base de clientes (borrado o aún sin importar): se enseña lo que haya
          const c = c0 ?? { id, name: todos[0]?.name ?? "Cliente " + id, legalName: "", city: "", municipio: "", address: "", phone: "", phones: [], emails: [], recargoEquivalencia: false, active: false, orders: [] };
          const compra = c.orders?.[0] ?? null;
          return send(res, 200, {
            manual: c0 ? { telefonos: customers.manualOf(id).phones ?? [], correos: customers.manualOf(id).emails ?? [] } : null, notas: c0 ? (customers.manualOf(id).notes ?? "") : "",
            cliente: { id: c.id, nombre: c.name, razon: c.legalName, poblacion: c.city, municipio: c.municipio, direccion: c.address, telefonos: [...new Set([c.phone, ...c.phones].filter(Boolean))], correos: c.emails, recargo: c.recargoEquivalencia, activo: c.active },
            esPrueba: esPruebaId(id), sinFicha: !c0,
            ofertasCorreo: accounts.ofertasDe(id),
            correoPedidos: { destino: elegirDestino({ account: cu, customer: c }), activo: accounts.correoPedidoActivo(id), delaCuenta: !!cu?.email && elegirDestino({ account: cu, customer: c }) === cu.email },
            cuenta: cu ? { estado: cu.status, confirmada: cu.verified, bloqueada: cu.locked, ultimoAcceso: cu.lastLogin, creada: cu.createdAt, codigoPropio: cu.ownCode } : null,
            aparatos: accounts.aparatosDe(id).length, password: accounts.passwordInfo(id),
            totalPedidosApp: todos.length,
            pedidos: todos.slice(0, 12).map(orderView).map((o) => ({ ref: o.ref, fecha: o.fecha, entrega: o.entrega?.texto ?? "", total: o.total, estado: o.estado, modificado: o.modificado, lineas: o.lineas.slice(0, 30).map((l) => ({ nombre: l.nombre, unidades: l.unidades, cajas: l.unidad === "caja" ? l.cajas : 0 })) })),
            erp: { pedidos: c.orders?.length ?? 0, ultimo: compra?.date ?? null },
            patrones: patronesCliente(base().validos.filter((o) => String(o.customer_id) === id), ahora),
            fijo: fijo && { dias: fijo.days, pausado: fijo.paused, saltaSemana: fijo.skipWeek, articulos: fijo.lines?.length ?? 0 },
            enlaces: accounts.invitacionesLista().filter((x) => String(x.cliente) === id).slice(0, 5),
          }), true;
        } }
      // ---- Buscador general (clientes, pedidos por referencia y artículos) ----
      if (p === "/api/admin/buscar" && get) {
        const q = String(url.searchParams.get("q") ?? "").trim().slice(0, 60), vacio = { clientes: [], pedidos: [], articulos: [] };
        if (q.length < 2) return send(res, 200, vacio), true;
        const nq = sinTildes(q), ql = q.toLowerCase();
        const clientes = customers.search({ q, limit: 40 }).rows.filter((c) => !esPruebaId(c.id)).slice(0, 6).map((c) => ({ id: c.id, nombre: c.name, poblacion: c.city ?? "", telefono: c.phone ?? "" }));
        const pedidos = /\d/.test(q) ? orders.listOrders({ limit: 5000 }).filter((o) => String(o.ref).toLowerCase().includes(ql)).slice(0, 5).map((o) => ({ ref: o.ref, cliente: o.name, codigo: o.customer_id, fecha: o.created_at })) : [];
        let articulos = []; try { articulos = catalogDb ? catalogDb.list({ activeOnly: false }).filter((x) => sinTildes(`${x.id} ${x.name}`).includes(nq)).slice(0, 6).map((x) => ({ id: x.id, nombre: x.name, precio: x.price, activo: x.active })) : []; } catch { /* sin catálogo */ }
        return send(res, 200, { clientes, pedidos, articulos }), true;
      }
    }
    // ---- Errores de la app del cliente (últimos 7 días): recuento por tipo, por cliente y por API ----
    if (p === "/api/admin/errores" && get) {
      const r = accounts.erroresResumen({ dias: Math.min(30, Math.max(1, Number(url.searchParams.get("dias") ?? 7) || 7)) });
      const nom = (id) => (id == null ? "Sin sesión (pantalla de acceso)" : customers.getById(id)?.name ?? "Cliente " + id);
      return send(res, 200, { ...r, porCliente: r.porCliente.map((x) => ({ ...x, nombre: nom(x.cliente) })), ultimos: r.ultimos.map((x) => ({ ...x, nombre: nom(x.cliente) })) }), true;
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
    // ---- Artículos ----
    if (p === "/api/admin/articulos" && get) {
      if (!catalogDb) return send(res, 404, { error: "No disponible." }), true;
      const q = sinTildes(url.searchParams.get("q") ?? "").slice(0, 60), cat = url.searchParams.get("categoria") ?? "", filtro = url.searchParams.get("filtro") ?? "";
      const pagina = Math.max(0, Number(url.searchParams.get("pagina")) || 0), por = 50, hoy = hoyMadrid();
      const cambios = catalogDb.ultimosCambiosDePrecio(), hechos = catalogDb.avisosHechos();
      const todas = catalogDb.list({ activeOnly: filtro !== "retirados" }).filter((x) => filtro !== "retirados" || !x.active).map((x) => {
        const k = categorizar(x), vig = promoVigente(x, hoy), ch = cambios.get(x.id) ?? null, cp = campanaDe(x, ch, hoy), hecho = cp && hechos.get(x.id)?.clave === cp.clave ? hechos.get(x.id).at : null;
        return { id: x.id, nombre: x.name, categoria: k.catNombre, categoriaId: k.cat, precio: x.price, descuento: x.discount ?? 0, unidadesPorCaja: x.unitsPerBox ?? null, iva: x.vat, activo: x.active,
          oferta: vig ? { tipo: vig.tipo, valor: Number(vig.valor), hasta: vig.hasta ?? null } : null, ofertaCaducada: x.promo && !vig ? { tipo: x.promo.tipo, valor: Number(x.promo.valor), hasta: x.promo.hasta ?? null } : null,
          cambioPrecio: ch ? { antes: ch.antes, despues: ch.despues, at: ch.at } : null, campana: cp?.tipo ?? null, aviso: cp ? { titulo: cp.titulo, texto: cp.texto } : null, avisado: hecho };
      });
      const filas = todas.filter((x) => (!q || sinTildes(`${x.id} ${x.nombre}`).includes(q)) && (!cat || x.categoriaId === cat) && (filtro !== "oferta" || x.oferta) && (filtro !== "bajada" || x.campana === "bajada") && (filtro !== "campana" || x.campana) && (filtro !== "fotopequena" || fotos.info(x.id).calidad === "pequena") && (filtro !== "sinfoto" || !fotos.info(x.id).existe));
      const categorias = [...new Map(todas.map((x) => [x.categoriaId, x.categoria])).entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
      return send(res, 200, { total: filas.length, pagina, porPagina: por, categorias, conOferta: todas.filter((x) => x.oferta).length, filas: filas.slice(pagina * por, pagina * por + por).map((x) => ({ ...x, foto: fotos.info(x.id) })) }), true;
    }
    // ---- Cambiar la foto de un artículo (la anterior se guarda en «anteriores», nunca se borra) ----
    { const mf = /^\/api\/admin\/articulos\/([\w.-]{1,40})\/foto$/.exec(p);
      if (mf && post) {
        if (!catalogDb?.get(mf[1])) return send(res, 404, { error: "No existe ese artículo." }), true;
        const buf = await readBuffer(req, FOTO_MAX + 1000).catch(() => null); if (!buf) return send(res, 413, { error: `La foto pesa demasiado (máximo ${FOTO_MAX / 1_000_000} MB).` }), true;
        const r = fotos.guardar(mf[1], buf, req.headers["content-type"]); if (r.error) return send(res, 400, { error: r.error }), true;
        return send(res, 200, r), true;
      } }
    // ---- Poner fotos desde un ZIP: primero se revisa (no cambia nada) y luego se aplican solo las que se confirman ----
    if (p === "/api/admin/fotos/zip" && post) {
      if (!fotosZip || !imgDir) return send(res, 400, { error: "Este programa no tiene catálogo o carpeta de fotos configurados." }), true;
      const buf = await readBuffer(req, MAX_ZIP); if (!buf) return send(res, 413, { error: `El zip pesa demasiado (máximo ${MAX_ZIP / 1_000_000} MB).` }), true;
      const r = fotosZip.vista(buf); return send(res, r.error ? 400 : 200, r), true;
    }
    if (p === "/api/admin/fotos/zip/aplicar" && post && fotosZip) {
      const b = (await readJson(req)) ?? {};
      if (b.confirmo !== true) return send(res, 400, { error: "Falta la confirmación." }), true;
      const r = fotosZip.aplicar(String(b.token ?? ""), Array.isArray(b.ids) ? b.ids.slice(0, 2000) : [], { forzar: b.forzar === true });
      return send(res, r.error ? 400 : 200, r), true;
    }
    m = /^\/api\/admin\/articulos\/([\w.-]{1,40})\/(precio|oferta|avisar)$/.exec(p);
    if (m && post && catalogDb) {
      const prod = catalogDb.get(m[1]);
      if (!prod) return send(res, 404, { error: "No existe ese artículo." }), true;
      const b = (await readJson(req)) ?? {};
      try {
        if (m[2] === "precio") {
          const precio = Math.round(Number(String(b.precio ?? "").replace(",", ".")) * 10000) / 10000;
          if (!Number.isFinite(precio) || precio <= 0 || precio > 100000) return send(res, 400, { error: "Escribe un precio mayor que 0." }), true;
          if (prod.promo?.tipo === "eur" && Number(prod.promo.valor) >= precio) return send(res, 400, { error: "El descuento en € que tiene ahora es mayor que ese precio: quita antes la oferta." }), true;
          return send(res, 200, { ok: true, cambio: catalogDb.update(prod.id, { price: precio }) }), true;
        }
        if (m[2] === "oferta") {
          if (b.tipo === "ninguna") return send(res, 200, { ok: true, cambio: catalogDb.setPromo(prod.id, null) }), true;
          const hasta = b.hasta ? String(b.hasta) : null;
          if (hasta && hasta < hoyMadrid()) return send(res, 400, { error: "La fecha de fin ya ha pasado." }), true;
          return send(res, 200, { ok: true, cambio: catalogDb.setPromo(prod.id, { tipo: b.tipo, valor: Number(String(b.valor ?? "").replace(",", ".")), hasta }) }), true;
        }
        // avisar: la campana. El texto lo arma el servidor con el estado real del artículo (no se fía de lo que mande la pantalla)
        if (b.confirmo !== true) return send(res, 400, { error: "Falta la confirmación para avisar." }), true;
        const cp = campanaDe(prod, catalogDb.ultimosCambiosDePrecio().get(prod.id) ?? null);
        if (!cp) return send(res, 400, { error: "Este artículo no tiene una oferta ni una bajada de precio reciente que avisar." }), true;
        if (accounts.pushLogCount(new Date(Date.now() - 3600_000).toISOString()) >= 10) return send(res, 400, { error: "Ya has enviado 10 avisos en la última hora. Espera un poco para no molestar a los clientes." }), true; // (no 429: el panel lo confundiría con el bloqueo de la clave)
        const r = await avisos.aTodos({ title: cp.titulo, body: cp.texto, url: "/cliente", tag: "oferta-" + prod.id });
        accounts.pushLogAdd({ titulo: cp.titulo, texto: cp.texto, destino: "todos", enviados: r.enviados, fallidos: r.fallidos, detalle: r.errores?.join(" · ") || null });
        if (r.enviados > 0) catalogDb.avisoHecho(prod.id, cp.clave);
        return send(res, 200, { ok: true, ...r, titulo: cp.titulo }), true;
      } catch (e) { return send(res, 400, { error: e.message || "No se pudo guardar." }), true; }
    }
    // ---- Avisos al móvil de los clientes (Web Push) ----
    if (p === "/api/admin/avisos" && get) return send(res, 200, { ...accounts.pushResumen(), contacto: avisos.contacto(), ultimos: accounts.pushLogList(15) }), true;
    if (p === "/api/admin/avisos/enviar" && post) {
      const b = (await readJson(req)) ?? {};
      const titulo = String(b.titulo ?? "").trim(), texto = String(b.texto ?? "").trim();
      if (b.confirmo !== true) return send(res, 400, { error: "Falta la confirmación para enviar." }), true;
      if (!titulo || titulo.length > 50 || !texto || texto.length > 180) return send(res, 400, { error: "Escribe un título (máximo 50 letras) y un mensaje (máximo 180)." }), true;
      if (b.destino !== "todos" && b.destino !== "cliente") return send(res, 400, { error: "Elige a quién enviarlo." }), true;
      const cli = b.destino === "cliente" ? customers.getById(String(b.clienteId ?? "")) : null;
      if (b.destino === "cliente" && !cli) return send(res, 400, { error: "Elige un cliente de la lista." }), true;
      if (accounts.pushLogCount(new Date(Date.now() - 3600_000).toISOString()) >= 10) return send(res, 400, { error: "Ya has enviado 10 avisos en la última hora. Espera un poco para no molestar a los clientes." }), true; // (no 429: el panel lo confundiría con el bloqueo de la clave)
      const mensaje = { title: titulo, body: texto, url: "/cliente", tag: "aviso-" + Date.now() };
      const r = cli ? await avisos.aCliente(cli.id, mensaje) : await avisos.aTodos(mensaje);
      accounts.pushLogAdd({ titulo, texto, destino: cli ? `${cli.id} ${cli.name}` : "todos", enviados: r.enviados, fallidos: r.fallidos, detalle: r.errores?.join(" · ") || null });
      return send(res, 200, { ok: true, ...r }), true;
    }
    // ---- Avisos programados (promociones y descuentos): se confirman aquí y salen solos a su hora; se pueden cancelar mientras estén pendientes ----
    if (p === "/api/admin/avisos/programados" && get) {
      const nom = (x) => ({ ...x, para: x.destino === "todos" ? "Todos los clientes con avisos" : (customers.getById(x.clienteId)?.name ?? "Cliente " + x.clienteId) });
      return send(res, 200, { pendientes: accounts.avisoProgPendientes().map(nom), historial: accounts.avisoProgHistorial(15).map(nom), maximo: MAX_PENDIENTES }), true;
    }
    if (p === "/api/admin/avisos/programar" && post) {
      const v = validarProgramado((await readJson(req)) ?? {}, { existeCliente: (id) => !!customers.getById(id) });
      if (v.error) return send(res, 400, { error: v.error }), true;
      if (accounts.avisoProgCuentaPendientes() >= MAX_PENDIENTES) return send(res, 400, { error: `Ya hay ${MAX_PENDIENTES} avisos programados. Cancela alguno para añadir más.` }), true;
      const id = accounts.avisoProgAdd(v.aviso);
      return send(res, 200, { ok: true, id, cuando: v.aviso.cuando }), true;
    }
    { const mc = /^\/api\/admin\/avisos\/programados\/(\d+)\/cancelar$/.exec(p);
      if (mc && post) return accounts.avisoProgCancelar(mc[1]) ? send(res, 200, { ok: true }) : send(res, 409, { error: "Ese aviso ya salió, se canceló o no existe." }), true; }
    // ---- Correos a clientes (promociones, descuentos, avisos de servicio): ahora o programados; las promociones solo a quien ha aceptado ofertas ----
    {
      const smtpCfg = () => smtpDesdeEntorno(), baseCliente = () => String(process.env.CLIENTE_URL || accounts.ajuste("contacto") || (process.env.APP_MODE !== "empresa" ? process.env.PUBLIC_URL : "") || "").replace(/^(https?:\/\/[^/]+).*$/i, "$1");
      const parte = (x) => ({ ...x, para: x.destino === "todos" ? (x.tipo === "promo" ? "Todos los que aceptan ofertas" : "Todos los clientes con correo") : (customers.getById(x.clienteId)?.name ?? "Cliente " + x.clienteId), tipoTexto: TIPOS_CORREO[x.tipo] });
      const lanzar = () => enviarCampanas({ accounts, contactos: () => customers.contactos(), smtp: smtpCfg()?.smtp, from: smtpCfg()?.from, base: baseCliente, negocio: "Distribuciones Valentín Martín", telefono: process.env.AYUDA_TEL ?? "" }).catch((e) => console.error("Correos a clientes:", e.message));
      if (p === "/api/admin/correos" && get) {
        const desde = new Date(Date.now() - 86400_000).toISOString();
        return send(res, 200, { configurado: !!smtpCfg(), baseLista: /^https?:\/\//.test(baseCliente()), destinoPrueba: (process.env.MAIL_TO ?? "").split(",").map((x) => x.trim()).filter(Boolean), limiteDia: limiteDia(), enviadosHoy: accounts.correosEnviadosDesde(desde), aceptanOfertas: accounts.ofertasAceptan().size, maximo: MAX_CAMPANAS, pendientes: accounts.campanaCorreoPendientes().map(parte), historial: accounts.campanaCorreoHistorial(15).map(parte) }), true;
      }
      if (p === "/api/admin/correos/audiencia" && post) {
        const b = (await readJson(req)) ?? {}; if (!Object.hasOwn(TIPOS_CORREO, b.tipo) || (b.destino !== "todos" && b.destino !== "cliente")) return send(res, 400, { error: "Elige el tipo y a quién." }), true;
        if (b.destino === "cliente" && !customers.getById(String(b.clienteId ?? ""))) return send(res, 400, { error: "Elige un cliente de la lista." }), true;
        const a = audiencia({ accounts, contactos: customers.contactos(), campana: { tipo: b.tipo, destino: b.destino, clienteId: b.destino === "cliente" ? String(b.clienteId) : null } });
        return send(res, 200, { enviaria: a.destinatarios.length, sinCorreo: a.sinCorreo, sinPermiso: a.sinPermiso, total: a.total, ejemplos: a.destinatarios.slice(0, 3).map((d) => d.nombre) }), true;
      }
      if ((p === "/api/admin/correos/vista" || p === "/api/admin/correos/prueba") && post) {
        const b = (await readJson(req)) ?? {}, asunto = String(b.asunto ?? "").trim(), texto = String(b.texto ?? "").trim();
        if (!Object.hasOwn(TIPOS_CORREO, b.tipo) || !asunto || !texto) return send(res, 400, { error: "Escribe el asunto y el mensaje." }), true;
        const m = mensajeCampana({ asunto, texto, tipo: b.tipo }, { nombre: "BAR EJEMPLO", base: baseCliente() || "https://tu-direccion.es", token: "enlace-de-baja-de-ejemplo", negocio: "Distribuciones Valentín Martín", telefono: process.env.AYUDA_TEL ?? "" });
        if (p.endsWith("/vista")) return send(res, 200, { asunto: m.subject, texto: m.text }), true;
        const cfg = smtpCfg(), to = (process.env.MAIL_TO ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (!cfg) return send(res, 400, { error: "El correo no está configurado en este programa (SMTP_HOST…)." }), true;
        if (!to.length) return send(res, 400, { error: "Falta MAIL_TO (el correo de la empresa donde recibir la prueba)." }), true;
        try { await sendMail(cfg.smtp, { from: cfg.from, to, subject: "[PRUEBA] " + m.subject, text: m.text, headers: [] }); return send(res, 200, { ok: true, a: to }), true; } catch (e) { return send(res, 502, { error: e.message }), true; }
      }
      if (p === "/api/admin/correos/programar" && post) {
        if (!smtpCfg()) return send(res, 400, { error: "El correo no está configurado en este programa (SMTP_HOST, SMTP_USER, SMTP_PASS y MAIL_FROM en empresa.env)." }), true;
        const v = validarCampana((await readJson(req)) ?? {}, { existeCliente: (id) => !!customers.getById(id) }); if (v.error) return send(res, 400, { error: v.error }), true;
        if (v.campana.tipo === "promo" && !/^https?:\/\//.test(baseCliente())) return send(res, 400, { error: "Falta la dirección pública de la aplicación del cliente (CLIENTE_URL en empresa.env): sin ella no se puede poner en el correo el enlace de baja que exige la ley." }), true;
        const a = audiencia({ accounts, contactos: customers.contactos(), campana: v.campana });
        if (!a.destinatarios.length) return send(res, 400, { error: v.campana.tipo === "promo" ? `No hay a quién enviarlo: ${a.sinPermiso} cliente${a.sinPermiso === 1 ? "" : "s"} con correo no ha${a.sinPermiso === 1 ? "" : "n"} aceptado recibir ofertas (lo aceptan en «Mi cuenta» o lo marcas tú en su ficha si te han dado permiso) y ${a.sinCorreo} no tienen correo.` : `No hay a quién enviarlo: ${a.sinCorreo} sin correo guardado.` }), true;
        if (accounts.campanaCorreoCuenta() >= MAX_CAMPANAS) return send(res, 400, { error: `Ya hay ${MAX_CAMPANAS} correos programados. Cancela alguno para añadir más.` }), true;
        const id = accounts.campanaCorreoAdd(v.campana);
        if (v.campana.ahora) void lanzar(); // sale ya, en segundo plano: el panel va viendo el resultado
        return send(res, 200, { ok: true, id, enviaria: a.destinatarios.length, ahora: v.campana.ahora }), true;
      }
      { const mc = /^\/api\/admin\/correos\/(\d+)\/cancelar$/.exec(p);
        if (mc && post) return accounts.campanaCorreoCancelar(mc[1]) ? send(res, 200, { ok: true }) : send(res, 409, { error: "Ese correo ya salió, se canceló o no existe." }), true; }
    }
    // ---- Bandeja de entrada (carpeta del ordenador) ----
    if (p === "/api/admin/entrada" && get) return send(res, 200, listarEntrada()), true;
    if (p === "/api/admin/entrada/archivo" && get) {
      const n = url.searchParams.get("nombre") ?? "", dir = entradaDir(), c = dir ? carpetaEntrada(dir, url.searchParams.get("carpeta") ?? "") : null;
      if (!c || !nombreValido(n) || !fs.existsSync(path.join(c.ruta, n))) return send(res, 404, { error: "No existe ese archivo en la carpeta." }), true;
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" }).end(fs.readFileSync(path.join(c.ruta, n)));
      return true;
    }
    if (p === "/api/admin/entrada/archivar" && post) { // el archivo ya se aplicó (o no hace falta): pasa a «aplicados», con la fecha delante
      const b = (await readJson(req)) ?? {}, dir = entradaDir(), c = dir ? carpetaEntrada(dir, typeof b.carpeta === "string" ? b.carpeta : "") : null;
      if (!c || !nombreValido(b.nombre) || !fs.existsSync(path.join(c.ruta, b.nombre))) return send(res, 404, { error: "No existe ese archivo en la carpeta." }), true;
      try {
        archivarEnCarpeta(c, b.nombre);
        return send(res, 200, { ok: true }), true;
      } catch (e) { return send(res, 409, { error: "No se pudo mover el archivo. Si lo tienes abierto en Excel, ciérralo y vuelve a intentarlo." }), true; }
    }
    // ---- Actualizar datos desde un Excel: vista previa de los cambios y aplicar solo las diferencias ----
    m = /^\/api\/admin\/(vista-previa|aplicar)\/(productos|clientes|historial|fotos)$/.exec(p);
    if (m && post) {
      if (!actualizador) return send(res, 400, { error: "La actualización de datos no está disponible." }), true;
      if (m[1] === "aplicar" && m[2] === "productos" && exigeReclave(req, res, who)) return true; // cambiar la tarifa entera: hay que volver a escribir la clave
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
  route.autoBases = autoBases; // server.js la pone en marcha cada minuto
  return route;
}
