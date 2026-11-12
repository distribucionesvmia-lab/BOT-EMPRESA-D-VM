// CARGA INICIAL: deja el programa listo para usar la primera vez que se instala, sin meter nada a mano.
// Lee los archivos de una carpeta (por defecto C:\vm\inicial), reconoce solo de qué tipo es cada uno y los carga en este orden:
//   1) clientes (Excel de a3ERP)  2) productos (Excel de artículos de a3ERP)  3) descuentos.json (descuento por artículo)
//   4) historial de compras (Excel «listado de histórico»)  5) fotos (ZIP «<código>.jpg»; fotos-ia.json = las generadas con IA)
//   6) prueba.json = clientes de PRUEBA (datos ficticios que se quitarán más adelante)
// Usa exactamente las mismas reglas que «Datos y Excel» del panel (mismas comprobaciones, mismas categorías, mismas cuentas),
// así que se puede repetir sin miedo: lo que ya está igual no se toca. Después, solo hay que subir actualizaciones desde el panel.
//
//   Uso:   node --env-file=C:\vm\config\empresa.env cargar-inicial.js [carpeta]
// Los archivos de esa carpeta llevan datos REALES de clientes: nunca se suben a GitHub (la carpeta «inicial» está en .gitignore).
import fs from "node:fs";
import path from "node:path";
import { crearActualizador, detectarTipo } from "./actualizar-datos.js";
import { getDatabases, getAccountsDb } from "./erp.js";
import { parseHistorialXlsx } from "./historial-import.js";
import { nifKeys } from "./nif-key.js";

const ORDEN = ["clientes", "productos", "historial", "fotos"];
const dir = path.resolve(process.argv[2] ?? "C:\\vm\\inicial");
const IMG_DIR = process.env.IMG_DIR ?? new URL("./imagenes/", import.meta.url).pathname; // la misma carpeta de fotos que usa el servidor
const t0 = Date.now();
const dicho = (m) => console.log(m);

function main() {
  if (!fs.existsSync(dir)) { console.error(`No existe la carpeta ${dir}. Copia ahí los archivos de la carga inicial (ver LEEME.txt del paquete).`); process.exit(1); }
  const dbs = getDatabases(), accountsDb = getAccountsDb();
  const imgDir = IMG_DIR;
  const familias = (() => { try { return JSON.parse(fs.readFileSync(new URL("./familias-categorias.json", import.meta.url), "utf8")); } catch { return {}; } })();
  const act = crearActualizador({ catalogDb: dbs.catalogDb, customersDb: dbs.customersDb, accountsDb, imgDir, copiaCatalogo: null, familias, registro: () => {}, onChange: () => {} });

  // Qué hay en la carpeta
  const archivos = fs.readdirSync(dir).filter((f) => /\.(xlsx|zip)$/i.test(f)).map((f) => ({ f, buf: fs.readFileSync(path.join(dir, f)) }));
  const porTipo = new Map();
  for (const a of archivos) {
    const tipo = detectarTipo(a.buf);
    if (!tipo) { dicho(`  · ${a.f}: no sé de qué tipo es, lo salto.`); continue; }
    (porTipo.get(tipo) ?? porTipo.set(tipo, []).get(tipo)).push(a);
  }
  dicho(`Carga inicial desde ${dir}`);
  const resumen = [];

  for (const tipo of ORDEN) {
    for (const a of porTipo.get(tipo) ?? []) {
      try {
        const v = act.vistaPrevia(tipo, a.buf);
        if (!v.aplicable) { dicho(`  ${tipo}: ${a.f} → ya estaba igual, nada que cargar.`); continue; }
        const r = act.aplicar(tipo, a.buf, { fichero: a.f, confirmo: true });
        dicho(`  ${tipo}: ${a.f} → cargado ${JSON.stringify(r.resumen ?? r)}`);
        resumen.push([tipo, a.f]);
      } catch (e) { dicho(`  ${tipo}: ${a.f} → NO se pudo cargar: ${e.message}`); process.exitCode = 1; }
    }
    if (tipo === "productos") descuentos(dbs);
  }
  fotosIA();
  prueba(dbs, act, accountsDb);

  const p = dbs.catalogDb.list({ activeOnly: true });
  dicho(`\nListo en ${((Date.now() - t0) / 1000).toFixed(1)} s. Catálogo: ${p.length} productos activos (${p.filter((x) => x.saleMode === "caja").length} solo caja, ${p.filter((x) => x.saleMode === "ambos").length} caja o unidad) · Clientes: ${dbs.customersDb.count()}.`);
}

// descuentos.json: { "código de artículo": porcentaje } (los de la tarifa); solo a los artículos que existen
function descuentos(dbs) {
  const f = path.join(dir, "descuentos.json");
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const lista = Object.entries(d).filter(([id, pct]) => dbs.catalogDb.get(id) && Number(pct) > 0 && Number(pct) <= 100).map(([id, pct]) => ({ id, discount: Number(pct) }));
  const r = dbs.catalogDb.upsertProducts(lista, { partial: true });
  dicho(`  descuentos: ${lista.length} artículos con descuento (${r.updated} actualizados).`);
}

// fotos-ia.json: códigos cuya foto está generada con IA (el catálogo lo avisa en pequeño)
function fotosIA() {
  const f = path.join(dir, "fotos-ia.json");
  if (!fs.existsSync(f)) return;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const destino = path.join(IMG_DIR, "fotos-ia.json"), nuevas = JSON.parse(fs.readFileSync(f, "utf8")).map(String);
  let ya = []; try { ya = JSON.parse(fs.readFileSync(destino, "utf8")).map(String); } catch { /* aún no existe */ }
  fs.writeFileSync(destino, JSON.stringify([...new Set([...ya, ...nuevas])].sort())); // se SUMA a las que ya había (por ejemplo las marcadas por el Excel de control de un ZIP)
  dicho(`  fotos-ia.json: ${nuevas.length} fotos marcadas como hechas con IA (en total ${new Set([...ya, ...nuevas]).size}).`);
}

// prueba.json: [{ id, name, nif, historial: "archivo.xlsx", codigoEnHistorial: "0818" }] → clientes FALSOS de prueba, con su historial
function prueba(dbs, act, accountsDb) {
  const f = path.join(dir, "prueba.json");
  if (!fs.existsSync(f)) return;
  for (const c of JSON.parse(fs.readFileSync(f, "utf8"))) {
    try {
      if (!dbs.customersDb.getById(c.id)) act.anadirCliente({ codigo: c.id, nombre: c.name, nif: c.nif, poblacion: "Medina del Campo", municipio: "47085", direccion: "Calle de prueba 1" });
      const { byCustomer } = parseHistorialXlsx(fs.readFileSync(path.join(dir, c.historial)));
      const orders = [...(byCustomer.get(c.codigoEnHistorial ?? c.id) ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
      dbs.customersDb.upsertCustomers([{ id: c.id, name: c.name, orders }]);
      accountsDb.ensureMany([c.id]);
      dicho(`  prueba: ${c.id} ${c.name} (cliente ficticio) con ${orders.length} pedidos de historial.`);
    } catch (e) { dicho(`  prueba: ${c.id} → NO se pudo crear: ${e.message}`); process.exitCode = 1; }
  }
}

main();
