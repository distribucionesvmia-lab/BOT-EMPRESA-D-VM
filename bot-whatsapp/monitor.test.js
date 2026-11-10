import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estadoSistema, crearVigilante, informeTexto } from "./monitor.js";

const H = 3_600_000, T0 = Date.parse("2026-11-10T10:00:00Z");
const base = (extra = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-mon-"));
  fs.writeFileSync(path.join(dir, "pedidos-1.sqlite"), "x"); // copia reciente
  return { pedidosPendientes: () => [], solicitudesPendientes: () => [], cuentasSinConfirmar: () => 0, sync: null, correo: { status: () => ({ destino: ["a@b.c"], enviados: 3, ultimoError: null }) }, copiasDir: dir, dataDir: dir, catalogo: () => ({ activos: 10, sinPrecio: 0 }), ahora: () => Date.now(), ...extra };
};

test("estado: todo en orden no da problemas", () => {
  const e = estadoSistema(base());
  assert.deepEqual(e.problemas, []);
  assert.match(informeTexto(e), /Todo en orden/);
});

test("estado: detecta pedidos parados, altas sin resolver, copias y correo", () => {
  const ahora = Date.now();
  const e = estadoSistema(base({
    ahora: () => ahora,
    pedidosPendientes: () => [{ fecha: new Date(ahora - 20 * H).toISOString(), estado: "pendiente" }, { fecha: new Date(ahora - 5 * H).toISOString(), estado: "retenido" }],
    solicitudesPendientes: () => [{ createdAt: new Date(ahora - 30 * H).toISOString() }],
    correo: { status: () => ({ ultimoError: { message: "auth" } }) },
    copiasDir: "/no/existe",
  }));
  assert.deepEqual(e.problemas.map((p) => p.clave).sort(), ["altas-sin-resolver", "correo-error", "pedidos-retenidos", "pedidos-sin-exportar", "sin-copias"]);
  assert.equal(e.problemas.find((p) => p.clave === "altas-sin-resolver").gravedad, "alta");
});

test("estado: sincronización fallida y correo sin configurar", () => {
  const e = estadoSistema(base({ sync: { status: () => ({ configurado: true, cadaMinutos: 15, ultima: { ok: false, at: new Date().toISOString(), resultados: [{ tipo: "productos", estado: "error", detalle: "Excel roto" }] } }) }, correo: null }));
  const k = e.problemas.map((p) => p.clave);
  assert.ok(k.includes("sync-error") && k.includes("correo-sin-configurar"));
  assert.match(e.problemas.find((p) => p.clave === "sync-error").texto, /Excel roto/);
});

test("vigilante: avisa una vez por problema, de nuevo al volver a aparecer, y manda el informe diario una vez", async () => {
  const enviados = [];
  let t = Date.parse("2026-11-10T08:00:00Z"); // 09:00 en Madrid
  let problemas = [{ clave: "x", gravedad: "alta", texto: "algo falla" }];
  const estado = () => ({ fecha: new Date(t).toISOString(), problemas, pedidos: { pendientes: 0, retenidos: 0 }, altas: { solicitudesPendientes: 0, cuentasSinConfirmar: 0 }, catalogo: null, copias: null, discoLibreMB: null });
  const v = crearVigilante({ estado, enviar: async (m) => enviados.push(m), ahora: () => t, log: { error() {} } });
  await v.pasada();
  assert.equal(enviados.length, 2); // aviso + informe diario
  assert.match(enviados[0].subject, /aviso/i);
  await v.pasada(); t += 3 * H;
  await v.pasada();
  assert.equal(enviados.length, 2); // ni repite el aviso antes de 6 h ni el informe el mismo día
  problemas = []; await v.pasada();
  problemas = [{ clave: "x", gravedad: "alta", texto: "algo falla" }]; await v.pasada();
  assert.equal(enviados.length, 3); // resuelto y vuelto a aparecer: aviso nuevo
});
