// Tanda 16 y Bench 1: instalar la app, estáticos, textos de configuración, títulos…
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { limpiaTextoEnv, condicionesPedido, BUSINESS } from "./config.js";
import { privacidadHtml } from "./privacidad.js";
import { responder } from "./asistente.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cli = leer("./cliente.html"), ped = leer("./pedido.html");

test("Bench 1.1: textos de configuración con la codificación mal («Valent??n», «ValentÃ­n») se reparan o se descartan; el aviso de privacidad sale con tildes", () => {
  assert.equal(limpiaTextoEnv("Valent??n Mart??n"), ""); assert.equal(limpiaTextoEnv("Valent�n"), ""); assert.equal(limpiaTextoEnv("ValentÃ­n"), "Valentín");
  assert.equal(limpiaTextoEnv("  Distribuciones Valentín Martín "), "Distribuciones Valentín Martín"); assert.equal(limpiaTextoEnv("¿Quieres algo?"), "¿Quieres algo?"); assert.equal(limpiaTextoEnv(undefined), "");
  const t = privacidadHtml({ titular: undefined }); assert.match(t, /Distribuciones Valentín Martín/); assert.equal((t.match(/\?\?/g) ?? []).length, 0);
  const sinEscapes = cli.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""); assert.equal((sinEscapes.match(/\?\?/g) ?? []).length, 0);
});
test("T16 5-8: manifest con id y capturas, iconos separados, favicon y un solo formato de título", () => {
  const m = JSON.parse(leer("./pwa/manifest.webmanifest")); assert.equal(m.id, "/cliente"); assert.equal(m.icons.length, 4);
  for (const i of m.icons) assert.ok(["any", "maskable"].includes(i.purpose));
  for (const f of ["icono-maskable-192.png", "icono-maskable-512.png", "captura-estrecha.png", "captura-ancha.png"]) assert.ok(fs.existsSync(new URL("./pwa/" + f, import.meta.url)), f);
  for (const h of [cli, ped]) { assert.match(h, /<link rel="icon" href="\/favicon\.ico"/); assert.match(h, /<link rel="apple-touch-icon"/); assert.match(h, /<title>[^<]+ · Distribuciones VM<\/title>/); }
  assert.match(ped, /document\.title = titulo \+ " · Distribuciones VM"/); assert.doesNotMatch(ped, /document\.title = "Pedido a "/);
});
test("T16 4: «Instalar la app» en el menú ⋯ y en Inicio, con el aviso del navegador o instrucciones (también iPhone)", () => {
  assert.match(cli, /id="instalar-menu">Instalar la app</); assert.match(cli, /"Instala la app en tu móvil"/); assert.match(cli, /async function abrirInstalar\(\)/);
  assert.match(cli, /instalacion\.prompt\(\)/); assert.match(cli, /Añadir a pantalla de inicio/); assert.match(cli, /Compartir/); assert.match(cli, /if \(!yaInstalada\(\)\)/);
});
test("T16 9: «¿cuál es el horario de reparto?» responde con los días de reparto (y HORARIO_REPARTO si está configurado)", () => {
  const ctx = { catalogo: [], cliente: {}, ahora: "2026-11-09T08:30:00Z" };
  for (const t of ["¿Cuál es el horario de reparto?", "horario de entrega", "¿qué días repartís?"]) assert.match(responder(t, ctx).reply, /Repartimos de lunes a viernes/, t);
  assert.match(responder("horario de reparto", { ...ctx, horarioReparto: "Lunes a viernes, de 8:00 a 14:00" }).reply, /Horario de reparto: Lunes a viernes, de 8:00 a 14:00/);
});
test("Bench 1.9: texto de precios sin contradicción", () => {
  assert.equal(BUSINESS.priceNote, "Precios sin IVA; abajo tienes el total con IVA. Los confirmamos al preparar el pedido.");
  assert.match(ped, /\$\("priceNote"\)\.textContent = data\.priceNote \|\| ""/); assert.equal(condicionesPedido().minimo >= 0, true);
});
