// Sincronización automática de las bases de datos de clientes y productos con una carpeta (Google Drive o del servidor).
//
// La empresa deja ahí los Excel que exporta a3ERP (o los edita en Google Sheets): el más reciente de «clientes» y el más
// reciente de «productos». Cada cierto tiempo el servidor los mira y, si han cambiado, actualiza las bases (crea y actualiza;
// no borra nada). Cada fichero va por separado: si uno falla, el otro se importa igualmente, y el motivo queda anotado.
//
// Seguridad ante ficheros equivocados: un fichero de clientes con muchos menos clientes de los que ya hay se rechaza.
import fs from "node:fs";
import path from "node:path";
import { parseClientesXlsx } from "./clientes-import.js";
import { parseProductosXlsx } from "./productos-import.js";

export const MIN_RATIO = 0.7; // un fichero con menos del 70 % de los clientes ya cargados se considera incompleto

// El nombre del fichero dice de qué es: «clientes…», «productos…»/«artículos…»/«tarifa…»
const KINDS = { clientes: /client/i, productos: /product|articul|tarifa|catalogo/i };

/** El fichero más reciente de cada tipo: { clientes, productos } (undefined si no hay). */
export function pickFiles(files) {
  const out = {};
  for (const [kind, re] of Object.entries(KINDS)) {
    out[kind] = files.filter((f) => re.test(f.name) && !(kind === "clientes" && KINDS.productos.test(f.name))).sort((a, b) => (a.modified < b.modified ? 1 : -1))[0];
  }
  return out;
}

/** Estado en un fichero JSON (se escribe entero y de golpe: un corte no lo corrompe). */
export function fileState(file) {
  return {
    get() { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { files: {}, log: [] }; } },
    set(s) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(s)); fs.renameSync(file + ".tmp", file); },
  };
}

/**
 * Una pasada: mira la carpeta e importa lo que haya cambiado. Nunca lanza: devuelve { ok, resultados:[{ tipo, fichero, estado, detalle }] }.
 * deps: { source, state, catalogDb, customersDb, accountsDb }
 */
export async function sincronizar({ source, state, catalogDb, customersDb, accountsDb, now = () => new Date().toISOString() }) {
  const st = state.get();
  st.files ??= {}; st.log ??= [];
  const resultados = [];
  let picked;
  try {
    picked = pickFiles(await source.list());
  } catch (e) {
    resultados.push({ tipo: "carpeta", estado: "error", detalle: e.message });
    return fin(st, state, resultados, now);
  }
  for (const tipo of ["clientes", "productos"]) {
    const f = picked[tipo];
    if (!f) { resultados.push({ tipo, estado: "sin fichero", detalle: `No hay ningún Excel de ${tipo} en la carpeta (el nombre debe contener «${tipo === "clientes" ? "clientes" : "productos"}»).` }); continue; }
    if (st.files[tipo]?.sig === f.sig) { resultados.push({ tipo, fichero: f.name, estado: "sin cambios" }); continue; }
    try {
      const buf = await source.read(f);
      let detalle;
      if (tipo === "clientes") {
        const { customers, stats } = parseClientesXlsx(buf);
        if (!customers.length) throw new Error("El Excel no tiene clientes.");
        const have = customersDb.count();
        if (have >= 20 && customers.length < have * MIN_RATIO) throw new Error(`El fichero tiene ${customers.length} clientes y ya hay ${have}: parece incompleto, no se importa.`);
        const r = customersDb.upsertCustomers(customers);
        const cuentas = accountsDb.ensureMany(customers.filter((c) => c.active !== false).map((c) => c.id));
        detalle = `${stats.importados} clientes (${r.added} nuevos, ${r.updated} actualizados), ${cuentas} cuentas nuevas`;
      } else {
        const { products, stats } = parseProductosXlsx(buf);
        if (!products.length) throw new Error("El Excel no tiene productos con precio.");
        const r = catalogDb.upsertProducts(products);
        detalle = `${stats.importados} productos (${r.added} nuevos, ${r.updated} con cambios, ${r.unchanged} iguales)` + (stats.sinPrecio ? `; ${stats.sinPrecio} sin precio, ignorados` : "");
      }
      st.files[tipo] = { sig: f.sig, name: f.name, at: now() };
      resultados.push({ tipo, fichero: f.name, estado: "importado", detalle });
    } catch (e) {
      resultados.push({ tipo, fichero: f.name, estado: "error", detalle: e.message }); // la firma no se guarda: se reintenta en la siguiente pasada
    }
  }
  return fin(st, state, resultados, now);
}

function fin(st, state, resultados, now) {
  const at = now();
  // Solo se anota en el registro lo que ha pasado algo (cambios o errores), para que no se llene de «sin cambios»
  if (resultados.some((r) => r.estado === "importado" || r.estado === "error")) st.log = [{ at, resultados }, ...st.log].slice(0, 20);
  st.last = { at, resultados };
  state.set(st);
  return { ok: !resultados.some((r) => r.estado === "error"), at, resultados };
}

/**
 * Servicio para el servidor: pasadas periódicas (cada `minutes`, 15 por defecto) sin solaparse, y una bajo demanda.
 * status() devuelve lo que muestra la aplicación de la empresa.
 */
export function crearSincronizacion({ source, state, catalogDb, customersDb, accountsDb, minutes = Number(process.env.SYNC_MINUTES ?? 15), log = console, onChange = () => {} }) {
  let running = null, timer = null;
  const run = () => (running ??= sincronizar({ source, state, catalogDb, customersDb, accountsDb }).then((r) => {
    for (const x of r.resultados) if (x.estado === "importado" || x.estado === "error") log.log(`Sincronización · ${x.tipo}: ${x.estado} · ${x.detalle}`);
    if (r.resultados.some((x) => x.estado === "importado")) onChange();
    return r;
  }).finally(() => (running = null)));
  return {
    configurado: !!source,
    runNow: run,
    start() {
      if (timer || !source) return;
      setTimeout(() => run(), 10_000).unref?.(); // primera pasada poco después de arrancar
      timer = setInterval(run, Math.max(1, minutes) * 60_000);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    status() {
      const s = state.get();
      return { configurado: !!source, origen: source?.name ?? null, cadaMinutos: minutes, ultima: s.last ?? null, ficheros: s.files ?? {}, registro: s.log ?? [] };
    },
  };
}
