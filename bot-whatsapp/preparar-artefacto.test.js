import { test } from "node:test";
import assert from "node:assert/strict";
import { diferencias } from "./preparar-artefacto.js";

test("diferencias: detecta nuevos, modificados, retirados e iguales por id", () => {
  const antes = [{ id: "1", price: 1 }, { id: "2", price: 2 }, { id: "3", price: 3 }];
  const ahora = [{ id: "1", price: 1 }, { id: "2", price: 2.5 }, { id: "4", price: 4 }];
  assert.deepEqual(diferencias(antes, ahora), { nuevos: ["4"], modificados: ["2"], retirados: ["3"], iguales: 1 });
});
test("diferencias: dos copias idénticas no tienen cambios", () => {
  const x = [{ id: "1", orders: [{ doc: "9", lines: [{ productId: "5", qty: 2 }] }] }];
  const d = diferencias(x, JSON.parse(JSON.stringify(x)));
  assert.equal(d.nuevos.length + d.modificados.length + d.retirados.length, 0);
});
