// Vigilancia del sistema: calcula el estado (pedidos, altas, sincronización, copias, disco, correo) y los PROBLEMAS que hay que mirar.
// Lo usan: GET /api/admin/estado (para Claude u otra herramienta), el informe diario por correo y los avisos de problemas nuevos.
import fs from "node:fs";
import path from "node:path";

const horas = (desde, ahora) => Math.round(((ahora - new Date(desde).getTime()) / 3_600_000) * 10) / 10;

/**
 * deps: { pedidosPendientes: () => [{ fecha, estado }], solicitudesPendientes: () => [{ createdAt }], cuentasSinConfirmar: () => n,
 *         sync: { status() } | null, correo: { status() } | null, copiasDir: string, dataDir: string, catalogo: () => { activos, sinPrecio }, ahora: () => ms }
 * umbrales: { pedidoHoras, altaHoras, retenidoHoras, copiaHoras, discoMB }
 */
export function estadoSistema(deps, umbrales = {}) {
  const u = { pedidoHoras: 12, altaHoras: 24, retenidoHoras: 3, copiaHoras: 30, discoMB: 1024, ...umbrales };
  const ahora = deps.ahora?.() ?? Date.now();
  const problemas = [];
  const pedidos = deps.pedidosPendientes();
  const retenidos = pedidos.filter((p) => p.estado === "retenido"), listos = pedidos.filter((p) => p.estado !== "retenido");
  const masViejo = (l) => (l.length ? Math.max(...l.map((p) => horas(p.fecha, ahora))) : 0);
  if (listos.length && masViejo(listos) > u.pedidoHoras) problemas.push({ clave: "pedidos-sin-exportar", gravedad: "media", texto: `Hay ${listos.length} pedidos sin exportar; el más antiguo lleva ${masViejo(listos)} h.` });
  if (retenidos.length && masViejo(retenidos) > u.retenidoHoras) problemas.push({ clave: "pedidos-retenidos", gravedad: "media", texto: `${retenidos.length} pedidos retenidos esperan revisión desde hace ${masViejo(retenidos)} h (cliente sin código, cuenta sin confirmar o pedido dudoso).` });

  const solicitudes = deps.solicitudesPendientes();
  const altaVieja = solicitudes.length ? Math.max(...solicitudes.map((s) => horas(s.createdAt, ahora))) : 0;
  if (altaVieja > u.altaHoras) problemas.push({ clave: "altas-sin-resolver", gravedad: "alta", texto: `${solicitudes.length} solicitudes de alta sin resolver; la más antigua lleva ${altaVieja} h (se prometió contestar en 24-48 h).` });

  const sync = deps.sync?.status?.() ?? null;
  if (sync?.configurado) {
    const err = sync.ultima && sync.ultima.ok === false;
    if (err) problemas.push({ clave: "sync-error", gravedad: "alta", texto: `La última sincronización con Drive falló: ${(sync.ultima.resultados ?? []).filter((r) => r.estado === "error").map((r) => `${r.tipo}: ${r.detalle}`).join("; ") || "error desconocido"}.` });
    else if (sync.ultima?.at && horas(sync.ultima.at, ahora) > Math.max(2, (sync.cadaMinutos ?? 15) / 60 * 8)) problemas.push({ clave: "sync-parada", gravedad: "media", texto: `La sincronización con Drive no se ha ejecutado desde hace ${horas(sync.ultima.at, ahora)} h.` });
  }

  const correo = deps.correo?.status?.() ?? null;
  if (!correo) problemas.push({ clave: "correo-sin-configurar", gravedad: "media", texto: "Los avisos de pedido por correo no están configurados (SMTP_HOST, MAIL_TO…)." });
  else if (correo.ultimoError) problemas.push({ clave: "correo-error", gravedad: "alta", texto: `Falla el envío de avisos por correo: ${correo.ultimoError.message}.` });

  let copia = null;
  try {
    const f = fs.readdirSync(deps.copiasDir).filter((n) => /\.sqlite$/.test(n)).map((n) => ({ n, t: fs.statSync(path.join(deps.copiasDir, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    if (f) copia = { archivo: f.n, hace: horas(new Date(f.t).toISOString(), ahora) };
  } catch { /* carpeta aún inexistente */ }
  if (!copia) problemas.push({ clave: "sin-copias", gravedad: "alta", texto: "No hay ninguna copia de seguridad todavía." });
  else if (copia.hace > u.copiaHoras) problemas.push({ clave: "copia-antigua", gravedad: "alta", texto: `La última copia de seguridad tiene ${copia.hace} h.` });

  let discoLibreMB = null;
  try { const s = fs.statfsSync(deps.dataDir); discoLibreMB = Math.round((s.bavail * s.bsize) / 1048576); } catch { /* no disponible */ }
  if (discoLibreMB !== null && discoLibreMB < u.discoMB) problemas.push({ clave: "disco-lleno", gravedad: "alta", texto: `Quedan solo ${discoLibreMB} MB libres en el disco.` });

  const cat = deps.catalogo?.() ?? null;
  return {
    fecha: new Date(ahora).toISOString(),
    funcionando: true,
    pedidos: { pendientes: listos.length, retenidos: retenidos.length, masAntiguoHoras: masViejo(pedidos) },
    altas: { solicitudesPendientes: solicitudes.length, masAntiguaHoras: altaVieja, cuentasSinConfirmar: deps.cuentasSinConfirmar() },
    sincronizacion: sync && { configurado: sync.configurado, ultima: sync.ultima ?? null },
    correo: correo && { destino: correo.destino, enviados: correo.enviados, ultimoError: correo.ultimoError },
    copias: copia, discoLibreMB, catalogo: cat,
    problemas,
  };
}

/** Texto del informe (correo diario o aviso). */
export function informeTexto(e, { titulo = "Informe diario" } = {}) {
  const L = [`${titulo} · ${e.fecha.slice(0, 16).replace("T", " ")} UTC`, ""];
  L.push(e.problemas.length ? `⚠ ${e.problemas.length} cosa(s) que mirar:` : "✔ Todo en orden.");
  for (const p of e.problemas) L.push(`  - [${p.gravedad}] ${p.texto}`);
  L.push("", `Pedidos pendientes de exportar: ${e.pedidos.pendientes} · retenidos: ${e.pedidos.retenidos}`, `Solicitudes de alta pendientes: ${e.altas.solicitudesPendientes} · cuentas sin confirmar: ${e.altas.cuentasSinConfirmar}`);
  if (e.catalogo) L.push(`Catálogo: ${e.catalogo.activos} productos activos`);
  if (e.copias) L.push(`Última copia de seguridad: hace ${e.copias.hace} h`);
  if (e.discoLibreMB !== null) L.push(`Disco libre: ${e.discoLibreMB} MB`);
  return L.join("\n");
}

/**
 * Vigilante: comprueba cada `cadaMin` minutos y manda un correo cuando aparece un problema NUEVO (o sigue 6 h después),
 * y un informe diario a la hora indicada (Madrid). Nunca lanza.
 * deps: { estado: () => estadoSistema, enviar: ({subject,text}) => Promise, ahora?, log? }
 */
export function crearVigilante({ estado, enviar, ahora = () => Date.now(), log = console, cadaMin = 15, informeA = process.env.REPORT_TIME ?? "08:30", repetirHoras = 6 }) {
  const avisados = new Map(); // clave → último aviso (ms)
  let ultimoInforme = "", timer = null;
  const horaMadrid = (ms) => new Date(ms).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });
  const diaMadrid = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  async function pasada() {
    try {
      const e = estado(), t = ahora();
      const nuevos = e.problemas.filter((p) => t - (avisados.get(p.clave) ?? 0) > repetirHoras * 3_600_000);
      for (const k of [...avisados.keys()]) if (!e.problemas.some((p) => p.clave === k)) avisados.delete(k); // resuelto: si vuelve, se avisa de nuevo
      if (nuevos.length) {
        await enviar({ subject: `[VM vigilancia] ${nuevos.length} aviso(s): ${nuevos[0].texto.slice(0, 60)}`, text: informeTexto({ ...e, problemas: nuevos }, { titulo: "Aviso" }) });
        for (const p of nuevos) avisados.set(p.clave, t);
      }
      if (horaMadrid(t) >= informeA && ultimoInforme !== diaMadrid(t)) {
        await enviar({ subject: `[VM informe] ${e.problemas.length ? `${e.problemas.length} aviso(s)` : "todo en orden"} · ${diaMadrid(t)}`, text: informeTexto(e) });
        ultimoInforme = diaMadrid(t);
      }
    } catch (err) { log.error("Vigilancia:", err.message); }
  }
  return {
    pasada,
    start() { if (timer) return; setTimeout(() => pasada(), 60_000).unref?.(); timer = setInterval(pasada, cadaMin * 60_000); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
  };
}
