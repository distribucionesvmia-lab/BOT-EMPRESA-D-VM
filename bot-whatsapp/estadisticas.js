// Estadísticas y patrones de compra del panel de la empresa. Todo se calcula aquí (en el servidor) a partir de los pedidos; solo LEE.
// - Los pedidos de prueba (nombres, códigos de cliente y NIF configurables) NUNCA cuentan.
// - «Reiniciar estadísticas» guarda solo la fecha de inicio del recuento: no se borra ningún pedido.
import { totals } from "./pricing.js";
import { madridDay, addDays, daysBetween } from "./delivery.js";
import { madridAIso } from "./invitaciones.js";
import { categorizar } from "./categorias.js";

export const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Usuarios de prueba por defecto (se pueden cambiar en el panel o con la variable STATS_EXCLUIR, nombres separados por «;»). */
export const EXCLUIDOS_DEFECTO = { nombres: ["PABLO MARTÍN CASTAÑEDA", "ENRIQUE MARTÍN GALLEGO"], codigos: [], nifs: ["818181"] };

const limpiaLista = (l, max = 50, largo = 80) => [...new Set((Array.isArray(l) ? l : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, largo)).filter(Boolean))].slice(0, max);

/** Valida lo que manda el panel. */
export function excluidosValidos(b) {
  if (!b || typeof b !== "object") return { error: "Solicitud no válida." };
  const nombres = limpiaLista(b.nombres), codigos = limpiaLista(b.codigos, 50, 20), nifs = limpiaLista(b.nifs, 20, 12).map((x) => x.replace(/\D/g, "").slice(0, 6)).filter((x) => x.length === 6);
  if (nombres.some((n) => sinTildes(n).length < 4)) return { error: "Cada nombre debe tener al menos 4 letras (si no, podría excluir pedidos que no son de prueba)." };
  return { excluidos: { nombres, codigos, nifs } };
}

/** Lista de excluidos guardada (o la de por defecto + STATS_EXCLUIR). */
export function leerExcluidos(accounts, env = process.env) {
  try { const v = JSON.parse(accounts.ajuste("stats_excluidos") ?? "null"); if (v && Array.isArray(v.nombres)) return { nombres: limpiaLista(v.nombres), codigos: limpiaLista(v.codigos, 50, 20), nifs: limpiaLista(v.nifs, 20, 6) }; } catch { /* se usa la de por defecto */ }
  const extra = String(env.STATS_EXCLUIR ?? "").split(";").map((x) => x.trim()).filter((x) => x.length >= 4);
  return { nombres: limpiaLista([...EXCLUIDOS_DEFECTO.nombres, ...extra]), codigos: [...EXCLUIDOS_DEFECTO.codigos], nifs: [...EXCLUIDOS_DEFECTO.nifs] };
}

/** { nombres:Set (sin tildes ni mayúsculas), ids:Set } con los clientes de prueba: por nombre, por código y por NIF (6 primeros dígitos). */
export function resolverExcluidos(cfg, customers) {
  const nombres = new Set(cfg.nombres.map(sinTildes).filter(Boolean)), ids = new Set(cfg.codigos.map(String));
  try { for (const nif of cfg.nifs) for (const id of customers.findByNif?.(nif) ?? []) ids.add(String(id)); } catch { /* sin ese dato, solo nombres y códigos */ }
  try {
    for (const n of nombres) for (const palabra of n.split(" ").filter((w) => w.length >= 4).slice(0, 2)) // la búsqueda del directorio distingue tildes: se busca por una palabra y se confirma sin tildes
      for (const c of customers.search?.({ q: palabra, limit: 200 })?.rows ?? []) if (sinTildes(`${c.name} ${c.legal_name ?? c.legalName ?? ""}`).includes(n)) ids.add(String(c.id));
  } catch { /* idem */ }
  return { nombres, ids };
}

export const esDePrueba = (o, ex) => (o.customer_id != null && ex.ids.has(String(o.customer_id))) || [...ex.nombres].some((n) => sinTildes(o.name).includes(n));

const DIAS_SEM = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
const amountOf = (l) => l.amount ?? Math.round((l.units ?? l.qty) * (l.price ?? 0) * (1 - (l.discount ?? 0) / 100) * 100) / 100;
const unidadesDe = (l) => Number(l.units ?? l.qty) || 0;
const centimos = (n) => Math.round(Number(n) * 100);

/** Separa los pedidos de prueba y añade a cada pedido su día, hora y día de la semana (hora de Madrid) y su total con IVA en céntimos. */
export function prepararPedidos(filas, ex) {
  const validos = [], excluidos = [];
  for (const o of filas) {
    if (esDePrueba(o, ex)) { excluidos.push(o); continue; }
    const p = Object.fromEntries(fmt.formatToParts(new Date(o.created_at)).map((x) => [x.type, x.value]));
    const t = totals(o.items.map((l) => ({ amount: amountOf(l), vat: l.vat_rate })), !!o.re);
    validos.push({ ...o, dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), dow: DIAS_SEM[p.weekday] ?? 0, cent: centimos(t.total), unidades: o.items.reduce((s, l) => s + unidadesDe(l), 0), clave: o.customer_id != null ? "c:" + o.customer_id : "t:" + o.phone });
  }
  return { validos, excluidos };
}

const diaMax = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Rango pedido: { rango: hoy|7d|30d|mes|todo|custom, desde, hasta (AAAA-MM-DD) }, el instante en que se reinició el recuento (o null) y «ahora».
 * Devuelve { desde, hasta (ISO, hasta excluido), previo:{desde,hasta}|null, etiqueta } o { error }.
 */
export function rangoDe(q = {}, nowIso = new Date().toISOString(), recuento = null) {
  const hoy = madridDay(nowIso), reg = /^\d{4}-\d{2}-\d{2}$/;
  let d0, d1 = hoy, etiqueta;
  switch (q.rango ?? "30d") {
    case "hoy": d0 = hoy; etiqueta = "Hoy"; break;
    case "7d": d0 = addDays(hoy, -6); etiqueta = "Últimos 7 días"; break;
    case "30d": d0 = addDays(hoy, -29); etiqueta = "Últimos 30 días"; break;
    case "mes": d0 = hoy.slice(0, 8) + "01"; etiqueta = "Este mes"; break;
    case "todo": d0 = null; etiqueta = "Todo"; break;
    case "custom":
      if (!reg.test(String(q.desde)) || !reg.test(String(q.hasta ?? hoy))) return { error: "Las fechas no son válidas." };
      d0 = String(q.desde); d1 = String(q.hasta ?? hoy);
      if (d0 > d1) return { error: "La fecha de inicio es posterior a la de fin." };
      if (daysBetween(d0, d1) > 1830) return { error: "El rango no puede pasar de 5 años." };
      etiqueta = `${d0.split("-").reverse().join("/")} – ${d1.split("-").reverse().join("/")}`; break;
    default: return { error: "Rango no válido." };
  }
  const desdeRango = d0 ? madridAIso(d0, "00:00") : null, hasta = madridAIso(addDays(d1, 1), "00:00");
  const desde = recuento && (!desdeRango || recuento > desdeRango) ? recuento : desdeRango;
  let previo = null;
  if (d0) { // el periodo anterior, igual de largo y justo antes; si el recuento empezó dentro de él, no se compara (sería injusto)
    const n = daysBetween(d0, d1) + 1, pd = madridAIso(addDays(d0, -n), "00:00");
    if (!recuento || pd >= recuento) previo = { desde: pd, hasta: desdeRango };
  }
  return { desde, hasta, desdeRango, previo, etiqueta, d0, d1 };
}

const suma = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
const variacion = (a, b) => (b == null ? null : b === 0 ? (a === 0 ? 0 : null) : Math.round(((a - b) / b) * 1000) / 10);

function resumen(lista) {
  const clientes = new Set();
  let cent = 0, unidades = 0;
  for (const o of lista) { clientes.add(o.clave); cent += o.cent; unidades += o.unidades; }
  const n = lista.length;
  return { pedidos: n, importe: cent / 100, ticket: n ? Math.round(cent / n) / 100 : 0, clientes: clientes.size, articulos: unidades };
}

const dentro = (o, desde, hasta) => (!desde || o.created_at >= desde) && o.created_at < hasta;

/** Todo lo de la página principal para un rango. `producto(id)`: ficha del artículo (para la categoría) o null. */
export function calcular(validos, excluidos, r, producto = () => null) {
  const actuales = validos.filter((o) => dentro(o, r.desde, r.hasta));
  const nExcl = excluidos.filter((o) => dentro(o, r.desde, r.hasta)).length;
  const act = resumen(actuales), prev = r.previo ? resumen(validos.filter((o) => dentro(o, r.previo.desde, r.previo.hasta))) : null;
  const comp = prev && { pedidos: variacion(act.pedidos, prev.pedidos), importe: variacion(act.importe, prev.importe), ticket: variacion(act.ticket, prev.ticket), clientes: variacion(act.clientes, prev.clientes), articulos: variacion(act.articulos, prev.articulos) };

  const arts = new Map(), cats = new Map(), catCache = new Map();
  const horas = Array(24).fill(0), calor = Array.from({ length: 7 }, () => Array(24).fill(0)), dias = Array(7).fill(0);
  for (const o of actuales) {
    horas[o.hora]++; calor[o.dow][o.hora]++; dias[o.dow]++;
    const vistos = new Set();
    for (const l of o.items) {
      const id = String(l.id), u = unidadesDe(l), base = Number(amountOf(l)) || 0, cajas = l.unit === "caja" ? Number(l.boxes ?? l.qty) || 0 : 0;
      let a = arts.get(id); if (!a) arts.set(id, (a = { id, nombre: l.name ?? id, unidades: 0, cajas: 0, importe: 0, pedidos: 0 }));
      a.nombre = l.name ?? a.nombre; a.unidades += u; a.cajas += cajas; a.importe += base; if (!vistos.has(id)) { a.pedidos++; vistos.add(id); }
      let c = catCache.get(id); if (!c) catCache.set(id, (c = categorizar({ id, name: l.name, ...(producto(id) ?? {}) })));
      let ct = cats.get(c.catNombre); if (!ct) cats.set(c.catNombre, (ct = { nombre: c.catNombre, unidades: 0, importe: 0, subs: new Map() }));
      ct.unidades += u; ct.importe += base;
      let sb = ct.subs.get(c.subNombre); if (!sb) ct.subs.set(c.subNombre, (sb = { nombre: c.subNombre, unidades: 0, importe: 0 }));
      sb.unidades += u; sb.importe += base;
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const lista = [...arts.values()].map((a) => ({ ...a, importe: r2(a.importe) }));
  const top = (cmp) => [...lista].sort(cmp).slice(0, 30);
  const categorias = [...cats.values()].map((c) => ({ nombre: c.nombre, unidades: c.unidades, importe: r2(c.importe), subs: [...c.subs.values()].map((s) => ({ ...s, importe: r2(s.importe) })).sort((a, b) => b.unidades - a.unidades) })).sort((a, b) => b.unidades - a.unidades);
  const pico = (() => { let m = 0, h = null; horas.forEach((n, i) => { if (n > m) { m = n; h = i; } }); return h; })();
  return {
    etiqueta: r.etiqueta, desde: r.desde, hasta: r.hasta, comparacion: !!r.previo,
    resumen: { actual: act, anterior: prev, variacion: comp },
    excluidos: nExcl,
    ranking: { porUnidades: top((a, b) => b.unidades - a.unidades || b.importe - a.importe), porImporte: top((a, b) => b.importe - a.importe || b.unidades - a.unidades) },
    categorias, horas, calor, dias, horaPico: pico,
  };
}

const mediana = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Clientes que llevan más tiempo de lo normal sin pedir (≥ 3 pedidos en días distintos; ciclo = mediana de días entre pedidos, mínimo 3). */
export function atrasados(validos, nowIso = new Date().toISOString(), limite = 25) {
  const hoy = madridDay(nowIso), por = new Map();
  for (const o of validos) { if (o.customer_id == null) continue; let g = por.get(o.clave); if (!g) por.set(o.clave, (g = { id: String(o.customer_id), nombre: o.name, dias: new Set() })); g.nombre = o.name ?? g.nombre; g.dias.add(o.dia); }
  const out = [];
  for (const g of por.values()) {
    const ds = [...g.dias].sort(); if (ds.length < 3) continue;
    const huecos = ds.slice(1).map((d, i) => daysBetween(ds[i], d)), ciclo = Math.max(3, mediana(huecos)), desde = daysBetween(ds[ds.length - 1], hoy);
    if (desde > ciclo * 1.5 && desde - ciclo >= 2) out.push({ id: g.id, nombre: g.nombre, ultimo: ds[ds.length - 1], ciclo: Math.round(ciclo * 10) / 10, dias: desde, exceso: Math.round((desde - ciclo) * 10) / 10, razon: Math.round((desde / ciclo) * 10) / 10 });
  }
  return out.sort((a, b) => b.razon - a.razon).slice(0, limite);
}

/** Qué suele pedir un cliente, cada cuánto, qué día y a qué hora, y qué ha dejado de pedir. `pedidos`: los suyos (ya sin pruebas ni antes del recuento). */
export function patronesCliente(pedidos, nowIso = new Date().toISOString()) {
  const hoy = madridDay(nowIso), ps = [...pedidos].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)), n = ps.length;
  if (!n) return { pedidos: 0 };
  const dias = [...new Set(ps.map((o) => o.dia))], huecos = dias.slice(1).map((d, i) => daysBetween(dias[i], d));
  const porDow = Array(7).fill(0), porHora = Array(24).fill(0);
  for (const o of ps) { porDow[o.dow]++; porHora[o.hora]++; }
  const NOMBRES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const habitualesDow = porDow.map((c, i) => ({ dia: NOMBRES[i], veces: c })).filter((x) => x.veces).sort((a, b) => b.veces - a.veces).slice(0, 3).map((x) => ({ ...x, pct: Math.round((x.veces / n) * 100) }));
  const hMax = porHora.indexOf(Math.max(...porHora)), horasUsadas = ps.map((o) => o.hora).sort((a, b) => a - b);
  const cent = ps.reduce((s, o) => s + o.cent, 0);
  const art = new Map();
  ps.forEach((o, idx) => { const vistos = new Set(); for (const l of o.items) { const id = String(l.id); let a = art.get(id); if (!a) art.set(id, (a = { id, nombre: l.name ?? id, veces: 0, unidades: 0, ultimo: o.dia, ultimoIdx: idx })); if (!vistos.has(id)) { a.veces++; vistos.add(id); } a.unidades += unidadesDe(l); a.nombre = l.name ?? a.nombre; a.ultimo = o.dia; a.ultimoIdx = idx; } });
  const lista = [...art.values()];
  const frecuentes = [...lista].sort((a, b) => b.veces - a.veces || b.unidades - a.unidades).slice(0, 12).map((a) => ({ id: a.id, nombre: a.nombre, veces: a.veces, mediaUds: Math.round((a.unidades / a.veces) * 10) / 10, ultimo: a.ultimo }));
  const dejados = n >= 4 ? lista.filter((a) => a.veces >= 2 && a.ultimoIdx < n - 3).sort((a, b) => b.veces - a.veces).slice(0, 10).map((a) => ({ id: a.id, nombre: a.nombre, veces: a.veces, ultimo: a.ultimo })) : [];
  const ciclo = huecos.length ? Math.max(3, mediana(huecos)) : null, desde = daysBetween(dias[dias.length - 1], hoy);
  return {
    pedidos: n, primero: ps[0].dia, ultimo: dias[dias.length - 1], diasDesdeUltimo: desde,
    cada: huecos.length ? { mediana: Math.round(mediana(huecos) * 10) / 10, media: Math.round((huecos.reduce((a, b) => a + b, 0) / huecos.length) * 10) / 10 } : null,
    dias: habitualesDow, hora: { habitual: hMax, desde: horasUsadas[0], hasta: horasUsadas[horasUsadas.length - 1] },
    ticket: Math.round(cent / n) / 100, total: cent / 100, frecuentes, dejados,
    sinPedirDeMas: ciclo != null && desde > ciclo * 1.5 && desde - ciclo >= 2 ? { ciclo: Math.round(ciclo * 10) / 10, dias: desde } : null,
    avisoPocoHistorial: n < 4 ? "Con menos de 4 pedidos todavía no se puede saber qué ha dejado de pedir." : null,
  };
}
