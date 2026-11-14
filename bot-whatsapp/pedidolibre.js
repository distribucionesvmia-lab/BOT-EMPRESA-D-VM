// Pedido escrito con naturalidad, de uno o de varios artículos en el mismo mensaje («ponme 2 cajas de coca cola y 3 de agua»).
// Cada artículo se procesa POR SEPARADO: lo claro se añade, lo ambiguo se pregunta, y lo que no existe se dice sin inventar nada parecido.
// Sin IA externa: reglas, palabras equivalentes y comparación «de oído» (k↔c/qu, ll↔y, v↔b, z↔s, sin h). Funciones puras: el catálogo llega como parámetro.
import { norm, numberWords, NUMBER_WORDS } from "./nlu.js";
import { categorizar } from "./categorias.js";
import { recomendarPara } from "./asistente.js";

/** Cómo suena una palabra: «kiero» = «quiero», «kajas» = «cajas», «bezolla» = «bezoya». */
export const fon = (w) => norm(w).replace(/[^a-z0-9]/g, "")
  .replace(/h/g, "").replace(/ll/g, "y").replace(/qu/g, "k").replace(/c(?=[ei])/g, "s").replace(/c/g, "k").replace(/z/g, "s").replace(/v/g, "b")
  .replace(/g(?=[ei])/g, "j").replace(/w/g, "b").replace(/(.)\1+/g, "$1");

// Palabras del idioma del pedido que se corrigen si vienen mal escritas (solo si NO son una palabra del catálogo)
const VOCABULARIO = ["quiero", "quisiera", "necesito", "ponme", "dame", "mandame", "apuntame", "anademe", "cajas", "caja", "unidades", "unidad", "barril", "barriles", "latas", "lata",
  "botellas", "botella", "gracias", "favor", "total", "confirmes", "confirmar", "limpiar", "plancha", "cerveza", "cervezas", "alcohol", "normal", "kilo", "kilos", "litro", "litros", "paquete", "bolsa"];
const CANON = new Map(VOCABULARIO.map((w) => [fon(w), w]));

const STOP = new Set(("de del la el los las y e un una uno unos unas con para por me mas otro otra tambien gracias hola buenas quiero quisiera necesito necesitamos ponme pon dame mandame manda " +
  "pedido favor porfa ud uds unidad unidades caja cajas lata latas botella botellas pack packs bandeja bandejas litro litros kilo kilos que a al en lo buenos dias tardes noches queria queremos " +
  "pedir pedirte voy puedes puedo podrias podeis traer traeme apuntame apunta anota anademe sirveme ademas luego si ser puede ponnos ponedme x eso esto mi nuestro nuestra " +
  "barril barriles paquete paquetes bolsa bolsas saco sacos carro carrito cesta cestita compra agrega agregame agregar mete meteme metelo incluye incluyeme suma sumame echa echame anadir anademe anadelo pideme necesitaba quisiera ponlo ponmelo " +
  "hazme haz preparame prepara tengo tenemos falta faltan hace falta").split(" "));
// Palabras que matizan el artículo (no son «el artículo»): sirven para afinar entre varios, pero sin ellas el artículo no cambia
const MODS = new Set(["grano", "granos", "molido", "molida", "soluble", "entera", "entero", "desnatada", "semi", "natural", "zero", "cero", "light", "sinalcohol", "singluten", "sinlactosa", "descafeinado", "gas", "normal", "clasica", "clasico", "original", "pequeno", "pequena", "grande", "familiar"]);
const NEGATIVOS = ["zero", "cero", "light", "sinalcohol", "singluten", "sinlactosa", "descafeinado", "sin"]; // «normal» = ninguna de estas variantes
const FORMATO_ESTRICTO = new Set(["barril", "barriles", "barrica", "garrafa", "garrafas", "bidon", "bidones", "granel"]); // si lo piden y no existe, NO se cambia por otro formato
const NUCLEO = {
  cerveza: ["cerveza", "mahou", "estrella", "amstel", "cruzcampo", "alhambra", "heineken", "damm", "radler", "shandy", "keler", "corona", "voll"],
  cafe: ["cafe", "marcilla", "saimaza", "mocay", "nescafe", "nespresso", "lavazza", "illy", "bonka", "bellarom"],
};
NUCLEO.cervezas = NUCLEO.cerveza;

const MEDIDA = /(\d+(?:[.,]\d+)?)\s*(kilos?|kgs?|gramos?|grs?|g|litros?|lts?|l|cl|ml)\b/g;
const UNIDAD_MEDIDA = { kilo: "kg", kilos: "kg", kg: "kg", kgs: "kg", gramo: "g", gramos: "g", gr: "g", grs: "g", g: "g", litro: "l", litros: "l", lt: "l", lts: "l", l: "l", cl: "cl", ml: "ml" };
/** Prepara un texto: sin tildes, medidas pegadas («1 kg» → «m_1kg»), «0,0» y «sin alcohol» como una sola palabra. */
export function preparar(s) {
  return ` ${norm(s)} `.replace(/(\d)\s*[,.]\s*(\d)/g, "$1.$2")
    .replace(MEDIDA, (_, n, u) => ` m_${Number(n)}${UNIDAD_MEDIDA[u] ?? u} `)
    .replace(/\b0\.0+\b\s*%?/g, " sinalcohol ").replace(/\b(?:sin|cero)\s+alcohol\b|\b0\s+alcohol\b/g, " sinalcohol ")
    .replace(/\bsin gluten\b/g, " singluten ").replace(/\bsin lactosa\b/g, " sinlactosa ");
}
const tokens = (s) => preparar(s).split(/[^a-z0-9_.]+/).filter((t) => t && t !== ".");
const medidasDe = (toks) => toks.filter((t) => t.startsWith("m_"));

/** 2 = misma palabra (o plural/prefijo); 1 = parecida (errata o «de oído»); 0 = distinta. */
export function parecido(q, t) {
  if (q === t || q === t + "s" || q === t + "es" || t === q + "s" || t === q + "es") return 2;
  if (q.length >= 4 && t.length >= 4 && (t.startsWith(q) || q.startsWith(t))) return 2;
  if (q.length >= 4 && t.length >= 4 && fon(q) === fon(t)) return 1;
  if (q.length >= 6 && t.length >= 6) { const a = fon(q), b = fon(t); if (a === b || (Math.abs(a.length - b.length) <= 1 && distancia1(a, b))) return 1; }
  return 0;
}
const distancia1 = (a, b) => {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
};

const INDICES = new WeakMap();
function indice(catalogo) {
  if (INDICES.has(catalogo)) return INDICES.get(catalogo);
  const prods = catalogo.filter((p) => p.active !== false && p.name).map((p) => {
    const toks = tokens(`${p.name} ${(p.aliases ?? []).join(" ")}`);
    let cat = []; try { cat = tokens(categorizar(p).catNombre); } catch { /* sin categoría */ }
    return { p, toks, cat, medidas: medidasDe(toks) };
  });
  const vocab = new Set(prods.flatMap((x) => x.toks));
  const r = { prods, vocab };
  INDICES.set(catalogo, r);
  return r;
}

// Cada palabra mal escrita se cambia por la buena si es del idioma del pedido y no es una palabra del catálogo
const corregir = (w, vocab) => (vocab.has(w) || STOP.has(w) || !CANON.has(fon(w)) || w.length < 4 ? w : CANON.get(fon(w)));

const CANTIDAD = /^\d+$/;
const REC = /\balgo (?:para|que|con)\b|\bque (?:me )?(?:sirve|sirven|recomiendas|va bien|puedo usar)\b|\bnecesito algo\b|\bpara limpiar\b|\bpara (?:la|el) (?:plancha|freidora|horno|campana|barra|cocina)\b/;
const META_TOTAL = /\b(?:dime|dame|indica|calcula|pon|muestrame|ensename|cuanto|cual)\b.*\b(?:total|importe|cuanto|suma|vale|cuesta|sale|salen)\b|^\s*(?:el )?total\b|\bel total\b/;
const META_NOCONFIRMAR = /\bno (?:lo )?(?:confirm|envi|mand|cierr|finaliz)\w*|\bsin (?:confirmar|enviar)\b|\bpero no\b|\bsolo (?:quiero )?(?:ver|saber|el total)\b/;
const CHARLA = /^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|gracias|por favor|porfa|vale|ok|oye|mira|venga|y|pues|bueno)?$/;

/** Parte el mensaje en trozos (uno por artículo): comas, «;», «+», «y», «e» y saltos de línea. */
export function trozos(texto) {
  return numberWords(texto).split(/\s*(?:,|;|\+|\n|\.\s|\by\b|\be\b)\s*/).map((x) => x.trim()).filter(Boolean);
}
const aNumero = (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w); // «dos» → «2», «una» → «1»
const tieneCantidad = (t) => { const w = tokens(numberWords(t).replace(MEDIDA, " ")).map(aNumero); return w.some((x) => CANTIDAD.test(x) && Number(x) > 0); };
/** ¿Es un mensaje con varias cosas (varios artículos, o artículos y una necesidad)? Entonces no lo contesta el asistente de preguntas sino este módulo. */
export function esPedidoMultiple(texto) {
  const ts = trozos(texto).map((z) => preparar(z));
  const cuantos = ts.filter((z) => tieneCantidad(z) && !META_TOTAL.test(z) && !REC.test(z)).length;
  const recs = ts.filter((z) => REC.test(z)).length;
  return cuantos >= 2 || (cuantos >= 1 && recs >= 1);
}

/** Todas las palabras del trozo ya preparadas y con las erratas corregidas. */
const palabrasDe = (z, vocab) => tokens(z).map((w) => aNumero(corregir(w, vocab)));

function interpretarTrozo(z, ctx, previo) {
  const { prods, vocab } = ctx.idx;
  const crudo = z.trim();
  const ws = palabrasDe(crudo, vocab);
  const plano = ws.join(" ");
  if (!ws.length || CHARLA.test(plano)) return { tipo: "nada" };
  if (META_TOTAL.test(plano)) return { tipo: "total", texto: crudo };
  if (META_NOCONFIRMAR.test(plano) && !ws.some((w) => CANTIDAD.test(w))) return { tipo: "noconfirmar", texto: crudo };
  if (REC.test(plano)) return { tipo: "recomendar", texto: crudo, ...recomendarPara(crudo, ctx.catalogo, { habituales: ctx.habituales, precioOf: ctx.precioOf }) };

  // Cantidad, medida y formato
  let qty = null, i = -1;
  ws.forEach((w, k) => { if (i < 0 && CANTIDAD.test(w) && !ws[k - 1]?.startsWith("m_")) i = k; });
  const resto = ws.slice();
  if (i >= 0) { qty = Number(resto[i]); resto.splice(i, 1); }
  const medida = resto.find((w) => w.startsWith("m_")) ?? null;
  const unitCaja = resto.some((w) => w === "caja" || w === "cajas");
  const unitUd = resto.some((w) => ["ud", "uds", "unidad", "unidades"].includes(w));
  const formato = resto.find((w) => FORMATO_ESTRICTO.has(w)) ?? null;
  // «2 cajas de X y 3 de Y»: el «3 de Y» también es en cajas
  const hereda = qty != null && !unitCaja && !unitUd && !formato && previo?.cajas && /^\s*\d+\s+de\s/.test(crudo);
  const unit = unitCaja || (hereda && !unitUd) ? "caja" : "ud";
  const unitStated = unitCaja || unitUd || hereda || !!formato;
  const query = resto.filter((w) => !STOP.has(w) && !w.startsWith("m_") && !/^\d+$/.test(w));
  if (!query.length && !medida) return { tipo: "nada" };
  if (qty != null && (qty < 1 || qty > 999)) return { tipo: "nada" };
  const mods = query.filter((w) => MODS.has(w));
  let core = query.filter((w) => !MODS.has(w));
  if (!core.length) core = query.slice();
  const resumen = [qty ?? "", unitCaja ? "cajas de" : formato ? formato : "", query.join(" "), medida ? medida.slice(2) : ""].filter((x) => x !== "").join(" ").replace(/\s+/g, " ").trim();
  const base = { texto: crudo.replace(/\s+/g, " "), resumen, qty, unit, unitStated, cajas: unitCaja };

  // 1) candidatos: TODAS las palabras del artículo tienen que estar (el artículo principal manda; «grano» o «1kg» sueltos no bastan)
  const nivel = (w, x, esCabeza) => {
    let n = 0;
    for (const t of x.toks) n = Math.max(n, parecido(w, t));
    if (n < 2 && esCabeza) {
      if (x.cat.some((t) => parecido(w, t) === 2 && w.length >= 4)) n = Math.max(n, 2);
      const g = NUCLEO[w]; if (g && x.toks.some((t) => g.includes(t))) n = 2;
    }
    return n;
  };
  const fila = prods.map((x) => {
    const niveles = core.map((w, k) => nivel(w, x, k === 0));
    return { x, niveles, ok: niveles.every((n) => n > 0), aprox: niveles.some((n) => n === 1) };
  });
  let cands = fila.filter((f) => f.ok);
  if (!cands.length) {
    // nada encaja del todo: se enseña lo que tiene el artículo principal (si lo hay), pero no se añade nada
    const cabeza = fila.filter((f) => f.niveles[0] > 0).map((f) => f.x.p);
    return { tipo: "duda", clase: "sin_coincidencia", ...base, productos: cabeza.slice(0, 5) };
  }
  // 2) formato exacto (barril…): si lo piden y no existe, se dice; no se cambia por otro formato
  if (formato) {
    const con = cands.filter((f) => f.x.toks.some((t) => parecido(formato, t) > 0 || parecido(formato.replace(/e?s$/, ""), t) > 0));
    if (!con.length) return { tipo: "duda", clase: "formato", ...base, formato, productos: cands.map((f) => f.x.p).slice(0, 5) };
    cands = con;
  }
  // 3) medida (1 kg, 1,5 l…)
  if (medida) {
    const con = cands.filter((f) => f.x.medidas.includes(medida));
    if (!con.length) return { tipo: "duda", clase: "medida", ...base, medida: medida.slice(2), productos: cands.map((f) => f.x.p).slice(0, 5) };
    cands = con;
  }
  // 4) «normal» = sin variantes; el resto de matices afinan («grano», «zero», «sin alcohol»…)
  if (mods.some((w) => ["normal", "clasica", "clasico", "original"].includes(w))) {
    const sin = cands.filter((f) => !f.x.toks.some((t) => NEGATIVOS.includes(t)));
    if (sin.length) cands = sin;
  }
  const exigidos = mods.filter((w) => !["normal", "clasica", "clasico", "original", "pequeno", "pequena", "grande", "familiar"].includes(w));
  if (exigidos.length) {
    const puntos = (f) => exigidos.filter((w) => f.x.toks.some((t) => parecido(w, t) > 0)).length;
    const mejor = Math.max(...cands.map(puntos));
    if (mejor < exigidos.length) {
      // ninguno tiene TODOS los matices («cerveza sin alcohol» pero no hay): se pregunta la marca entre las que hay, sin añadir ninguna
      if (mejor === 0 || !cands.some((f) => puntos(f) === exigidos.length)) return { tipo: "duda", clase: "variante", ...base, variante: exigidos.join(" ").replace("sinalcohol", "sin alcohol"), productos: cands.map((f) => f.x.p), todas: true };
    }
    cands = cands.filter((f) => puntos(f) === mejor);
  }
  // una sola palabra que es una categoría («agua», «vino»): se enseña TODA la categoría, no solo los que llevan la palabra (el «vaso de agua» no es agua)
  if (core.length === 1 && core[0].length >= 4 && !mods.length && !medida) {
    const porCat = cands.filter((f) => f.x.cat.some((t) => parecido(core[0], t) === 2));
    if (porCat.length > 1) cands = porCat;
  }
  const lista = cands.map((f) => f.x.p);
  // 5) uno solo: claro (si lo acertó «de oído», se confirma antes de añadirlo); varios: si solo uno ya lo compra, ese; si no, se pregunta
  if (lista.length === 1) {
    const aprox = cands[0].aprox;
    return aprox ? { tipo: "duda", clase: "confirmar", ...base, productos: lista } : { tipo: "claro", ...base, p: lista[0] };
  }
  const compra = lista.filter((p) => ctx.bought.has(String(p.id)));
  if (compra.length === 1 && !cands.some((f) => f.aprox)) return { tipo: "claro", ...base, p: compra[0], habitual: true };
  return { tipo: "duda", clase: cands.some((f) => f.aprox) ? "confirmar" : "ambiguo", ...base, query: query.join(" "), productos: lista };
}

/**
 * Interpreta un mensaje con uno o varios artículos. Devuelve null si no hay nada que se parezca a un pedido; si no:
 *  { claros: [{ p, qty, unit, unitStated, texto }], dudas: [{ clase, texto, qty, unit, unitStated, productos, … }], pideTotal, noConfirmar }
 * clase de duda: «ambiguo» (varios artículos igual de buenos), «confirmar» (parece este, pero escrito «de oído»), «formato» (no existe el formato pedido),
 * «medida» (no existe esa medida), «variante» (no hay ninguno con ese matiz), «sin_coincidencia» (no existe), «recomendar» (pide una recomendación).
 */
export function interpretarPedido(texto, { catalogo, habituales = new Set(), bought = new Set(), precioOf = (p) => p.price } = {}) {
  const idx = indice(catalogo);
  const ctx = { catalogo, idx, habituales, bought, precioOf };
  const out = { claros: [], dudas: [], pideTotal: false, noConfirmar: false };
  let previo = null;
  for (const z of trozos(texto)) {
    const r = interpretarTrozo(z, ctx, previo);
    if (r.tipo === "nada") continue;
    if (r.tipo === "total") { out.pideTotal = true; continue; }
    if (r.tipo === "noconfirmar") { out.noConfirmar = true; continue; }
    if (r.tipo === "recomendar") { out.dudas.push({ clase: "recomendar", texto: r.texto, productos: r.productos ?? [], mensaje: r.mensaje }); continue; }
    if (r.tipo === "claro") { out.claros.push(r); previo = { cajas: r.unit === "caja" && r.unitStated }; continue; }
    out.dudas.push(r); previo = { cajas: !!r.cajas };
  }
  // Un mensaje sin artículos ni cantidades no se toma por pedido («hola», «qué tal»)
  const hayCantidad = tieneCantidad(texto);
  if (!out.claros.length && !out.dudas.length) return null;
  if (!hayCantidad && !out.claros.length && out.dudas.every((d) => d.clase === "sin_coincidencia" && !d.productos.length)) return null;
  // Sin cantidad, un solo artículo claro («agua» ya se resuelve con la lista; «servilletas» → que elija): no se añade solo
  for (const c of out.claros.slice()) if (c.qty == null) { out.claros.splice(out.claros.indexOf(c), 1); out.dudas.push({ ...c, clase: "ambiguo", productos: [c.p], query: c.texto }); }
  return out;
}
