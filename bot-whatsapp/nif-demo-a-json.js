// Prepara el acceso con NIF de la DEMO para los clientes de un listado de a3ERP: guarda solo las HUELLAS de los 6 últimos caracteres
// (nunca el NIF) de cada cliente, con su código tal como puede estar en la base de la demo («0429» y «429»).
//   node nif-demo-a-json.js clientes.xlsx nif.json        y al compilar:  NIF_JSON=nif.json node demo-web/build.mjs
// Así se puede entrar con el NIF aunque la base de la demo no tenga (o haya perdido) su índice de huellas.
import fs from "node:fs";
import { readXlsx } from "./xlsx-read.js";
import { demoNifKeys } from "./demo-web/nif-demo.js";

export function huellasNif(rows, { solo = null } = {}) { // solo: lista de códigos de cliente (p. ej. ["0429"]); si no se indica, todos
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const hi = rows.findIndex((r) => r.some((c) => /^cod\.? ?cliente/.test(norm(c))) && r.some((c) => norm(c) === "nif"));
  if (hi < 0) throw new Error("El listado debe tener las columnas «Cód. cliente» y «NIF».");
  const ci = rows[hi].findIndex((c) => /^cod\.? ?cliente/.test(norm(c))), ni = rows[hi].findIndex((c) => norm(c) === "nif");
  const out = {};
  for (const r of rows.slice(hi + 1)) {
    const id = String(r[ci] ?? "").trim(), nif = String(r[ni] ?? "").trim();
    if (!id || !nif || (solo && !solo.map((x) => x.replace(/^0+(?=\d)/, "")).includes(id.replace(/^0+(?=\d)/, "")))) continue;
    for (const v of new Set([id, id.replace(/^0+(?=\d)/, "")])) out[v] = demoNifKeys(v, nif);
  }
  return out;
}

if (process.argv[1]?.endsWith("nif-demo-a-json.js")) {
  const [, , entrada, salida, ...solo] = process.argv; // clientes opcionales al final: node nif-demo-a-json.js clientes.xlsx nif.json 0429
  if (!entrada || !salida) { console.error("Uso: node nif-demo-a-json.js clientes.xlsx nif.json"); process.exit(1); }
  const m = huellasNif(readXlsx(fs.readFileSync(entrada)), { solo: solo.length ? solo : null });
  fs.writeFileSync(salida, JSON.stringify(m));
  console.log(`${Object.keys(m).length} códigos de cliente con huellas de NIF → ${salida}`);
}
