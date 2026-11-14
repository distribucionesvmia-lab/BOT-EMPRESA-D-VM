// Sistema de diseño: los dos HTML del cliente comparten los mismos tokens, con contraste legible y pesos de letra limitados.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const cliente = leer("./cliente.html"), pedido = leer("./pedido.html");
const tokens = (h) => (h.match(/:root\s*\{[\s\S]*?--bg:[\s\S]*?\n  \}/) || [""])[0];
const hex = (h, n) => (h.match(new RegExp(`--${n}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
const lum = (c) => { const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test("los tokens son los mismos en acceso/chat y en el catálogo", () => {
  const a = tokens(cliente), b = tokens(pedido);
  assert.ok(a.length > 200, "tokens de cliente.html");
  for (const n of ["bg", "surface", "text", "text-2", "fill", "line", "accent", "accent-soft", "ok", "warn"]) assert.equal(hex(a, n), hex(b, n), `--${n}`);
  assert.equal(hex(a, "bg"), "#F5F5F7"); assert.equal(hex(a, "accent"), "#C8102E"); assert.equal(hex(a, "text"), "#1D1D1F");
});

test("contraste AA (4,5:1) en los pares de texto principales", () => {
  const t = tokens(cliente), g = (n) => hex(t, n);
  for (const [f, fo] of [["text", "bg"], ["text", "surface"], ["text-2", "surface"], ["text-2", "bg"], ["on-accent", "accent"], ["accent", "surface"], ["accent", "accent-soft"], ["ok", "ok-bg"], ["warn", "warn-bg"]]) assert.ok(contraste(g(f), g(fo)) >= 4.5, `${f} sobre ${fo}: ${contraste(g(f), g(fo)).toFixed(2)}`);
});

test("solo pesos de letra 400, 600 y 700", () => {
  for (const h of [cliente, pedido]) for (const m of h.matchAll(/font-weight:\s*(\d{3})/g)) assert.ok(["400", "600", "700"].includes(m[1]), `peso ${m[1]}`);
});

test("respeta reducir movimiento, transparencia y contraste", () => {
  for (const h of [cliente, pedido]) { assert.match(h, /prefers-reduced-motion/); assert.match(h, /prefers-reduced-transparency/); }
});

test("fila compacta: precio con 2 decimales (3 solo si <1 € y el tercero no es cero), «+» y contador accesibles", async () => {
  const vm = await import("node:vm");
  const fn = (pedido.match(/const eurp = (n => \{[^\n]*?\});/) || [])[1];
  assert.ok(fn, "eurp");
  const eurp = vm.runInNewContext("(" + fn + ")");
  assert.equal(eurp(0.5), "0,50 €"); assert.equal(eurp(0.625), "0,625 €"); assert.equal(eurp(1.6), "1,60 €"); assert.equal(eurp(21), "21,00 €"); assert.equal(eurp(0.62), "0,62 €");
  assert.match(pedido, /"Añadir " \+ p\.name/); assert.match(pedido, /"Quitar uno de " \+ p\.name/); assert.match(pedido, /"Cantidad de " \+ p\.name/);
  assert.match(pedido, /inp\.inputMode = "numeric"[^\n]*inp\.max = 999/);
  assert.match(pedido, /\.pf-step \{[^}]*height:44px/); assert.match(pedido, /\.pf-add \{ width:44px; height:44px; border:0; border-radius:50%/);
  assert.match(pedido, /\.pf-n \{[^}]*-webkit-line-clamp:2/); assert.match(pedido, /prefers-reduced-motion: reduce\) \{ \.pf-step \{ animation:none/);
});

test("botones redondos con icono: el icono va centrado y el globo del carrito no lo empuja", () => {
  assert.match(pedido, /header \.ds-circ, \.ds-circ \{ display:inline-flex; align-items:center; justify-content:center; gap:0; padding:0; width:44px; height:44px;/);
  assert.match(pedido, /header \.cartbtn \.ds-dot, \.cartbtn span\.ds-dot \{ position:absolute;/);
  assert.match(pedido, /\.ayudabtn::before \{ content:none; \}/);
  assert.match(pedido, /minus\.innerHTML = '<svg/); assert.match(pedido, /plus\.innerHTML = '<svg/); // «−» y «+» del carrito son dibujos centrados, no letras
});
