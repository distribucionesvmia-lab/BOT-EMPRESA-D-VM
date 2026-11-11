import test from "node:test";
import assert from "node:assert/strict";
import { cicloHabitual, recordatoriosDeHoy, telefonoWa } from "./recordatorios.js";

const HOY = "2026-11-10"; // martes

test("ciclo habitual: mediana de días entre pedidos, con al menos 3 pedidos", () => {
  assert.equal(cicloHabitual(["2026-10-01", "2026-10-08"]), null); // solo 2 pedidos
  assert.equal(cicloHabitual(["2026-10-01", "2026-10-08", "2026-10-15"]), 7);
  assert.equal(cicloHabitual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-29"]), 7); // la mediana, no la media
  assert.equal(cicloHabitual(["2026-10-01", "2026-10-01", "2026-10-08", "2026-10-15"]), 7); // un mismo día cuenta una vez
});

test("teléfono para WhatsApp: con prefijo de país, y sin teléfono usable no hay recordatorio", () => {
  assert.equal(telefonoWa("983 12 34 56"), "34983123456"); assert.equal(telefonoWa("+34 600 111 222"), "34600111222"); assert.equal(telefonoWa("0034600111222"), "34600111222");
  assert.equal(telefonoWa(""), null); assert.equal(telefonoWa("12345"), null);
});

test("recordatorios de hoy: entre el 75 % y el 100 % del ciclo, o día de pedido fijo; nunca sin teléfono, ya avisados, «no avisar más» ni quien ya pidió hoy", () => {
  const sem = (ultimo) => ["2026-09-01", "2026-09-08", "2026-09-15", ultimo]; // ciclo de 7 días
  const clientes = [
    { id: "A", name: "Bar A", phone: "600111222", fechas: sem("2026-11-04") }, // 6 días de 7 → 86 %: toca
    { id: "B", name: "Bar B", phone: "600111223", fechas: sem("2026-11-09") }, // 1 día → 14 %: aún no
    { id: "C", name: "Bar C", phone: "600111224", fechas: sem("2026-10-20") }, // 21 días → 300 %: pasado de ciclo, no se insiste
    { id: "D", name: "Bar D", phone: "", fechas: sem("2026-11-04") }, // sin teléfono
    { id: "E", name: "Bar E", phone: "600111225", fechas: ["2026-11-02", "2026-11-04"] }, // 2 pedidos: sin ciclo
    { id: "F", name: "Bar F", phone: "600111226", fechas: sem("2026-11-04") }, // tocaría, pero ya se avisó hoy
    { id: "G", name: "Bar G", phone: "600111227", fechas: sem("2026-11-04") }, // tocaría, pero «no avisar más»
    { id: "H", name: "Bar H", phone: "600111228", fechas: sem(HOY) }, // ya ha pedido hoy
    { id: "I", name: "Bar I", phone: "600111229", fechas: ["2026-11-02"] }, // 1 pedido pero hoy (martes) es su día de pedido fijo
    { id: "J", name: "Bar J", phone: "600111230", fechas: ["2026-11-02"] }, // fijo en pausa
  ];
  const fijos = new Map([["I", { days: [2], paused: false }], ["J", { days: [2], paused: true }]]);
  const filas = recordatoriosDeHoy({ hoy: HOY, clientes, fijos, avisadosHoy: new Set(["F"]), nunca: new Set(["G"]), enlace: "https://pedidos.ejemplo/" });
  assert.deepEqual(filas.map((f) => f.id), ["I", "A"]); // primero los de pedido fijo
  assert.match(filas[0].motivo, /día de pedido fijo \(martes\)/); assert.match(filas[1].motivo, /6 días de un ciclo de 7/);
  assert.equal(filas[1].wa, "34600111222");
  assert.equal(filas[1].texto, "Hola Bar A, ¿te preparo tu pedido de siempre? Puedes revisarlo y enviarlo tú aquí: https://pedidos.ejemplo/. Si no quieres recordatorios, dínoslo y los quitamos.");
});
