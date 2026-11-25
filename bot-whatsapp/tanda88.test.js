// Catálogo por TIPO de artículo (15 categorías) con tarjetas de subcategoría dentro de cada una. Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TIPOS, destino, conArbolTipos, ordenTipos } from "./arbol-tipos.js";
const lee = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("hay 17 categorías (15 de tipo + licores + «Otros productos») y cada familia de a3ERP cae en una", () => {
  assert.equal(TIPOS.length, 17);
  const nombres = JSON.parse(lee("./familias-nombres.json"));
  const fam = [...new Set(Object.keys(nombres).map((k) => k.split(".")[0]))];
  const sin = fam.filter((F) => { const d = destino({ family: `${F}.0`, name: "ARTICULO DE PRUEBA" }); return !TIPOS.some((t) => t.nombre === d.categoria); });
  assert.deepEqual(sin, []);
});

test("las marcas no mandan: el tipo sale de la familia por tipo o del nombre", () => {
  const v = (f, n) => destino({ family: f, name: n });
  assert.deepEqual(v("22.21", "MAHOU 5 ESTRELLAS LATA 33CL"), { categoria: "Cervezas", subcategoria: "Lata" });
  assert.deepEqual(v("22.42", "AMSTEL BOTELLIN 25CL"), { categoria: "Cervezas", subcategoria: "Botella" });
  assert.deepEqual(v("22.25", "MAHOU 0,0 BOTELLA"), { categoria: "Cervezas", subcategoria: "Sin alcohol" });
  assert.deepEqual(v("30.4", "CALVO ATUN CLARO"), { categoria: "Conservas y legumbres", subcategoria: "Pescado y marisco" });
  assert.deepEqual(v("30.4", "CALVO TOMATE FRITO"), { categoria: "Aceites, vinagres y salsas", subcategoria: "Tomate y salsas" });
  assert.deepEqual(v("33.5", "TWININGS TE VERDE"), { categoria: "Café e infusiones", subcategoria: "Infusiones y té" });
  assert.deepEqual(v("10.7", "PERRIER 33CL"), { categoria: "Aguas", subcategoria: "Con gas" });
  assert.deepEqual(v("1.62", "LECHE SIN LACTOSA"), { categoria: "Leche y lácteos", subcategoria: "Leche sin lactosa" });
  assert.deepEqual(v("93.0", "HUEVOS L"), { categoria: "Leche y lácteos", subcategoria: "Huevos" });
  assert.deepEqual(v("60.1", "LEJIA"), { categoria: "Limpieza", subcategoria: "Limpieza y químicos" });
  assert.deepEqual(destino({ name: "VINO TINTO RIOJA" }), { categoria: "Vinos", subcategoria: "Tintos" }); // sin familia: por el nombre
});

test("orden fijo de categorías y subcategorías, con su posición `o`", () => {
  const arbol = [{ id: "a", nombre: "Limpieza", count: 1, subs: [{ id: "x", nombre: "Limpieza y químicos", count: 1 }] }, { id: "b", nombre: "Cervezas", count: 3, subs: [{ id: "bo", nombre: "Botella", count: 1 }, { id: "la", nombre: "Lata", count: 2 }] }, { id: "c", nombre: "Leche y lácteos", count: 1, subs: [] }];
  const o = ordenTipos(arbol);
  assert.deepEqual(o.map((c) => c.nombre), ["Leche y lácteos", "Cervezas", "Limpieza"]);
  assert.deepEqual(o[1].subs.map((s) => s.nombre), ["Lata", "Botella"]);
  assert.ok(o.every((c) => typeof c.o === "number"));
  const items = conArbolTipos([{ id: "1", name: "MAHOU LATA", family: "22.21" }]);
  assert.equal(items[0].category, "Cervezas"); assert.equal(items[0].icono, "🍺");
});

test("pantalla y servidor: tarjetas de subcategoría y árbol por tipo (se apaga con ARBOL_TIPOS=0)", () => {
  const h = lee("./pedido.html"), s = lee("./server.js");
  assert.match(h, /function renderSubTarjetas\(list, c\)/);
  assert.match(h, /renderSubTarjetas\(list, c\); return entrada\(list, "\.cat"\)/);
  assert.match(h, /irA\(c\.id, null\) : \(\) => irA\(null, null\)/); // «atrás» desde los artículos vuelve a las tarjetas de la categoría
  assert.match(h, /typeof c\.o === "number"/);
  assert.match(s, /process\.env\.ARBOL_TIPOS !== "0"\) return conArbolTipos\(l\)/);
  assert.match(s, /arbol = ordenTipos\(arbol\)/);
});
