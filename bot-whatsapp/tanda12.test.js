// Tanda 12: pedido semanal real de un bar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const p = fs.readFileSync(new URL("./pedido.html", import.meta.url), "utf8");

test("1. «Repetir y revisar» con un pedido ya empezado: nunca se mezcla sin preguntar (sustituir / añadir / cancelar), enseñando antes cómo cambia el total", () => {
  assert.match(p, /async function precargar\(\)/); assert.match(p, /function elegirAnterior\(ops, aplicar\)/);
  assert.match(p, /if \(ops\.length && qty\.size && !sumar\) \{/); assert.match(p, /await elegirAnterior\(ops, aplicar\)/);
  for (const t of ["Sustituir el pedido actual", "Añadir al pedido actual", "Si lo sustituyes", "Si lo añades", "Tu pedido ahora"]) assert.ok(p.includes(t), t);
  assert.doesNotMatch(p, /confirm\("Tienes un pedido sin terminar/); // ya no se usa el aviso del navegador
});
test("1b. si el resultado supera los 3.000 € se pregunta «¿Seguro?» (como con una cantidad enorme) y, si no, se deshace", () => {
  assert.match(p, /calc\(\)\.total > LIM_IMPORTE && !\(await preguntar\(\{ titulo: "¿Seguro\?"/); assert.match(p, /Ojo: si lo añades, el pedido pasa de/);
});
test("1c. la orden del enlace (#c=…) se usa una sola vez: al recargar no se vuelve a sumar", () => { assert.match(p, /history\.replaceState\(history\.state, "", location\.pathname \+ location\.search\)/); });
