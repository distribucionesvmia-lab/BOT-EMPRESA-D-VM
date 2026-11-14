// Bench 3: diseño visual II (que se entienda).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lineaPdf, pdfPedido, datosPdf } from "./pdf.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const p = leer("./pedido.html"), c = leer("./cliente.html");
const limpiarNombre = new Function(p.match(/const SIGLAS = [^\n]+\n/)[0] + p.match(/function limpiarNombre\(n\) \{[\s\S]*?\n\}\n/)[0] + "return limpiarNombre;")();

test("Tanda 2 (cierre): «Imagen orientativa» en #6E6E73 (≥ 4,5:1 en claro) y los nombres largos salen en 3 líneas con puntos suspensivos", () => {
  assert.match(p, /:root \{ --gris-suave:#6E6E73; \}/); assert.match(p, /#zoomFoto \.zia, \.ficha-ia \{ color:var\(--gris-suave\); \}/);
  const lum = (h) => { const n = parseInt(h.slice(1), 16), f = (x) => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(n >> 16 & 255) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  assert.ok((lum("#FFFFFF") + .05) / (lum("#6E6E73") + .05) >= 4.5);
  assert.match(p, /\.pf-n \{[^}]*display:-webkit-box; -webkit-line-clamp:2;[^}]*overflow:hidden;/); assert.match(p, /\.pf-n \{ -webkit-line-clamp:3; \}/); // 3 líneas en móvil; «…» al final (line-clamp)
});
test("1. nombre visible: sin comillas ni «´», en tipo frase y con la añada al final (la búsqueda usa el original)", () => {
  assert.equal(limpiarNombre('"MOCAY´S" CAFE MOLIDO 250 G'), "Mocays cafe molido 250 g");
  assert.equal(limpiarNombre("PINNA FIDELIS ROBLE 2023"), "Pinna fidelis roble 2023");
  assert.equal(limpiarNombre("VINO 2019 RIOJA CRIANZA D.O. 75 CL"), "Vino rioja crianza D.O. 75 cl 2019");
  assert.equal(limpiarNombre("PACK 2000 UDS VASOS"), "Pack 2000 uds vasos"); assert.equal(limpiarNombre("AGUA BEZOYA 1,5 L"), "Agua bezoya 1,5 L"); assert.equal(limpiarNombre("ACEITE AOVE 5 L"), "Aceite AOVE 5 L");
  assert.match(p, /h\.textContent = nombreVisible\(p\); h\.title = p\.name/); assert.match(p, /n\.textContent = nombreVisible\(l\); n\.title = l\.name/); // ficha y carrito
  assert.match(p, /el\.setAttribute\("aria-label", p\.name\)/); // el nombre original sigue para lectores de pantalla y búsqueda
});
test("2. el código del artículo y el del cliente NO se ven en la aplicación del cliente (tarjeta, carrito, Mi cuenta ni PDF)", () => {
  assert.equal(/pf-cod|"Cód\. "|Cód\. \$\{/.test(p), false);
  const c = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(/Cliente nº/.test(c), false);
  const o = { ref: "VM-2026-000009", created_at: "2026-11-14T10:00:00Z", delivery_date: "2026-11-16", address: "x", note: "", re: 0, items: [{ product_id: "58127", name: "CUENCO REDONDO 9 X 6", unit: "ud", qty: 6, units: 6, price: 1, vat: 21, amount: 6 }] };
  const t = pdfPedido(datosPdf(o, { empresa: "VM", cliente: "BAR", codigoCliente: "T0818" })).toString("latin1");
  assert.equal(t.includes("58127") || t.includes("Cód.") || t.includes("T0818") || t.includes("Nº de cliente"), false);
  assert.equal("codigo" in lineaPdf(o.items[0]), false);
});
test("3. precio claro: 17 px en negrita seguido de «/ud» o «/caja (N ud)»; con descuento, el original tachado y el neto al lado", () => {
  assert.match(p, /\.pf-pr b \{ font-size:calc\(17px \/ var\(--k,1\)\); font-weight:700; \}/);
  assert.match(p, /ud\.textContent = enCaja \? ` \/caja \(\$\{p\.unitsPerBox\} ud\)` : \(esPack \? " \/pack" : " \/ud"\)/);
  assert.match(p, /viejo\.className = "pf-viejo"; viejo\.textContent = fmtP\(enCaja \? Number\(p\.price\) \* p\.unitsPerBox : Number\(p\.price\)\); price\.textContent = fmtP\(enCaja \? precioCaja\(p\) : precioUd\(p\)\)/);
});
test("4. corazón de favorito: icono de 20 px en un círculo de 32 px (zona de toque de 44 px)", () => {
  assert.match(p, /\.pf-fav::before \{ display:block !important; width:32px; height:32px;/); assert.match(p, /\.pf-fav svg \{ width:20px !important; height:20px !important; \}/); assert.match(p, /\.pf-fav \{ position:static; grid-area:fav; justify-self:start; align-self:center; width:44px; height:44px;/);
});
test("5. foco visible con un solo rojo (el de acento) en toda la app, también en el contador de cantidad", () => {
  for (const h of [p, c]) { assert.match(h, /:focus-visible, button:focus-visible, a:focus-visible, select:focus-visible, \[tabindex\]:focus-visible \{ outline:3px solid var\(--accent\) !important; outline-offset:2px; \}/); assert.match(h, /input:focus, textarea:focus, select:focus, input:focus-visible, textarea:focus-visible \{ outline:3px solid var\(--accent\) !important;/); }
  assert.match(p, /\.pf-step input:focus, \.hstep input:focus, \.pf-step input:focus-visible, \.hstep input:focus-visible \{ outline:3px solid var\(--accent\) !important; outline-offset:-3px;/);
});
