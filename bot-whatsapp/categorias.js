// Categorías y subcategorías del catálogo, ordenadas por TIPO DE PRODUCTO (lo que el cliente busca), no por marca.
// Función pura (sin Node): la usan el servidor, la demo del navegador y las actualizaciones de productos.
//
// Cada producto se clasifica así (clasificar):
//   1. reglas por el NOMBRE para casos concretos (azúcar → Despensa aunque venga de la familia del café, envases retornables, artículos internos…);
//   2. el código de FAMILIA de a3ERP («27.1», «22.7»…) con el mapa familias-categorias.json, afinado por el nombre cuando la familia es muy amplia;
//   3. sin familia: palabras del nombre (REGLAS_GENERALES).
// Si la ficha ya trae categoría/subcategoría (columnas del Excel), categorizar() las respeta.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ%]+/g, " ").trim();
const slug = (s) => norm(s).replace(/\s+/g, "-") || "otros";

// subs: nombres de subcategoría (el id es el nombre sin tildes ni espacios); la última recoge lo que no encaja
const C = (id, nombre, icono, subs) => ({ id, nombre, icono, subs: subs.map((s) => [slug(s), s]) });
export const CATEGORIAS = [
  C("cafe", "Café", "☕", ["Café en grano y molido", "Café descafeinado", "Cápsulas", "Café de vaso y soluble", "Infusiones y té", "Complementos del café", "Otros cafés"]),
  C("pascual", "Pascual", "🥛", ["Leche", "Leche sin lactosa", "Batidos y cafés fríos", "Bebidas vegetales", "Yogures", "Natillas y postres", "Nata y mantequilla", "Huevos", "Otros Pascual"]),
  C("aguas", "Aguas", "💧", ["Bezoya", "Nestlé Aquarel", "Pedras", "S.Pellegrino", "Perrier", "Garrafas y dispensadores", "Otras aguas"]),
  C("bebidas", "Bebidas", "🥤", ["Refrescos y tés fríos", "Zumos y néctares", "Cervezas", "Licores y destilados", "Otras bebidas"]),
  C("vinos", "Vinos", "🍷", ["Tintos", "Blancos", "Rosados", "Espumosos y cava", "Dulces y generosos", "Bag in box y brik", "Otros vinos"]),
  C("despensa", "Despensa", "🫒", ["Aceites y vinagres", "Tomate y salsas", "Conservas de pescado", "Conservas de carne", "Conservas vegetales y encurtidos", "Frutas en conserva", "Mermeladas y miel", "Siropes y toppings", "Pasta, arroz y harinas", "Legumbres", "Caldos y sopas", "Sal y especias", "Azúcar y edulcorantes", "Cacao y desayuno", "Galletas y dulces", "Repostería", "Frutos secos y snacks", "Otros despensa"]),
  C("refrigerados", "Refrigerados", "🧀", ["Quesos", "Jamón y fiambres", "Embutidos", "Bacon y salchichas", "Platos cocinados y gazpachos", "Otros refrigerados"]),
  C("congelados", "Congelados", "❄️", ["Panes y barras", "Croissants y napolitanas", "Bollería dulce", "Snacks salados", "Pastelería", "Otros congelados"]),
  C("hosteleria", "Hostelería y menaje", "🍽️", ["Vasos y copas", "Tazas y cafetería", "Platos, bowls y fuentes", "Cubertería", "Cocina y utensilios", "Mesa y bar", "Papel y desechables", "Limpieza y droguería", "Uniformes y textil", "Embalaje y bolsas", "Otros menaje"]),
  C("otros", "Otros productos", "🛒", ["Envases y palés", "Lotes de Navidad", "Artículos internos (no vender)", "Otros"]),
];
const byId = new Map(CATEGORIAS.map((c) => [c.id, c]));
const byName = (s) => CATEGORIAS.find((c) => c.id === slug(s) || norm(c.nombre) === norm(s));
const R = (re, category, subcategory) => ({ re, category, subcategory });

// 1) Reglas por el nombre que MANDAN sobre la familia (casos concretos)
const REGLAS_NOMBRE = [
  R(/articulo generico|base al \d+ ?% iva|operaciones sujetas|^iva \d/, "Otros productos", "Artículos internos (no vender)"),
  R(/\b(azucar|azucarillo|azucarito|edulcorante|sacarina|stevia)s?\b/, "Despensa", "Azúcar y edulcorantes"), // «azúcar para el café» es despensa; «sin azúcar» se excluye abajo
  R(/\bleche condensada|\bcondensada\b/, "Despensa", "Cacao y desayuno"),
  R(/\bcopa\b/, "Hostelería y menaje", null),
  R(/maizena/, "Despensa", "Pasta, arroz y harinas"),
  R(/meica|bockwurst|frankfurter|corned beef/, "Despensa", "Conservas de carne"),
  R(/pasta sandw/, "Despensa", "Tomate y salsas"),
  R(/^(?!.*(merme|mini|mermelada)).*(melocoton|coctel de frutas|coctel frutas|cocktail|cerezas|mandarina|piña en|macedonia de frutas)/, "Despensa", "Frutas en conserva"),
  R(/\bporra navidad|lote navidad|\blote\b.*navidul|navidad/, "Otros productos", "Lotes de Navidad"),
  R(/cajetin|\bpalet\b|envase retornable|envases|botella (vacia|vacio)|bidon vacio/, "Otros productos", "Envases y palés"),
  // menaje y desechables que vienen en familias de café (vasos de cartón, tazas, paletinas…): se afinan como hostelería
  R(/vaso carton|(?<!a la )\btazas?\b|\bpaletinas?\b|portavasos|\bplato (solo|con leche)|tapa vaso/, "Hostelería y menaje", null),
];
const SIN_AZUCAR = /(\bs a\b|\bs azucar|sin azucar|\b0 ?% ?azu|azucar 0|\bdiet\b)/; // «S/ AZUCAR», «0% azúcar»: no es azúcar

// 2) Afinado por el nombre dentro de una categoría cuando la familia es muy amplia
const AFINAR = {
  vinos: [
    [/bag in box|\bbrik\b/, "Bag in box y brik"],
    [/espum|\bcava\b|\bbrut\b|nature\b|semi ?seco|champan/, "Espumosos y cava"],
    [/pedro ximenez|moscatel|oloroso|\bfino\b|amontillado|\bdulce\b|licoroso|sherry|jerez/, "Dulces y generosos"],
    [/rosado|clarete|rose\b|pink/, "Rosados"],
    [/tinto|crianza|reserva|roble|ribera|rioja|tempranillo|toro\b|mencia|garnacha/, "Tintos"],
    [/verdejo|blanco|godello|albarino|rueda|sauvignon|chardonnay|frizzante|barrica|semidulce/, "Blancos"],
  ],
  refrigerados: [
    [/queso|mozzarella|emmental|edam|burgos|\bazul\b|ralla|cheddar|philadelphia|reny|picot|tranchete/, "Quesos"],
    [/fuet|salchichon|chorizo|lomo embuchado|longaniza|sobrasada|morcilla|torrezno|chistorra|porra|embutido|salami/, "Embutidos"],
    [/bacon|panceta|salchicha|frankfurt|bockwurst|hot ?dog|wurst/, "Bacon y salchichas"],
    [/jamon|fiambre|paleta|pavo|pechuga|mortadela|lonchas|york|lacon|chopped/, "Jamón y fiambres"],
    [/gazpacho|salmorejo|callos|orejas|morros|rabo|tortilla|ensaladilla|empanadilla|croqueta|pato|pisto|lasana|masa/, "Platos cocinados y gazpachos"],
  ],
  despensa: [
    [/mermelada|merme\b|confitura|membrillo|crema de cacao|untar|picos|\bmiel\b/, "Mermeladas y miel"],
    [/sirope|topping|jarabe/, "Siropes y toppings"],
    [/maizena|harina|pan rallado|arroz|pasta|fideo|macarron|spag|tallarin|lasana|helices|plumas|cuscus|sopa/, "Pasta, arroz y harinas"],
    [/atun|bonito|ventresca|anchoa|sardina|caballa|mejillon|calamar|boqueron|salmon|bacalao|pulpo|berberecho|melva|tinta/, "Conservas de pescado"],
    [/tomate|ketchup|catsup|mayonesa|mostaza|salsa|alioli|ali ?oli|pisto|bolonesa|barbacoa|tabasco|worcester|lea ?& ?perrins/, "Tomate y salsas"],
  ],
  congelados: [
    [/empanadilla|panini|bocapizza|pizza|hojaldre|croqueta|nugget|rebozad/, "Snacks salados"],
    [/tarta|pastel|brownie|cheesecake|bizcocho|muffin/, "Pastelería"],
  ],
  hosteleria: [
    [/estuche|bolsa papel|asa plana|caja regalo/, "Embalaje y bolsas"],
    [/delantal|gorro|chaqueta cocina|pantalon|cubrecabeza|manguito|trapo|bata\b/, "Uniformes y textil"],
    [/fregona|mopa|escoba|recogedor|\bcubo\b|contenedor.*(\d+ ?l\b|pedal)|bayeta|estropajo|lejia|cloro|amoniaco|sosa|detergente|desinfect|jabon|higienic|basura|guante|mascarilla|abrillantador|pulverizador|friegasuelos|fregasuelos|ambientador|insectic|esponja|gamuza|limpia|limpieza|cepillo|rasqueta|lavavajillas|alcohol|toallero|toallita|escobilla|gel (bano|manos)|desatascador|eliminador/, "Limpieza y droguería"],
    [/mantel|servilleta(?!ro)|rollo|papel|blonda|rodal|desech|reut|vaso.*(carton|kraft|plast|irromp|transp)|vaso chiquito|tapa (vaso|para|env)|paletina|palillo|pajita|cana papel|portavasos|film|aluminio|alumi\b|bolsa (de |envasar|basura|hielo)|termosellable|take ?away|envase|(set|pack).*(plastico|cubiertos)|bandeja carton|cana azuc|tarrina|bagazo|dispensador (bobina|servilleta)/, "Papel y desechables"],
    [/escurridor|prensa|hermetico|gastronorm|\bgn ?1|contenedor|cuchillo (jamonero|kebab|cocinero|chef|deshuesador|puntilla|pelador|pan|filetear|carnicero|arcos|sabatier|queso)|cuchara (madera|helado|servir|arroz)|espumadera|cucharon|chaira|afilador/, "Cocina y utensilios"],
    [/tenedor|cuchara\b|cucharas|cucharilla|cubierto|\bcuchillo\b|pala pescado/, "Cubertería"],
    [/(?<!a la )\btazas?\b|plato (solo|con leche|cortado|te|cafe|moka)|plato moka|cafetera|tetera|azucarero|jarra (leche|cafe)|lechera|\bmoka\b|expresso|espresso|vaso (cafe|te)\b/, "Tazas y cafetería"],
    [/\bvasos?\b|\bcopas?\b|chupito|cubata|jarrita|jarra (cerveza|cristal|agua)|catavino|decantador/, "Vasos y copas"],
    [/salero|aceitera|vinagrera|servilletero|palillero|cubitera|champanera|panera|cesta|jarra|botella|decanter|coctelera|sacacorchos|abrebotellas|pinza (hielo|azucarillo)|bandeja servicio|frasca/, "Mesa y bar"],
    [/\bplato|\bbowl|ensaladera|fuente|cazuela|bandeja|cuenco|barreno|\bsopera|\bflan\b(?!ero)/, "Platos, bowls y fuentes"],
  ],
};
// Las subcategorías por defecto de hostelería: «Cocina y utensilios» (cazos, sartenes, cuchillos de cocina…)

// 3) Sin familia: palabras del nombre (en este orden)
const REGLAS_GENERALES = [
  R(/^(?!.*\b(yogur|yogures|natilla|natillas|flan|leche|batido|postre|cuajada|gazpacho|zumo|helado|cerveza|vino|refresco|cafe)\b).*\b(vasos?|copas?|platos?|bowls?|cuchillos?|tenedor(es)?|cucharas?|cucharillas?|tazas?|mantel(es)?|servilletas?|bobinas?|portabobinas|brochetas?|ceniceros?|flaneros?|rollos? (mantel|papel|higienico|aluminio)|fregonas?|sartenes|sarten|ollas?|cazuelas?|bandejas?|ensaladeras?|cazos?|escobas?|bayetas?|estropajos?|guantes?|estuches?|jarras?|fuentes?|cubiertos?|delantal(es)?)\b/, "Hostelería y menaje", null), // menaje claro por el nombre
  R(/croissant|napolitana/, "Congelados", "Croissants y napolitanas"), // antes que «mantequilla» (un croissant de mantequilla no es mantequilla)
  R(/cerveza|\bcerv\b|radler|lager|\bcana\b.*alhambra/, "Bebidas", "Cervezas"),
  R(/\bron\b|ginebra|whisky|vodka|licor|brandy|\banis\b|pacharan|coñac|conac|tequila|vermut|aguardiente|orujo|crema de orujo/, "Bebidas", "Licores y destilados"),
  R(/refresco|\bcola\b|fanta|limonada|tonica|isotonic|energetic|gaseosa|nestea|aquarius|schweppes|red bull|\bkas\b|fuze/, "Bebidas", "Refrescos y tés fríos"),
  R(/zumo|nectar|bifrutas/, "Bebidas", "Zumos y néctares"),
  R(/\bvino\b|bornos|verdejo|tinto|blanco|rosado|crianza|reserva|\bcava\b|pazos|rioja|ribera|albarino|tempranillo|sauvignon/, "Vinos", "Otros vinos"),
  R(/bezoya/, "Aguas", "Bezoya"), R(/aquarel/, "Aguas", "Nestlé Aquarel"), R(/pedras/, "Aguas", "Pedras"), R(/pellegrino/, "Aguas", "S.Pellegrino"), R(/perrier/, "Aguas", "Perrier"),
  R(/garrafa agua|dispensador|bidon/, "Aguas", "Garrafas y dispensadores"),
  R(/\bagua\b|\baguas\b|mineral|con gas|sin gas/, "Aguas", "Otras aguas"),
  R(/vivesoy|bebida de (avena|almendra|soja|centeno|arroz)|bebida vegetal/, "Pascual", "Bebidas vegetales"),
  R(/descafe|sin pausa/, "Café", "Café descafeinado"), R(/capsula/, "Café", "Cápsulas"), R(/infusi|\bte\b|manzanilla|\bpoleo\b|\btila\b|twinings/, "Café", "Infusiones y té"),
  R(/mocay|\bcafe\b|maestro|barista/, "Café", "Café en grano y molido"),
  R(/sin lactosa/, "Pascual", "Leche sin lactosa"), R(/batido|cola-?cao shake/, "Pascual", "Batidos y cafés fríos"),
  R(/yogur|yogikids/, "Pascual", "Yogures"), R(/natilla|flan\b|postre|cuajada/, "Pascual", "Natillas y postres"),
  R(/\bnata\b|mantequilla|margarina/, "Pascual", "Nata y mantequilla"), R(/huevo|clara/, "Pascual", "Huevos"),
  R(/leche|pascual/, "Pascual", "Leche"),
  R(/atun|bonito|sardina|anchoa|ventresca|caballa|mejillon/, "Despensa", "Conservas de pescado"),
  R(/aceite|\baove\b|oliva|vinagre/, "Despensa", "Aceites y vinagres"),
  R(/tomate|ketchup|catsup|mayonesa|mostaza|salsa/, "Despensa", "Tomate y salsas"),
  R(/mermelada|miel\b|confitura/, "Despensa", "Mermeladas y miel"), R(/sirope|topping/, "Despensa", "Siropes y toppings"),
  R(/pasta|arroz|harina|macarron|spaghetti|fideo/, "Despensa", "Pasta, arroz y harinas"), R(/alubia|garbanzo|lenteja|legumbre/, "Despensa", "Legumbres"),
  R(/caldo|sopa|avecrem/, "Despensa", "Caldos y sopas"), R(/\bsal\b|especia|pimienta|oregano|pimenton|comino/, "Despensa", "Sal y especias"),
  R(/cola-?cao|cacao|cereales|kellogg|choco krispies/, "Despensa", "Cacao y desayuno"), R(/galleta|cuetara|artiach|maria\b/, "Despensa", "Galletas y dulces"),
  R(/levadura|gelatina|royal/, "Despensa", "Repostería"), R(/patata|snack|frutos secos|aperitivo|cacahuete|pipas|palomitas|nueces|pringles/, "Despensa", "Frutos secos y snacks"),
  R(/esparrago|pimiento|maiz|aceituna|pepinillo|encurtido|guisantes|judias|zanahoria|macedonia|champiñon|alcaparra|cebollita/, "Despensa", "Conservas vegetales y encurtidos"),
  R(/melocoton|piña|fruta|cocktail|cerezas|mandarina/, "Despensa", "Frutas en conserva"),
  R(/queso|reny|picot|mozzarella|emmental/, "Refrigerados", "Quesos"), R(/chorizo|salchichon|fuet|embutido|sobrasada|torrezno/, "Refrigerados", "Embutidos"),
  R(/bacon|panceta|salchicha|frankfurt/, "Refrigerados", "Bacon y salchichas"), R(/jamon|fiambre|lomo|pavo|mortadela|campofrio|navidul/, "Refrigerados", "Jamón y fiambres"),
  R(/gazpacho|salmorejo|tortilla|ensaladilla|empanadilla|callos/, "Refrigerados", "Platos cocinados y gazpachos"),
  R(/croissant|napolitana/, "Congelados", "Croissants y napolitanas"), R(/bolleria|donut|ensaimada|magdalena|palmera|hoops|berlina|cookie/, "Congelados", "Bollería dulce"),
  R(/\bpan\b|barra|baguette|chapata|flauta/, "Congelados", "Panes y barras"), R(/panini|pizza|croqueta|empanad|nugget|rebozad|bocapizza/, "Congelados", "Snacks salados"),
  R(/pastel|tarta|brownie|bizcocho|muffin|cheesecake/, "Congelados", "Pastelería"), R(/congelad|panamar/, "Congelados", "Otros congelados"),
];

/** Clasifica un producto → { category, subcategory } (nombres). familias: mapa «código de familia» → { category, subcategory }. */
export function clasificar(p, familias = {}) {
  const n = norm(p?.name);
  const f = p?.family ? familias[p.family] : null;
  for (const r of REGLAS_NOMBRE) {
    if (!r.re.test(n)) continue;
    if (r.subcategory === "Azúcar y edulcorantes" && (SIN_AZUCAR.test(n) || f?.category === "Hostelería y menaje")) continue; // «sin azúcar» y los bowls/pinzas de azúcar no son azúcar
    if (r.subcategory) return { category: r.category, subcategory: r.subcategory };
    const c = byName(r.category);
    for (const [re, sub] of AFINAR[c.id] ?? []) if (re.test(n)) return { category: r.category, subcategory: sub };
    return { category: r.category, subcategory: "Cocina y utensilios" };
  }
  if (f?.category) {
    const c = byName(f.category);
    for (const [re, sub] of AFINAR[c?.id] ?? []) {
      if (!re.test(n)) continue;
      if (c.id === "despensa" && f.subcategory && !/^(Tomate y salsas|Siropes y toppings|Mermeladas y miel)$/.test(f.subcategory) && !/^(27\.3)$/.test(p.family)) continue; // en despensa solo afinan las familias mezcladas
      return { category: f.category, subcategory: sub };
    }
    return { category: f.category, subcategory: f.subcategory ?? (c ? c.subs[c.subs.length - 1][1] : "General") };
  }
  for (const r of REGLAS_GENERALES) {
    if (!r.re.test(n)) continue;
    if (r.subcategory) return { category: r.category, subcategory: r.subcategory };
    for (const [re, sub] of AFINAR[byName(r.category).id] ?? []) if (re.test(n)) return { category: r.category, subcategory: sub };
    return { category: r.category, subcategory: "Cocina y utensilios" };
  }
  // Último recurso: las palabras de menaje, despensa, refrigerados y congelados de las reglas de afinado (solo si nada de lo anterior encaja)
  for (const id of ["hosteleria", "despensa", "refrigerados", "congelados"]) for (const [re, sub] of AFINAR[id]) if (re.test(n)) return { category: byId.get(id).nombre, subcategory: sub };
  return { category: "Otros productos", subcategory: "Otros" };
}

/**
 * Clasifica un producto → { cat, sub, catNombre, subNombre, icono }.
 * Con categoría/subcategoría en la ficha (p.category, p.subcategory) se respetan: si coinciden con las de la web se usan sus ids y,
 * si no (familias propias de a3ERP), se crean aparte con ese nombre.
 */
export function categorizar(p) {
  let explicit = String(p?.category ?? "").trim(), explicitSub = String(p?.subcategory ?? "").trim();
  if (!explicit) ({ category: explicit, subcategory: explicitSub } = clasificar(p));
  const c = byName(explicit);
  if (c) {
    const sub = explicitSub ? c.subs.find(([id, nombre]) => id === slug(explicitSub) || norm(nombre) === norm(explicitSub)) : null;
    const s = sub ?? (explicitSub ? [slug(explicitSub), explicitSub] : c.subs[c.subs.length - 1]);
    return { cat: c.id, sub: s[0], catNombre: c.nombre, subNombre: s[1], icono: c.icono };
  }
  return { cat: "f-" + slug(explicit), sub: explicitSub ? slug(explicitSub) : "general", catNombre: explicit, subNombre: explicitSub || "General", icono: "📦" };
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
