// Actualiza los productos con un Excel nuevo de a3ERP SIN borrar y volver a meter todo: compara con lo que hay y enseña
// qué se añade, qué se quita y qué cambia; con --aplicar solo se tocan esos productos y cada cambio queda registrado.
//
//   Ver los cambios (no escribe nada):   node actualizar-productos.js ARTICULOS.xlsx
//   Aplicarlos a la base del servidor:   node actualizar-productos.js ARTICULOS.xlsx --aplicar [--catalogo catalogo.sqlite]
//   Con una lista en JSON (la demo):     node actualizar-productos.js ARTICULOS.xlsx --actual lista.json --salida-json nueva.json --aplicar
//   Otras opciones:  --informe informe.md  ·  --fotos carpeta (guarda las fotos nuevas o cambiadas)  ·  --familias familias.json
//                    --artefacto carpeta  (deja carpeta/datos/productos.json para el cargador por diferencias de la demo: #cargar-datos)
//                    --descuentos-de lista.json  (completa el descuento con el de otra lista, p. ej. la sacada de a3ERP, solo en los productos que no tengan)
//                    --iva SRE=4  (tipo de IVA de un código que el Excel trae sin porcentaje; si no se indica, NO se supone)
//
// Lo que el Excel no trae no se toca (descuentos, categorías…). Los productos que ya no están pasan a «inactivos» (no se borran, queda el historial).
import fs from "node:fs";
import path from "node:path";
import { readXlsxSheets, fotosPorFila } from "./xlsx-read.js";
import { parseProductos } from "./productos-import.js";
import { compararProductos, aplicarProductos, CAMPOS, vendible } from "./productos-diff.js";
import { clasificar } from "./categorias.js";

const eur = (n) => (n == null ? "—" : Number(n).toFixed(2).replace(".", ",") + " €");
const fmt = (campo, v) => (v == null ? "—" : campo === "price" ? eur(v) : campo === "active" ? (v ? "sí" : "no") : String(v));

/** Excel → { productos, sinPrecioIds, filasPorHoja } (todas las hojas con cabecera de productos). */
export function leerExcel(buf, { iva = {} } = {}) {
  const productos = [], sinPrecioIds = [], fotos = [], vistos = new Set(), rechazados = [], avisos = [];
  let columnas = null;
  const hojas = readXlsxSheets(buf);
  const porHoja = hojas.length ? fotosPorFila(buf) : new Map();
  for (const h of hojas) {
    let r;
    try { r = parseProductos(h.rows); } catch { continue; }
    sinPrecioIds.push(...(r.stats.sinPrecioIds ?? []));
    rechazados.push(...r.stats.rechazados); avisos.push(...r.stats.avisos); columnas ??= r.stats.columnas;
    for (const [k, p] of r.products.entries()) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      if (p.vat === undefined && p.vatCode && iva[p.vatCode] != null) p.vat = iva[p.vatCode];
      productos.push(p);
      const foto = porHoja.get(h.name)?.get(r.rowOf[k]);
      if (foto) fotos.push({ id: p.id, ...foto });
    }
  }
  return { productos, sinPrecioIds, fotos, rechazados, avisos, columnas };
}

/** Categoría y subcategoría de un producto por su tipo: reglas del nombre + código de familia de a3ERP (mapa familias-categorias.json). */
export const categoriaPorFamilia = (mapa) => (n) => clasificar(n, mapa);

/** Informe en texto (Markdown) de los cambios. */
export function informe(cmp, { fichero = "", sinFamilia = [], ivaDesconocido = [], saltosPrecio = [] } = {}) {
  const L = [];
  const lista = (titulo, arr, f, max = 60) => {
    L.push(`\n## ${titulo} (${arr.length})\n`);
    arr.slice(0, max).forEach((x) => L.push(f(x)));
    if (arr.length > max) L.push(`… y ${arr.length - max} más`);
  };
  L.push(`# Actualización de productos${fichero ? ` · ${fichero}` : ""}\n`);
  L.push(`| Añadidos | Quitados | Modificados | Reactivados | Sin precio | Sin cambios |\n|---|---|---|---|---|---|\n| ${cmp.anadidos.length} | ${cmp.quitados.length} | ${cmp.modificados.length} | ${cmp.reactivados.length} | ${cmp.sinPrecio.length} | ${cmp.iguales} |`);
  const porCampo = {};
  for (const m of cmp.modificados) for (const c of m.cambios) porCampo[c.campo] = (porCampo[c.campo] ?? 0) + 1;
  if (cmp.modificados.length) L.push(`\nCambios por campo: ${Object.entries(porCampo).map(([k, n]) => `${CAMPOS[k]} ${n}`).join(" · ")}`);
  if (saltosPrecio.length) lista("Precios que cambian mucho (revisar)", saltosPrecio, (s) => `- ${s.id} ${s.name}: ${eur(s.antes)} → ${eur(s.despues)} (${s.pct > 0 ? "+" : ""}${s.pct.toFixed(0)} %)`, 40);
  lista("Modificados", cmp.modificados, (m) => `- **${m.id}** ${m.name}: ${m.cambios.map((c) => `${CAMPOS[c.campo]} ${fmt(c.campo, c.antes)} → ${fmt(c.campo, c.despues)}`).join("; ")}`, 80);
  lista("Añadidos", cmp.anadidos, (p) => `- ${p.id} ${p.name} · ${eur(p.price)}${p.category ? ` · ${p.category}${p.subcategory ? " › " + p.subcategory : ""}` : " · sin categoría asignada"}`, 80);
  lista("Quitados (pasarán a inactivos)", cmp.quitados, (p) => `- ${p.id} ${p.name} · ${p.motivo}`, 80);
  if (cmp.reactivados.length) lista("Reactivados", cmp.reactivados, (p) => `- ${p.id} ${p.name}`);
  lista("Sin precio en el Excel (no se pueden vender)", cmp.sinPrecio, (p) => `- ${p.id} ${p.name ?? ""}`, 30);
  if (ivaDesconocido.length) L.push(`\n## Avisos\n\n- ${ivaDesconocido.length} productos con un código de IVA sin porcentaje conocido (${[...new Set(ivaDesconocido.map((p) => p.vatCode))].join(", ")}). Indica su tipo con --iva CÓDIGO=PORCENTAJE; mientras tanto no se les cambia el IVA y a los nuevos no se les puede aplicar.`);
  if (sinFamilia.length) {
    L.push(`- ${sinFamilia.length} productos nuevos cuya familia de a3ERP todavía no tiene categoría: se clasifican por su nombre. Para fijarla, añade la familia a familias-categorias.json.`);
    const porFam = new Map();
    for (const p of sinFamilia) porFam.set(p.family ?? "(sin familia)", [...(porFam.get(p.family ?? "(sin familia)") ?? []), p.name]);
    L.push(`\n### Familias nuevas sin categoría\n`);
    for (const [f, n] of [...porFam].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) L.push(`- **${f}** (${n.length}): ${n.slice(0, 3).join(" · ")}`);
  }
  return L.join("\n") + "\n";
}

/** Subidas o bajadas de precio de más del 25 %: lo más probable es un error del Excel o un cambio importante. */
export const saltosDePrecio = (cmp, umbral = 25) =>
  cmp.modificados.flatMap((m) => m.cambios.filter((c) => c.campo === "price" && c.antes > 0).map((c) => ({ id: m.id, name: m.name, antes: c.antes, despues: c.despues, pct: ((c.despues - c.antes) / c.antes) * 100 })))
    .filter((s) => Math.abs(s.pct) >= umbral).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const fichero = args.find((a, i) => !a.startsWith("--") && !["--catalogo", "--actual", "--salida-json", "--informe", "--fotos", "--familias", "--iva", "--artefacto", "--descuentos-de"].includes(args[i - 1]));
  if (!fichero) { console.error("Uso: node actualizar-productos.js ARTICULOS.xlsx [--aplicar] [--catalogo catalogo.sqlite | --actual lista.json --salida-json nueva.json] [--informe informe.md] [--fotos carpeta] [--iva SRE=4]"); process.exit(1); }
  const iva = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "--iva" ? [a.split("=")] : [])).map(([k, v]) => [k, Number(v)]));
  const familiasRuta = opt("--familias") ?? new URL("./familias-categorias.json", import.meta.url).pathname;
  const familias = fs.existsSync(familiasRuta) ? JSON.parse(fs.readFileSync(familiasRuta, "utf8")) : {};

  const { productos, sinPrecioIds, fotos } = leerExcel(fs.readFileSync(fichero), { iva });
  let actual, db = null;
  if (opt("--actual")) actual = JSON.parse(fs.readFileSync(opt("--actual"), "utf8"));
  else {
    const { openCatalogDb } = await import("./catalogo-db.js");
    db = openCatalogDb(opt("--catalogo") ?? process.env.CATALOG_DB ?? "catalogo.sqlite");
    actual = db.list({ activeOnly: false });
  }
  const catNueva = categoriaPorFamilia(familias);
  const nuevos = productos.map((p) => ({ ...p, ...(p.category ? {} : catNueva(p)) })); // también los que ya existen: las categorías se rehacen por tipo de producto
  const cmp = compararProductos(actual, nuevos, { sinPrecioIds });
  const ivaDesconocido = nuevos.filter((p) => p.vat === undefined && p.vatCode && vendible(p));
  const sinFamilia = cmp.anadidos.filter((p) => !p.category);
  const texto = informe(cmp, { fichero: path.basename(fichero), sinFamilia, ivaDesconocido, saltosPrecio: saltosDePrecio(cmp) });
  console.log(texto);
  if (opt("--informe")) fs.writeFileSync(opt("--informe"), texto);

  if (opt("--fotos")) {
    fs.mkdirSync(opt("--fotos"), { recursive: true });
    let nuevas = 0, cambiadas = 0;
    for (const f of fotos) {
      const ext = f.ext === "jpeg" ? "jpg" : f.ext, ruta = path.join(opt("--fotos"), `${f.id}.${ext}`);
      if (!fs.existsSync(ruta)) { fs.writeFileSync(ruta, f.data); nuevas++; }
      else if (!fs.readFileSync(ruta).equals(f.data)) { if (args.includes("--aplicar")) fs.writeFileSync(ruta, f.data); cambiadas++; }
    }
    console.log(`Fotos: ${fotos.length} en el Excel · ${nuevas} nuevas guardadas · ${cambiadas} cambiadas${args.includes("--aplicar") ? " (actualizadas)" : " (sin aplicar)"}`);
  }

  if (!args.includes("--aplicar")) { console.log("\nNo se ha cambiado nada. Para aplicar estos cambios, repite el comando con --aplicar."); return; }
  if (db && cmp.anadidos.some((p) => p.vat === undefined) && !args.includes("--acepto-iva-21")) { // en la base del servidor no se inventa un IVA; en una lista de demo sí se puede seguir
    console.error(`\nNO se aplica: hay ${cmp.anadidos.filter((p) => p.vat === undefined).length} productos nuevos sin tipo de IVA conocido. Indica el tipo con --iva CÓDIGO=PORCENTAJE (por ejemplo --iva SRE=4).`);
    process.exit(2);
  }
  const resultado = aplicarProductos(actual, nuevos);
  if (opt("--descuentos-de")) { // completa: los productos SIN descuento toman el de esa lista (el que ya tienen no se toca)
    const ref = new Map(JSON.parse(fs.readFileSync(opt("--descuentos-de"), "utf8")).map((p) => [String(p.id), p]));
    let cambiados = 0;
    for (const p of resultado) { const r = ref.get(p.id); if (r && r.discount && !p.discount) { p.discount = r.discount; cambiados++; } }
    console.log(`Descuentos tomados de ${path.basename(opt("--descuentos-de"))}: ${cambiados} productos cambiados.`);
  }
  if (opt("--artefacto")) {
    // Formato de datos/productos.json del artefacto (claves en orden fijo: el cargador compara una huella de cada registro)
    const dir = path.join(opt("--artefacto"), "datos");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "productos.json"), JSON.stringify(resultado.map((p) => ({
      id: String(p.id), name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, vat: p.vat ?? 21, discount: p.discount ?? 0,
      ...(p.category ? { category: p.category } : {}), ...(p.subcategory ? { subcategory: p.subcategory } : {}), updatedAt: null, changes: [],
    }))));
    console.log(`\nArchivo para el artefacto: ${path.join(dir, "productos.json")} (${resultado.length} productos). Publícalo como archivo del artefacto y abre #cargar-datos: solo se escriben las diferencias.`);
  }
  if (opt("--salida-json")) {
    fs.writeFileSync(opt("--salida-json"), JSON.stringify(resultado));
    console.log(`\nLista nueva guardada en ${opt("--salida-json")}: ${resultado.length} productos.`);
  } else if (db) {
    const copia = `${opt("--catalogo") ?? process.env.CATALOG_DB ?? "catalogo.sqlite"}.antes-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    db.backupTo(copia);
    const r = db.upsertProducts(resultado.map((p) => ({ ...p, unitsPerBox: p.unitsPerBox ?? null })), { partial: true, deactivateMissing: true });
    console.log(`\nAplicado: ${r.added} nuevos, ${r.updated} con cambios, ${r.unchanged} iguales, ${r.deactivated} desactivados. Copia de seguridad anterior: ${copia}`);
  }
  db?.close();
}

if (process.argv[1]?.endsWith("actualizar-productos.js")) main().catch((e) => { console.error(e.message); process.exit(1); });
