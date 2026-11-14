import test from "node:test";
import assert from "node:assert/strict";
import { limpiarNombre as l } from "./nombres.js";

test("nombres: mayúscula inicial, unidades, siglas y acentos", () => {
  assert.equal(l("REFRESCO COLA LATA 33 CL.").nombre, "Refresco cola lata 33 cl");
  assert.equal(l("AGUA MINERAL 1,5 L").nombre, "Agua mineral 1,5 L");
  assert.equal(l("AGUA MINERAL 1.5 LITROS").nombre, "Agua mineral 1,5 L");
  assert.equal(l("CAFE MOLIDO NATURAL 250 GR").nombre, "Café molido natural 250 g");
  assert.equal(l("LECHE UHT ENTERA 1 L").nombre, "Leche UHT entera 1 L");
  assert.equal(l("BOTELLA PET 2 L").nombre, "Botella PET 2 L");
  assert.equal(l("PACK 6X33CL").nombre, "Pack 6x33 cl");
});
test("nombres: comillas sueltas, puntos y espacios dobles", () => {
  assert.equal(l('" 12 " LITROS').nombre, "12 L");
  assert.equal(l("23 CL.VALENCIA").nombre, "23 cl · Valencia");
  assert.equal(l("  AZUCAR   1 KG..  ").nombre, "Azúcar 1 kg");
  assert.equal(l('VINO "TINTO" 75 CL').nombre, "Vino tinto 75 cl");
});
test("nombres: marca separada si es conocida y excepciones manuales", () => {
  const r = l("COCA-COLA ZERO PET 2 L");
  assert.equal(r.marca, "Coca-Cola"); assert.equal(r.nombre, "Zero PET 2 L");
  assert.equal(l("MAHOU CINCO ESTRELLAS 33CL.").marca, "Mahou");
  assert.equal(l("COSA RARA 1 L", { marcas: ["cosa rara"] }).marca, "Cosa Rara");
  assert.deepEqual(l("ARTICULO X", { excepciones: { "articulo x": { nombre: "Bien", marca: "M" } } }), { nombre: "Bien", marca: "M", original: "ARTICULO X", cambiado: true, excepcion: true });
  assert.equal(l("ATÚN pack", { excepciones: { "ATUN PACK": "Atún" } }).nombre, "Atún");
});
test("nombres: el original no se pierde y un nombre ya limpio no cambia", () => {
  assert.equal(l("AGUA MINERAL 1,5 L").original, "AGUA MINERAL 1,5 L");
  assert.equal(l("Agua mineral 1,5 L").cambiado, false);
  assert.equal(l("").nombre, "");
});
