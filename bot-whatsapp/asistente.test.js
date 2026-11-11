// El asistente del chat: contesta preguntas sobre cómo usar la aplicación y recomienda productos del catálogo (sin IA externa).
import test from "node:test";
import assert from "node:assert/strict";
import { handleMessage, newSession, setCatalog, setAskDelivery } from "./bot.js";
import { responder, buscar, conceptosDe, precioMaximoDe, pedidoDesdeFrase } from "./asistente.js";
import { AVISO_HOY } from "./delivery.js";

setAskDelivery(true);
const CATALOGO = [
  { id: "V1", name: "VINO TINTO JOVEN RIOJA 75 CL", price: 3.2, unitsPerBox: 6 },
  { id: "V2", name: "VINO TINTO CRIANZA RIBERA 75 CL", price: 6.9, unitsPerBox: 6 },
  { id: "V3", name: "VINO BLANCO VERDEJO RUEDA 75 CL", price: 4.1, unitsPerBox: 6 },
  { id: "V4", name: "VINO ROSADO NAVARRA 75 CL", price: 3.0, unitsPerBox: 6 },
  { id: "V5", name: "CAVA BRUT NATURE 75 CL", price: 5.5, unitsPerBox: 6 },
  { id: "C1", name: "CERVEZA MAHOU CINCO ESTRELLAS LATA 33 CL", price: 0.62, unitsPerBox: 24 },
  { id: "C2", name: "CERVEZA SIN ALCOHOL ESTRELLA GALICIA 0,0 33 CL", price: 0.7, unitsPerBox: 24 },
  { id: "A1", name: "AGUA MINERAL 1,5 L", price: 0.4, unitsPerBox: 6 },
  { id: "A2", name: "AGUA CON GAS 33 CL", price: 0.5, unitsPerBox: 24 },
  { id: "R1", name: "COCA-COLA ZERO LATA 33 CL", price: 0.55, unitsPerBox: 24 },
  { id: "K1", name: "CAFE EN GRANO NATURAL 1 KG", price: 11.5 },
  { id: "K2", name: "CAFE MOLIDO MEZCLA 250 GR", price: 3.1 },
  { id: "L1", name: "LECHE ENTERA PASCUAL BRIK 1 L", price: 0.9, unitsPerBox: 6 },
  { id: "P1", name: "PATATAS FRITAS LISAS BOLSA 140 GR", price: 1.3, unitsPerBox: 12 },
  { id: "S1", name: "SERVILLETAS PAPEL 30X30 PAQUETE 100", price: 0.8 },
  { id: "H1", name: "HIELO EN CUBITOS BOLSA 2 KG", price: 1.9 },
];
setCatalog(CATALOGO);
const medina = { id: "9001", name: "BAR UNO", address: "Calle Uno 1", phone: "600000001", municipio: "47085", city: "MEDINA DEL CAMPO", orders: [{ doc: "A", date: "2026-10-20", lines: [{ productId: "V1", qty: 12 }, { productId: "C1", qty: 24 }] }] };
const tordesillas = { ...medina, id: "9002", municipio: "47186", city: "TORDESILLAS" };
const sinPedidos = { ...medina, id: "9003", orders: [] };
const LUNES_930 = "2026-11-09T08:30:00Z", LUNES_1100 = "2026-11-09T10:00:00Z";
const di = (cliente, texto, now = LUNES_930, s = newSession(cliente, "/catalogo")) => handleMessage(s, texto, { now });

test("«¿cómo hago un pedido?»: explica los pasos y ofrece abrir el catálogo", () => {
  for (const t of ["¿Cómo hago un pedido?", "como puedo pedir", "cómo funciona esto", "ayuda", "como compro"]) {
    const r = di(medina, t);
    assert.match(r.reply, /Hacer un pedido es muy fácil/, t);
    assert.match(r.reply, /Hacer pedido/);
    assert.equal(r.ui.type, "link");
    assert.equal(r.session.cart.length, 0, "no apunta nada");
  }
  assert.match(di(medina, "como hago un pedido", LUNES_930).reply, new RegExp(AVISO_HOY.replace(/[.]/g, "\\.")), "a las 9:30, cliente de Medina: también el aviso de hoy");
  assert.doesNotMatch(di(medina, "como hago un pedido", LUNES_1100).reply, /10:00/, "a las 11:00 ya no se dice");
  assert.doesNotMatch(di(tordesillas, "como hago un pedido", LUNES_930).reply, /10:00/, "otro municipio: nunca");
});

test("«¿puedo repetir el último pedido?»: dice que sí, con el botón «Repetir y revisar» que abre el catálogo con ese pedido puesto", () => {
  for (const t of ["¿Puedo repetir el último pedido?", "puedo repetir mi pedido de siempre", "lo de siempre", "quiero repetir el pedido anterior"]) {
    const r = di(medina, t);
    assert.match(r.reply, /Repetir y revisar/, t);
    assert.equal(r.ui.type, "link");
    assert.equal(r.ui.title, "Repetir y revisar");
    assert.match(r.ui.url, /^\/catalogo#c=V1\.12,C1\.24&r=1$/); // las líneas del último pedido, en unidades, y la marca para medir el uso
    assert.equal(r.session.cart.length, 0);
  }
  assert.match(di(sinPedidos, "puedo repetir el último pedido").reply, /Todavía no tengo pedidos tuyos/);
});

test("contraseña y datos: dice dónde se cambia la contraseña y dónde se descargan o eliminan los datos", () => {
  for (const t of ["¿Cómo puedo cambiar la contraseña?", "quiero cambiar mi clave", "he olvidado la contraseña", "como cambio el pin"]) assert.match(di(medina, t).reply, /menú ⋮.*Cambiar contraseña/s, t);
  for (const t of ["como elimino mi cuenta", "quiero borrar mis datos", "puedo descargar mis datos", "quiero darme de baja"]) assert.match(di(medina, t).reply, /Mis datos y privacidad/, t);
});

test("entrega: contesta con la regla real del día y la hora (la misma que la opción «Hoy»)", () => {
  assert.match(di(medina, "¿me lo podéis entregar hoy?", LUNES_930).reply, /Si haces el pedido antes de las 10:00, te lo entregamos hoy/);
  const tarde = di(medina, "¿me lo podéis entregar hoy?", LUNES_1100).reply;
  assert.match(tarde, /Hoy ya no llegamos/); assert.match(tarde, /martes/);
  const otro = di(tordesillas, "¿cuándo me llega el pedido?", LUNES_930).reply;
  assert.doesNotMatch(otro, /10:00/); assert.match(otro, /martes/);
  assert.match(di(medina, "¿repartís los sábados?", "2026-11-14T08:00:00Z").reply, /lunes a viernes/);
});

test("cajas e IVA: explica la diferencia y, si nombra un producto, cuántas unidades trae la caja", () => {
  assert.match(di(medina, "¿qué diferencia hay entre cajas y unidades?").reply, /cajas/i);
  const r = di(medina, "¿cuántas unidades trae una caja de cerveza mahou?").reply;
  assert.match(r, /cajas de 24 unidades/); assert.match(r, /MAHOU/);
  assert.match(di(medina, "¿los precios llevan IVA?").reply, /sin IVA/);
});

test("añadir al carrito escribiendo: «añádeme al carro 2 cajas de agua y 6 cervezas»", () => {
  assert.equal(pedidoDesdeFrase("añádeme al carro 2 cajas de agua y 3 cervezas en cajas"), "2 cajas de agua, 3 cajas cervezas");
  assert.equal(pedidoDesdeFrase("2 aguas"), null, "sin verbo lo sigue anotando el chat de siempre");
  let r = di(medina, "añádeme al carro 2 cajas de agua mineral y 6 cervezas mahou");
  assert.deepEqual(r.session.cart.map((i) => [i.id, i.qty, i.unit]), [["A1", 2, "caja"]]); // lo claro se anota…
  assert.equal(r.session.askUnit[0].id, "C1"); // …y la cerveza, que se vende en cajas y no dijo cuál, se pregunta («¿cajas o unidades?»), como siempre
  r = di(medina, "ponme 3 de leche entera en cajas");
  assert.deepEqual(r.session.cart.map((i) => [i.id, i.qty, i.unit]), [["L1", 3, "caja"]]);
});

test("recomendaciones: vino con características, precio máximo y «el más barato»", () => {
  const ids = (t) => buscar(t, CATALOGO, { habituales: new Set() }).map((p) => p.id);
  assert.equal(ids("vino tinto joven")[0], "V1");
  assert.deepEqual(ids("vino tinto crianza").slice(0, 1), ["V2"]);
  assert.equal(ids("vino blanco verdejo")[0], "V3");
  assert.equal(ids("un cava")[0], "V5");
  assert.equal(ids("cerveza sin alcohol")[0], "C2");
  assert.equal(precioMaximoDe("un vino tinto por menos de 4 euros"), 4);
  assert.equal(precioMaximoDe("vino máximo 5,50 €"), 5.5);
  const r = responder("¿qué vino me recomiendas por menos de 4 euros?", { catalogo: CATALOGO, cliente: medina, ahora: LUNES_930, habituales: new Set() });
  assert.ok(r.productos.length >= 1 && r.productos.every((p) => p.price <= 4), "todos por debajo del precio pedido");
  const barato = responder("¿cuál es el vino más barato?", { catalogo: CATALOGO, cliente: medina, ahora: LUNES_930, habituales: new Set() });
  assert.equal(barato.productos[0].id, "V4"); // el más barato de los vinos
  assert.deepEqual(conceptosDe("¿Qué vino tinto joven me recomiendas?"), ["vino", "tinto", "joven"]);
});

test("recomendar y añadir: lista con botones para añadir, «añade el segundo» y lo que ya compra va primero", () => {
  let r = di(medina, "¿Qué vino tinto joven me recomiendas?");
  assert.match(r.reply, /Esto es lo que mejor encaja/);
  assert.equal(r.ui.type, "multi");
  assert.equal(r.ui.rows[0].id, "p:V1"); // el que ya compra (V1) primero
  assert.ok(r.ui.rows.every((x) => /^p:/.test(x.id) && x.title.length <= 24 && x.description.length <= 72));
  assert.equal(r.session.cart.length, 0, "recomendar no apunta nada solo");
  // «añade el segundo» sobre la última recomendación → pregunta cuántas cajas o unidades (el artículo se vende en cajas)
  const sig = di(medina, "añade el segundo", LUNES_930, r.session);
  assert.match(sig.reply, /cajas|unidades/i);
  assert.equal(sig.session.askUnit?.[0]?.id ?? sig.session.pick?.id, r.ui.rows[1].id.slice(2));
  // elegir de la lista (p:V1) sigue el camino de siempre
  assert.match(di(medina, "p:V1", LUNES_930, r.session).reply, /V|VINO/i);
  // varios marcados con las casillas (ps:v1,v2 → llegan en minúsculas): 1 caja de cada uno al carrito
  const dos = di(medina, "ps:" + r.ui.rows.slice(0, 2).map((x) => x.id.slice(2).toLowerCase()).join(","), LUNES_930, r.session);
  assert.match(dos.reply, /Anotado/);
  assert.equal(dos.session.cart.length, 2);
  assert.ok(dos.session.cart.every((i) => i.qty === 1));
});

test("necesidades y negocios: «¿qué me sirve para un bar de tapas?» recomienda por tipos de producto", () => {
  const r = di(medina, "¿Qué me sirve para un bar de tapas?");
  assert.match(r.reply, /Para un bar de tapas/);
  assert.equal(r.ui.type, "multi");
  const ids = r.ui.rows.map((x) => x.id.slice(2));
  assert.ok(ids.includes("C1") && ids.includes("P1") && ids.includes("S1"), "cerveza, patatas y servilletas: " + ids);
  assert.match(di(medina, "teneis algún producto para una cafetería de desayunos").reply, /cafetería/);
  const cafe = di(medina, "¿tenéis café en grano?");
  assert.equal(cafe.ui.rows[0].id, "p:K1");
});

test("precios y existencias: «¿cuánto vale la cerveza?» y lo que no existe se dice claro", () => {
  const r = di(medina, "¿cuánto vale la cerveza?");
  assert.match(r.reply, /CERVEZA/); assert.equal(r.ui.type, "multi");
  const nada = di(medina, "¿tenéis caviar beluga?");
  assert.match(nada.reply, /No encuentro nada/); assert.equal(nada.session.cart.length, 0);
});

test("lo que no es del negocio sigue sin responderse, y un cliente sin verificar no recibe recomendaciones ni datos", () => {
  for (const t of ["qué tal", "gracias", "buenas tardes", "quiero hablar", "blablabla"]) assert.match(di(medina, t).reply, /No estoy diseñado/, t);
  const ajeno = newSession({ ...medina }, "/catalogo", { identify: true, holdUnverified: true });
  ajeno.unverified = true;
  assert.doesNotMatch(handleMessage(ajeno, "¿qué vino tinto me recomiendas?", { now: LUNES_930 }).reply ?? "", /Esto es lo que mejor encaja/);
});
