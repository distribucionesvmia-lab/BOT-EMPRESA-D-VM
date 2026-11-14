// Bench 8: aviso «Hoy es tu día» antes de la hora límite (fechas forzadas; nunca se avisa a clientes reales).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openAccountsDb } from "./cuentas-db.js";
import { avisarCortes, horaAviso, cuando } from "./avisocorte.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const LUNES = "2026-11-16T07:45:00Z"; // lunes 16 de noviembre, 08:45 en Madrid
const ID = "T818181"; // cuenta de prueba (ficticia)
function montaje({ pedidos = [], dias = [1, 2, 3, 4, 5], medina = true } = {}) {
  const accounts = openAccountsDb(":memory:");
  accounts.setStanding(ID, { lines: [{ id: "1010", qty: 2, unit: "ud" }], days: dias });
  accounts.pushSave(ID, { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } });
  const enviados = [];
  const avisos = { aCliente: async (id, m) => { enviados.push([id, m]); return { enviados: 1, fallidos: 0 }; } };
  const customers = { getById: (id) => ({ id, name: "BAR PRUEBA", city: medina ? "MEDINA DEL CAMPO" : "VALLADOLID", municipio: medina ? "47085" : "47186" }) };
  const db = { recentOrders: () => pedidos };
  return { accounts, avisos, customers, db, enviados, ejecuta: (extra = {}) => avisarCortes({ nowIso: LUNES, accounts, db, customers, avisos, soloClientes: [ID], ...extra }) };
}

test("1. el día que toca el pedido fijo, a partir de las 8:30 y antes de las 10:00, sale UN aviso con el texto pedido y abre el fijo para revisar", async () => {
  const m = montaje(); const r = await m.ejecuta();
  assert.equal(r.length, 1); assert.equal(r[0].enviado, true); assert.equal(m.enviados.length, 1);
  const [id, msg] = m.enviados[0]; assert.equal(id, ID);
  assert.match(msg.body, /^Envía antes de las 10:00 y te lo llevamos (hoy|mañana|el \p{L}+ \d+ de \p{L}+)\.$/u); assert.equal(msg.title, "Hoy es tu día"); assert.equal(msg.url, "/cliente#revisar-fijo");
  // máximo 1 aviso por día y cliente
  const otra = await m.ejecuta({ nowIso: "2026-11-16T08:30:00Z" }); assert.equal(m.enviados.length, 1); assert.equal(otra[0].motivo, "ya avisado hoy");
  // al día siguiente vuelve a tocar
  await m.ejecuta({ nowIso: "2026-11-17T07:45:00Z" }); assert.equal(m.enviados.length, 2);
});
test("2. no avisa: pedido ya hecho para ese reparto o hoy, fijo en pausa, semana saltada, hoy no toca, avisos del cliente desactivados o sin móvil", async () => {
  const motivo = async (m, extra) => (await m.ejecuta(extra))[0].motivo;
  assert.equal(await motivo(montaje({ pedidos: [{ status: "ok", delivery_date: "2026-11-16", created_at: "2026-11-14T10:00:00Z" }] })), "ya tiene pedido para ese reparto"); // Medina antes de las 10:00: el reparto es hoy
  assert.equal(await motivo(montaje({ medina: false, pedidos: [{ status: "ok", delivery_date: "2026-11-17", created_at: "2026-11-14T10:00:00Z" }] })), "ya tiene pedido para ese reparto"); // fuera de Medina: el primer reparto es mañana
  const otroDia = montaje({ medina: false, pedidos: [{ status: "ok", delivery_date: "2026-11-20", created_at: "2026-11-14T10:00:00Z" }] }); const ro = await otroDia.ejecuta(); assert.equal(ro[0].enviado, true); assert.match(otroDia.enviados[0][1].body, /mañana/); // un pedido para OTRO reparto no impide el aviso
  assert.equal(await motivo(montaje({ pedidos: [{ status: "ok", delivery_date: null, created_at: "2026-11-16T06:30:00Z" }] })), "ya tiene pedido para ese reparto"); // pidió hoy mismo
  const cancel = montaje({ pedidos: [{ status: "cancelled", delivery_date: "2026-11-17", created_at: "2026-11-16T06:30:00Z" }] }); assert.equal((await cancel.ejecuta())[0].enviado, true); // un pedido cancelado no cuenta
  const p = montaje(); p.accounts.pauseStanding(ID, true); assert.equal(await motivo(p), "pausado");
  const s = montaje(); s.accounts.skipStanding(ID, "2026-11-16"); assert.equal(await motivo(s), "semana saltada");
  assert.equal(await motivo(montaje({ dias: [2] })), "hoy no toca");
  const d = montaje(); d.accounts.corteSet(ID, false); assert.equal(await motivo(d), "desactivado por el cliente");
  const n = montaje(); n.accounts.pushRemove("https://fcm.googleapis.com/fcm/send/abc"); assert.equal(await motivo(n), "sin avisos activados");
  for (const m of [p, s, d, n]) assert.equal(m.enviados.length, 0);
});
test("3. la hora la pone la oficina (AVISO_CORTE_HORA, por defecto 8:30), nunca después de las 10:00; fines de semana y fuera de hora no avisa; solo a los clientes indicados", async () => {
  assert.equal(horaAviso(undefined), 510); assert.equal(horaAviso("9:15"), 555); assert.equal(horaAviso("07.00"), 420); assert.equal(horaAviso("basura"), 510); assert.equal(horaAviso("11:00"), 510); // la hora de corte son las 10:00
  const m = montaje();
  assert.equal((await m.ejecuta({ nowIso: "2026-11-16T07:00:00Z" })).length, 0); // 08:00 → todavía no
  assert.equal((await m.ejecuta({ nowIso: "2026-11-16T09:00:00Z" })).length, 0); // 10:00 → ya pasó la hora límite
  assert.equal((await m.ejecuta({ nowIso: "2026-11-14T07:45:00Z" })).length, 0); // sábado
  assert.equal((await m.ejecuta({ hora: "9:30" })).length, 0); // 08:45 antes de las 9:30 configuradas
  assert.equal((await m.ejecuta({ hora: "8:00" })).length, 1);
  const otro = montaje(); assert.equal((await otro.ejecuta({ soloClientes: ["OTRO"] })).length, 0); assert.equal(otro.enviados.length, 0); // pruebas: nunca a clientes reales
  assert.equal(cuando("2026-11-16", "2026-11-16"), "hoy"); assert.equal(cuando("2026-11-17", "2026-11-16"), "mañana"); assert.equal(cuando("2026-11-19", "2026-11-16"), "el jueves 19 de noviembre");
});
test("4. interruptor «Avisarme antes de la hora límite» (activado por defecto), aviso que abre el pedido fijo sin enviarlo y tarea programada solo en la app del cliente", () => {
  const a = openAccountsDb(":memory:"); assert.equal(a.corteActivo("X"), true); a.corteSet("X", false); assert.equal(a.corteActivo("X"), false); a.corteSet("X", true); assert.equal(a.corteActivo("X"), true);
  const c = leer("./cliente.html"), s = leer("./server.js"), sw = leer("./pwa/sw.js");
  assert.match(c, /"Avisarme antes de la hora límite"/); assert.match(c, /cb\.setAttribute\("role", "switch"\)/); assert.match(c, /post\("\/api\/avisos\/corte", \{ activo: cb\.checked \}\)/);
  assert.match(c, /location\.hash === "#revisar-fijo"/); assert.match(c, /"&r=1";\n?\s*\}|&r=1"\;?/); assert.doesNotMatch(c.slice(c.indexOf("async function revisarFijoDesdeAviso"), c.indexOf("function entrar(nombre)")), /\/catalogo"?\s*,\s*\{ method: "POST"/); // abre el carrito: no hay POST de pedido
  assert.match(s, /\/api\/avisos\/corte/); assert.match(s, /clientEnabled && process\.env\.AVISO_CORTE !== "0"/); assert.match(s, /process\.env\.DEMO !== "1" && !process\.env\.VM_TEST/); // en pruebas y demo no se programa
  assert.match(sw, /c\.navigate \? c\.navigate\(url\) : c/); // con la app ya abierta, el toque también lleva al aviso
});
