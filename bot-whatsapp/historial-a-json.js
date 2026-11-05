// Convierte un listado de histórico de a3ERP (Artículo, Descripción, Unidades, Fecha, Precio, Desc.1, Nº Documento, Cliente…)
// en un JSON { código de cliente: [pedidos] } para ponérselo a uno o varios clientes de la demo (p. ej. un cliente de prueba).
//   node historial-a-json.js historial.xlsx historial.json
// Después, al compilar la demo:  HISTORIAL_JSON=historial.json node demo-web/build.mjs
// (En el servidor real no hace falta: se deja el Excel «historial…» en la carpeta datos de Drive y se sincroniza solo.)
import fs from "node:fs";
import { parseHistorialXlsx } from "./historial-import.js";

if (process.argv[1]?.endsWith("historial-a-json.js")) {
  const [, , entrada, salida] = process.argv;
  if (!entrada || !salida) { console.error("Uso: node historial-a-json.js historial.xlsx historial.json"); process.exit(1); }
  const { byCustomer, stats } = parseHistorialXlsx(fs.readFileSync(entrada));
  fs.writeFileSync(salida, JSON.stringify(Object.fromEntries(byCustomer)));
  console.log(`${stats.clientes} cliente(s), ${[...byCustomer.values()].reduce((n, o) => n + o.length, 0)} pedidos, ${stats.lineas} líneas · ignoradas: ${stats.cantidadNoValida} con cantidad no válida (devoluciones), ${stats.sinFecha} sin fecha → ${salida}`);
  for (const [c, o] of byCustomer) console.log(`  ${c}: ${o.length} pedidos (del ${o.at(-1).date} al ${o[0].date})`);
}
