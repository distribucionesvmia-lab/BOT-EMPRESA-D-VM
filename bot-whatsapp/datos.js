#!/usr/bin/env node
// Gestión de las bases de datos de productos y de clientes:
//   node datos.js importar <fichero.json>      carga {products, customers} (crea o actualiza; registra cambios)
//   node datos.js ejemplo                      carga los datos FICTICIOS de ejemplo/
//   node datos.js productos                    lista el catálogo
//   node datos.js clientes                     lista los clientes
//   node datos.js precio <código> <precio>     actualiza el precio de un producto
//   node datos.js historial <código>           cambios registrados de un producto
//   node datos.js buscar <nombre>              prueba la identificación por nombre
import fs from "node:fs";
import { openCatalogDb } from "./catalogo-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { importData } from "./seed.js";

const [cmd, a, b] = process.argv.slice(2);
const cat = openCatalogDb();
const cus = openCustomersDb();
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

switch (cmd) {
  case "importar":
  case "ejemplo": {
    const file = cmd === "ejemplo" ? new URL("./ejemplo/historial-ficticio.json", import.meta.url) : a;
    if (!file) throw new Error("Indica el fichero: node datos.js importar historial.json");
    console.log(importData(read(file), cat, cus));
    break;
  }
  case "productos":
    for (const p of cat.list({ activeOnly: false })) console.log(`${p.id}\\t${p.name}\\t${p.price} €\\t${p.unitsPerBox ?? 1} uds/caja\\tIVA ${p.vat}%\\t${p.active ? "" : "(baja)"}`);
    break;
  case "clientes":
    for (const c of cus.list()) console.log(`${c.id}\\t${c.name}\\t${c.phone}\\t${c.orders} pedidos\\túltimo: ${c.lastOrder ?? "-"}`);
    break;
  case "precio":
    console.log(cat.update(a, { price: Number(b) }));
    break;
  case "historial":
    for (const h of cat.history(a)) console.log(`${h.changedAt}\\t${h.field}\\t${h.oldValue ?? "-"} -> ${h.newValue ?? "-"}`);
    break;
  case "buscar":
    console.log(cus.find(a).map((c) => `${c.id} ${c.name}`).join("\\n") || "Sin coincidencias");
    break;
  default:
    console.log("Uso: node datos.js importar <fichero.json> | ejemplo | productos | clientes | precio <código> <precio> | historial <código> | buscar <nombre>");
}
cat.close();
cus.close();
