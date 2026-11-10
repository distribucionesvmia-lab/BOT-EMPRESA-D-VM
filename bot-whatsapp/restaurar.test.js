// Ensayo completo de «el ordenador se estropea y hay que volver a las copias»: datos reales de las 4 bases → copia diaria → desastre → restauración → todo igual.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { openAccountsDb } from "./cuentas-db.js";
import { openCustomersDb } from "./clientes-db.js";
import { openCatalogDb } from "./catalogo-db.js";
import { backupAll } from "./backup.js";
import { listarCopias, verificarCopia, restaurar } from "./restaurar.js";

const montar = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-rest-"));
  const destinos = { pedidos: path.join(dir, "datos", "pedidos.sqlite"), cuentas: path.join(dir, "datos", "cuentas.sqlite"), clientes: path.join(dir, "datos", "clientes.sqlite"), catalogo: path.join(dir, "datos", "catalogo.sqlite") };
  fs.mkdirSync(path.join(dir, "datos"));
  return { dir, destinos, respaldos: path.join(dir, "respaldos") };
};
const rellenar = (destinos) => {
  const pedidos = openDb(destinos.pedidos), cuentas = openAccountsDb(destinos.cuentas), clientes = openCustomersDb(destinos.clientes), catalogo = openCatalogDb(destinos.catalogo);
  catalogo.upsertProducts([{ id: "A1", name: "AGUA", price: 4.995, vat: 10, unitsPerBox: 6, discount: 5 }, { id: "B1", name: "VINO", price: 12.5, vat: 21 }, { id: "C1", name: "LECHE", price: 0.79, vat: 4, unitsPerBox: 6 }]);
  clientes.upsertCustomers([{ id: "9001", name: "BAR UNO", phones: ["600111222"], emails: ["a@b.es"], nifKeys: [], specialPrices: { A1: 4.5 }, discounts: { B1: 10 }, orders: [{ doc: "D1", date: "2026-10-01", lines: [{ productId: "A1", qty: 12 }] }], active: true }]);
  cuentas.ensureMany(["9001"]);
  const o1 = pedidos.createOrder({ key: "k1", phone: "600111222", customerId: "9001", name: "BAR UNO", address: "Calle 1", text: "x", total: 20, review: false, at: "2026-11-01T10:00:00.000Z", items: [{ id: "A1", name: "AGUA", price: 4.5, qty: 2, vat_rate: 10 }, { id: "B1", name: "VINO", price: 12.5, qty: 1, vat_rate: 21 }] }).order;
  pedidos.createOrder({ key: "k2", phone: "600111222", customerId: "9001", name: "BAR UNO", text: "y", total: 3, review: true, reason: "dudoso", at: "2026-11-02T10:00:00.000Z", items: [{ id: "C1", name: "LECHE", price: 0.79, qty: 4, vat_rate: 4 }] });
  const dbs = { pedidos, cuentas, clientes, catalogo };
  const foto = () => ({
    pedidos: pedidos.listOrders({ limit: 100 }).map((o) => [o.ref, o.customer_id, o.review, o.items.map((i) => [i.id, i.qty, i.price])]),
    cuentas: cuentas.listAccounts().map((a) => [a.customerId, a.status]),
    clientes: clientes.getById("9001"),
    catalogo: catalogo.list({ activeOnly: false }).map((p) => [p.id, p.price, p.vat, p.unitsPerBox, p.discount]),
  });
  return { dbs, foto, ref: o1.ref };
};

test("ENSAYO: copia diaria → desastre (bases borradas) → restauración → los pedidos, cuentas, clientes y precios quedan exactamente igual", () => {
  const { destinos, respaldos } = montar();
  const { dbs, foto, ref } = rellenar(destinos);
  const antes = JSON.parse(JSON.stringify(foto()));
  const copia = backupAll(dbs, { dir: respaldos, now: new Date("2026-11-10T03:00:00Z") });
  assert.deepEqual(copia.errors, {});
  assert.equal(Object.keys(copia.files).length, 4);
  for (const d of Object.values(dbs)) d.close();
  // desastre: se pierden los ficheros (y uno queda a medias con restos «wal»)
  for (const f of Object.values(destinos)) fs.rmSync(f, { force: true });
  fs.writeFileSync(destinos.pedidos + "-wal", "basura de una base anterior");
  const vista = restaurar({ desde: respaldos, destinos, simular: true });
  assert.ok(Object.values(vista.bases).every((b) => b.estado === "se podría restaurar"), JSON.stringify(vista));
  assert.equal(vista.bases.pedidos.datos.orders, 2);
  assert.ok(!fs.existsSync(destinos.cuentas), "simular no toca nada");
  const r = restaurar({ desde: respaldos, destinos });
  assert.ok(Object.values(r.bases).every((b) => b.estado === "restaurada"), JSON.stringify(r));
  assert.ok(!fs.existsSync(destinos.pedidos + "-wal"), "se limpian los restos de la base anterior");
  // el programa abre las bases restauradas y ve lo mismo que antes
  const nuevo = rellenarSoloLeer(destinos);
  assert.deepEqual(JSON.parse(JSON.stringify(nuevo.foto())), antes);
  assert.equal(nuevo.pedidos.listOrders()[0].ref.startsWith("VM-2026-"), true);
  assert.ok(nuevo.pedidos.listOrders().some((o) => o.ref === ref));
  // y el siguiente pedido sigue la numeración (no repite referencias)
  const siguiente = nuevo.pedidos.createOrder({ key: "k3", phone: "1", customerId: "9001", name: "X", at: "2026-11-10T09:00:00.000Z", items: [{ id: "A1", qty: 1 }] }).order;
  assert.equal(new Set(nuevo.pedidos.listOrders({ limit: 100 }).map((o) => o.ref)).size, 3); // 3 pedidos, 3 referencias distintas
  assert.notEqual(siguiente.ref, ref);
});
function rellenarSoloLeer(destinos) {
  const pedidos = openDb(destinos.pedidos), cuentas = openAccountsDb(destinos.cuentas), clientes = openCustomersDb(destinos.clientes), catalogo = openCatalogDb(destinos.catalogo);
  return { pedidos, foto: () => ({
    pedidos: pedidos.listOrders({ limit: 100 }).filter((o) => o.key !== "k3").map((o) => [o.ref, o.customer_id, o.review, o.items.map((i) => [i.id, i.qty, i.price])]),
    cuentas: cuentas.listAccounts().map((a) => [a.customerId, a.status]),
    clientes: clientes.getById("9001"),
    catalogo: catalogo.list({ activeOnly: false }).map((p) => [p.id, p.price, p.vat, p.unitsPerBox, p.discount]),
  }) };
}

test("restaurar guarda antes lo que había (nunca se pierde nada) y elige la copia pedida por fecha", () => {
  const { destinos, respaldos } = montar();
  const { dbs } = rellenar(destinos);
  backupAll(dbs, { dir: respaldos, now: new Date("2026-11-09T03:00:00Z") });
  dbs.pedidos.createOrder({ key: "k9", phone: "1", customerId: "9001", name: "X", at: "2026-11-09T12:00:00.000Z", items: [{ id: "A1", qty: 1 }] });
  backupAll(dbs, { dir: respaldos, now: new Date("2026-11-10T03:00:00Z") });
  const c = listarCopias(respaldos);
  assert.deepEqual(c.pedidos.map((x) => x.fecha.slice(0, 8)), ["20261110", "20261109"]); // la más reciente primero
  for (const d of Object.values(dbs)) d.close();
  const r = restaurar({ desde: respaldos, destinos, fecha: "20261109", solo: ["pedidos"], ahora: new Date("2026-11-10T12:00:00Z") });
  assert.equal(r.bases.pedidos.estado, "restaurada");
  const p = openDb(destinos.pedidos);
  assert.equal(p.listOrders({ limit: 100 }).length, 2); // la del día 9, sin el pedido de después
  p.close();
  // lo que había antes de restaurar (3 pedidos) quedó guardado
  const guardada = openDb(path.join(r.carpetaAntes, "pedidos.sqlite"));
  assert.equal(guardada.listOrders({ limit: 100 }).length, 3);
  guardada.close();
});

test("una copia dañada o que no es de esa base se detecta y NO se restaura; lo que hay se queda como está", () => {
  const { dir, destinos, respaldos } = montar();
  const { dbs } = rellenar(destinos);
  backupAll(dbs, { dir: respaldos, now: new Date("2026-11-10T03:00:00Z") });
  for (const d of Object.values(dbs)) d.close();
  const copia = listarCopias(respaldos).pedidos[0].ruta;
  fs.truncateSync(copia, Math.floor(fs.statSync(copia).size / 2)); // copia a medias
  assert.equal(verificarCopia(copia, "pedidos").ok, false);
  fs.copyFileSync(listarCopias(respaldos).cuentas[0].ruta, path.join(respaldos, "clientes-20261111-0300.sqlite")); // fichero de cuentas con nombre de clientes
  assert.match(verificarCopia(path.join(respaldos, "clientes-20261111-0300.sqlite"), "clientes").motivo, /falta la tabla/);
  const tamaño = fs.statSync(destinos.pedidos).size;
  const r = restaurar({ desde: respaldos, destinos, solo: ["pedidos"] });
  assert.equal(r.bases.pedidos.estado, "copia dañada");
  assert.equal(fs.statSync(destinos.pedidos).size, tamaño); // intacta
  assert.equal(restaurar({ desde: path.join(dir, "no-existe"), destinos, solo: ["cuentas"] }).bases.cuentas.estado, "sin copia");
});
