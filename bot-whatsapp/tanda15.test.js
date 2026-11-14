// Tanda 15: contraste del tema oscuro y contraste alto. Tanda 10/15: /health con commit y fecha.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { estadoVersion } from "./version.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const htmls = { "cliente.html": leer("./cliente.html"), "pedido.html": leer("./pedido.html") };

const parse = (c) => { c = c.trim(); if (c[0] === "#") { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 1]; } const m = c.match(/rgba?\(([^)]+)\)/); const v = m[1].split(",").map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; };
const sobre = (f, b) => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1];
const lum = (c) => { const f = (x) => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const razon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const tokens = (bloque) => Object.fromEntries([...bloque.matchAll(/--([\w-]+):\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));

for (const [nombre, h] of Object.entries(htmls)) {
  test(`${nombre}: tema oscuro con contraste ≥ 4,5:1 (rojo sobre granate, gris sobre gris, texto sobre verde, botones de la cabecera)`, () => {
    const t15 = h.slice(h.indexOf("Tanda 15: contraste del tema oscuro"));
    const base = tokens(h.match(/:root\[data-tema="oscuro"\] \{[^}]*\}/)[0]); // lo definido para el oscuro…
    const d = { ...base, ...tokens(t15.match(/:root\[data-tema="oscuro"\] \{[^}]*\}/)[0]) }; // …y lo que corrige la tanda 15
    const surf = parse(d.surface), bg = parse(d.bg), fill = parse(d.fill), acc = parse(d.accent);
    const soft = sobre(parse(d["accent-soft"]), surf), campo = sobre(parse(d.field), bg);
    const pares = [["rojo sobre granate", acc, soft], ["rojo sobre fondo", acc, surf], ["gris sobre superficie", parse(d["text-2"]), surf], ["gris sobre relleno", parse(d["text-2"]), fill], ["gris sobre campo", parse(d["text-2"]), campo], ["texto sobre campo", parse(d.text), campo], ["texto sobre verde", parse(d["on-ok"]), parse(d.ok)], ["pestañas", parse(d["tab-off"]), surf]];
    for (const [n, a, b] of pares) assert.ok(razon(a, b) >= 4.5, `${n}: ${razon(a, b).toFixed(2)}`);
    assert.ok(razon(parse("#B30D28"), parse("#FFFFFF")) >= 4.5); // icono rojo del botón blanco de la cabecera
    assert.ok(razon(parse("#FFFFFF"), parse("#C8102E")) >= 3); // y el botón blanco se distingue de la barra roja (3:1 en elementos que no son texto)
    assert.match(t15, /:root\[data-tema="oscuro"\] \.bar \.ds-circ, :root\[data-tema="oscuro"\] header \.ds-circ, :root\[data-tema="oscuro"\] \.letra \.letra-bt \{ background:#FFFFFF; color:#B30D28/);
    assert.match(t15, /input::placeholder, textarea::placeholder \{ color:var\(--text-2\); opacity:1; \}/); // el texto de ayuda del buscador legible
  });
  test(`${nombre}: contraste alto (opción en Ayuda, recordada, y preferencia del móvil) con razones muy altas`, () => {
    assert.match(h, /data-contraste/); assert.match(h, /Contraste alto \(textos y bordes más marcados\)/); assert.match(h, /localStorage\.setItem\("vm:contraste"/);
    assert.match(h, /@media \(prefers-contrast: more\) and \(prefers-color-scheme: dark\)/);
    const alto = tokens(h.match(/:root\[data-contraste="alto"\] \{[^}]*\}/)[0]), altoO = tokens(h.match(/:root\[data-contraste="alto"\]\[data-tema="oscuro"\] \{[^}]*\}/)[0]);
    assert.ok(razon(parse(alto.text), parse("#FFFFFF")) >= 7); assert.ok(razon(parse(alto["text-2"]), parse("#FFFFFF")) >= 7); assert.ok(razon(parse(alto.accent), parse("#FFFFFF")) >= 7);
    const sOsc = parse("#1C1C1E"); assert.ok(razon(parse(altoO.text), sOsc) >= 7); assert.ok(razon(parse(altoO["text-2"]), sOsc) >= 7); assert.ok(razon(parse(altoO.accent), sOsc) >= 7);
  });
}
test("/health dice el commit en marcha, su fecha, cuándo se puso en marcha y el commit que hay en el disco", () => {
  const e = estadoVersion();
  for (const k of ["version", "commitFecha", "desplegado", "enDisco", "reinicioPendiente"]) assert.ok(k in e, k);
  assert.match(e.desplegado, /^\d{4}-\d{2}-\d{2}T/); if (e.commitFecha) assert.match(e.commitFecha, /^\d{4}-\d{2}-\d{2}T/);
});
test("las pruebas que leen archivos del programa no se rompen con saltos de línea de Windows (CRLF)", () => {
  for (const f of fs.readdirSync(new URL(".", import.meta.url)).filter((x) => x.endsWith(".test.js") && x !== "tanda15.test.js")) {
    const src = fs.readFileSync(new URL("./" + f, import.meta.url), "utf8");
    for (const m of src.matchAll(/readFileSync\(new URL\([^;]*?, "utf8"\)(?!\.replace\(\/\\r)/g)) assert.fail(`${f}: lee un archivo del programa sin normalizar CRLF → ${m[0].slice(0, 80)}`);
  }
});
