// Lector de texto de PDF SIN dependencias (solo `zlib` de Node). Sirve para los listados de a3ERP (generados por eDocEngine: texto suelto
// con su posición, fuentes WinAnsi o Identity-H con ToUnicode). NO es un lector general de PDF: no hace OCR, no abre PDF cifrados ni escaneados.
// Devuelve, por página, los trozos de texto con su posición { x, y, t } y las líneas ya agrupadas por altura.
import zlib from "node:zlib";

const MAX_BYTES = 40e6;
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const winAnsi = (b) => CP1252[b] ?? String.fromCharCode(b);

/** Un PDF seguro de leer: empieza por %PDF, no es enorme y no lleva nada que se ejecute (JavaScript, lanzar programas, archivos incrustados). */
export function revisarPdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Ese archivo no es un PDF.");
  if (buf.length > MAX_BYTES) throw new Error("El PDF pesa demasiado.");
  const s = buf.toString("latin1");
  if (/\/Encrypt\b/.test(s)) throw new Error("El PDF está protegido con contraseña: no se puede leer.");
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/.test(s)) throw new Error("El PDF lleva elementos activos (scripts o archivos incrustados): no se abre por seguridad.");
}

/** Objetos «N G obj … endobj» con su texto y, si lo tienen, su contenido (descomprimido si hace falta). */
function objetos(buf) {
  const s = buf.toString("latin1"), out = new Map(), re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length, fin = s.indexOf("endobj", ini); if (fin < 0) break;
    const cuerpo = s.slice(ini, fin), n = Number(m[1]), iStream = cuerpo.search(/stream\r?\n/);
    let dic = cuerpo, datos = null;
    if (iStream >= 0) {
      dic = cuerpo.slice(0, iStream);
      const desde = ini + iStream + cuerpo.slice(iStream).match(/stream\r?\n/)[0].length, hasta = s.indexOf("endstream", desde);
      if (hasta > desde) {
        let raw = buf.subarray(desde, hasta);
        if (/\/Filter\s*(\[\s*)?\/FlateDecode/.test(dic)) { try { raw = zlib.inflateSync(raw); } catch { try { raw = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { raw = null; } } }
        else if (/\/Filter/.test(dic)) raw = null; // otro filtro (imágenes…): no nos interesa
        datos = raw;
      }
    }
    out.set(n, { dic, datos });
    re.lastIndex = fin + 6;
  }
  return out;
}

const refsDe = (t) => [...String(t).matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));

/** ToUnicode: bfchar y bfrange → Map(código → texto). */
function cmap(txt) {
  const mapa = new Map(), u16 = (h) => { let r = ""; for (let i = 0; i + 3 < h.length + 1; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return r; };
  for (const bloque of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of bloque[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) mapa.set(parseInt(p[1], 16), u16(p[2]));
  for (const bloque of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of bloque[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(p[1], 16), b = parseInt(p[2], 16);
      if (b - a > 70000) continue;
      if (p[4]) { const base = u16(p[4]); for (let c = a; c <= b; c++) mapa.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - a))); }
      else { const lista = [...p[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => u16(x[1])); for (let c = a; c <= b && c - a < lista.length; c++) mapa.set(c, lista[c - a]); }
    }
  }
  return mapa;
}

/** Fuentes por nombre de recurso (/F0, /F1…): tipo y, si son de 2 bytes, su tabla ToUnicode. */
function fuentes(obj) {
  const f = new Map();
  for (const { dic } of obj.values()) {
    if (!/\/Type\s*\/Font\b/.test(dic) || /FontDescriptor\s*\/|\/Type\s*\/FontDescriptor/.test(dic) && !/\/Subtype/.test(dic)) continue;
    const nombre = /\/Name\s*\/(\S+?)(?=[\s/>\[])/.exec(dic)?.[1]; if (!nombre) continue;
    const dosBytes = /\/Subtype\s*\/Type0/.test(dic), tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(dic);
    const tabla = dosBytes && tu && obj.get(Number(tu[1]))?.datos ? cmap(obj.get(Number(tu[1])).datos.toString("latin1")) : null;
    f.set(nombre, { dosBytes, tabla });
  }
  return f;
}

/** Texto de una cadena PDF ya leída (bytes) según la fuente. */
function decodifica(bytes, fuente) {
  if (fuente?.dosBytes) { let r = ""; for (let i = 0; i + 1 < bytes.length; i += 2) { const c = (bytes[i] << 8) | bytes[i + 1]; r += fuente.tabla?.get(c) ?? ""; } return r; }
  let r = ""; for (const b of bytes) r += winAnsi(b); return r;
}

/** Recorre el contenido de una página y saca los trozos de texto con su posición. */
function trozosDePagina(contenido, fuentesMapa) {
  const s = contenido.toString("latin1"), items = [];
  let fuente = null, x = 0, y = 0, lx = 0, ly = 0, lead = 0, i = 0;
  const pila = [];
  const ws = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  const cad = () => { // cadena literal que empieza en s[i] === "("
    const bytes = []; let prof = 1; i++;
    while (i < s.length && prof > 0) {
      const c = s[i];
      if (c === "\\") {
        const n = s[i + 1];
        if (/[0-7]/.test(n)) { let o = ""; let k = 0; while (k < 3 && /[0-7]/.test(s[i + 1 + k] ?? "")) { o += s[i + 1 + k]; k++; } bytes.push(parseInt(o, 8) & 255); i += 1 + k; continue; }
        const mapa = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
        if (n === "\r" || n === "\n") { i += n === "\r" && s[i + 2] === "\n" ? 3 : 2; continue; }
        bytes.push(mapa[n] ?? n.charCodeAt(0)); i += 2; continue;
      }
      if (c === "(") prof++; else if (c === ")") { prof--; if (prof === 0) break; }
      bytes.push(c.charCodeAt(0) & 255); i++;
    }
    i++; return Buffer.from(bytes);
  };
  const hex = () => { const f = s.indexOf(">", i); const h = s.slice(i + 1, f < 0 ? s.length : f).replace(/\s+/g, ""); i = (f < 0 ? s.length : f) + 1; return Buffer.from(h.length % 2 ? h + "0" : h, "hex"); };
  const num = () => { const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 24)); if (!m) { i++; return null; } i += m[0].length; return Number(m[0]); };
  const operandos = [];
  while (i < s.length) {
    const c = s[i];
    if (ws(c)) { i++; continue; }
    if (c === "%") { while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === "(") { operandos.push({ cad: cad() }); continue; }
    if (c === "<" && s[i + 1] !== "<") { operandos.push({ cad: hex() }); continue; }
    if (c === "<" || c === ">") { i += 2; continue; }
    if (c === "[") { i++; const arr = []; while (i < s.length && s[i] !== "]") { if (ws(s[i])) { i++; continue; } if (s[i] === "(") arr.push({ cad: cad() }); else if (s[i] === "<") arr.push({ cad: hex() }); else { const n = num(); if (n !== null) arr.push(n); } } i++; operandos.push({ arr }); continue; }
    if (c === "/") { let j = i + 1; while (j < s.length && !ws(s[j]) && !"/[]<>()".includes(s[j])) j++; operandos.push({ nombre: s.slice(i + 1, j) }); i = j; continue; }
    if (/[+\-.\d]/.test(c)) { const n = num(); if (n !== null) operandos.push(n); continue; }
    let j = i; while (j < s.length && !ws(s[j]) && !"/[]<>()%".includes(s[j])) j++;
    const op = s.slice(i, j); i = j || i + 1;
    const nums = operandos.filter((o) => typeof o === "number");
    switch (op) {
      case "q": pila.push([fuente, x, y, lx, ly, lead]); break;
      case "Q": { const p = pila.pop(); if (p) [fuente, x, y, lx, ly, lead] = p; break; }
      case "BT": x = y = lx = ly = 0; break;
      case "Tf": { const n = operandos.find((o) => o.nombre !== undefined); if (n) fuente = fuentesMapa.get(n.nombre) ?? null; break; }
      case "Tm": if (nums.length >= 6) { x = lx = nums[4]; y = ly = nums[5]; } break;
      case "Td": if (nums.length >= 2) { lx += nums[0]; ly += nums[1]; x = lx; y = ly; } break;
      case "TD": if (nums.length >= 2) { lead = -nums[1]; lx += nums[0]; ly += nums[1]; x = lx; y = ly; } break;
      case "TL": if (nums.length) lead = nums[0]; break;
      case "T*": ly -= lead; y = ly; x = lx; break;
      case "Tj": case "'": case '"': { if (op !== "Tj") { ly -= lead; y = ly; x = lx; } const o = operandos[operandos.length - 1]; if (o?.cad) { const t = decodifica(o.cad, fuente); if (t.trim()) items.push({ x, y, t }); } break; }
      case "TJ": { const o = operandos[operandos.length - 1]; if (o?.arr) { const t = o.arr.map((e) => (e.cad ? decodifica(e.cad, fuente) : Number(e) < -250 ? " " : "")).join(""); if (t.trim()) items.push({ x, y, t }); } break; }
      default: break;
    }
    operandos.length = 0;
  }
  return items;
}

/** Páginas del PDF en orden: [{ trozos: [{x,y,t}], lineas: [[{x,y,t}…]…] }]. */
export function leerPdf(buf) {
  revisarPdf(buf);
  const obj = objetos(buf), fmap = fuentes(obj), paginas = [];
  // el orden lo da /Kids del nodo raíz de páginas; si no se entiende, el orden de aparición
  const esPagina = (d) => /\/Type\s*\/Page\b(?!s)/.test(d);
  const orden = [];
  for (const [n, { dic }] of obj) if (/\/Type\s*\/Pages\b/.test(dic) && /\/Kids/.test(dic)) { const k = /\/Kids\s*\[([^\]]*)\]/.exec(dic)?.[1]; if (k) orden.push(...refsDe(k)); }
  const lista = [], visto = new Set(), recorre = (n) => { if (visto.has(n)) return; visto.add(n); const o = obj.get(n); if (!o) return; if (esPagina(o.dic)) lista.push(n); else if (/\/Kids/.test(o.dic)) for (const h of refsDe(/\/Kids\s*\[([^\]]*)\]/.exec(o.dic)?.[1] ?? "")) recorre(h); };
  for (const n of orden) recorre(n);
  for (const [n, { dic }] of obj) if (esPagina(dic) && !visto.has(n)) lista.push(n);
  for (const n of lista) {
    const dic = obj.get(n).dic, c = /\/Contents\s*(\[([^\]]*)\]|(\d+)\s+\d+\s+R)/.exec(dic); if (!c) continue;
    const refs = c[2] ? refsDe(c[2]) : [Number(c[3])]; let partes = [];
    for (const r of refs) { const d = obj.get(r)?.datos; if (d) partes.push(d); }
    const trozos = trozosDePagina(Buffer.concat(partes.flatMap((p) => [p, Buffer.from("\n")])), fmap);
    // líneas: misma altura (±1,5 pt), de arriba abajo, y dentro de cada línea de izquierda a derecha
    const ord = [...trozos].sort((a, b) => b.y - a.y || a.x - b.x), lineas = [];
    for (const t of ord) { const l = lineas[lineas.length - 1]; if (l && Math.abs(l[0].y - t.y) <= 1.5) l.push(t); else lineas.push([t]); }
    for (const l of lineas) l.sort((a, b) => a.x - b.x);
    paginas.push({ trozos, lineas });
  }
  if (!paginas.length) throw new Error("No he encontrado texto en el PDF (¿es un PDF escaneado o de otro programa?).");
  return paginas;
}
