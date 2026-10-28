import test from "node:test";
import assert from "node:assert/strict";
import { makeToken, readToken } from "./links.js";
import { handleMessage, newSession } from "./bot.js";

test("el enlace válido devuelve teléfono y cliente", () => {
  const t = readToken(makeToken("34600111222", "5900"));
  assert.equal(t.p, "34600111222");
  assert.equal(t.c, "5900");
});

test("un enlace manipulado o inventado no vale", () => {
  const t = makeToken("34600111222", "5900");
  const [data, sig] = t.split(".");
  const otro = Buffer.from(JSON.stringify({ p: "34699999999", c: "1", e: Date.now() + 1e9, n: "x" })).toString("base64url");
  assert.equal(readToken(`${otro}.${sig}`), null); // misma firma, otro contenido
  assert.equal(readToken(`${data}.${sig.slice(0, -2)}AA`), null); // firma alterada
  assert.equal(readToken("basura"), null);
  assert.equal(readToken(""), null);
});

test("el enlace caduca a las 24 horas", () => {
  const ahora = Date.now();
  const t = makeToken("34600111222", "5900", ahora);
  assert.ok(readToken(t, ahora + 23 * 3600e3));
  assert.equal(readToken(t, ahora + 25 * 3600e3), null);
});

test("el saludo del cliente conocido ofrece el botón de enlace; sin enlace, la lista", () => {
  const cliente = { id: "1", name: "Bar", address: "x", orders: [{ doc: "A", date: "2026-01-01", lines: [{ productId: 1, qty: 3 }] }] };
  let r = handleMessage(newSession(cliente, "https://x.test/pedido/abc"), "hola");
  assert.deepEqual(r.ui, { type: "link", title: "Hacer pedido", url: "https://x.test/pedido/abc" });
  assert.ok(r.ui.title.length <= 20);
  r = handleMessage(r.session, "lista"); // sigue pudiendo pedir dentro del chat
  assert.equal(r.ui.type, "list");
  assert.equal(handleMessage(newSession(cliente), "hola").ui.type, "list");
  // el enlace se conserva al volver al menú o cancelar
  const r2 = handleMessage(handleMessage(newSession(cliente, "https://x.test/pedido/abc"), "p:1").session, "cancelar");
  assert.equal(r2.session.link, "https://x.test/pedido/abc");
});
