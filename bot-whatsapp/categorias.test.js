import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { categorizar, arbolCategorias, clasificar, CATEGORIAS } from "./categorias.js";

const familias = JSON.parse(fs.readFileSync(new URL("./familias-categorias.json", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const k = (name, extra = {}) => { const r = categorizar({ name, ...extra }); return `${r.cat}/${r.sub}`; };
const f = (name, family) => { const r = clasificar({ name, family }, familias); return `${r.category} › ${r.subcategory}`; };

test("por tipo de producto, no por marca (sin código de familia: palabras del nombre)", () => {
  assert.equal(k("AGUA MINERAL 1,5 L"), "aguas/otras-aguas");
  assert.equal(k("Bezoya 50 cl"), "aguas/bezoya");
  assert.equal(k("VINO TINTO CRIANZA 75 CL (CAJA 6)"), "vinos/otros-vinos");
  assert.equal(k("Leche Pascual Classic semidesnatada 10 L"), "pascual/leche");
  assert.equal(k("Vivesoy Barista"), "pascual/bebidas-vegetales");
  assert.equal(k("Yogur natural vaso"), "pascual/yogures");
  assert.equal(k("ZUMO NARANJA 1 L"), "bebidas/zumos-y-nectares");
  assert.equal(k("Café Mocay Maestro 1 kg"), "cafe/cafe-en-grano-y-molido");
  assert.equal(k("Infusión Mocay pirámide"), "cafe/infusiones-y-te");
  assert.equal(k("Atún claro Calvo en aceite de oliva"), "despensa/conservas-de-pescado");
  assert.equal(k("Kétchup Helios 3 kg"), "despensa/tomate-y-salsas");
  assert.equal(k("Aceite de oliva virgen extra 5 L"), "despensa/aceites-y-vinagres");
  assert.equal(k("Chorizo Campofrío"), "refrigerados/embutidos");
  assert.equal(k("Queso Reny Picot"), "refrigerados/quesos");
  assert.equal(k("Croissant mantequilla congelado Panamar"), "congelados/croissants-y-napolitanas");
  assert.equal(k("REFRESCO COLA LATA 33 CL"), "bebidas/refrescos-y-tes-frios");
  assert.equal(k("CERVEZA RUBIA LATA 33 CL"), "bebidas/cervezas");
  assert.equal(k("PATATAS FRITAS 150 GR"), "despensa/frutos-secos-y-snacks");
  assert.equal(k("ARTÍCULO RARO"), "otros/otros");
});

test("el pan de barra es pan (antes «croustilante» caía en infusiones por contener «tila»)", () => {
  assert.equal(k("P. BARRA LARGA CROUSTILANTE TRA 260gr"), "congelados/panes-y-barras");
  assert.equal(k("PAN DE BARRA 250 GR"), "congelados/panes-y-barras");
  assert.equal(f("P. BARRA LARGA CROUSTILANTE TRA 260gr", "92.2"), "Congelados › Panes y barras");
  assert.equal(k("TILA SOBRES 20 UD"), "cafe/infusiones-y-te"); // la tila de verdad sí es infusión
});

test("casos que antes quedaban mal: el azúcar es despensa aunque venga de la familia del café", () => {
  assert.equal(f("MOCAY AZUCAR 5 GR SOBRE (1X1000)", "40.3"), "Despensa › Azúcar y edulcorantes");
  assert.equal(f("AZUCARITOS MORENO ESTUCHE 300 GR", "40.3"), "Despensa › Azúcar y edulcorantes");
  assert.equal(f("MOCAY EDULCORANTE SOB.6GRX150 UN.", "40.3"), "Despensa › Azúcar y edulcorantes");
  assert.equal(f("LA LECHERA LECHE CONDENSADA LATA 740 GR", "40.4"), "Despensa › Cacao y desayuno");
  assert.equal(f("MOCAY GALLETAS (150 UN)MOCAYTA", "40.4"), "Café › Complementos del café");
  assert.equal(f("MOCAY VASO CARTON 280 ML ( PACK 1 X 45 UN.)", "40.4"), "Hostelería y menaje › Papel y desechables");
  assert.equal(f("MOCAY TAZAS CAFE SOLO", "40.4"), "Hostelería y menaje › Tazas y cafetería");
  // «sin azúcar» no es azúcar; los bowls y pinzas «de azúcar» tampoco
  assert.equal(f("ESSENTIAL S/ AZUCAR NARANJA 1L", "11.6"), "Bebidas › Zumos y néctares");
  assert.equal(f("VIVESOY 1L LIGERA SIN AZUCAR", "11.8"), "Pascual › Bebidas vegetales");
  assert.equal(f("PINZA AZUCARILLO 11 CM. LACOR", "54.0"), "Hostelería y menaje › Mesa y bar");
  assert.equal(f("BOWL CAÑA AZUCAR 360 ML.(PACK 125 UND)", "58.0"), "Hostelería y menaje › Papel y desechables");
});

test("bebidas vegetales solo lleva bebidas vegetales; chocolate «a la taza» no es una taza", () => {
  assert.equal(f("VIVESOY BEBIDA DE ALMENDRA", "11.8"), "Pascual › Bebidas vegetales");
  assert.equal(f("JARRA VIVESOY SOJA", "69.0"), "Otros productos › Envases y palés");
  assert.equal(f("KIKKOMAN SALSA SOJA 150 ML", "33.0"), "Despensa › Tomate y salsas");
  assert.equal(f("RENY PICOT CHOCOLATE A LA TAZA 1L", "20.3"), "Pascual › Natillas y postres");
});

test("por familia de a3ERP, afinado por el nombre", () => {
  assert.equal(f("HELIOS SIROPE CARAMELO 295 GR", "27.3"), "Despensa › Siropes y toppings");
  assert.equal(f("HELIOS TOMATE FRITO vidrio PEQ.300GR", "27.3"), "Despensa › Tomate y salsas");
  assert.equal(f("HELIOS MERME.TOMATE 340 GR", "27.1"), "Despensa › Mermeladas y miel");
  assert.equal(f("VILLA CAMPO 3 KG MELOCOTON 30/40", "30.9"), "Despensa › Frutas en conserva");
  assert.equal(f("MAIZENA FINA DE MAIZ 700 GR", "29.0"), "Despensa › Pasta, arroz y harinas");
  assert.equal(f("PEDRO XIMENEZ ROBLES VINO DULCE 75 CL.", "21.2"), "Vinos › Dulces y generosos");
  assert.equal(f("BORNOS SEMIDULCE VERDEJO", "21.2"), "Vinos › Blancos");
  assert.equal(f("COPA CHATEAU 52 CL VICRILA (PF", "21.1"), "Hostelería y menaje › Vasos y copas");
  assert.equal(f("ESTUCHE CARTON CERRADO 2 B0T.", "21.9"), "Hostelería y menaje › Embalaje y bolsas");
  assert.equal(f("PORRA NAVIDAD LOTE H-151 (IVA 10%)CESTA 1 pi", "21.9"), "Otros productos › Lotes de Navidad");
  assert.equal(f("CAMPOFRIO PVP 1€ JAMON COCIDO", "81.7"), "Refrigerados › Jamón y fiambres");
  assert.equal(f("RENY PICOT 8 UNIDADES LONCHAS", "81.5"), "Refrigerados › Quesos");
  assert.equal(f("P. EMPANADILLA TOMATE ATUN 125 GR", "92.1"), "Congelados › Snacks salados");
  assert.equal(f("ARTICULO GENERICO", "99.0"), "Otros productos › Artículos internos (no vender)");
  assert.equal(f("CUCHILLO JAMONERO SALMON 28 CM", "57.3"), "Hostelería y menaje › Cocina y utensilios");
  assert.equal(f("CUCHARA MOKA 1001 COMAS", "57.2"), "Hostelería y menaje › Cubertería");
  assert.equal(f("CUCHARA REUT.PS CREMA(PACK 1 X20 UN.)", "56.0"), "Hostelería y menaje › Papel y desechables");
  assert.equal(f("JARRA LECHE 1 L. LACOR", "54.0"), "Hostelería y menaje › Tazas y cafetería");
  assert.equal(f("ALCOHOL 96º BOTELLA 1L", "54.0"), "Hostelería y menaje › Limpieza y droguería");
});

test("el mapa de familias cubre todo y solo usa categorías y subcategorías que existen", () => {
  const nombres = new Map(CATEGORIAS.map((c) => [c.nombre, c.subs.map(([, n]) => n)]));
  for (const [cod, v] of Object.entries(familias)) {
    assert.ok(nombres.has(v.category), `familia ${cod}: categoría «${v.category}» no existe`);
    if (v.subcategory) assert.ok(nombres.get(v.category).includes(v.subcategory), `familia ${cod}: subcategoría «${v.subcategory}» no existe en ${v.category}`);
  }
});

test("la categoría de la ficha manda; si es de a3ERP y no de la web, se crea aparte", () => {
  assert.equal(k("LO QUE SEA", { category: "Vinos", subcategory: "Tintos" }), "vinos/tintos");
  assert.equal(k("LO QUE SEA", { category: "Aguas" }), "aguas/otras-aguas"); // sin subcategoría: la última
  const r = categorizar({ name: "X", category: "Droguería", subcategory: "Limpieza" });
  assert.deepEqual([r.cat, r.sub, r.catNombre, r.subNombre], ["f-drogueria", "limpieza", "Droguería", "Limpieza"]);
  assert.equal(k("x", { category: "Droguería" }), "f-drogueria/general");
});

test("árbol: orden de la web, solo con productos, con sus cuentas", () => {
  const t = arbolCategorias([{ name: "AGUA MINERAL" }, { name: "Bezoya 1,5 L" }, { name: "CERVEZA RUBIA" }, { name: "Vino tinto" }, { name: "x", category: "Droguería", subcategory: "Limpieza" }]);
  assert.deepEqual(t.map((c) => [c.id, c.count]), [["aguas", 2], ["bebidas", 1], ["vinos", 1], ["f-drogueria", 1]]);
  assert.deepEqual(t[0].subs.map((s) => [s.id, s.count]), [["bezoya", 1], ["otras-aguas", 1]]); // en el orden de la web
  assert.deepEqual(CATEGORIAS.map((c) => c.nombre), ["Café", "Pascual", "Aguas", "Bebidas", "Vinos", "Despensa", "Refrigerados", "Congelados", "Hostelería y menaje", "Otros productos"]);
});
