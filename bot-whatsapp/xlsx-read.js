// Lector mínimo de ficheros .xlsx (sin dependencias): primera hoja, texto y números.
// Devuelve filas como arrays de cadenas (las celdas vacías son ""). Pensado para exportaciones de a3ERP.
import zlib from "node:zlib";

/** Descomprime un ZIP en memoria: { "ruta": Buffer }. Solo lee los ficheros que se piden. */
const MAX_ENTRADA = 120_000_000, MAX_TOTAL = 300_000_000; // lo descomprimido: por archivo y en total (contra «bombas» ZIP que se hinchan hasta llenar la memoria)
/** Nombres que no tienen sitio en un Excel, unas fotos o un ZIP de datos: programas, scripts, accesos directos, macros de Office y objetos incrustados. */
export const NOMBRE_PELIGROSO = /\.(exe|dll|com|scr|pif|bat|cmd|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|lnk|reg|cpl|sys|drv|ocx|iso|img|apk|sh|py|php\d?|asp|aspx|jsp|cgi|svg|html?)$|(^|\/)vbaProject\.bin$|(^|\/)(macrosheets|embeddings|activeX)\//i;
const MAX_ENTRADAS = 20000;
/** Recorre los nombres del ZIP sin descomprimir nada y rechaza el archivo entero si hay algo peligroso o raro. */
function revisarContenido(buf, p, n) {
  if (n > MAX_ENTRADAS) throw new Error("El archivo tiene demasiados ficheros dentro y se rechaza por seguridad");
  for (let i = 0; i < n; i++) {
    if (p < 0 || p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("El archivo está dañado o no es un .xlsx o .zip válido");
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:|\0/i.test(name)) throw new Error("El archivo lleva rutas sospechosas y se rechaza por seguridad");
    if (NOMBRE_PELIGROSO.test(name)) throw new Error(`El archivo contiene algo que no debería (${name.split("/").pop().slice(0, 40)}): programas, scripts o macros. Se rechaza por seguridad`);
    p += 46 + nl + el + cl;
  }
}
export function unzip(buf, want) {
  const out = {};
  let total = 0;
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("El archivo no es un .xlsx o .zip válido");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  revisarContenido(buf, p, n); // antivirus de entrada: ni programas, ni scripts, ni macros dentro del archivo
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!(typeof want === "function" ? want(name) : want.includes(name))) continue;
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    const dato = method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRADA }) : data; // si se pasa del límite, lanza error y se rechaza el archivo
    total += dato.length; if (total > MAX_TOTAL) throw new Error("El archivo descomprimido es demasiado grande");
    out[name] = dato;
  }
  return out;
}

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const text = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Filas de una hoja a partir de su XML: string[][] */
function sheetRows(xml, shared) {
  const rows = [];
  const filas = [...xml.matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)];
  for (const r of filas) {
    const row = [];
    const nFila = Number(/\br="(\d+)"/.exec(r[0].slice(0, r[0].indexOf(">") + 1))?.[1]) || rows.length + 1;
    while (rows.length < nFila - 1) rows.push([]); // las filas vacías no vienen en el XML: se conserva el número de fila real de Excel
    for (const c of (r[1] ?? "").matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? "";
      let v = "";
      if (type === "s") v = shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])] ?? "";
      else if (type === "inlineStr") v = text(body);
      else v = decode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      row[colIndex(ref)] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}
const sharedOf = (f) => (f["xl/sharedStrings.xml"] ? [...f["xl/sharedStrings.xml"].toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1])) : []);

/** TODAS las hojas del libro: [{ name, rows }] (para tarifas con una hoja por proveedor o familia). */
export function readXlsxSheets(buf) {
  return libro(buf).sheets.map(({ name, rows }) => ({ name, rows }));
}

/** Libro completo: hojas con su ruta interna ({ name, path, rows }) y el contenido ya descomprimido de lo que se pidió. */
export function libro(buf) {
  const files = unzip(buf, ["xl/sharedStrings.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"]);
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) throw new Error("El Excel no tiene la estructura esperada");
  const rels = new Map([...files["xl/_rels/workbook.xml.rels"].toString("utf8").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [...files["xl/workbook.xml"].toString("utf8").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode(/name="([^"]*)"/.exec(m[0])?.[1] ?? ""), target: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) }));
  const paths = sheets.map((x) => (x.target ?? "").replace(/^\/?(xl\/)?/, "xl/"));
  const data = unzip(buf, paths);
  const shared = sharedOf(files);
  return { sheets: sheets.map((x, i) => ({ name: x.name, path: paths[i], rows: data[paths[i]] ? sheetRows(data[paths[i]].toString("utf8"), shared) : [] })) };
}

/** Imágenes incrustadas por hoja: Map(nombre de hoja → Map(nº de fila de Excel → { ext, data })). Solo lee; no escribe nada. */
export function fotosPorFila(buf) {
  const f = unzip(buf, (n) => /^xl\/(worksheets\/_rels|drawings|drawings\/_rels|media)\//.test(n) || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels");
  const rel = (b) => new Map([...(b?.toString("utf8") ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const norm = (base, t) => { const parts = (t.startsWith("/") ? t.slice(1) : base.split("/").slice(0, -1).join("/") + "/" + t).split("/"); const o = []; for (const p of parts) p === ".." ? o.pop() : o.push(p); return o.join("/"); };
  const { sheets } = libro(buf), out = new Map();
  for (const h of sheets) {
    const sr = f[h.path.replace("worksheets/", "worksheets/_rels/") + ".rels"];
    const draw = [...rel(sr).values()].find((t) => /drawings\/drawing\d+\.xml$/.test(t ?? ""));
    const porFila = new Map();
    out.set(h.name, porFila);
    if (!draw) continue;
    const dp = norm(h.path, draw), dx = f[dp]?.toString("utf8");
    if (!dx) continue;
    const dr = rel(f[dp.replace("drawings/", "drawings/_rels/") + ".rels"]);
    for (const a of dx.matchAll(/<(?:xdr:)?(?:two|one)CellAnchor[\s\S]*?<\/(?:xdr:)?(?:two|one)CellAnchor>/g)) { // con o sin prefijo «xdr:» (Excel lo pone; LibreOffice y otros programas, a veces no)
      const row = /<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/.exec(a[0])?.[1], emb = /r:embed="([^"]+)"/.exec(a[0])?.[1];
      const mp = emb && dr.get(emb) ? norm(dp, dr.get(emb)) : null;
      if (row === undefined || !mp || !f[mp]) continue;
      porFila.set(Number(row) + 1, { ext: mp.split(".").pop().toLowerCase(), data: f[mp] });
    }
  }
  return out;
}

/** Filas de la primera hoja: string[][] */
export function readXlsx(buf) {
  const files = unzip(buf, ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]);
  if (!files["xl/worksheets/sheet1.xml"]) throw new Error("No se encuentra la primera hoja del Excel");
  return sheetRows(files["xl/worksheets/sheet1.xml"].toString("utf8"), sharedOf(files));
}

/** Fotos «dentro de la celda» (Excel 365: Insertar → Imagen → Colocar en celda). Map(nombre de hoja → Map(nº de fila → { ext, data })). Solo lee. */
export function fotosEnCelda(buf) {
  const f = unzip(buf, (n) => /^xl\/(richData|media|worksheets)\//.test(n) || n === "xl/metadata.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels");
  const txt = (n) => f[n]?.toString("utf8") ?? "", out = new Map();
  const rv = [...txt("xl/richData/rdrichvalue.xml").matchAll(/<rv\b[^>]*?(?:\/>|>([\s\S]*?)<\/rv>)/g)].map((m) => ({ s: Number(/\bs="(\d+)"/.exec(m[0])?.[1] ?? 0), v: [...(m[1] ?? "").matchAll(/<v>([\s\S]*?)<\/v>/g)].map((x) => x[1]) }));
  if (!rv.length) return out;
  const estructuras = [...txt("xl/richData/rdrichvaluestructure.xml").matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map((m) => [...m[1].matchAll(/<k\b[^>]*n="([^"]+)"/g)].map((x) => x[1]));
  const relIds = [...txt("xl/richData/richValueRel.xml").matchAll(/<rel\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const rels = new Map([...txt("xl/richData/_rels/richValueRel.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  // vm (nº de valor de la celda, desde 1) → qué rich value es: por metadata.xml si está; si no, el mismo orden
  const meta = txt("xl/metadata.xml"), rvb = [...(/<futureMetadata\b[^>]*XLRICHVALUE[\s\S]*?<\/futureMetadata>/.exec(meta)?.[0] ?? "").matchAll(/<(?:xlrd:)?rvb\b[^>]*\bi="(\d+)"/g)].map((m) => Number(m[1]));
  const bk = [...(/<valueMetadata\b[\s\S]*?<\/valueMetadata>/.exec(meta)?.[0] ?? "").matchAll(/<bk>\s*<rc\b[^>]*\bv="(\d+)"/g)].map((m) => Number(m[1]));
  const rvDeVm = (vm) => (bk.length && rvb.length ? rvb[bk[vm - 1]] : undefined) ?? vm - 1;
  const imagen = (vm) => {
    const r = rv[rvDeVm(vm)]; if (!r) return null;
    const k = (estructuras[r.s] ?? []).indexOf("_rvRel:LocalImageIdentifier"), idx = Number(r.v[k < 0 ? 0 : k]);
    const t = rels.get(relIds[idx]); if (!t) return null;
    const ruta = "xl/" + t.replace(/^\.\.\//, "").replace(/^\/?(xl\/)?/, ""); return f[ruta] ? { ext: ruta.split(".").pop().toLowerCase(), data: f[ruta] } : null;
  };
  const rels2 = new Map([...txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  for (const h of [...txt("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)]) {
    const nombre = decode(/name="([^"]*)"/.exec(h[0])?.[1] ?? ""), t = rels2.get(/r:id="([^"]+)"/.exec(h[0])?.[1]); if (!t) continue;
    const xml = txt(t.replace(/^\/?(xl\/)?/, "xl/")), porFila = new Map();
    for (const c of xml.matchAll(/<c\b[^>]*>/g)) {
      const vm = /\bvm="(\d+)"/.exec(c[0])?.[1], ref = /\br="[A-Z]+(\d+)"/.exec(c[0])?.[1]; if (!vm || !ref) continue;
      const im = imagen(Number(vm)); if (im && !porFila.has(Number(ref))) porFila.set(Number(ref), im);
    }
    out.set(nombre, porFila);
  }
  return out;
}

/** Fotos de un Excel con filas «nombre/código + foto»: [{ fila, hoja, textos: string[], ext, data }]. Vale con fotos flotantes y con fotos dentro de la celda. */
export function filasConFoto(buf) {
  const { sheets } = libro(buf), flot = fotosPorFila(buf); let celda = new Map(); try { celda = fotosEnCelda(buf); } catch { /* sin fotos en celda */ }
  const out = [];
  for (const h of sheets) {
    const a = flot.get(h.name) ?? new Map(), b = celda.get(h.name) ?? new Map();
    for (const fila of new Set([...a.keys(), ...b.keys()])) out.push({ fila, hoja: h.name, textos: (h.rows[fila - 1] ?? []).map((x) => String(x ?? "").trim()).filter(Boolean), ...(a.get(fila) ?? b.get(fila)) });
  }
  return out;
}
