// Avisos programados (promociones y descuentos): validación, envío a su hora, nunca tarde, respeto del límite y repetición semanal.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAccountsDb } from "./cuentas-db.js";
import { validarProgramado, enviarProgramados, madridAIso, GRACIA_MIN } from "./avisos-programados.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const montar = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-prog-")), accounts = openAccountsDb(path.join(dir, "a.sqlite")), enviados = [];
  const avisos = { aTodos: async (m) => (enviados.push({ a: "todos", m }), { enviados: 3, fallidos: 0, errores: [] }), aCliente: async (id, m) => (enviados.push({ a: id, m }), { enviados: 1, fallidos: 0, errores: [] }) };
  const customers = { getById: (id) => (id === "7001" ? { id: "7001", name: "BAR PRUEBA" } : null) };
  return { accounts, avisos, customers, enviados };
};
const AHORA = new Date("2026-11-14T10:00:00Z");
const base = { titulo: "Oferta de la semana", texto: "Cerveza al mejor precio", destino: "todos", dia: "2026-11-18", hora: "09:00", confirmo: true };

test("PROGRAMADOS: validación (confirmación, longitudes, destino, fecha futura y hora de Madrid)", () => {
  const ok = validarProgramado(base, { ahora: AHORA }); assert.ok(ok.aviso); assert.equal(ok.aviso.cuando, "2026-11-18T08:00:00.000Z"); // 09:00 en Madrid (invierno) = 08:00 UTC
  assert.equal(madridAIso("2026-07-10", "09:00"), "2026-07-10T07:00:00.000Z"); // en verano = 07:00 UTC
  assert.match(validarProgramado({ ...base, confirmo: false }, { ahora: AHORA }).error, /confirmación/);
  assert.match(validarProgramado({ ...base, titulo: "x".repeat(51) }, { ahora: AHORA }).error, /título/);
  assert.match(validarProgramado({ ...base, texto: "" }, { ahora: AHORA }).error, /mensaje/);
  assert.match(validarProgramado({ ...base, destino: "otros" }, { ahora: AHORA }).error, /quién/);
  assert.match(validarProgramado({ ...base, destino: "cliente", clienteId: "999" }, { ahora: AHORA, existeCliente: () => false }).error, /cliente/);
  assert.match(validarProgramado({ ...base, dia: "2026-11-14", hora: "11:00" }, { ahora: AHORA }).error, /minuto/); // 11:00 Madrid = 10:00 UTC: ahora mismo
  assert.match(validarProgramado({ ...base, dia: "2028-01-01" }, { ahora: AHORA }).error, /año/);
  assert.match(validarProgramado({ ...base, hora: "25:00" }, { ahora: AHORA }).error, /válid/);
  assert.match(validarProgramado({ ...base, repetir: "diario" }, { ahora: AHORA }).error, /Repetición/);
  assert.match(validarProgramado({ ...base, abre: "https://malo.example" }, { ahora: AHORA }).error, /abre/i); // solo páginas de la propia aplicación
});

test("PROGRAMADOS: sale a su hora, una sola vez, y deja constancia en el registro de avisos", async () => {
  const { accounts, avisos, customers, enviados } = montar();
  const id = accounts.avisoProgAdd({ ...validarProgramado(base, { ahora: AHORA }).aviso, clienteId: null });
  assert.deepEqual(await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-11-18T07:59:00Z") }), { enviados: 0, perdidos: 0, aplazados: 0 }); // aún no es la hora
  assert.equal(enviados.length, 0);
  const r = await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-11-18T08:00:30Z") });
  assert.equal(r.enviados, 1); assert.equal(enviados.length, 1); assert.equal(enviados[0].a, "todos"); assert.equal(enviados[0].m.title, "Oferta de la semana"); assert.equal(enviados[0].m.url, "/cliente");
  assert.equal((await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-11-18T08:01:30Z") })).enviados, 0); // no se repite
  assert.equal(accounts.avisoProgHistorial()[0].estado, "enviado"); assert.match(accounts.avisoProgHistorial()[0].resultado, /3 móviles/);
  assert.equal(accounts.pushLogList(5)[0].titulo, "Oferta de la semana"); assert.match(accounts.pushLogList(5)[0].detalle, /Programado/);
  assert.equal(accounts.avisoProgPendientes().length, 0); void id;
});

test("PROGRAMADOS: un aviso nunca sale tarde (programa parado), se puede cancelar y el límite de 10 por hora lo aplaza", async () => {
  const { accounts, avisos, customers, enviados } = montar();
  accounts.avisoProgAdd({ ...validarProgramado(base, { ahora: AHORA }).aviso, clienteId: null });
  const tarde = new Date(Date.parse("2026-11-18T08:00:00Z") + (GRACIA_MIN + 5) * 60_000);
  const r = await enviarProgramados({ accounts, avisos, customers, ahora: tarde }); assert.equal(r.perdidos, 1); assert.equal(enviados.length, 0);
  assert.equal(accounts.avisoProgHistorial()[0].estado, "perdido"); assert.match(accounts.avisoProgHistorial()[0].resultado, /parado/);
  // cancelado: no sale
  const id = accounts.avisoProgAdd({ ...validarProgramado(base, { ahora: AHORA }).aviso, clienteId: null }); assert.equal(accounts.avisoProgCancelar(id), true); assert.equal(accounts.avisoProgCancelar(id), false);
  assert.equal((await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-11-18T08:00:30Z") })).enviados, 0); assert.equal(enviados.length, 0);
  // límite: con 10 avisos enviados en la última hora, se aplaza (y sale cuando haya hueco, dentro de la gracia)
  const ahora = new Date("2026-11-18T08:00:30Z");
  for (let i = 0; i < 10; i++) accounts.pushLogAdd({ titulo: "t", texto: "x", destino: "todos", enviados: 1, fallidos: 0 }, new Date(ahora.getTime() - 60_000).toISOString());
  accounts.avisoProgAdd({ ...validarProgramado(base, { ahora: AHORA }).aviso, clienteId: null });
  assert.deepEqual(await enviarProgramados({ accounts, avisos, customers, ahora }), { enviados: 0, perdidos: 0, aplazados: 1 }); assert.equal(accounts.avisoProgPendientes().length, 1);
  assert.equal((await enviarProgramados({ accounts, avisos, customers, ahora: new Date(ahora.getTime() + 3700_000) })).enviados, 1); // una hora después ya hay hueco y sigue dentro de las 2 h de gracia: sale
});

test("PROGRAMADOS: a un cliente concreto (si ya no existe, error y no sale) y repetición semanal a la misma hora de Madrid", async () => {
  const { accounts, avisos, customers, enviados } = montar();
  const uno = validarProgramado({ ...base, destino: "cliente", clienteId: "7001", abre: "catalogo" }, { ahora: AHORA }).aviso;
  accounts.avisoProgAdd(uno); accounts.avisoProgAdd({ ...uno, clienteId: "9999" });
  const r = await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-11-18T08:00:30Z") }); assert.equal(r.enviados, 1);
  assert.equal(enviados[0].a, "7001"); assert.equal(enviados[0].m.url, "/catalogo");
  assert.ok(accounts.avisoProgHistorial().some((x) => x.estado === "error" && /ya no existe/.test(x.resultado)));
  // semanal: al salir deja el siguiente para dentro de 7 días a las 09:00 de Madrid (también cruzando el cambio de hora de octubre)
  const sem = validarProgramado({ ...base, dia: "2026-10-22", hora: "09:00", repetir: "semana" }, { ahora: new Date("2026-10-20T10:00:00Z") }).aviso;
  accounts.avisoProgAdd(sem);
  await enviarProgramados({ accounts, avisos, customers, ahora: new Date("2026-10-22T07:00:30Z") });
  const sig = accounts.avisoProgPendientes().find((x) => x.repetir === "semana"); assert.ok(sig); assert.equal(sig.dia, "2026-10-29"); assert.equal(sig.cuando, "2026-10-29T08:00:00.000Z"); // 09:00 en Madrid (ya invierno)
});

test("PANEL: sección «Programar un aviso», lista con «Cancelar» y planificador solo en la app de la empresa", () => {
  const h = leer("./empresa.html"), a = leer("./admin.js"), sv = leer("./server.js");
  for (const id of ["f-prog", "pr-dia", "pr-hora", "pr-repetir", "pr-abre", "pr-resumen", "pr-lista", "pr-hist"]) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(h, /¿Programar este aviso\?/); assert.match(h, /confirmo: true/); assert.match(h, /Cancelar/);
  for (const r of ['"/api/admin/avisos/programados" && get', '"/api/admin/avisos/programar" && post', "programados\\/(\\d+)\\/cancelar"]) assert.ok(a.includes(r.replace(/\\\\/g, "\\")) || a.includes(r), r);
  assert.match(sv, /adminEnabled && process\.env\.AVISOS_PROGRAMADOS !== "0"/); assert.match(sv, /process\.env\.DEMO !== "1" && !process\.env\.VM_TEST && adminEnabled/);
});
