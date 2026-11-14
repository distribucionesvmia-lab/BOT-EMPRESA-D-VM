// Tanda 18: «Tu pedido de siempre» (portada) se puede editar, borrar y recuperar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openAccountsDb } from "./cuentas-db.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const c = leer("./cliente.html");

test("la tarjeta tiene «Editar» y «Borrar», con ventana propia (cierra con Esc/Atrás) y sin confirm()", () => {
  assert.match(c, /el\("button", "vm-btn ghost", "Editar"\)[\s\S]{0,80}el\("button", "vm-btn ghost", "Borrar"\)/);
  assert.match(c, /id="m-siempre" hidden/); // las .vm-modal las cierran Escape, tocar fuera y «Atrás»
  assert.match(c, /async function abrirSiempre\(modo\)/);
  const f = c.slice(c.indexOf("async function abrirSiempre"), c.indexOf('$("s-x").onclick'));
  assert.equal(/\bconfirm\(/.test(f), false); // pregunta con la propia ventana
  assert.match(f, /Sí, borrar/); assert.match(f, /No, dejarlo como está/);
  assert.match(c, /Volver a mostrar mi último pedido/); // el borrado se puede deshacer
  assert.match(c, /Esto solo cambia lo que ves en tu pantalla de inicio\. No envía ningún pedido/);
  assert.match(c, /#s-cuerpo \.s-ctl button \{ min-width:44px; min-height:44px;/); // toques de 44 px
});

test("cuentas-db: editar, borrar y restaurar el pedido de siempre, y se borra con la cuenta", () => {
  const db = openAccountsDb(":memory:");
  assert.equal(db.getUsual("1"), null);
  assert.equal(db.setUsual("1", []), false); // vacío no vale
  assert.equal(db.setUsual("1", [{ id: 5, qty: 2.9, unit: "caja" }, { id: "6", qty: 0 }, { id: "", qty: 1 }, { id: "7", qty: 5000 }]), true);
  assert.deepEqual(db.getUsual("1"), { hidden: false, lines: [{ id: "5", qty: 2, unit: "caja" }, { id: "6", qty: 1, unit: "ud" }, { id: "7", qty: 999, unit: "ud" }] });
  db.hideUsual("1"); assert.deepEqual(db.getUsual("1"), { hidden: true, lines: [] });
  db.setUsual("1", [{ id: "5", qty: 1 }]); assert.equal(db.getUsual("1").hidden, false); // editar de nuevo lo vuelve a mostrar
  assert.equal(db.getUsual("2"), null); // otro cliente, intacto
  assert.equal(db.resetUsual("1"), true); assert.equal(db.getUsual("1"), null);
  assert.match(leer("./cuentas-db.js"), /DELETE FROM usual_orders WHERE customer_id/); // al eliminar la cuenta
});
