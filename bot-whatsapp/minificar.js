// Limpia el CSS y el JavaScript que se SIRVEN (los archivos fuente no se tocan): quita comentarios y espacios sobrantes y,
// en el CSS, junta las reglas repetidas (mismo selector, mismo @media) solo cuando es seguro: nada que quede entre medias
// toca ninguna de las propiedades que se mueven, así que el orden de la cascada no cambia y el aspecto tampoco.
// Todo es a prueba de fallos: si algo no se entiende, se devuelve el texto original sin tocar.

const colapsa = (s) => { // varios espacios seguidos → uno (fuera de comillas)
  let out = "", q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === "\\") out += s[++i] ?? ""; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (/\s/.test(c)) { if (!/\s$/.test(out)) out += " "; continue; }
    out += c;
  }
  return out.trim();
};

// ───────────── CSS ─────────────
function quitaComentariosCss(css) {
  let out = "", q = "";
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (q) { out += c; if (c === "\\") out += css[++i] ?? ""; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === "/" && css[i + 1] === "*") { const f = css.indexOf("*/", i + 2); if (f < 0) throw new Error("comentario sin cerrar"); i = f + 1; if (!/\s$/.test(out)) out += " "; continue; }
    out += c;
  }
  if (q) throw new Error("comillas sin cerrar");
  return out;
}
// Busca el cierre de «{» (o el primer ; / { de nivel 0) respetando comillas y paréntesis
function hasta(s, i, paradas) {
  let q = "", par = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "(") par++; else if (c === ")") par--;
    else if (par <= 0 && paradas.includes(c)) return i;
  }
  return -1;
}
function cierre(s, abre) { // índice del «}» que cierra el «{» de la posición `abre`
  let prof = 0, q = "";
  for (let i = abre; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "{") prof++; else if (c === "}" && --prof === 0) return i;
  }
  throw new Error("llave sin cerrar");
}
function decls(body) {
  const out = []; let i = 0;
  while (i < body.length) {
    const f = hasta(body, i, [";"]); const fin = f < 0 ? body.length : f;
    const t = body.slice(i, fin).trim(); if (t) { const k = t.indexOf(":"); if (k < 1) throw new Error("declaración rara"); out.push({ prop: t.slice(0, k).trim().toLowerCase(), text: colapsa(t) }); }
    i = fin + 1;
  }
  return out;
}
const CON_HIJOS = new Set(["media", "supports", "container", "layer"]);
const INERTES = new Set(["keyframes", "-webkit-keyframes", "font-face", "page", "property", "counter-style"]);
function parseCss(s) {
  const nodos = []; let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const p = hasta(s, i, ["{", ";"]); if (p < 0) throw new Error("fin inesperado");
    const pre = colapsa(s.slice(i, p));
    if (s[p] === ";") { nodos.push({ k: "stmt", raw: pre + ";" }); i = p + 1; continue; }
    const c = cierre(s, p), cuerpo = s.slice(p + 1, c); i = c + 1;
    if (pre.startsWith("@")) {
      const n = /^@([\w-]+)/.exec(pre)?.[1]?.toLowerCase();
      if (CON_HIJOS.has(n)) nodos.push({ k: "cond", pre, hijos: parseCss(cuerpo) });
      else if (INERTES.has(n)) nodos.push({ k: "inerte", pre, raw: colapsa(cuerpo) });
      else nodos.push({ k: "raro", pre, raw: colapsa(cuerpo) });
    } else nodos.push({ k: "regla", pre, decls: decls(cuerpo) });
  }
  return nodos;
}
const familia = (p) => (p.startsWith("--") ? p : p.replace(/^-(webkit|moz|ms|o)-/, "").split("-")[0]);
const TODO = Symbol("todo");
function props(n) { // familias de propiedades que toca un nodo (TODO = no se sabe: nada se mueve a través de él)
  if (n.k === "regla") return new Set(n.decls.map((d) => familia(d.prop)));
  if (n.k === "inerte") return new Set();
  if (n.k === "cond") { const u = new Set(); for (const h of n.hijos) { const x = props(h); if (x === TODO) return TODO; for (const f of x) u.add(f); } return u; }
  return TODO;
}
const clave = (n) => (n.k === "regla" ? "r:" + n.pre : n.k === "cond" ? "c:" + n.pre : null);
function junta(nodos) {
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (let i = 0; i < nodos.length && !cambio; i++) {
      const ki = clave(nodos[i]); if (!ki) continue;
      const pi = props(nodos[i]); if (pi === TODO) continue;
      for (let j = i + 1; j < nodos.length; j++) {
        if (clave(nodos[j]) !== ki) continue;
        let seguro = true;
        for (let k = i + 1; k < j && seguro; k++) { const pk = props(nodos[k]); if (pk === TODO) seguro = false; else for (const f of pi) if (pk.has(f)) { seguro = false; break; } }
        if (!seguro) continue; // este par no se puede juntar; se prueba con el siguiente igual
        if (nodos[i].k === "regla") nodos[j].decls = nodos[i].decls.concat(nodos[j].decls); else nodos[j].hijos = nodos[i].hijos.concat(nodos[j].hijos);
        nodos.splice(i, 1); cambio = true; break;
      }
    }
  }
  for (const n of nodos) if (n.k === "cond") junta(n.hijos);
  return nodos;
}
const escribe = (nodos) => nodos.map((n) => (n.k === "stmt" ? n.raw : n.k === "regla" ? `${n.pre}{${n.decls.map((d) => d.text).join(";")}}` : n.k === "cond" ? `${n.pre}{${escribe(n.hijos)}}` : `${n.pre}{${n.raw}}`)).join("\n");

export function limpiaCss(css) {
  try { return escribe(junta(parseCss(quitaComentariosCss(String(css))))); } catch { return String(css); }
}

// ───────────── JavaScript ─────────────
const ANTES_DE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const PALABRAS_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof"]);
export function limpiaJs(js) {
  const s = String(js);
  try {
    let i = 0, ultimo = "", palabra = "";
    const marca = (c) => { if (/[\w$]/.test(c)) palabra += c; else { if (!/\s/.test(c)) palabra = ""; } if (!/\s/.test(c)) ultimo = c; };
    // `copia` devuelve el código sin comentarios hasta el final o hasta el «}» que cierra una ${…}
    const copia = (enTemplate) => {
      let out = "", prof = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '"' || c === "'") { // cadena
          let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; if (s[j] === "\n") throw new Error("cadena rota"); j++; }
          if (j >= s.length) throw new Error("cadena sin cerrar");
          out += s.slice(i, j + 1); i = j + 1; ultimo = c; palabra = ""; continue;
        }
        if (c === "`") { out += plantilla(); ultimo = "`"; palabra = ""; continue; }
        if (c === "/") {
          const n = s[i + 1];
          if (n === "/") { // comentario de línea
            let j = s.indexOf("\n", i); if (j < 0) j = s.length;
            out = out.replace(/[ \t]+$/, ""); i = j; // el salto de línea se queda; si la línea solo tenía el comentario, se quita también
            if (out === "" || out.endsWith("\n")) { if (s[i] === "\n") i++; }
            continue;
          }
          if (n === "*") { // comentario de bloque
            const f = s.indexOf("*/", i + 2); if (f < 0) throw new Error("comentario sin cerrar");
            const hayLinea = s.slice(i, f).includes("\n"); i = f + 2;
            if (hayLinea) { out = out.replace(/[ \t]+$/, ""); if (!(out === "" || out.endsWith("\n"))) out += "\n"; } else if (!/\s$/.test(out)) out += " ";
            continue;
          }
          if (ANTES_DE_REGEX.has(ultimo) || PALABRAS_REGEX.has(palabra)) { // expresión regular
            let j = i + 1, clase = false;
            for (; j < s.length; j++) { const d = s[j]; if (d === "\n") throw new Error("regex rota"); if (d === "\\") { j++; continue; } if (d === "[") clase = true; else if (d === "]") clase = false; else if (d === "/" && !clase) break; }
            if (j >= s.length) throw new Error("regex sin cerrar");
            j++; while (j < s.length && /[a-z]/i.test(s[j])) j++;
            out += s.slice(i, j); i = j; ultimo = ")"; palabra = ""; continue; // tras una regex, una «/» es división
          }
        }
        if (enTemplate) { if (c === "{") prof++; else if (c === "}") { if (prof === 0) return out; prof--; } }
        out += c; i++; marca(c);
      }
      if (enTemplate) throw new Error("plantilla sin cerrar");
      return out;
    };
    const plantilla = () => { // `texto ${código} texto`: el texto se copia tal cual (los espacios y saltos de línea son contenido)
      let out = "`"; i++;
      while (i < s.length) {
        const c = s[i];
        if (c === "\\") { out += c + (s[i + 1] ?? ""); i += 2; continue; }
        if (c === "`") { out += c; i++; return out; }
        if (c === "$" && s[i + 1] === "{") { out += "${"; i += 2; const gu = [ultimo, palabra]; ultimo = "{"; palabra = ""; out += copia(true); [ultimo, palabra] = gu; out += "}"; i++; continue; }
        out += c; i++;
      }
      throw new Error("plantilla sin cerrar");
    };
    const r = copia(false);
    new Function(r); // si no compila, se devuelve el original
    return r;
  } catch { return s; }
}
