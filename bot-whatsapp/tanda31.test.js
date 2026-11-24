// Rediseño de las páginas del panel de la empresa: cabecera común, rejilla de campos y filtros, botones, tablas con scroll propio y estados vacíos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const e = fs.readFileSync(new URL("./empresa.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("cada página lleva su título y descripción con el mismo estilo (y no es la barra roja de arriba)", () => {
  for (const [id, t] of [["p-pedidos", "Pedidos"], ["p-solicitudes", "Solicitudes de alta"], ["p-cuentas", "Cuentas de clientes"], ["p-articulos", "Artículos"], ["p-avisos", "Avisos a clientes"], ["p-datos", "Datos y Excel"]]) {
    const i = e.indexOf(`id="${id}"`); assert.ok(i > 0, id); assert.ok(e.slice(i, i + 900).includes(`<div class="pag-cab"><h1>${t}</h1><p>`), id);
  }
  assert.doesNotMatch(e, /<header class="pag-cab">/); // la regla de la barra superior (roja, fija) es del único <header>
});
test("campos: etiqueta encima, misma altura y rejillas sin solapes en 1100, 900 y 640 px", () => {
  assert.match(e, /\.form-grid \{ display:grid; grid-template-columns:repeat\(auto-fit, minmax\(min\(100%, 240px\), 1fr\)\); gap:16px 20px; align-items:start;/);
  assert.match(e, /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\), select \{ height:40px; padding:0 12px; \}/); assert.match(e, /label > input:not\(\[type=checkbox\]\):not\(\[type=radio\]\), label > select, \.campo > input, \.campo > select \{ width:100%;/);
  assert.match(e, /#f-filtro \{ grid-template-columns:repeat\(4, minmax\(128px, 170px\)\) minmax\(220px, 1fr\) auto; \}/); assert.match(e, /#f-articulos \{ grid-template-columns:minmax\(240px, 1fr\) minmax\(170px, 220px\) minmax\(240px, 300px\) auto; \}/);
  assert.match(e, /@media \(max-width: 1099px\) \{ #f-filtro \{ grid-template-columns:repeat\(4, minmax\(0, 1fr\)\); \} #f-articulos \{ grid-template-columns:repeat\(2, minmax\(0, 1fr\)\);/); assert.match(e, /@media \(max-width: 640px\) \{ #f-filtro \{ grid-template-columns:repeat\(2, minmax\(0, 1fr\)\); \} #f-articulos \{ grid-template-columns:minmax\(0, 1fr\);/);
  assert.equal((e.match(/<label style="display:flex;flex-direction:column/g) ?? []).length, 0); // ya no quedan etiquetas con estilos sueltos
  const av = e.slice(e.indexOf('<form id="f-avisos"'), e.indexOf("</form>", e.indexOf('<form id="f-avisos"'))); for (const id of ["av-destino", "av-q", "av-sel", "av-titulo", "av-texto", "av-enviar"]) assert.ok(av.includes(`id="${id}"`), id); // mismos campos y mismos ids que antes
});
test("botones: el principal destacado, los secundarios discretos y borrar con su estilo y con confirmación", () => {
  assert.match(e, /<div class="acciones" id="ped-acciones"><div class="grupo">.*id="exportar-sel".*id="exportar".*id="ver-excel".*<\/div><div class="grupo der">.*id="marcar-todos".*id="borrar-sel".*<\/div>/);
  assert.match(e, /button\.peligro \{ border-color:var\(--accent\); color:var\(--accent\); background:transparent; \}/); assert.match(e, /\.acciones \.grupo\.der \{ margin-left:auto; \}/);
  assert.match(e, /\$\("borrar-sel"\)\.onclick = async \(\) => \{[\s\S]{0,1400}if \(!confirm\(aviso\)\) return/); // borrar sigue pidiendo confirmación
  assert.doesNotMatch(e, /1a7f4b|#0f7a4d/); assert.match(e, /wa\.classList\.add\("btn-wa"\)/); // el botón de WhatsApp ya no es verde
});
test("tablas: scroll dentro de la tabla, cabecera fija, números a la derecha, estados con etiqueta y estados vacíos explicados", () => {
  assert.match(e, /\.scroll \{ max-height:min\(68vh, 720px\); overflow:auto;/); assert.match(e, /td\.num, th\.num \{ text-align:right;/); assert.match(e, /th \{ z-index:2; background:var\(--th\);/);
  assert.match(e, /\.scroll:has\(\+ \.vacio:not\(\[hidden\]\)\), \.vacio:not\(\[hidden\]\) \+ \.scroll \{ display:none; \}/); // sin cabeceras fantasma cuando no hay datos
  for (const id of ["ped-vacio", "sol-vacio", "av-vacio", "err-vacio", "inv-vacio"]) assert.match(e, new RegExp(`<p[^>]*class="vacio"[^>]*id="${id}"|<p[^>]*id="${id}"[^>]*class="vacio"`), id);
  assert.match(e, /etq\.appendChild\(el\("span", estado, \{ className: "badge "/); assert.match(e, /id="sol-tabla"/); assert.match(e, /colSpan: 6/); // solicitudes: contacto en una columna y tarjetas en pantallas estrechas
  assert.match(e, /@media \(max-width: 900px\) \{[\s\S]{0,600}#sol-tabla thead \{ display:none; \}/);
});
test("transiciones suaves y foco visible, y todo se queda quieto con «reducir movimiento»", () => {
  assert.match(e, /@keyframes pagIn/); assert.match(e, /@media \(prefers-reduced-motion: reduce\) \{ #app > div, details\.panel > :not\(summary\) \{ animation:none !important; \}/);
  assert.match(e, /button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, a:focus-visible, \.tab:focus-visible \{ outline:3px solid var\(--accent\);/);
});

test("pedido desplegado: las líneas se adaptan al ancho de la celda y no ensanchan la tabla", () => {
  assert.match(e, /#ped \.lines tr \{ display:flex; flex-wrap:wrap;/); assert.match(e, /#ped \.lines td:nth-child\(2\) \{ order:-1; flex:1 1 100%;/); // el nombre arriba y debajo código, unidades, precio e importe
});

test("DATOS Y EXCEL: las tarjetas de subida van primero, compactas y alineadas, y la revisión va en un panel aparte", async () => {
  const h = (await import("node:fs")).readFileSync(new URL("./empresa.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(h.indexOf('id="dx-tarjetas"') < h.indexOf('id="alta-cli"'), "las tarjetas de subida van antes que lo demás");
  assert.ok(h.indexOf('id="dx-tarjetas"') < h.indexOf('id="entrada-panel"'));
  for (const t of ["dx-drop", "dx-rev", "dx-info", 'id="dx-revisiones"', "-cerrar", "MutationObserver", "Elegir archivo"]) assert.ok(h.includes(t), t);
  assert.ok(!h.includes('id="dx-pasos"'), "ya no hay el panel de explicación con los pasos");
  for (const id of ["px", "cl", "co", "fo"]) assert.ok(h.includes('{ p: "' + id + '"'), id);
  assert.ok(!h.includes('{ p: "hi"'), "el historial de compras ya no tiene tarjeta (sale del Excel de consumo)");
});
