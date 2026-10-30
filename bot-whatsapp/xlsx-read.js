// Lector mínimo de ficheros .xlsx (sin dependencias): primera hoja, texto y números.
// Devuelve filas como arrays de cadenas (las celdas vacías son ""). Pensado para exportaciones de a3ERP.
import zlib from "node:zlib";

/** Descomprime un ZIP en memoria: { "ruta": Buffer }. Solo lee los ficheros que se piden. */
function unzip(buf, want) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!want.includes(name)) continue;
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
  }
  return out;
}

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const text = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Filas de la primera hoja: string[][] */
export function readXlsx(buf) {
  const files = unzip(buf, ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]);
  if (!files["xl/worksheets/sheet1.xml"]) throw new Error("No se encuentra la primera hoja del Excel");
  const shared = files["xl/sharedStrings.xml"] ? [...files["xl/sharedStrings.xml"].toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1])) : [];
  const rows = [];
  for (const r of files["xl/worksheets/sheet1.xml"].toString("utf8").matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
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
