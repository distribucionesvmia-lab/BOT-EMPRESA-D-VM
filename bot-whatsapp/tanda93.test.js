// Clasificación del catálogo por tipo: casos reales que estaban mal (agua con gas, pasta, salsas, copas, licores…). Nombres de artículo, sin datos de clientes.
import test from "node:test";
import assert from "node:assert/strict";
import { destino } from "./arbol-tipos.js";
const d = (family, name) => { const r = destino({ family, name }); return `${r.categoria} › ${r.subcategoria}`; };
const casos = [
  ["10.5", "PEDRAS AGUA GAS 750 CC", "Aguas › Con gas"],
  ["10.5", "PEDRAS AGUA GAS LIMON VIDRIO 250.RT4", "Aguas › Con gas"],
  ["10.5", "PEDRAS SIN GAS 500", "Aguas › Agua mineral"],
  ["10.7", "SAN PELLEGRINO 750 AGUA VIDRIO", "Aguas › Con gas"],
  ["10.1", "AGUA BEZOYA PET 1,5L (R6)", "Aguas › Agua mineral"],
  ["10.1", "AGUA BEZOYA GARRAFA 5 L", "Aguas › Garrafas y dispensadores"],
  ["10.0", "AGUA EDEN BIDON 18.9L", "Aguas › Garrafas y dispensadores"],
  ["23.1", "RON EJEMPLO 1 L", "Licores y destilados › Licores y destilados"],
  ["29.6", "PASTA GALLO MACARRON 500 GR", "Despensa y snacks › Arroz, pasta y harinas"],
  ["30.0", "KUHNE PEPINILLOS 720 GR", "Conservas y legumbres › Verduras y encurtidos"],
  ["45.0", "HELIOS SIROPE FRESA 1 L", "Café e infusiones › Siropes"],
  ["33.1", "PRIMA KETCHUP SOBRES", "Aceites, vinagres y salsas › Mostaza, mayonesa y kétchup"],
  ["19.0", "CRACKERS SALADAS 200 GR", "Desayuno y dulces › Galletas"],
  ["55.0", "COPA CHATEAU 35 CL VICRILA", "Menaje y cristalería › Copas"],
  ["99.0", "CUCHILLO JAMONERO 28 CM", "Menaje y cristalería › Cuchillería"],
  ["22.2", "MAHOU 5* LAT. 33 CL", "Cervezas › Lata"],
  ["22.2", "ESTRELLA 6X25cl", "Cervezas › Botella"],
  ["21.9", "VINO PEDRO XIMENEZ 75 CL", "Vinos › Otros vinos"],
  ["21.0", "ESTUCHE VINO RIOJA 2 BOTELLAS", "Vinos › Estuches y lotes"],
  ["80.0", "KAIKU CAFFE LATTE 1 L", "Leche y lácteos › Batidos y cafés fríos"],
  ["80.0", "RENY PICOT MIGAS DE AZUL", "Charcutería y quesos › Quesos"],
  ["92.3", "P.MAXI HOOPS GLASEADOS 70 GR", "Congelados y preparados › Bollería"],
  ["40.4", "MOCAY TAZA CAFE 90 ML", "Menaje y cristalería › Vajilla"],
  ["54.0", "SARTEN INOX 24 CM", "Menaje y cristalería › Ollas y sartenes"],
  ["54.0", "GUANTE NITRILO NEGRO CAJA 100 U", "Desechables y envases › Higiénico"],
  ["56.0", "MANTEL BLANCO 1 X 1 35GR", "Desechables y envases › Manteles y servilletas"],
  ["56.0", "BARQUETAS KRAFT 390 GR ANTIGRASA", "Desechables y envases › Tarrinas y bandejas"],
  ["81.7", "ALVALLE GAZPACHO ORIGINAL 1 L.", "Congelados y preparados › Platos preparados"],
];
for (const [f, n, esperado] of casos) test(`CLASIFICACIÓN: ${n} → ${esperado}`, () => assert.equal(d(f, n), esperado));
