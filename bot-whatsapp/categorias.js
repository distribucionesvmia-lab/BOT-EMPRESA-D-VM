// Categorías y subcategorías del catálogo, las del menú de la web de la empresa: Café, Pascual, Vinos, Aguas, Despensa, Refrigerados
// y Congelados (+ «Otros productos», solo si hay algo que no encaja: refrescos, cervezas, snacks…).
// Función pura (sin Node): la usan el servidor y la demo del navegador.
//
// Cada producto se clasifica así: si la ficha trae categoría/subcategoría (columnas «Categoría»/«Familia» y «Subcategoría»/«Subfamilia»
// del Excel de a3ERP) se respeta; si no, se deduce de las palabras del nombre (marca, tipo de producto).

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ%]+/g, " ").trim();
const slug = (s) => norm(s).replace(/\s+/g, "-") || "otros";

// subs: [id, nombre, expresión]; el orden importa (la primera que encaja gana); la última («otros») recoge el resto
export const CATEGORIAS = [
  { id: "cafe", nombre: "Café", icono: "☕", re: /mocay|\bcafe\b|descafe|infusi|capsula/, subs: [
    ["maestro", "Maestro", /maestro/], ["barista", "Barista", /barista/], ["descafeinado", "Sin pausa (descafeinado)", /descafe|sin pausa/],
    ["infusiones", "Infusiones", /infusi|\bte\b|manzanilla|poleo|tila/], ["complementos", "Complementos", /azucar|sobre|palito|agitador|complement/], ["otros", "Otros cafés", /./]] },
  { id: "pascual", nombre: "Pascual", icono: "🥛", re: /leche|pascual|bifrutas|vivesoy|yogur|yogikids|natilla|flan\b|postre|batido|zumo|\bnata\b|soja|avena|vegetal/, subs: [
    ["vegetales", "Bebidas vegetales", /vivesoy|soja|avena|vegetal|almendra/], ["yogures", "Yogures y Yogikids", /yogur|yogikids/], ["postres", "Natillas y postres", /natilla|flan\b|postre|cuajada/],
    ["zumos", "Zumos y batidos", /zumo|bifrutas|batido|nectar/], ["leche", "Leche", /leche|\bnata\b/], ["otros", "Otros Pascual", /./]] },
  { id: "vinos", nombre: "Vinos", icono: "🍷", re: /\bvino\b|bornos|verdejo|tinto|blanco|rosado|crianza|reserva|\bcava\b|pazos|rioja|ribera|albarino|tempranillo|sauvignon/, subs: [
    ["bornos", "Palacio de Bornos", /bornos/], ["pazos", "Pazos de Baró", /pazos|baro|albarino/], ["ribera", "Ribera del Duero", /ribera|tempranillo/], ["otros", "Otras bodegas", /./]] },
  { id: "aguas", nombre: "Aguas", icono: "💧", re: /\bagua\b|\baguas\b|bezoya|aquarel|pellegrino|perrier|pedras|mineral|con gas|sin gas/, subs: [
    ["bezoya", "Bezoya", /bezoya/], ["aquarel", "Nestlé Aquarel", /aquarel/], ["pellegrino", "S.Pellegrino", /pellegrino/], ["perrier", "Perrier", /perrier/], ["pedras", "Pedras", /pedras/], ["otros", "Otras aguas", /./]] },
  { id: "despensa", nombre: "Despensa", icono: "🫒", re: /aceite|\baove\b|oliva|calvo|helios|\bprima\b|koipe|carbonell|luengo|ballena|carmencita|borges|villacampo|vegagel|atun|bonito|sardina|conserva|tomate|ketchup|catsup|mayonesa|mostaza|salsa|maiz|esparrago|pimiento|aceituna|vinagre|especia|pimenton|oregano|sirope|torti/, subs: [
    ["calvo", "Calvo", /calvo/], ["helios", "Helios", /helios/], ["prima", "Prima", /\bprima\b/], ["koipe", "Carbonell · Koipe", /carbonell|koipe/], ["luengo", "Luengo", /luengo/],
    ["ballena", "La Ballena", /ballena/], ["carmencita", "Carmencita", /carmencita/], ["borges", "Borges", /borges/], ["villacampo", "Villacampo", /villacampo|vegagel/],
    ["aceites", "Aceites", /aceite|\baove\b|oliva/], ["conservas", "Conservas", /atun|bonito|sardina|conserva|esparrago|pimiento|maiz|aceituna/], ["salsas", "Salsas y tomate", /salsa|ketchup|catsup|mayonesa|mostaza|tomate|vinagre|sirope/], ["otros", "Otros", /./]] },
  { id: "refrigerados", nombre: "Refrigerados", icono: "🧀", re: /queso|charcut|jamon|chorizo|salchich|salchicha|lomo|fiambre|embutido|campofrio|reny|picot|mantequilla|bacon|panceta|pate\b|ahumado|preparado/, subs: [
    ["quesos", "Quesos", /queso|reny|picot/], ["charcuteria", "Charcutería", /jamon|chorizo|salchich|lomo|fiambre|embutido|campofrio|bacon|panceta|pate\b/], ["lacteos", "Lácteos", /mantequilla|\bnata\b/], ["preparados", "Preparados", /./]] },
  { id: "congelados", nombre: "Congelados", icono: "❄️", prio: -1, re: /congelad|panamar|croissant|bolleria|baguette|chapata|napolitana|donut|ensaimada|magdalena|palmera|pizza|helado|empanad|croqueta|nugget|rebozad|tarta|brownie|bizcocho|muffin|cheesecake/, subs: [
    ["panes", "Panes y barras", /\bpan\b|barra|baguette|chapata/], ["croissants", "Croissants", /croissant/], ["bolleria", "Bollería dulce", /bolleria|napolitana|donut|ensaimada|magdalena|palmera/],
    ["snacks", "Snacks salados", /snack|croqueta|empanad|nugget|pizza|rebozad/], ["pasteleria", "Pastelería", /pastel|tarta|brownie|bizcocho|muffin|cheesecake/], ["otros", "Otros congelados", /./]] },
  { id: "otros", nombre: "Otros productos", icono: "🛒", re: /./, subs: [
    ["refrescos", "Refrescos", /refresco|\bcola\b|fanta|limonada|tonica|isotonic|energetic|gaseosa|tonic/], ["cervezas", "Cervezas", /cerveza|\bcerv\b|radler|lager/],
    ["snacks", "Snacks", /patata|snack|frutos secos|aperitivo|cacahuete|pipas|palomitas/], ["otros", "Otros", /./]] },
];

// Orden en que se prueban las categorías (el de la web, salvo las que llevan prio, que pasan delante)
const EVALUACION = [...CATEGORIAS].sort((a, b) => (a.prio ?? 0) - (b.prio ?? 0));
const byId = new Map(CATEGORIAS.map((c) => [c.id, c]));
const byName = (s) => CATEGORIAS.find((c) => c.id === slug(s) || norm(c.nombre) === norm(s));

/**
 * Clasifica un producto → { cat, sub, catNombre, subNombre, icono }.
 * Con categoría/subcategoría en la ficha (p.category, p.subcategory) se respetan: si coinciden con las de la web se usan sus ids y,
 * si no (familias propias de a3ERP), se crean aparte con ese nombre.
 */
export function categorizar(p) {
  const explicit = String(p?.category ?? "").trim(), explicitSub = String(p?.subcategory ?? "").trim();
  if (explicit) {
    const c = byName(explicit);
    if (c) {
      const sub = explicitSub ? c.subs.find(([id, nombre]) => id === slug(explicitSub) || norm(nombre) === norm(explicitSub)) : null;
      const s = sub ?? (explicitSub ? [slug(explicitSub), explicitSub] : c.subs[c.subs.length - 1]);
      return { cat: c.id, sub: s[0], catNombre: c.nombre, subNombre: s[1], icono: c.icono };
    }
    return { cat: "f-" + slug(explicit), sub: explicitSub ? slug(explicitSub) : "general", catNombre: explicit, subNombre: explicitSub || "General", icono: "📦" };
  }
  const n = norm(p?.name);
  const c = EVALUACION.find((x) => x.id !== "otros" && x.re.test(n)) ?? byId.get("otros");
  const [sid, snombre] = c.subs.find(([, , re]) => re.test(n));
  return { cat: c.id, sub: sid, catNombre: c.nombre, subNombre: snombre, icono: c.icono };
}

/**
 * Árbol de categorías con productos, en el orden de la web (primero las de la web, después las propias de a3ERP):
 * [{ id, nombre, icono, count, subs: [{ id, nombre, count }] }]. Solo salen las que tienen productos.
 */
export function arbolCategorias(products) {
  const cats = new Map();
  for (const p of products) {
    const k = categorizar(p);
    if (!cats.has(k.cat)) cats.set(k.cat, { id: k.cat, nombre: k.catNombre, icono: k.icono, count: 0, subs: new Map() });
    const c = cats.get(k.cat);
    c.count++;
    if (!c.subs.has(k.sub)) c.subs.set(k.sub, { id: k.sub, nombre: k.subNombre, count: 0 });
    c.subs.get(k.sub).count++;
  }
  const order = (id) => (byId.has(id) ? CATEGORIAS.findIndex((c) => c.id === id) : 100);
  return [...cats.values()]
    .sort((a, b) => order(a.id) - order(b.id) || a.nombre.localeCompare(b.nombre))
    .map((c) => {
      const known = byId.get(c.id)?.subs.map(([id]) => id) ?? [];
      const subs = [...c.subs.values()].sort((a, b) => (known.indexOf(a.id) + 1 || 99) - (known.indexOf(b.id) + 1 || 99) || a.nombre.localeCompare(b.nombre));
      return { ...c, subs };
    });
}
