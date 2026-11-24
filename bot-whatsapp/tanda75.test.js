// «Quitar del catálogo»: el artículo deja de verse para los clientes, no se borra y se puede volver a poner. Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openAccountsDb } from "./cuentas-db.js";
import { leerOcultos, ponerOculto, textoOcultos } from "./articulos-ocultos.js";
import { etiquetaAccion } from "./actividad.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("OCULTOS: se quitan y se vuelven a poner sin duplicar, y el texto cambia (para que el catálogo se refresque)", () => {
  const a = openAccountsDb(":memory:"), t0 = textoOcultos(a);
  assert.equal(leerOcultos(a).size, 0);
  assert.equal(ponerOculto(a, "220171", true), true); ponerOculto(a, "220161", true); ponerOculto(a, "220161", true);
  assert.deepEqual([...leerOcultos(a)].sort(), ["220161", "220171"]); assert.notEqual(textoOcultos(a), t0);
  assert.equal(ponerOculto(a, "220171", false), true); assert.deepEqual([...leerOcultos(a)], ["220161"]);
  a.ajusteGuardar("articulos_ocultos", "esto no es json"); assert.equal(leerOcultos(a).size, 0, "un ajuste roto no tumba nada");
});

test("PANEL Y CLIENTES: la ruta pide confirmar, el catálogo de los clientes los filtra y queda en la actividad", () => {
  const ad = leer("./admin.js"), sv = leer("./server.js"), em = leer("./empresa.html");
  assert.match(ad, /quitar\|poner/); assert.match(ad, /b\.confirmo !== true/);
  assert.match(sv, /!ocultos\.has\(String\(p\.id\)\)/); assert.match(sv, /textoOcultos\(getAccountsDb\(\)\)/);
  for (const t of ["Quitar del catálogo", "Volver a poner", "Quitados del catálogo", "QUITADO DEL CATÁLOGO"]) assert.ok(em.includes(t), t);
  assert.match(etiquetaAccion("POST", "/api/admin/articulos/220171/quitar"), /Quitó un artículo/);
  assert.match(etiquetaAccion("POST", "/api/admin/articulos/220171/poner"), /Volvió a poner/);
});
