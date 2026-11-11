// Asistente del chat: entiende preguntas escritas con naturalidad y contesta (cómo se pide, cambiar la contraseña, entrega, cajas…), y recomienda
// productos del catálogo según lo que cuente el cliente («un vino tinto joven por menos de 5 €», «qué me sirve para un bar de tapas»…),
// para que pueda añadirlos al pedido. NO usa IA generativa ni servicios externos (nada sale del ordenador de la empresa): son reglas claras,
// sinónimos y una búsqueda con puntuación sobre el catálogo, así que siempre da respuestas comprobables y solo de productos que existen.
// Funciones puras: el reloj, el cliente y el catálogo llegan como parámetros.
import { norm, numberWords, NUMBER_WORDS } from "./nlu.js";
import { entregaHoyDisponible, deliveryOptions, puedeHoy, AVISO_HOY } from "./delivery.js";

const limpio = (t) => ` ${norm(t).replace(/[¿?¡!.,;:()"«»]/g, " ").replace(/\s+/g, " ").trim()} `;
const palabras = (t) => limpio(t).trim().split(" ").filter(Boolean);

// ───────────────────────── Sinónimos: lo que dice el cliente → palabras que aparecen en los nombres de los artículos ─────────────────────────
const SIN = {
  tinto: ["tinto", "crianza", "roble", "reserva", "rioja", "ribera", "toro", "mencia", "tempranillo"],
  blanco: ["blanco", "verdejo", "rueda", "albarino", "chardonnay", "sauvignon"],
  rosado: ["rosado", "clarete", "rose"],
  espumoso: ["cava", "espumoso", "brut", "champan", "lambrusco"],
  cava: ["cava", "espumoso", "brut"],
  joven: ["joven", "cosecha", "roble"],
  crianza: ["crianza", "roble", "reserva"],
  refresco: ["cola", "fanta", "naranja", "limon", "tonica", "sprite", "aquarius", "nestea", "7up", "gaseosa", "refresco", "zumo"],
  refrescos: ["cola", "fanta", "naranja", "limon", "tonica", "sprite", "aquarius", "nestea", "7up", "gaseosa", "refresco"],
  cerveza: ["cerveza", "lata", "mahou", "estrella", "amstel", "cruzcampo", "alhambra", "san miguel", "radler", "shandy"],
  cervezas: ["cerveza", "mahou", "estrella", "amstel", "cruzcampo", "alhambra", "san miguel", "radler"],
  agua: ["agua", "mineral"],
  cafe: ["cafe", "capsula", "grano", "molido", "soluble", "descafeinado", "mocay", "marcilla", "saimaza"],
  leche: ["leche", "pascual", "entera", "semi", "desnatada"],
  zumo: ["zumo", "naranja", "piña", "melocoton"],
  azucar: ["azucar", "sacarina", "edulcorante", "sobres"],
  bolleria: ["bolleria", "croissant", "magdalena", "napolitana", "donut", "galleta", "galletas"],
  galletas: ["galleta", "galletas", "maria", "cookies"],
  aceitunas: ["aceituna", "aceitunas", "olivas"],
  patatas: ["patatas", "patata", "fritas", "snack", "chips"],
  "frutos secos": ["frutos", "cacahuete", "almendra", "pistacho", "mix", "pipas"],
  encurtidos: ["encurtido", "pepinillo", "cebolleta", "banderilla", "guindilla"],
  hielo: ["hielo"],
  vasos: ["vaso", "vasos", "copa", "copas"],
  servilletas: ["servilleta", "servilletas", "papel"],
  palillos: ["palillo", "palillos"],
  aceite: ["aceite", "oliva", "girasol"],
  arroz: ["arroz"],
  pan: ["pan", "barra", "baguette", "tostado"],
  yogur: ["yogur", "yogurt", "natillas", "flan", "postre"],
  helado: ["helado", "tarrina", "polo"],
  lejia: ["lejia", "fregasuelos", "limpia", "desinfectante", "detergente", "bayeta", "estropajo", "friegaplatos", "lavavajillas"],
  "sin alcohol": ["sin", "alcohol", "0,0", "cero"],
  "sin gluten": ["gluten", "celiaco"],
  bolsas: ["bolsa", "bolsas"],
  cajas: ["caja", "cajas"],
};
const PALABRAS_DE_RELLENO = new Set(("un una uno unos unas el la los las lo de del al a en con sin por para y e o que cual cuales cuanto cuantos como me te se mi mis tu tus nos "
  + "es son ser esta este esto estos esas hay tengo tienes teneis tienen tenemos puedo puedes pueden podeis quiero quisiera quiria necesito necesitamos busco buscamos "
  + "recomiendas recomienda recomiendame recomendar recomendarme aconsejas aconseja aconsejame sugieres sugiere sugiereme dime digame decir dar dame ponme "
  + "algun alguna algunos algunas algo producto productos articulo articulos cosa cosas mejor mejores bueno buena buenos buenas muy mas menos tipo tipos "
  + "sirva sirve sirven valga vale va bien ir ideal adecuado adecuada acertado acertada gustaria hola buenas buenos dias tardes noches porfa favor gracias "
  + "oye mira vamos quieres precio precios cuesta cuestan euros euro eur maximo hasta mismo misma entre sobre unos cierto cierta ya tambien otro otra").split(" "));

// ───────────────────────── Necesidades y tipos de negocio → qué suele hacer falta ─────────────────────────
const USOS = [
  { re: /\b(bar de tapas|tapeo|tapas|aperitivo|aperitivos)\b/, nombre: "un bar de tapas", conceptos: ["cerveza", "vino", "aceitunas", "patatas", "frutos secos", "encurtidos", "servilletas", "palillos"] },
  { re: /\b(chiringuito|terraza)\b/, nombre: "una terraza", conceptos: ["cerveza", "refresco", "agua", "hielo", "vasos", "servilletas"] },
  { re: /\b(cafeteria|desayuno|desayunos)\b/, nombre: "una cafetería", conceptos: ["cafe", "leche", "azucar", "bolleria", "zumo", "galletas", "servilletas"] },
  { re: /\b(restaurante|menu del dia|comedor|catering)\b/, nombre: "un restaurante", conceptos: ["aceite", "arroz", "vino", "agua", "pan", "servilletas", "lejia"] },
  { re: /\b(hotel|hostal|pension|casa rural)\b/, nombre: "un hotel", conceptos: ["cafe", "leche", "zumo", "agua", "galletas", "azucar"] },
  { re: /\b(bar|pub|taberna|cerveceria)\b/, nombre: "un bar", conceptos: ["cerveza", "refresco", "agua", "vino", "cafe", "patatas", "hielo", "vasos", "servilletas"] },
  { re: /\b(postre|postres|helados)\b/, nombre: "los postres", conceptos: ["helado", "yogur", "galletas", "bolleria"] },
  { re: /\b(limpiar|limpieza|desinfectar|fregar)\b/, nombre: "limpiar", conceptos: ["lejia"] },
];

// ───────────────────────── Búsqueda con puntuación sobre el catálogo ─────────────────────────
const tokensDe = (p) => palabras(p.name);
const coincide = (alt, toks, nombreLimpio) => {
  if (alt.includes(" ")) return nombreLimpio.includes(` ${alt} `) || nombreLimpio.includes(alt);
  return toks.some((t) => t === alt || t === alt + "s" || t === alt + "es" || alt === t + "s" || (alt.length >= 4 && t.startsWith(alt)) || (alt.length >= 6 && t.length >= 6 && lev1(alt, t)));
};
const lev1 = (a, b) => { // ¿a y b se parecen salvo una errata?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
};
const grupo = (palabra) => SIN[palabra] ?? SIN[palabra.replace(/(es|s)$/, "")] ?? [palabra];

/** Palabras que cuentan de la frase (sin relleno ni cifras), como conceptos a buscar; «sin alcohol» y «sin gluten» van juntos. */
export function conceptosDe(texto) {
  let t = limpio(texto).replace(/\bsin alcohol\b/g, " sin_alcohol ").replace(/\bsin gluten\b/g, " sin_gluten ").replace(/\bfrutos secos\b/g, " frutos_secos ").replace(/\bcalidad precio\b/g, " ");
  const out = [];
  for (const w of t.trim().split(" ")) {
    if (!w || PALABRAS_DE_RELLENO.has(w) || /^\d/.test(w) || ["barato", "baratos", "barata", "baratas", "economico", "economica", "premium", "calidad"].includes(w)) continue;
    const clave = w.replace("_", " ");
    if (!out.includes(clave)) out.push(clave);
  }
  return out;
}

/**
 * Los artículos que mejor encajan con lo que dice el cliente. Un concepto encaja si alguna de sus palabras equivalentes está en el nombre;
 * gana quien encaja con más conceptos, luego los que el cliente ya compra, y después el precio (barato → más barato primero; «el mejor» → más caro).
 */
export function buscar(texto, catalogo, { habituales = new Set(), max = 5, precioOf = (p) => p.price, conceptos = null, orden = null, precioMax = null } = {}) {
  const t = limpio(texto);
  const cs = (conceptos ?? conceptosDe(texto)).filter(Boolean);
  if (!cs.length) return [];
  const barato = /\b(barato|baratos|barata|baratas|economico|economica|economicos|ajustado|calidad precio|el mas barato)\b/.test(t) || orden === "barato";
  const caro = /\b(premium|gama alta|el mejor|la mejor|lo mejor|top|calidad superior)\b/.test(t) || orden === "caro";
  const n = catalogo.length || 1;
  const df = cs.map((c) => catalogo.filter((p) => grupo(c).some((a) => coincide(a, tokensDe(p), ` ${norm(p.name)} `))).length);
  const filas = [];
  for (const p of catalogo) {
    if (p.active === false) continue;
    const toks = tokensDe(p), nombre = ` ${norm(p.name)} `;
    let puntos = 0, aciertos = 0;
    cs.forEach((c, i) => {
      const exacto = coincide(c, toks, nombre), alguno = exacto || grupo(c).some((a) => coincide(a, toks, nombre));
      if (alguno) { aciertos++; puntos += (exacto ? 3 : 2) + Math.log(n / (df[i] || 1)); }
    });
    const pr = precioOf(p);
    if (!aciertos || (cs.length > 1 && aciertos < Math.ceil(cs.length * 0.6)) || (precioMax != null && !(pr <= precioMax))) continue;
    if (habituales.has(String(p.id))) puntos += 1.5;
    filas.push({ p, aciertos, puntos, pr });
  }
  filas.sort((a, b) => b.aciertos - a.aciertos || (barato ? a.pr - b.pr : caro ? b.pr - a.pr : 0) || b.puntos - a.puntos || a.pr - b.pr || a.p.name.localeCompare(b.p.name, "es"));
  return filas.slice(0, max).map((f) => f.p);
}

const PRECIO_MAX = /\b(?:menos de|menor de|menor que|por debajo de|hasta|maximo|max|no mas de|como mucho|a menos de|por menos de)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)?/;
/** «un vino por menos de 5 euros» → 5 (null si no dice precio máximo). */
export const precioMaximoDe = (texto) => { const m = PRECIO_MAX.exec(` ${norm(texto).replace(/(\d),(\d)/g, "$1.$2")} `); return m ? Number(m[1]) : null; };

// ───────────────────────── Respuestas fijas (cómo se usa la aplicación) ─────────────────────────
const dia = (o) => (o ? (o.detail ? `${o.label.toLowerCase()} (${o.detail})` : o.label.toLowerCase()) : "");
const FAQ = [
  { id: "contrasena", re: /\b(cambiar|cambio|cambiarla|cambiarlo|poner|modificar|olvide|olvido|olvidado|perdi|recuperar|restablecer|resetear|nueva|nuevo)\b.*\b(contrasena|clave|pin|password|codigo)\b|\b(contrasena|clave|pin|password)\b.*\b(cambiar|cambio|olvide|olvido|perdi|recuperar|restablecer|nueva)\b/,
    texto: () => "🔑 *Cambiar la contraseña:* pulsa el menú ⋮ (arriba a la derecha) → *Cambiar contraseña* y elige 6 letras o números (da igual mayúsculas o minúsculas). Con ella podrás entrar con el teléfono con el que sueles contactar con nosotros.\n\nSi la has olvidado, llámanos y te damos una nueva." },
  { id: "datos", re: /\b(elimin\w*|borr\w*|suprim\w*|quit\w*|cancel\w*|anul\w*)\b.*\b(cuenta|datos|usuario|perfil)\b|\b(dar de baja|darme de baja|darnos de baja|darse de baja|de baja)\b|\b(descargar|bajar|ver|exportar|consultar)\b.*\b(mis datos|datos que|datos personales)\b|\b(privacidad|rgpd|proteccion de datos|derechos)\b/,
    texto: () => "🔒 *Tus datos:* pulsa el menú ⋮ → *Mis datos y privacidad*. Ahí puedes descargar todo lo que guardamos de ti, pedirnos que corrijamos o limitemos tus datos y *eliminar tu cuenta* cuando quieras." },
  { id: "repetir", re: /\b(repetir|repite|repetirlo|repetirme|repetimos|lo de siempre|lo mismo de siempre|el mismo pedido|mismo pedido|pedido de siempre|pedido anterior|repetir el ultimo)\b/,
    texto: (c) => (c.ultimo ? "🔁 Sí. En la portada del chat tienes *«Tu pedido de siempre»* con el botón *Repetir y revisar*: se abre el catálogo con ese pedido ya puesto, lo revisas, cambias lo que quieras y lo envías.\n\nTambién puedes pulsar el botón de aquí abajo." : "Todavía no tengo pedidos tuyos anteriores para repetir. Cuando hagas uno, aparecerá en la portada como *«Tu pedido de siempre»*."),
    accion: (c) => (c.ultimo ? "repetir" : null) },
  { id: "pedir", re: /\b(como|donde)\b.*\b(hago|hacer|hacerlo|realizo|realizar|pido|pedir|pedirlo|se pide|se hace|compro|comprar|encargo|encargar|funciona|empiezo|empezar|se usa|uso|usar|manejo)\b.*\b(pedido|pedidos|pedir|comprar|compra|aplicacion|app|esto|chat|catalogo)?\b|\b(ayuda|ayudame|instrucciones|que puedo hacer|que sabes hacer|como funciona)\b/,
    texto: (c) => `🛒 *Hacer un pedido es muy fácil:*\n1️⃣ Pulsa *Hacer pedido* y elige tus productos del catálogo: toca *«+ Añadir»* (por defecto en cajas; cambia a «Uds» si prefieres unidades).\n2️⃣ O escríbeme lo que necesitas, por ejemplo _«2 cajas de agua y 6 cervezas»_, y lo añado.\n3️⃣ Revisa el carrito, elige el día de entrega y confirma.\n\nTambién te puedo *recomendar productos*: pregúntame, por ejemplo, _«¿qué vino tinto joven me recomiendas?»_ o _«¿qué me sirve para un bar de tapas?»_.${c.aviso ? `\n\n🚚 ${AVISO_HOY}` : ""}`,
    accion: () => "abrir" },
  { id: "entrega", re: /\b(cuando|a que hora|hasta que hora|que dia|que dias|cuanto tarda|cuanto tardan)\b.*\b(llega|llegan|entrega|entregais|entregan|reparto|repartis|recibo|recibir|servis|sirven|traeis|llegaria)\b|\b(entreg\w*|repart\w*|envi\w*|llev\w*|traer|traeis|serv\w*)\b.*\b(hoy|manana|dia|dias|hora|sabado|sabados|domingo|festivos|lunes|viernes)\b|\bhasta que hora (puedo|se puede) pedir\b|\bentrega (hoy|mismo dia|el mismo dia)\b|\bpedir para hoy\b/,
    texto: (c) => {
      if (c.entregaHoy) return `🚚 ${AVISO_HOY}\n\nRepartimos de lunes a viernes. Al finalizar el pedido eliges el día.`;
      const p = c.primerDia;
      return `🚚 Repartimos de lunes a viernes.${c.puedeHoy ? " Hoy ya no llegamos a entregar un pedido nuevo (solo si se hace antes de las 10:00 de un día laborable)." : ""} El primer día en que podemos entregártelo es ${dia(p) || "mañana"}. Al finalizar el pedido eliges el día.`;
    } },
  { id: "cajas", re: /\b(diferencia|que es|que significa|como funciona|cuantas unidades|cuantos|que trae|que lleva)\b.*\b(caja|cajas|uds|unidades)\b|\b(caja|cajas)\b.*\b(unidades|trae|lleva|incluye|tiene|diferencia)\b/,
    texto: (c) => c.productoCaja
      ? `📦 «${c.productoCaja.name}» viene en *cajas de ${c.productoCaja.upb} unidades* (${c.productoCaja.caja} la caja, ${c.productoCaja.unidad} cada unidad).`
      : "📦 Muchos artículos se venden por *cajas* (cada caja trae varias unidades; lo ves en la ficha: «Caja de 12 uds»). Puedes pedirlos en *Cajas* o en *Uds* con el selector que hay en cada producto; en el carrito ves el importe exacto." },
  { id: "iva", re: /\b(iva|impuestos?|recargo|recargo de equivalencia)\b/,
    texto: () => "🧾 Los precios del catálogo van *sin IVA*. En el carrito ves el total con IVA (y el recargo de equivalencia si lo tienes)." },
  { id: "entrar", re: /\b(no puedo|no me deja|no consigo|como)\b.*\b(entrar|acceder|iniciar sesion|loguear|loguearme)\b/,
    texto: () => "🔐 Entra con el *teléfono con el que sueles contactar con nosotros* y tu contraseña. Si todavía no tienes contraseña y eres cliente habitual, entra con los 6 primeros dígitos de tu DNI/CIF (botón «¿Sin contraseña?») y luego pon una contraseña en el menú ⋮. Si no te deja, llámanos." },
];

// ¿Lleva cantidad? (cifras o números en palabras: «dos», «una»…)
const CANTIDAD = new RegExp("\\d|\\b(?:" + Object.keys(NUMBER_WORDS).join("|") + ")\\b");
const VERBOS_AÑADIR = /\b(anade|anademe|anademe|anadir|anadelo|agrega|agregame|agregar|mete|metelo|meteme|pon|ponme|ponlo|apunta|apuntame|incluye|incluyeme|suma|sumame|echa|echame|manda|mandame|dame|quiero|necesito|necesitamos|quisiera|me hace falta|me faltan?|pideme|ponedme)\b/;
const CARRITO = /\b(al|en el|a mi|a la|en la|en mi)?\s*(carro|carrito|cesta|cestita|pedido|compra|cart)\b/g;

/** «añádeme al carro 2 aguas y 3 colas en cajas» → «2 cajas agua, 3 cajas colas» (para que lo anote el interprete de pedidos de siempre). */
export function pedidoDesdeFrase(texto) {
  let t = numberWords(texto);
  if (!CANTIDAD.test(t) || !VERBOS_AÑADIR.test(` ${t} `)) return null;
  const todoCajas = /\b(en|por|todo en|todas en|todo por)\s+cajas?\b|\ben cajas\b/.test(t);
  t = ` ${t} `.replace(CARRITO, " ").replace(/\b(en|por|todo en|todas en|todo por)\s+cajas?\b/g, " ").replace(VERBOS_AÑADIR, " ").replace(/\b(por favor|porfa|gracias|me|si puedes|de favor|tambien|ademas|ahora|otra vez)\b/g, " ");
  const trozos = t.split(/\s*(?:,|;|\+|\by\b|\be\b)\s*/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out = [];
  for (const z of trozos) {
    if (!CANTIDAD.test(z)) { if (out.length) out[out.length - 1] += ` ${z}`; continue; } // «2 aguas, para el lunes»: sigue siendo del trozo anterior
    let zz = z;
    if (todoCajas && !/\b(caja|cajas|ud|uds|unidad|unidades)\b/.test(zz)) zz = zz.replace(/(\d+)\s*/, "$1 cajas ");
    out.push(zz);
  }
  const res = out.join(", ").replace(/\bde\s+de\b/g, "de").trim();
  return res && CANTIDAD.test(res) ? res : null;
}

const POSICION = [[/\b(primero|primera|el 1|la 1|el uno|numero 1|el de arriba)\b/, 0], [/\b(segundo|segunda|el 2|la 2|el dos|numero 2)\b/, 1], [/\b(tercero|tercera|el 3|la 3|el tres|numero 3)\b/, 2], [/\b(cuarto|cuarta|el 4|la 4)\b/, 3], [/\b(quinto|quinta|el 5|la 5)\b/, 4], [/\b(ultimo|ultima)\b/, -1]];

/** Frases que piden, buscan o preguntan por productos o precios. */
const INTENCION_PRODUCTO = /\b(recomien\w*|recomend\w*|aconsej\w*|sugier\w*|busco|buscamos|buscaba|teneis|tienes|tienen|vendeis|hay (algun|alguna|algo)|necesito (un|una|algo)|quiero (un|una|algo)|quisiera (un|una|algo)|me sirve|me sirven|que (producto|productos|vino|vinos|cerveza|cervezas|cafe|cafes|agua|aguas|refresco|refrescos|zumo|aceite|leche|marca)\w*|mas barato|el mejor|la mejor|cual es (el|la|lo)|cuanto (cuesta|cuestan|vale|valen|sale|salen)|precio (de|del|de la)|a como esta|a como estan)\b/;
const esPregunta = (t) => /\?/.test(t) || /^\s*(como|cuando|donde|que|cual|cuales|cuanto|cuantos|puedo|puedes|podeis|podria|teneis|tienes|tienen|hay|me recomiendas|recomiendame|aconsejame|aconsejas|busco|necesito un|necesito una|necesito algo|quiero un|quiero una|quiero algo|sirve|sirven|que me|dime|existe|vendeis)\b/.test(limpio(t));

/**
 * Entiende la frase. Devuelve null si no es algo suyo (el chat sigue con lo que ya hacía), o uno de:
 *  { tipo: "pedido", texto }                  → es un pedido escrito («añádeme 2 cajas de agua»): lo anota el intérprete de pedidos con ese texto limpio
 *  { tipo: "elegir", indice }                 → «añade el segundo» sobre la última recomendación
 *  { tipo: "respuesta", reply, productos, accion }  → texto + artículos que se pueden añadir al pedido (accion: "abrir" | "repetir" | null)
 * ctx: { catalogo, cliente, habituales:Set, ahora, ultimo (¿tiene pedido anterior?), recomendados:[ids], precioOf, upbOf, caja(p) }
 */
export function responder(texto, ctx) {
  const t = limpio(texto).trim();
  if (!t) return null;
  const cat = ctx.catalogo ?? [];
  const precioOf = ctx.precioOf ?? ((p) => p.price), upbOf = ctx.upbOf ?? ((p) => (Number.isInteger(p.unitsPerBox) && p.unitsPerBox > 1 ? p.unitsPerBox : null));
  // 1) «añade el segundo / ese» sobre lo último que recomendé
  if (ctx.recomendados?.length && VERBOS_AÑADIR.test(` ${t} `) && !/\d{2,}/.test(t)) {
    for (const [re, i] of POSICION) if (re.test(` ${t} `)) { const idx = i < 0 ? ctx.recomendados.length - 1 : i; if (ctx.recomendados[idx]) return { tipo: "elegir", indice: idx }; }
    if (/\b(ese|esa|eso|lo|la)\b/.test(t) && ctx.recomendados.length === 1) return { tipo: "elegir", indice: 0 };
  }
  // 2) «añádeme al carro 2 cajas de agua y 3 colas»
  const ped = pedidoDesdeFrase(texto);
  if (ped) return { tipo: "pedido", texto: ped };
  // 3) preguntas sobre la aplicación
  const aviso = entregaHoyDisponible(ctx.cliente ?? {}, ctx.ahora);
  for (const f of FAQ) {
    if (!f.re.test(` ${t} `)) continue;
    const primerDia = deliveryOptions(ctx.ahora, { hoy: puedeHoy(ctx.cliente ?? {}) })[0];
    let productoCaja = null;
    if (f.id === "cajas") {
      const palabrasProducto = conceptosDe(texto).filter((w) => !["cuantas", "cuantos", "unidades", "unidad", "uds", "trae", "traen", "lleva", "llevan", "incluye", "tiene", "tienen", "caja", "cajas", "diferencia", "significa", "hay"].includes(w));
      const hit = palabrasProducto.length ? buscar(texto, cat.filter((p) => upbOf(p)), { max: 1, habituales: ctx.habituales, conceptos: palabrasProducto }) : [];
      if (hit[0]) productoCaja = { name: hit[0].name, upb: upbOf(hit[0]), caja: ctx.caja ? ctx.caja(hit[0]) : "", unidad: ctx.unidad ? ctx.unidad(hit[0]) : "" };
    }
    const c = { ...ctx, aviso, entregaHoy: aviso, puedeHoy: puedeHoy(ctx.cliente ?? {}), primerDia, productoCaja };
    return { tipo: "respuesta", reply: f.texto(c), productos: [], accion: f.accion?.(c) ?? null };
  }
  // 4) recomendaciones y búsquedas de productos
  const usoDe = USOS.find((u) => u.re.test(` ${t} `));
  const pidePrecio = precioMaximoDe(texto);
  const quiereProducto = INTENCION_PRODUCTO.test(` ${t} `); // solo si pide o pregunta por productos de verdad («agua» suelto lo sigue llevando el chat de siempre)
  if (!quiereProducto && !usoDe) return null;
  if (usoDe && (esPregunta(texto) || /\b(sirve|sirven|necesito|recomien|aconsej|que (productos?|cosas?|me)|que pido|que puedo pedir|me hace falta|empiezo|abro|monto|tengo un|tengo una|para)\b/.test(t))) {
    const grupos = [], vistos = new Set();
    for (const c of usoDe.conceptos) {
      const hit = buscar(c, cat, { conceptos: [c], max: 2, habituales: ctx.habituales, precioOf }).filter((p) => !vistos.has(String(p.id)));
      if (hit[0]) { vistos.add(String(hit[0].id)); grupos.push({ concepto: c, p: hit[0] }); }
    }
    if (!grupos.length) return { tipo: "respuesta", reply: `No encuentro en el catálogo productos que encajen con ${usoDe.nombre}. Prueba a escribirme algo más concreto (por ejemplo «cerveza» o «café»).`, productos: [], accion: "abrir" };
    const linea = (g) => `• *${g.concepto[0].toUpperCase() + g.concepto.slice(1)}:* ${g.p.name} — ${ctx.fmtPrecio ? ctx.fmtPrecio(g.p) : precioOf(g.p)}`;
    return { tipo: "respuesta", reply: `Para ${usoDe.nombre} suele hacer falta esto; te dejo lo más acertado de tu catálogo (lo que ya compras va primero):\n\n${grupos.map(linea).join("\n")}\n\nMarca con la casilla los que quieras y pulsa «Añadir al pedido» (pongo 1 caja o unidad de cada uno; luego lo cambias en el catálogo).`, productos: grupos.map((g) => g.p), accion: null };
  }
  const conceptos = conceptosDe(texto);
  if (!conceptos.length) return null;
  const hits = buscar(texto, cat, { habituales: ctx.habituales, max: 5, precioOf, precioMax: pidePrecio, conceptos });
  const barato = /\b(barato|baratos|economico|calidad precio|mas barato)\b/.test(t), caro = /\b(premium|el mejor|la mejor|lo mejor|gama alta)\b/.test(t);
  if (!hits.length) {
    return { tipo: "respuesta", reply: `No encuentro nada en el catálogo que encaje con «${texto.trim().slice(0, 60)}»${pidePrecio != null ? ` por menos de ${String(pidePrecio).replace(".", ",")} €` : ""}. Prueba con otras palabras (por ejemplo «vino tinto», «café en grano»…) o abre el catálogo.`, productos: [], accion: "abrir" };
  }
  const lineaP = (p, i) => `${i + 1}. ${p.name} — ${ctx.fmtPrecio ? ctx.fmtPrecio(p) : precioOf(p)}`;
  const intro = hits.length === 1 ? "Te recomiendo este:" : barato ? "Estos son los más económicos que encajan:" : caro ? "Estos son de gama más alta:" : "Esto es lo que mejor encaja con lo que buscas (lo que ya compras va primero):";
  return { tipo: "respuesta", reply: `${intro}\n\n${hits.map(lineaP).join("\n")}\n\nMarca los que quieras en la lista de abajo y pulsa «Añadir al pedido» (o escribe «añade el primero»).`, productos: hits, accion: null };
}
