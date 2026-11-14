// Tanda 6: el asistente de pedidos con frases de camarero (varios artículos, erratas, formatos que no existen, recomendaciones sensatas…).
// Catálogo ficticio. Nunca se confirma un pedido solo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleMessage, newSession, setCatalog, setAskDelivery } from "./bot.js";
import { fon, parecido, esPedidoMultiple } from "./pedidolibre.js";

setAskDelivery(true);
const CAT = [
  { id: "R1", name: "COCA COLA LATA 33 CL", price: 0.55, unitsPerBox: 24 },
  { id: "R2", name: "COCA COLA ZERO LATA 33 CL", price: 0.55, unitsPerBox: 24 },
  { id: "R3", name: "COCA COLA LIGHT LATA 33 CL", price: 0.55, unitsPerBox: 24 },
  { id: "A1", name: "AGUA BEZOYA 1,5 L", price: 0.4, unitsPerBox: 6 },
  { id: "A2", name: "AGUA FONT VELLA 1,5 L", price: 0.42, unitsPerBox: 6 },
  { id: "M1", name: "MAHOU 5 ESTRELLAS LATA 33 CL PACK 12", price: 0.99, unitsPerBox: 12 },
  { id: "C0", name: "ESTRELLA GALICIA 0,0 LATA 33 CL", price: 0.7, unitsPerBox: 24 },
  { id: "K1", name: "MOCAY CAFE MOLIDO MEZCLA 250 G", price: 3.1 },
  { id: "B1", name: "BORGES NUEZ GRANO 1KG", price: 9.9 },
  { id: "S1", name: "SERVILLETAS PAPEL 30X30 PAQUETE 100", price: 0.8 },
  { id: "S2", name: "SERVILLETAS BLANCAS 40X40 PAQUETE 50", price: 0.9 },
  { id: "D1", name: "DESENGRASANTE COCINA PLANCHA 750 ML", price: 4.5 },
  { id: "L1", name: "LEJIA CODENIAL 1 LITRO", price: 0.6 },
];
const SIN_DESENGRASANTE = CAT.filter((p) => p.id !== "D1");
const SIN_CERO = CAT.filter((p) => p.id !== "C0");
const cliente = { id: "9001", name: "BAR UNO", address: "Calle Uno 1", phone: "600000001", municipio: "47085", orders: [] };
const NOW = "2026-11-09T08:30:00Z";
const di = (t, s = newSession(cliente, "/catalogo", {}), cat = CAT) => { setCatalog(cat); return handleMessage(s, t, { now: NOW }); };
const carro = (r) => r.session.cart.map((i) => `${i.qty}${i.unit === "caja" ? "c" : ""}×${i.id}`).join(",");
const NO_DISENADO = /No estoy diseñado/;

test("de oído: «kiero», «kajas» y «bezolla» suenan como quiero, cajas y Bezoya", () => {
  assert.equal(fon("kiero"), fon("quiero")); assert.equal(fon("kajas"), fon("cajas")); assert.equal(fon("bezolla"), fon("bezoya"));
  assert.equal(parecido("bezolla", "bezoya"), 1); assert.equal(parecido("agua", "aguas"), 2); assert.equal(parecido("tal", "tallarines"), 0);
});

test("1. «ponme 2 cajas de coca cola y 3 de agua»: no se olvida del agua; pregunta por las dos cosas ambiguas, una detrás de otra, y conserva las cantidades", () => {
  let r = di("ponme 2 cajas de coca cola y 3 de agua");
  assert.match(r.reply, /coca cola/i); assert.match(r.reply, /agua/i); // las dos dudas a la vista
  assert.equal(r.ui.rows.length, 3); // primero las 3 Coca-Colas
  assert.equal(r.session.pendientes.length, 1); // y queda el agua
  r = handleMessage(r.session, "p:R1", { now: NOW });
  assert.equal(carro(r), "2c×R1"); // 2 cajas de la elegida
  assert.deepEqual(r.ui.rows.map((x) => x.id).sort(), ["p:A1", "p:A2"]); // ahora el agua
  r = handleMessage(r.session, "p:A1", { now: NOW });
  assert.equal(carro(r), "2c×R1,3c×A1"); // «3 de agua» heredó las cajas
  assert.equal(r.order, undefined);
});

test("2. «2 barriles de mahou»: no existe el barril → no añade otro formato, lo dice y ofrece alternativas", () => {
  const r = di("2 barriles de mahou");
  assert.equal(r.session.cart.length, 0);
  assert.match(r.reply, /no vendemos eso en barril/);
  assert.match(r.reply, /MAHOU 5 ESTRELLAS/); // alternativa ofrecida, no añadida
  assert.equal(r.ui.type, "multi");
});

test("3. «café en grano 1kg»: no lo empareja con «BORGES NUEZ GRANO 1KG» (el café manda, no «grano» o «1kg» sueltos)", () => {
  for (const cat of [CAT, CAT.filter((p) => p.id !== "K1")]) {
    const r = di("café en grano 1kg", undefined, cat);
    assert.equal(r.session.cart.length, 0);
    assert.ok(!/BORGES/.test(r.reply), r.reply);
    assert.ok(!(r.ui?.rows ?? []).some((x) => x.id === "p:B1"));
  }
});

test("4. «algo para limpiar la plancha»: un desengrasante, nunca lejía; sin desengrasante pregunta", () => {
  let r = di("algo para limpiar la plancha");
  assert.match(r.reply, /DESENGRASANTE/); assert.ok(!/LEJIA/i.test(r.reply)); assert.deepEqual(r.ui.rows.map((x) => x.id), ["p:D1"]);
  r = di("algo para limpiar la plancha", undefined, SIN_DESENGRASANTE);
  assert.ok(!/LEJIA/i.test(r.reply)); assert.match(r.reply, /persona|marca/); assert.equal(r.session.cart.length, 0);
});

test("5. pedido largo en un solo mensaje: añade lo claro, lista las dudas y da el total, sin confirmar", () => {
  const r = di("3 cajas de agua Bezoya, 2 cajas de Coca-Cola normal, una caja de cerveza sin alcohol, 2 barriles de Mahou, 1 kg de café en grano, servilletas y algo para limpiar la plancha; dime el total, pero no confirmes");
  assert.equal(carro(r), "3c×A1,2c×R1,1c×C0"); // lo claro
  assert.match(r.reply, /Total con IVA/); // el total de lo anotado
  assert.match(r.reply, /barril/); assert.match(r.reply, /caf[eé] en grano/i); assert.match(r.reply, /servilletas/i); assert.match(r.reply, /plancha/i); // las dudas
  assert.ok(!/LEJIA/i.test(r.reply));
  assert.match(r.reply, /No he confirmado nada/);
  assert.equal(r.order, undefined);
  assert.equal(r.session.state === "confirm", false);
});

test("6. «una caja de cerveza sin alcohol»: busca en el catálogo; si no hay, pregunta la marca (sin añadir ni rechazar)", () => {
  let r = di("una caja de cerveza sin alcohol");
  assert.equal(carro(r), "1c×C0");
  r = di("una caja de cerveza sin alcohol", undefined, SIN_CERO);
  assert.equal(r.session.cart.length, 0); assert.doesNotMatch(r.reply, NO_DISENADO);
  assert.match(r.reply, /sin alcohol/); assert.ok(r.ui.rows.length >= 1);
});

test("7. «kiero 3 kajas de agua bezolla»: tolera erratas y confirma la marca antes de añadir", () => {
  let r = di("kiero 3 kajas de agua bezolla");
  assert.equal(r.session.cart.length, 0); assert.doesNotMatch(r.reply, NO_DISENADO);
  assert.match(r.reply, /BEZOYA/); assert.deepEqual(r.ui.rows.map((x) => x.id), ["p:A1"]);
  r = handleMessage(r.session, "p:A1", { now: NOW });
  assert.equal(carro(r), "3c×A1");
});

test("8. «¿cuánto llevo?»: dice los artículos y el importe (y si no hay nada, también)", () => {
  let r = di("¿cuánto llevo?");
  assert.match(r.reply, /Todavía no has añadido nada/);
  r = di("2 cajas de agua bezoya");
  r = handleMessage(r.session, "¿cuánto llevo?", { now: NOW });
  assert.match(r.reply, /AGUA BEZOYA/); assert.match(r.reply, /Total con IVA/); assert.doesNotMatch(r.reply, NO_DISENADO);
});

test("9. «¿hacéis factura?»: responde (a quién llamar) sin inventar la política; la hora de entrega sigue respondiendo", () => {
  const r = di("¿hacéis factura?");
  assert.doesNotMatch(r.reply, NO_DISENADO); assert.match(r.reply, /factura/i); assert.match(r.reply, /oficina|persona/);
  assert.match(di("¿a qué hora llega el pedido?").reply, /Repartimos/);
});

test("10. un emoji suelto: 🍺 se entiende como cerveza; uno que no conocemos recibe una respuesta amable", () => {
  const r = di("🍺");
  assert.doesNotMatch(r.reply, NO_DISENADO); assert.ok(r.ui?.rows?.length); // enseña las cervezas
  const x = di("🚀"); assert.doesNotMatch(x.reply, NO_DISENADO); assert.match(x.reply, /con palabras/);
});

test("11. pantalla: el mensaje propio conserva el emoji y una respuesta larga se lee desde su principio", () => {
  const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(h, /clase === "in" \? sinEmoji\(esc\) : esc/);
  assert.match(h, /function alFinal\(\)/); assert.match(h, /ancla/);
});

test("lo que ya funcionaba sigue igual: «lo de siempre», «azucar», «servilletas», «quita el agua» sin borrador y nunca confirma solo", () => {
  setCatalog(CAT);
  const conPedido = { ...cliente, orders: [{ doc: "A", date: "2026-10-20", lines: [{ productId: "A1", qty: 12 }] }] };
  let r = di("lo de siempre", newSession(conPedido, "/catalogo", {}));
  assert.equal(r.session.cart.length, 0);
  r = di("servilletas"); assert.equal(r.ui.rows.length, 2); assert.equal(r.session.cart.length, 0);
  r = di("quita el agua"); assert.equal(r.session.cart.length, 0);
  assert.equal(esPedidoMultiple("hola buenas"), false);
  assert.equal(esPedidoMultiple("¿qué me sirve para un bar de tapas?"), false);
});
