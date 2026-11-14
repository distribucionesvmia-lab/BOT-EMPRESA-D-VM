// Nombres de artículo más limpios para el cliente («REFRESCO COLA LATA 33 CL» → «Refresco cola lata 33 cl»).
// Solo cambia cómo SE ENSEÑA: el nombre original no se toca, se sigue buscando por él y se ve en el detalle del artículo.
// Se puede corregir cualquier caso a mano con la tabla de excepciones (original → limpio): ver nombres-excepciones.ejemplo.json.

const SIGLAS = new Set(["PET", "IVA", "ES", "UHT", "IGP", "DOP", "DO", "SA", "SL", "BIO", "LED", "USB", "TV", "XL", "XXL", "ECO", "UD", "UDS"]);
const ACENTOS = { azucar: "azúcar", cafe: "café", atun: "atún", jamon: "jamón", limon: "limón", platano: "plátano", melocoton: "melocotón", anis: "anís", cafeina: "cafeína", picante: "picante", tonica: "tónica", mineral: "mineral", gaseosa: "gaseosa", cerveza: "cerveza", sin: "sin", cacao: "cacao", camaron: "camarón", champinon: "champiñón", champinones: "champiñones", pimenton: "pimentón", salmon: "salmón", maiz: "maíz", ñora: "ñora", bonito: "bonito", pure: "puré", pina: "piña", tomate: "tomate", mani: "maní", cerezas: "cerezas", espana: "España", galicia: "Galicia", rioja: "Rioja", ribera: "Ribera", valencia: "Valencia", naranja: "naranja", leche: "leche", agua: "agua", aceite: "aceite", vino: "vino" };
const PROPIOS = new Set(["rioja", "ribera", "valencia", "españa", "galicia", "duero", "rueda", "navarra", "cádiz", "jerez", "murcia", "castilla", "león", "toro", "cava"]);
const UNIDADES = { l: "L", lt: "L", lts: "L", litro: "L", litros: "L", cl: "cl", ml: "ml", gr: "g", grs: "g", g: "g", kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg" };

/** Marcas conocidas (en minúsculas, sin tildes). Se amplía con la opción `marcas` o con el fichero de marcas de la empresa. */
export const MARCAS_BASE = ["coca-cola", "coca cola", "pepsi", "fanta", "sprite", "nestea", "aquarius", "schweppes", "red bull", "monster", "mahou", "estrella galicia", "estrella damm", "cruzcampo", "san miguel", "heineken", "alhambra", "amstel", "voll-damm", "damm", "ribera del duero", "campofrio", "campofrío", "el pozo", "casa tarradellas", "tarradellas", "pascual", "puleva", "president", "président", "danone", "nestle", "nestlé", "nescafe", "nescafé", "marcilla", "saimaza", "bonka", "lavazza", "cola cao", "colacao", "nocilla", "ybarra", "carbonell", "koipe", "hacendado", "gallina blanca", "knorr", "maggi", "heinz", "orlando", "ligeresa", "frigo", "ron barcelo", "barceló", "larios", "brugal", "bacardi", "jb", "ballantines", "gordons", "beefeater", "bezoya", "font vella", "solan de cabras", "lanjaron", "lanjarón", "veri", "vichy catalan", "vichy catalán", "viladrau"];

const sinTildes = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s) => sinTildes(s).toLowerCase().replace(/\s+/g, " ").trim();

function titulo(s) { return s.replace(/(^|[\s-])([a-záéíóúüñ])/g, (_, a, b) => a + b.toUpperCase()); } // marca: cada palabra con mayúscula

function palabra(w, primera) {
  const bajo = w.toLowerCase(), clave = sinTildes(bajo);
  if (SIGLAS.has(w.toUpperCase()) && w === w.toUpperCase()) return w.toUpperCase();
  if (/^\d/.test(w)) return bajo.replace(/(\d)(l|lt|lts|litros?|cl|ml|gr|grs|g|kg)$/i, (_, n, u) => n + UNIDADES[u.toLowerCase()]);
  if (UNIDADES[clave] && /^(cl|ml|gr|grs|kg|kgs|lts?|litros?)$/.test(clave)) return UNIDADES[clave];
  const acento = ACENTOS[clave];
  const w2 = acento || bajo;
  return primera || PROPIOS.has(norm(w2)) ? w2[0].toUpperCase() + w2.slice(1) : w2;
}

function limpiaBase(original) {
  let s = String(original ?? "");
  s = s.replace(/[“”«»„]/g, '"').replace(/\s+/g, " ").trim();
  // « " 12 " LITROS » → «12 L»: comillas sueltas alrededor de una cantidad
  s = s.replace(/"\s*(\d+(?:[.,]\d+)?)\s*"\s*(litros?|lts?|l|cl|ml|kgs?|kilos?|grs?|g)\b/gi, (_, n, u) => `${n} ${UNIDADES[u.toLowerCase()]}`);
  s = s.replace(/"/g, "").replace(/\s*'\s*$/, "");
  // «23 CL.VALENCIA» → «23 cl · Valencia»: tamaño pegado por un punto a otra palabra
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(litros?|lts?|l|cl|ml|kgs?|kilos?|grs?|g)\.\s*(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])/gi, (_, n, u) => `${n} ${UNIDADES[u.toLowerCase()]} · `);
  s = s.replace(/\.\s*(?=[A-Za-zÁÉÍÓÚÑ])/g, ". ").replace(/\s*[.,;:]+\s*$/g, "").replace(/\s+([.,)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s+/g, " ").trim();
  return s;
}

/** Cantidad + unidad: «33cl» → «33 cl», «1.5 litros» → «1,5 L», «250 GR» → «250 g». */
function unidades(s) {
  return s.replace(/(\d+(?:[.,]\d+)?)\s*(litros?|lts?|l|cl|ml|kgs?|kilos?|grs?|g)(?![a-záéíóúñ0-9])/gi, (_, n, u) => `${n.replace(".", ",")} ${UNIDADES[u.toLowerCase()]}`);
}

function aFrase(s) {
  const partes = s.split(" · ").map((parte) => parte.trim()).filter(Boolean);
  const t = partes.map((p, i) => p.split(" ").map((w, j) => {
    const m = w.match(/^(\(?)(.*?)(\)?[.,]?)$/); // conserva paréntesis y signos pegados
    return m[1] + palabra(m[2], i === 0 && j === 0 || j === 0 && i > 0 && PROPIOS.has(norm(m[2]))) + m[3];
  }).join(" "));
  return unidades(t.join(" · ").replace(/^(\(?)([a-záéíóúñ])/, (_, a, b) => a + b.toUpperCase()));
}

/**
 * Devuelve { nombre, marca, original, cambiado }.
 * `excepciones`: { "NOMBRE ORIGINAL": "Nombre limpio" } o { "...": { nombre, marca } } (se compara sin tildes ni mayúsculas).
 * `marcas`: lista extra de marcas de la empresa.
 */
export function limpiarNombre(original, { excepciones = {}, marcas = [] } = {}) {
  const orig = String(original ?? "");
  const claveOrig = norm(orig);
  for (const [k, v] of Object.entries(excepciones)) if (norm(k) === claveOrig) { const o = typeof v === "string" ? { nombre: v } : v; return { nombre: o.nombre, marca: o.marca || "", original: orig, cambiado: o.nombre !== orig, excepcion: true }; }
  let base = limpiaBase(orig);
  let marca = "";
  const lista = [...new Set([...MARCAS_BASE, ...marcas].map(norm))].sort((a, b) => b.length - a.length);
  const nb = norm(base);
  for (const m of lista) if (nb === m || nb.startsWith(m + " ")) { marca = titulo(base.slice(0, m.length).toLowerCase()); base = base.slice(m.length).trim(); break; }
  const nombre = aFrase(base || limpiaBase(orig));
  return { nombre, marca, original: orig, cambiado: nombre !== orig || !!marca };
}

/** Línea secundaria «Caja de 35 · 10,71 €». */
export const esquemaPrecio = (n, dec) => n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
