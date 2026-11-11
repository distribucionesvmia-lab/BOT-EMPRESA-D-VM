// Contenido XML de un libro .xlsx (parte pura, sin Node: la usan también la demo del navegador y xlsx.js).
// El empaquetado ZIP está en zip.js (Node) o demo-web/zip-browser.js (navegador).


const esc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "") // caracteres no permitidos en XML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function colName(i) {
  let n = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) n = String.fromCharCode(65 + ((i - 1) % 26)) + n;
  return n;
}

// Estilos disponibles (índice en cellXfs). Una celda puede ser un valor o { v, s: estilo }.
// Los 12 primeros son fijos (STYLE); los demás se piden con estilo({...}) y se registran UNA vez al cargar el módulo que los usa (así el libro es siempre el mismo).
export const STYLE = { normal: 0, bold: 1, money: 2, boldMoney: 3, header: 4, price: 5, title: 6, banner: 7, obsRed: 8, obsYellow: 9, obsGreen: 10, bannerRight: 11 };
// spec: { b, sz, color, name, fill, h (horizontal), v (vertical), indent, wrap, shrink, fmt (número de formato de Excel o texto), border: { side: "bottom"|"all", style, color } }
const BASE = [
  {}, { b: 1 }, { fmt: 4 }, { fmt: 4, b: 1 }, { b: 1, fill: "D9E2F3" }, { fmt: "#,##0.000" }, { b: 1, fill: "B4C6E7" },
  { b: 1, sz: 22, color: "FFFFFF", fill: "1F3864", h: "left", v: "center", indent: 1 },
  { b: 1, color: "FFFFFF", fill: "FF0000" }, { b: 1, color: "000000", fill: "FFFF00" }, { b: 1, color: "000000", fill: "92D050" },
  { b: 1, sz: 22, color: "FFFFFF", fill: "1F3864", h: "right", v: "center", indent: 1 },
];
const EXTRA = [], EXTRA_KEYS = new Map();
export function estilo(spec) {
  const k = JSON.stringify(spec);
  if (!EXTRA_KEYS.has(k)) { EXTRA_KEYS.set(k, BASE.length + EXTRA.length); EXTRA.push(spec); }
  return EXTRA_KEYS.get(k);
}
const specOf = (i) => (i < BASE.length ? BASE[i] : EXTRA[i - BASE.length]) ?? {};
/** Decimales con los que se enseña un número según su formato (2, 3…) o null si es entero/sin formato. */
export function estiloDecimales(i) {
  const f = specOf(i).fmt;
  if (f === 4) return 2;
  return typeof f === "string" && f.includes(".") ? f.split(".")[1].replace(/[^0#]/g, "").length : null;
}
/** Estilo de una celda como CSS (la vista previa de la demo pinta el Excel con él). */
export function estiloCss(i) {
  const s = specOf(i), css = [];
  if (s.b) css.push("font-weight:700");
  if (s.color) css.push(`color:#${s.color}`);
  if (s.fill) css.push(`background:#${s.fill}`);
  if (s.sz) css.push(`font-size:${Math.round(s.sz * 1.15)}px`);
  if (s.h) css.push(`text-align:${s.h}`);
  if (s.v) css.push("vertical-align:middle");
  if (s.wrap) css.push("white-space:pre-line");
  if (s.border) { const c = `1px ${s.border.style === "hair" ? "dotted" : "solid"} #${s.border.color ?? "BFBFBF"}`; css.push(s.border.side === "all" ? `border:${c}` : `border-${s.border.side}:${c}`); }
  return css.join(";");
}

function stylesXml() {
  const all = [...BASE, ...EXTRA];
  const fonts = [], fills = [{ x: '<fill><patternFill patternType="none"/></fill>' }, { x: '<fill><patternFill patternType="gray125"/></fill>' }], borders = [{ x: "<border><left/><right/><top/><bottom/><diagonal/></border>" }], fmts = [];
  const idxOf = (list, key, make) => { let i = list.findIndex((e) => e.k === key); if (i < 0) { list.push({ k: key, x: make() }); i = list.length - 1; } return i; };
  const xfs = all.map((s) => {
    const fk = [s.b ? 1 : 0, s.sz ?? 11, s.color ?? "", s.name ?? "Calibri"].join("|");
    const fontId = idxOf(fonts, fk, () => `<font>${s.b ? "<b/>" : ""}<sz val="${s.sz ?? 11}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ""}<name val="${s.name ?? "Calibri"}"/></font>`);
    const fillId = s.fill ? idxOf(fills, "f" + s.fill, () => `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/></patternFill></fill>`) : 0;
    const bd = s.border;
    const side = (n) => (bd && (bd.side === "all" || bd.side === n) ? `<${n} style="${bd.style ?? "thin"}"><color rgb="FF${bd.color ?? "BFBFBF"}"/></${n}>` : `<${n}/>`);
    const borderId = bd ? idxOf(borders, "b" + JSON.stringify(bd), () => `<border>${side("left")}${side("right")}${side("top")}${side("bottom")}<diagonal/></border>`) : 0;
    let numFmtId = 0;
    if (typeof s.fmt === "number") numFmtId = s.fmt;
    else if (s.fmt) { let j = fmts.indexOf(s.fmt); if (j < 0) { fmts.push(s.fmt); j = fmts.length - 1; } numFmtId = 164 + j; }
    const al = s.h || s.v || s.wrap || s.shrink || s.indent ? `<alignment${s.h ? ` horizontal="${s.h}"` : ""}${s.v ? ` vertical="${s.v}"` : ""}${s.wrap ? ' wrapText="1"' : ""}${s.shrink ? ' shrinkToFit="1"' : ""}${s.indent ? ` indent="${s.indent}"` : ""}/>` : "";
    return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ""} applyFont="1"${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1">' + al + "</xf>" : "/>"}`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${fmts.length ? `<numFmts count="${fmts.length}">${fmts.map((f, j) => `<numFmt numFmtId="${164 + j}" formatCode="${esc(f)}"/>`).join("")}</numFmts>` : ""}<fonts count="${fonts.length}">${fonts.map((f) => f.x).join("")}</fonts><fills count="${fills.length}">${fills.map((f) => f.x).join("")}</fills><borders count="${borders.length}">${borders.map((b) => b.x).join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

// Los textos van siempre como texto (así un código "00123" no pierde los ceros); los números, como números
function cell(v, r, c, defaultStyle = 0) {
  let style = defaultStyle;
  if (v !== null && typeof v === "object") {
    style = v.s ?? defaultStyle;
    v = v.v;
  }
  const ref = `${colName(c)}${r + 1}`;
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined || v === "") return `<c r="${ref}"${s}/>`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Número no válido en ${ref}`);
    return `<c r="${ref}"${s}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/** Los ficheros XML que forman el libro, sin empaquetar: { "ruta": "contenido" }.
 *  Cada hoja: { name, rows, widths?, merges?, heights?, print? }. print = { area: "A1:H40", footerLeft?, footerRight?, margins?: { l, r, t, b, h, f } } →
 *  hoja A4 vertical, ajustada al ancho de una página, con área de impresión y pie de página (&P/&N = página/total). */
export function workbookFiles(sheets) {
  if (!sheets.length) throw new Error("El libro necesita al menos una hoja");
  const sheetXml = ({ rows, widths = [], merges = [], heights = {}, print = null, defaultHeight = null }) => {
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const data = rows.map((row, r) => `<row r="${r + 1}"${heights[r] ? ` ht="${heights[r]}" customHeight="1"` : ""}>${row.map((v, c) => cell(v, r, c)).join("")}</row>`).join("");
    const mer = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    let pre = "", post = "";
    if (print) {
      const m = { l: 0.25, r: 0.25, t: 0.4, b: 0.6, h: 0.2, f: 0.25, ...(print.margins ?? {}) };
      const pie = `&L&8${(print.footerLeft ?? "").replace(/&/g, "&&")}&R&9&P/&N`;
      pre = `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>`;
      post = `<printOptions horizontalCentered="1"/><pageMargins left="${m.l}" right="${m.r}" top="${m.t}" bottom="${m.b}" header="${m.h}" footer="${m.f}"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>${esc(pie)}</oddFooter></headerFooter>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pre}${cols}<sheetData>${data}</sheetData>${mer}${post}</worksheet>`;
  };
  const n = sheets.length;
  const idx = (f) => Array.from({ length: n }, (_, i) => f(i + 1)).join("");
  const quote = (name) => `'${name.slice(0, 31).replace(/'/g, "''")}'`;
  const areas = sheets.map((sh, i) => (sh.print?.area ? `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(quote(sh.name))}!${sh.print.area.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}</definedName>` : "")).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sh, i) => `<sheet name="${esc(sh.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${areas ? `<definedNames>${areas}</definedNames>` : ""}</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`)}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  };
  files["xl/styles.xml"] = stylesXml();
  sheets.forEach((sh, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sh)));
  return files;
}
