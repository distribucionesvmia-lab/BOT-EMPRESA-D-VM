// Clientes FALSOS de prueba para la demo: cada uno con su historial (Excel «listado de histórico» de a3ERP) y un NIF inventado
// (solo sirve para entrar: se guardan las huellas, no el NIF). El código de cliente del Excel se cambia por el indicado para no pisar
// a ningún cliente real que tenga el mismo código.
//   node prueba-a-json.js salida.json  ID:Nombre:NIF:historial.xlsx  [ID:Nombre:NIF:historial.xlsx …]
// y al compilar la demo:  PRUEBA_JSON=salida.json node demo-web/build.mjs   (lleva datos de prueba: NO se sube al repositorio)
import fs from "node:fs";
import { parseHistorialXlsx } from "./historial-import.js";
import { demoNifKeys } from "./demo-web/nif-demo.js";

if (process.argv[1]?.endsWith("prueba-a-json.js")) {
  const [, , salida, ...clientes] = process.argv;
  if (!salida || !clientes.length) { console.error("Uso: node prueba-a-json.js salida.json ID:Nombre:NIF:historial.xlsx …"); process.exit(1); }
  const lista = clientes.map((c) => {
    const [id, name, nif, ...resto] = c.split(":"), fichero = resto.join(":");
    const { byCustomer } = parseHistorialXlsx(fs.readFileSync(fichero));
    const orders = [...byCustomer.values()].flat().sort((a, b) => (a.date < b.date ? 1 : -1));
    console.log(`${id} ${name}: ${orders.length} pedidos`);
    return { id, name, legalName: name, city: "MEDINA DEL CAMPO", municipio: "", phone: "", phones: [], emails: [], address: "", active: true, specialPrices: {}, discounts: {}, orders, nifKeys: demoNifKeys(id, nif) };
  });
  fs.writeFileSync(salida, JSON.stringify(lista));
}
