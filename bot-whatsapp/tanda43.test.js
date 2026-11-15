// Revisión de categorías con la tarifa real: productos que caían en una subcategoría equivocada.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clasificar, categorizar } from "./categorias.js";

const mapa = JSON.parse(fs.readFileSync(new URL("./familias-categorias.json", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const donde = (name, family) => { const c = clasificar({ name, family }, mapa); const k = categorizar({ name, category: c.category, subcategory: c.subcategory }); return `${k.catNombre} › ${k.subNombre}`; };
const familiaDe = (re) => Object.keys(mapa).find((f) => re.test(`${mapa[f].category}/${mapa[f].subcategory}`));

test("sin familia (nombre solo): lo que antes caía en «Otros» o en la subcategoría equivocada", () => {
  assert.equal(donde("LAT.DEL MONTE PIÑA 820 GR"), "Despensa › Frutas en conserva");
  assert.equal(donde("KOIPESOL GIRASOL GARRAFA PET 5 L."), "Despensa › Aceites y vinagres");
  assert.equal(donde("CUCHILLO JAMONERO"), "Hostelería y menaje › Cocina y utensilios");
  assert.equal(donde("CAMPOFRIO DELANTAL NEGRO"), "Hostelería y menaje › Uniformes y textil");
  assert.equal(donde('"2025" BORNOS VERDEJO 75 CL (CAJA 12 Unid)'), "Vinos › Blancos");
});
test("reglas por el nombre que mandan sobre la familia", () => {
  assert.equal(donde("BORGES SIROPE CARAMELO 1 KG"), "Despensa › Siropes y toppings");
  assert.equal(donde("HELIOS MINI MELOCOTÓN CONFITU. 28 GR"), "Despensa › Mermeladas y miel");
  assert.equal(donde("BEBE CEBOLLA CONFITADA 230 GR"), "Despensa › Conservas vegetales y encurtidos");
  assert.equal(donde("PASTA GALLO HARINA TRIGO 1 KG"), "Despensa › Pasta, arroz y harinas");
  assert.equal(donde("TWININGS TE ENGLISH BREAKFAST 10 BOL."), "Café › Infusiones y té");
  assert.equal(donde("MARTINI ROSSO 1 L VERMUT"), "Bebidas › Licores y destilados");
  assert.equal(donde("RUAVIEJA LICOR HIERBAS 700 ML"), "Bebidas › Licores y destilados");
  assert.equal(donde("VASO FULL KRAFT CARTON 4 OZ- 120 ML (1 X 50 UN)"), "Hostelería y menaje › Papel y desechables");
});
test("lo que NO debe moverse: el vaso de licor, la jarra de sirope, el atún de girasol y los cuchillos de mesa", () => {
  assert.equal(donde("VASO LICOR CHUPITO 5 CL."), "Hostelería y menaje › Vasos y copas");
  assert.equal(donde("JARRA SIROPE CRISTAL"), "Hostelería y menaje › Mesa y bar");
  assert.notEqual(donde("CALVO ATUN CLARO GIRASOL 160 GR"), "Despensa › Aceites y vinagres");
  assert.equal(donde("CUCHILLO MESA VIENA COMAS"), "Hostelería y menaje › Cubertería");
  assert.equal(donde("CUCHILLO CHULETERO MANGO NEGRO"), "Hostelería y menaje › Cubertería");
});
test("menaje: «cubata» no es «bata» y el vaso de cristal transparente no es desechable", () => {
  assert.equal(donde("COPA CUBATA 78 CL.COMBI-PLUS"), "Hostelería y menaje › Vasos y copas");
  assert.equal(donde("VASO DIAMOND 30 CL TRANSPARENTE BORMIOLI"), "Hostelería y menaje › Vasos y copas");
  assert.equal(donde("VASO TRANSP.330 CC.(PACK 1 X 50)"), "Hostelería y menaje › Papel y desechables"); // el de plástico sí
});
test("dentro de Aguas y Café cada cosa en su subcategoría (con la familia de a3ERP)", () => {
  const fAgua = familiaDe(/^Aguas\//), fCafe = familiaDe(/^Café\/Café en grano/) ?? familiaDe(/^Café\//);
  assert.ok(fAgua && fCafe, "hay familias de agua y de café en el mapa");
  assert.equal(donde("SAN PELLEGRINO 750 AGUA VIDRIO", fAgua), "Aguas › S.Pellegrino");
  assert.equal(donde("PERRIER AGUA GAS 0,75 VIDRIO", fAgua), "Aguas › Perrier");
  assert.equal(donde("AGUA BEZOYA DISPENSADOR 8 LITROS", fAgua), "Aguas › Garrafas y dispensadores");
  assert.equal(donde("AGUA EDEN BIDON 18.9L", fAgua), "Aguas › Garrafas y dispensadores");
  assert.equal(donde("MOCAY \" 8 GR\" CAPSULA CAFÉ Natural (EST. 1X50)", fCafe), "Café › Cápsulas");
  assert.equal(donde("MOCAY BARISTA 3 DESCAF.(NATU)1K", fCafe), "Café › Café descafeinado");
  assert.equal(donde("MOCAY CAFE SOLUBLE SIN FILTRO 250gr", fCafe), "Café › Café de vaso y soluble");
  assert.equal(donde("MOCAY VASO CAPPUCCINO 200 ML", fCafe), "Café › Café de vaso y soluble");
  assert.equal(donde("MOCAY CAFE  MAESTRO COLOMBIA 1Kg", fCafe), "Café › Café en grano y molido");
});
test("congelados: la lámina de hojaldre es pastelería, no un snack salado", () => {
  assert.equal(donde("P. LÁMINA HOJALDRE (60*40) 900 GR"), "Congelados › Pastelería");
  assert.equal(donde("P.PANINI KEBAB 175gr(22UND)"), "Congelados › Snacks salados");
});
