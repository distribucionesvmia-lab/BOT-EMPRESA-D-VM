// Catálogo por TIPO de artículo (no por marca): unas 15 categorías que agrupan las familias de a3ERP (PDF «Listado de familias») y, dentro de cada una,
// subcategorías por tipo. Las familias de a3ERP que son de marca (Cuétara, Ybarra, Calvo, Borges, Mahou, Amstel…) se reparten por el tipo que dice el NOMBRE
// del artículo. Todo en memoria: no toca la base ni el orden de los pedidos (que sigue siendo por código de familia de a3ERP). Se apaga con ARBOL_TIPOS=0.
import { categorizar } from "./categorias.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ%.,/ ]+/g, " ").replace(/\s+/g, " ").trim();
const limpia = (f) => String(f ?? "").trim().replace(/\.+$/, "");

/** Categorías en el orden en que salen, con su icono, el orden de sus subcategorías y la subcategoría «por defecto» (cuando el nombre no dice más). */
export const TIPOS = [
  { nombre: "Leche y lácteos", icono: "🥛", subs: ["Leche", "Leche sin lactosa", "Batidos y cafés fríos", "Bebidas vegetales", "Yogures y postres", "Nata y mantequilla", "Lácteos de hostelería", "Huevos"], defecto: "Leche" },
  { nombre: "Aguas", icono: "💧", subs: ["Agua mineral", "Con gas", "Garrafas y dispensadores"], defecto: "Agua mineral" },
  { nombre: "Refrescos y zumos", icono: "🥤", subs: ["Refrescos", "Zumos y néctares", "Gaseosa y tinto de verano", "Bebidas bio"], defecto: "Refrescos" },
  { nombre: "Vinos", icono: "🍷", subs: ["Tintos", "Blancos", "Rosados", "Espumosos y cava", "Bag in box", "Estuches y lotes", "Otros vinos"], defecto: "Otros vinos" },
  { nombre: "Licores y destilados", icono: "🥃", subs: ["Licores y destilados"], defecto: "Licores y destilados" },
  { nombre: "Cervezas", icono: "🍺", subs: ["Lata", "Botella", "Sin alcohol", "Radler", "Especiales", "Otras cervezas"], defecto: "Otras cervezas" },
  { nombre: "Café e infusiones", icono: "☕", subs: ["Café en grano y molido", "Café descafeinado", "Cápsulas", "Infusiones y té", "Azúcar y sobres", "Siropes", "Otros de café"], defecto: "Café en grano y molido" },
  { nombre: "Aceites, vinagres y salsas", icono: "🫒", subs: ["Aceites", "Vinagres", "Tomate y salsas", "Mostaza, mayonesa y kétchup"], defecto: "Tomate y salsas" },
  { nombre: "Conservas y legumbres", icono: "🥫", subs: ["Pescado y marisco", "Verduras y encurtidos", "Legumbres", "Frutas en almíbar", "Carne en conserva", "Conservas varias"], defecto: "Conservas varias" },
  { nombre: "Desayuno y dulces", icono: "🍪", subs: ["Galletas", "Cereales", "Chocolates y bombones", "Cacao", "Mermeladas y miel", "Postres", "Dulces varios"], defecto: "Dulces varios" },
  { nombre: "Despensa y snacks", icono: "🥜", subs: ["Arroz, pasta y harinas", "Caldos y sopas", "Frutos secos", "Snacks y picos", "Especias y sal", "Despensa varia"], defecto: "Despensa varia" },
  { nombre: "Charcutería y quesos", icono: "🧀", subs: ["Curados", "Cocidos y fiambres", "Bacon y salchichas", "Quesos", "Patés", "Lotes y loncheados", "Embutidos"], defecto: "Embutidos" },
  { nombre: "Congelados y preparados", icono: "❄️", subs: ["Pan y barras", "Bollería", "Salados", "Hamburguesas", "Bacalao y pescado", "Platos preparados"], defecto: "Platos preparados" },
  { nombre: "Menaje y cristalería", icono: "🍽️", subs: ["Vasos", "Copas", "Cubertería", "Vajilla", "Cuchillería", "Ollas y sartenes", "Fuentes, bandejas y cubetas", "Utensilios de cocina", "Repostería y moldes", "Bar y camarero", "Cocina y complementos"], defecto: "Cocina y complementos" },
  { nombre: "Desechables y envases", icono: "📦", subs: ["Vasos y platos desechables", "Un solo uso", "Manteles y servilletas", "Bolsas, film y aluminio", "Tarrinas y bandejas", "Cañas y palillos", "Higiénico", "Envases", "Consumibles"], defecto: "Consumibles" },
  { nombre: "Limpieza", icono: "🧴", subs: ["Limpieza y químicos"], defecto: "Limpieza y químicos" },
  { nombre: "Otros productos", icono: "🛒", subs: ["Tienda", "Otros"], defecto: "Otros" },
];
const T = (n) => TIPOS.find((t) => t.nombre === n);

// Código de familia de a3ERP → [categoría, subcategoría | null (= por el nombre)]. Vale el código exacto («22.25»), un grupo con «*» («1.7*») o la familia («22»).
const RUTAS = {
  "1": ["Leche y lácteos", "Leche"], "1.6*": ["Leche y lácteos", "Leche sin lactosa"], "1.7*": ["Leche y lácteos", "Batidos y cafés fríos"], "1.76": ["Leche y lácteos", "Batidos y cafés fríos"],
  "11.8": ["Leche y lácteos", "Bebidas vegetales"], "15": ["Leche y lácteos", "Yogures y postres"], "70": ["Leche y lácteos", "Nata y mantequilla"], "73": ["Leche y lácteos", "Nata y mantequilla"],
  "80": ["Leche y lácteos", null, "Lácteos de hostelería"], "93": ["Leche y lácteos", "Huevos"],
  "10": ["Aguas", null], "10.3": ["Aguas", null, "Garrafas y dispensadores"], "10.5": ["Aguas", null, "Con gas"], "10.7": ["Aguas", null, "Con gas"], "10.8": ["Aguas", null, "Con gas"], "23": ["Licores y destilados", "Licores y destilados"],
  "11": ["Refrescos y zumos", "Zumos y néctares"], "12": ["Refrescos y zumos", "Bebidas bio"], "14": ["Refrescos y zumos", "Refrescos"], "14.2": ["Refrescos y zumos", "Gaseosa y tinto de verano"], "14.4": ["Refrescos y zumos", "Gaseosa y tinto de verano"],
  "21": ["Vinos", null], "21.1": ["Vinos", "Tintos"], "21.2": ["Vinos", "Blancos"], "21.3": ["Vinos", "Rosados"], "21.4": ["Vinos", "Espumosos y cava"], "21.5": ["Vinos", "Bag in box"], "21.9": ["Vinos", "Otros vinos"],
  "22": ["Cervezas", null], "22.25": ["Cervezas", "Sin alcohol"], "22.26": ["Cervezas", "Sin alcohol"], "22.5": ["Cervezas", "Sin alcohol"], "22.43": ["Cervezas", "Radler"], "22.44": ["Cervezas", "Radler"], "22.7": ["Cervezas", "Especiales"], "22.9": ["Otros productos", "Otros"],
  "40": ["Café e infusiones", "Café en grano y molido"], "40.11": ["Café e infusiones", "Café descafeinado"], "40.12": ["Café e infusiones", "Cápsulas"], "40.2*": ["Café e infusiones", "Infusiones y té"], "40.3": ["Café e infusiones", "Azúcar y sobres"], "40.4": ["Café e infusiones", null, "Otros de café"], "45": ["Café e infusiones", "Siropes"],
  "24": ["Aceites, vinagres y salsas", "Aceites"], "24.3": ["Aceites, vinagres y salsas", "Vinagres"], "48": ["Aceites, vinagres y salsas", "Vinagres"], "27.3": ["Aceites, vinagres y salsas", "Tomate y salsas"], "29.5": ["Aceites, vinagres y salsas", "Tomate y salsas"], "33": ["Aceites, vinagres y salsas", "Tomate y salsas"], "33.7": ["Aceites, vinagres y salsas", "Tomate y salsas"],
  "30": ["Conservas y legumbres", null], "31": ["Conservas y legumbres", null], "32": ["Conservas y legumbres", "Legumbres"], "27.8": ["Conservas y legumbres", "Legumbres"], "27.2": ["Conservas y legumbres", "Verduras y encurtidos"], "27.5": ["Conservas y legumbres", "Verduras y encurtidos"], "27.7": ["Conservas y legumbres", "Verduras y encurtidos"], "27.6": ["Conservas y legumbres", "Frutas en almíbar"], "27.9": ["Conservas y legumbres", "Frutas en almíbar"],
  "18": ["Desayuno y dulces", "Cereales"], "19": ["Desayuno y dulces", "Galletas"], "25": ["Desayuno y dulces", "Galletas"], "20": ["Desayuno y dulces", "Chocolates y bombones"], "29.6": ["Despensa y snacks", "Arroz, pasta y harinas"], "29.7": ["Desayuno y dulces", "Cacao"], "29.3": ["Desayuno y dulces", "Postres"], "36": ["Desayuno y dulces", "Mermeladas y miel"], "27.1": ["Desayuno y dulces", "Mermeladas y miel"], "27.11": ["Desayuno y dulces", "Mermeladas y miel"], "27.4": ["Desayuno y dulces", "Mermeladas y miel"], "19.0": ["Desayuno y dulces", "Galletas"],
  "26": ["Desayuno y dulces", null], "27": ["Desayuno y dulces", null],
  "29": ["Despensa y snacks", null, "Caldos y sopas"], "29.2": ["Despensa y snacks", "Arroz, pasta y harinas"], "49": ["Despensa y snacks", "Frutos secos"], "49.2": ["Despensa y snacks", null, "Snacks y picos"], "27.10": ["Despensa y snacks", "Snacks y picos"], "51": ["Despensa y snacks", "Especias y sal"],
  "81": ["Charcutería y quesos", "Embutidos"], "81.1*": ["Charcutería y quesos", "Curados"], "81.2*": ["Charcutería y quesos", "Cocidos y fiambres"], "81.3": ["Charcutería y quesos", "Bacon y salchichas"], "81.4": ["Charcutería y quesos", "Quesos"], "81.5": ["Charcutería y quesos", "Lotes y loncheados"], "81.6*": ["Charcutería y quesos", null, "Lotes y loncheados"], "81.7": ["Charcutería y quesos", null, "Embutidos"], "81.8": ["Charcutería y quesos", "Bacon y salchichas"], "81.9": ["Charcutería y quesos", "Lotes y loncheados"],
  "85": ["Charcutería y quesos", "Quesos"], "88": ["Charcutería y quesos", "Bacon y salchichas"], "91": ["Charcutería y quesos", "Patés"],
  "92": ["Congelados y preparados", "Pan y barras"], "92.1": ["Congelados y preparados", "Bollería"], "92.4": ["Congelados y preparados", "Bollería"], "92.5": ["Congelados y preparados", "Bollería"], "92.3": ["Congelados y preparados", "Salados"], "92.6": ["Congelados y preparados", "Salados"], "94": ["Congelados y preparados", "Hamburguesas"], "75": ["Congelados y preparados", "Bacalao y pescado"], "76": ["Congelados y preparados", "Platos preparados"], "79": ["Congelados y preparados", "Platos preparados"],
  "54": ["Menaje y cristalería", null, "Cocina y complementos"], "55": ["Menaje y cristalería", null, "Vasos"], "55.2*": ["Menaje y cristalería", "Copas"], "57": ["Menaje y cristalería", "Cubertería"], "58": ["Menaje y cristalería", null, "Cocina y complementos"], "59": ["Menaje y cristalería", "Cuchillería"], "61": ["Menaje y cristalería", "Vajilla"],
  "56": ["Desechables y envases", null, "Consumibles"], "56.1": ["Desechables y envases", "Vasos y platos desechables"], "56.2": ["Desechables y envases", null, "Un solo uso"], "56.3": ["Desechables y envases", "Higiénico"], "69": ["Desechables y envases", "Envases"],
  "60": ["Limpieza", "Limpieza y químicos"], "95": ["Otros productos", "Tienda"], "99": ["Otros productos", null, "Otros"],
};
const RUTA_COMODIN = Object.entries(RUTAS).filter(([k]) => k.endsWith("*")).map(([k, v]) => [k.slice(0, -1), v]).sort((a, b) => b[0].length - a[0].length);
const rutaDe = (f) => {
  if (RUTAS[f]) return RUTAS[f];
  for (const [pre, v] of RUTA_COMODIN) if (f.startsWith(pre)) return v;
  return RUTAS[f.split(".")[0]] ?? null;
};

// Subcategoría por el NOMBRE cuando la familia de a3ERP es de marca o muy amplia. «@Categoría|Sub» cambia también de categoría.
const NOMBRE_SUBS = {
  "Aguas": [[/garrafa|dispensador|bidon|(?<![0-9,.])(5|8|10|12|15|18)(,0+)? ?(l|lt|litros?)\b|18[,.]9/, "Garrafas y dispensadores"], [/sin gas/, "Agua mineral"], [/pellegrino|perrier|con gas|vichy|carbonatad|agua gas|\bpedras\b|\bgas\b/, "Con gas"]],
  "Vinos": [[/estuche|bolsa papel|porra|\blote\b|cesta|pack regalo/, "Estuches y lotes"], [/pedro ximenez|moscatel|oloroso|amontillado|jerez|vermut/, "Otros vinos"], [/bag in box|\bbib\b/, "Bag in box"], [/cava|espumoso|champan|lambrusco|brut|prosecco/, "Espumosos y cava"], [/rosado|\brose\b/, "Rosados"], [/blanco|verdejo|albarino|rueda|chardonnay/, "Blancos"], [/tinto|crianza|reserva|rioja|ribera|roble|joven/, "Tintos"]],
  "Cervezas": [[/sin alcohol|\b0 ?[,.] ?0\b|\b0 ?%|zero|\bsin\b/, "Sin alcohol"], [/radler|shandy/, "Radler"], [/\blata\b|\blat\b/, "Lata"], [/botella|botellin|tercio|vidrio|\b1\/[35]\b|\bret\b|(20|25|33) ?cl\b/, "Botella"]],
  "Conservas y legumbres": [
    [/corned/, "Carne en conserva"],
    [/atun|bonito|sardina|sardinilla|mejillon|caballa|anchoa|berberecho|pulpo|calamar|chipiron|navaja|almeja|bacalao|salmon|ventresca|melva|zamburina|pescado|marisco|boquerones|huevas/, "Pescado y marisco"],
    [/macedonia (de )?verdu|piquillo|morron|brotes|\bajo\b/, "Verduras y encurtidos"],
    [/tomate (frito|triturado|natural|entero)|ketchup|catsup|mayonesa|mostaza|\bsalsa\b|pisto/, "@Aceites, vinagres y salsas|Tomate y salsas"],
    [/alubia|garbanzo|lenteja|fabada|potaje|judion|cocido|habas|judias? (blanc|pint|cocid|guisad)/, "Legumbres"],
    [/almibar|melocoton|pina |piña|\bfruta|macedonia|cocktail|mandarina|pera |albaricoque/, "Frutas en almíbar"],
    [/atun|bonito|sardina|sardinilla|mejillon|caballa|anchoa|berberecho|pulpo|calamar|chipiron|navaja|almeja|bacalao|salmon|ventresca|melva|zamburina|pescado|marisco|boquerones|huevas/, "Pescado y marisco"],
    [/meica|corned|bockwurst|frankfurter|paté|pate |carne|callos|fiambre/, "Carne en conserva"],
    [/pimiento|esparrago|champi|alcachofa|\bmaiz\b|guisante|judias|zanahoria|menestra|remolacha|pepinillo|aceituna|encurtido|cebolla|espinaca|coliflor|verdura|palmito|setas|tomate/, "Verduras y encurtidos"],
  ],
  "Desayuno y dulces": [[/galleta|cuetara|maria|cracker|barquillo|bizcocho|magdalena/, "Galletas"], [/cereal|muesli|corn flakes|copos/, "Cereales"], [/chocolate|bombon|tableta|turron|polvoron/, "Chocolates y bombones"], [/cacao|colacao|nesquik|cola cao/, "Cacao"], [/mermelada|miel|confitura|crema de untar|nocilla|nutella/, "Mermeladas y miel"], [/postre|natilla|flan|gelatina|cuajada/, "Postres"]],
  "Despensa y snacks": [[/frutos secos|almendra|cacahuete|pistacho|anacardo|nueces|nuez|avellana|\bmix\b/, "Frutos secos"], [/pringles|patata|snack|aperitivo|gusanito|palomita|nachos|pico|grissini|regañas|rosquilla|pipa/, "Snacks y picos"], [/arroz|pasta|macarron|espagueti|fideo|harina|maizena|tallarin|cuscus/, "Arroz, pasta y harinas"], [/caldo|sopa|pastilla|concentrado/, "Caldos y sopas"], [/especia|pimenton|oregano|comino|sal |pimienta|azafran|laurel|curry|colorante/, "Especias y sal"]],
  "Charcutería y quesos": [[/gazpacho|salmorejo|empanadilla|tortilla|ensaladilla|masa/, "@Congelados y preparados|Platos preparados"], [/queso|mozzarella|parmesano|emmental|tierno|curado queso|manchego/, "Quesos"], [/bacon|panceta|salchicha|chorizo fresco|longaniza|morcilla/, "Bacon y salchichas"], [/pate|paté|foie|sobrasada/, "Patés"], [/jamon cocido|york|pavo|fiambre|mortadela|cocido/, "Cocidos y fiambres"], [/jamon|lomo|salchichon|chorizo|curado|paleta|cecina|fuet|salami|taquitos/, "Curados"], [/torrezno|panceta/, "Bacon y salchichas"], [/lote|lonchead|sobre/, "Lotes y loncheados"]],
  "Congelados y preparados": [[/croissant|napolitana|palmera|donut|ensaimada|magdalena|bolleria|caracola/, "Bollería"], [/barra|pan |panecillo|baguette|chapata|hogaza/, "Pan y barras"], [/hamburguesa|burger/, "Hamburguesas"], [/bacalao|merluza|pescado|calamar|gamba|langostino/, "Bacalao y pescado"]],
  "Café e infusiones": [[/\btaza|\bplato|platillo/, "@Menaje y cristalería|Vajilla"], [/paletina|portavasos|vaso carton|agitador/, "@Desechables y envases|Un solo uso"], [/galleta|muffin|palmera|magdalena|bizcocho|croissant/, "@Desayuno y dulces|Galletas"], [/capsula|monodosis nespresso|dolce gusto/, "Cápsulas"], [/descafeinado|\bdesc\b/, "Café descafeinado"], [/infusion|te |manzanilla|poleo|tila|twinings|rooibos/, "Infusiones y té"], [/azucar|sobre|edulcorante/, "Azúcar y sobres"], [/sirope/, "Siropes"], [/cafe|mocay|grano|molido|soluble/, "Café en grano y molido"]],
  "Aceites, vinagres y salsas": [[/vinagre/, "Vinagres"], [/aceite|oliva|girasol|freidora/, "Aceites"], [/mostaza|mayonesa|ketchup|kétchup|catsup/, "Mostaza, mayonesa y kétchup"]],
  "Leche y lácteos": [[/migas de azul|queso|mozzarella/, "@Charcutería y quesos|Quesos"], [/caffe|cafe |latte|capuccino|cappuccino/, "Batidos y cafés fríos"], [/slup|yogur|natilla|flan|postre|actimel/, "Yogures y postres"]],
  "Menaje y cristalería": [
    [/brocheta|pincho/, "@Desechables y envases|Cañas y palillos"],
    [/gorro|guante|toallita|mascarilla/, "@Desechables y envases|Higiénico"],
    [/blonda|tarrina|bisagra|kraft|desechable|aluminio|bandeja carton|cartulina|\bcarton\b/, "@Desechables y envases|Tarrinas y bandejas"],
    [/^copa\b|\bcopa /, "Copas"],
    [/rustidera|asador|cazuelit|lechera|sarten|cacerola|\bolla\b|ollas|\bcazo\b|paellera|perol|cazuela|marmita|\bwok\b|vaporera|puchero|cacillo/, "Ollas y sartenes"],
    [/molde|manga pastel|rodillo|cortapastas|boquilla|reposter/, "Repostería y moldes"],
    [/servillet|cenicero|salero|palillero|queser|campana|portahelado|frasca|portabobina|portarrollo|toallero|secamanos|camarero|cocktel|coctel|abridor|sacacorchos|cubitera|hielo|jarra|exprimidor|dosificador|pulverizador|botella|posavasos|termo|panera/, "Bar y camarero"],
    [/cuenco|rabanera|lavafrutas|fuente|bandeja|plato|sopera|\bbol\b|bowl|ensaladera|cubeta|hermetic|gastronorm|recipiente|contenedor|barreno|cesta/, "Fuentes, bandejas y cubetas"],
    [/cucharon|espumadera|pinza|\bpala\b|batidor|colador|rallador|embudo|tijera|abrelatas|tabla|mortero|pelador|cortador|espatula|mandolina|cucharilla/, "Utensilios de cocina"],
  ],
  "Desechables y envases": [
    [/film|rollo alum|bolsa|saco|papel (vegetal|encerado|parafinado|horno|antigrasa)/, "Bolsas, film y aluminio"],
    [/higienico|secamanos|toallita|guante|gorro|mascarilla/, "Higiénico"],
    [/cubierto/, "Vasos y platos desechables"],
    [/mantel|servilleta|salvamantel|bobina|rollo|papel cocina/, "Manteles y servilletas"],
    [/\bcana|paja|pajita|palillo|pincho|brocheta|palo |agitador|removedor|paletina|lazo/, "Cañas y palillos"],
    [/vaso|plato|taza|cubierto|tenedor|cuchara|cuchillo|bowl|copa/, "Vasos y platos desechables"],
    [/tarrina|barqueta|bandeja|blonda|envase|\benv\b|alumi|caja|tapa|contenedor|hermetic/, "Tarrinas y bandejas"],
  ],
  "Otros productos": [[/cuchillo|cuchilla/, "@Menaje y cristalería|Cuchillería"]],
  "Refrescos y zumos": [[/zumo|nectar|smoothie/, "Zumos y néctares"], [/gaseosa|tinto de verano/, "Gaseosa y tinto de verano"], [/\bbio\b/, "Bebidas bio"]],
};
// Reglas que MANDAN sobre la familia (casos concretos)
const PRIMERO = [
  [/twinings|infusion|manzanilla|poleo/, "Café e infusiones", "Infusiones y té"],
  [/delantal|trapo|bayeta|estropajo/, "Limpieza", "Limpieza y químicos"],
  [/^(?!.*(jarra|dosific|bomba|dispens)).*\bsirope\b/, "Café e infusiones", "Siropes"],
  [/corned beef/, "Conservas y legumbres", "Carne en conserva"],
  [/^(?!.*(patata|snack|pringles|ganchito)).*(ketchup|kétchup|catsup|mayonesa|mostaza|alioli)/, "Aceites, vinagres y salsas", "Mostaza, mayonesa y kétchup"],
  [/cracker/, "Desayuno y dulces", "Galletas"],
  [/^sal( |$)|\bsal (fina|gorda|yodada|marina)/, "Despensa y snacks", "Especias y sal"],
  [/crema (de )?cacao|crema de untar/, "Desayuno y dulces", "Mermeladas y miel"],
  [/natilla/, "Leche y lácteos", "Yogures y postres"],
  [/hoops/, "Congelados y preparados", "Bollería"],
  [/^copa\b|\bcopa (chateau|frizzante|bornos|cava|vino|agua|balon|licor|flauta|cocktel|coctel)\b/, "Menaje y cristalería", "Copas"],
];

// El catálogo antiguo (por nombre) → categoría nueva, para lo que no tenga familia de a3ERP
const VIEJO_A_NUEVO = { "Café": "Café e infusiones", "Pascual": "Leche y lácteos", "Aguas": "Aguas", "Bebidas": "Refrescos y zumos", "Vinos": "Vinos", "Despensa": "Despensa y snacks", "Refrigerados": "Charcutería y quesos", "Congelados": "Congelados y preparados", "Hostelería y menaje": "Menaje y cristalería", "Otros productos": "Otros productos" };

function subPorNombre(cat, nombre) {
  for (const [re, s] of NOMBRE_SUBS[cat] ?? []) if (re.test(nombre)) return s;
  return null;
}

/** Destino {categoria, subcategoria} de un artículo. */
export function destino(p) {
  const nombre = norm(p?.name ?? p?.nombre ?? "");
  for (const [re, c, s] of PRIMERO) if (re.test(nombre)) return { categoria: c, subcategoria: s };
  const f = limpia(p?.family);
  const r = /^\d+(\.\d+)?$/.test(f) ? rutaDe(f) : null;
  let cat, sub, subViejo = null, respaldo = null;
  if (r) { cat = r[0]; sub = r[1]; respaldo = r[2] ?? null; }
  else { const k = categorizar(p); cat = VIEJO_A_NUEVO[k.catNombre] ?? "Otros productos"; sub = null; if (T(cat)?.subs.includes(k.subNombre)) subViejo = k.subNombre; }
  if (sub === null) sub = subPorNombre(cat, nombre) ?? subViejo ?? respaldo;
  if (typeof sub === "string" && sub.startsWith("@")) { const [c2, s2] = sub.slice(1).split("|"); cat = c2; sub = s2; }
  if (sub === null) sub = T(cat)?.defecto ?? "Otros";
  return { categoria: cat, subcategoria: sub };
}

/** Copias de los artículos con la categoría y subcategoría por tipo. */
export function conArbolTipos(items) {
  if (!Array.isArray(items) || !items.length) return items;
  return items.map((p) => { const d = destino(p); return { ...p, category: d.categoria, subcategory: d.subcategoria, icono: T(d.categoria)?.icono ?? "📦" }; });
}

/** Ordena el árbol (categorías y subcategorías) como arriba y marca cada una con su posición `o` (la pantalla la respeta). */
export function ordenTipos(arbol) {
  const pos = (n) => { const i = TIPOS.findIndex((t) => t.nombre === n); return i < 0 ? 99 : i; };
  return [...arbol].sort((a, b) => pos(a.nombre) - pos(b.nombre) || a.nombre.localeCompare(b.nombre, "es")).map((c) => {
    const subs = T(c.nombre)?.subs ?? [], sp = (n) => { const i = subs.indexOf(n); return i < 0 ? 99 : i; };
    return { ...c, o: pos(c.nombre), subs: [...(c.subs ?? [])].sort((a, b) => sp(a.nombre) - sp(b.nombre) || a.nombre.localeCompare(b.nombre, "es")).map((s, i) => ({ ...s, o: i })) };
  });
}
