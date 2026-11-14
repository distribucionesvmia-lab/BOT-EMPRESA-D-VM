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

test("navegación inferior: 5 pestañas, aria-current, sin «Paso 1 de 3» ni pestañas de arriba, carrito flotante", () => {
  const nav = (pedido.match(/<nav class="tabbar"[\s\S]*?<\/nav>/) || [""])[0];
  assert.equal((nav.match(/<button /g) || []).length, 5);
  for (const t of ["Inicio", "Catálogo", "Pedido", "Mis pedidos", "Ayuda"]) assert.match(nav, new RegExp(`class="tb-t">${t}<`));
  assert.match(pedido, /setAttribute\("aria-current", "page"\)/);
  assert.doesNotMatch(pedido, /<div class="paso">/); assert.doesNotMatch(pedido, /<nav class="tabs">/);
  assert.match(pedido, /<footer hidden role="status" aria-live="polite"><button class="pill-cart"/);
  assert.match(pedido, /\.pill-cart \{[^}]*min-height:54px/); assert.match(pedido, /\.tb \{[^}]*min-height:56px/);
  assert.match(pedido, /Buscar en todo el catálogo/); assert.match(pedido, /slice\(0, 6\)/); // buscador con hasta 6 sugerencias
  assert.match(pedido, /posTab\[tab\]\.scroll = \$\("list"\)\.scrollTop/); // cada pestaña recuerda su posición
  assert.match(pedido, /history\.pushState\(\{ vmTab: t \}/); // «Atrás» del móvil vuelve a la pestaña anterior
  assert.match(pedido, /aviso\("Quitado: "/); // «Quitado · Deshacer»
});

test("pantalla Pedido única: fichas de día de 64 px, «Hoy» solo si el servidor lo ofrece, tick que se dibuja y referencia", () => {
  assert.match(pedido, /\.dchip \{[^}]*min-height:64px/);
  assert.match(pedido, /for \(const o of ops\) \{/); // las fichas salen de data.delivery (el servidor decide si hay «Hoy»)
  assert.doesNotMatch(pedido, /ficha\("Hoy"/);
  assert.match(pedido, /Elige el día de entrega\./); assert.match(pedido, /tick-c 400ms/);
  assert.match(pedido, /"Referencia " \+ j\.ref/); assert.match(pedido, /id="doneVer"/); assert.match(pedido, /Volver al inicio/);
  assert.match(pedido, /dx < -90/); assert.match(pedido, /8000 : 4000/); // deslizar quita; «Deshacer» 8 s
  assert.match(pedido, /#cart \.tl \.av\.tl-av, #cart \.tl \.tl-av \{ width:52px; height:52px/);
});

test("Inicio: saludo por hora de Madrid, «hoy» solo con la regla de siempre, pedido de siempre con fotos solapadas, tarjeta comercial solo con datos", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /timeZone: "Europe\/Madrid", hour: "numeric"/); assert.match(cli, /"Buenos días" : h < 21 \? "Buenas tardes" : "Buenas noches"/);
  assert.match(cli, /fetch\("\/catalogo\/aviso"\)[^\n]*j\?\.entregaHoy/); // la misma regla del servidor (Medina del Campo, laborable, antes de las 10:00)
  assert.match(cli, /\.in-foto \{ width:44px; height:44px; margin-left:calc\(-1 \* var\(--s3\)\)/); // miniaturas solapadas
  assert.match(cli, /Empieza tu primer pedido/); assert.match(cli, /"Lo más pedido"/); assert.match(cli, /"Lo que sueles pedir"/);
  assert.match(cli, /\.in-prod \{[^}]*width:148px/);
  assert.match(cli, /j\.ayuda && \(j\.ayuda\.tel \|\| j\.ayuda\.horario \|\| j\.ayuda\.whatsappHref\)/);
  assert.match(cli, /if \(!j\?\.fijo \|\| !j\.hoy\.toca \|\| j\.hoy\.yaPidio\) return;/); // «Revisar y enviar» solo el día que toca
  assert.doesNotMatch(cli, /Hoy toca[^\n]*enviar\(/); // nunca se envía solo
});

test("fotos y estados: baldosa con foto al 82 % sin agrandar, fundido de 200 ms, aviso «Imagen orientativa» y estados con un solo botón", () => {
  const cli = leer("./cliente.html");
  assert.match(pedido, /\.av img, \.pf-av img[^{]*\{[^}]*max-width:82%; max-height:82%;[^}]*opacity:0; transition:opacity 200ms/);
  assert.match(pedido, /nat < 160 \? nat/); assert.match(pedido, /"Imagen orientativa"/);
  assert.match(cli, /max-width:82%; max-height:82%/); assert.equal((cli.match(/data:image\/png;base64,/g) || []).length, 1); // el logo, una sola vez
  for (const t of ["Aún no tienes histórico", "Sin resultados", "Tu pedido está vacío", "Sin conexión", "No se ha podido enviar"]) assert.ok(pedido.includes(t), t);
  assert.match(pedido, /\.estado svg \{ width:48px; height:48px/); assert.match(pedido, /boton: "Reintentar"/);
  assert.match(pedido, /navigator\.vibrate\(8\)/); assert.match(pedido, /sinMovimiento\(\)/); // vibración suave, nunca con «reducir movimiento»
  assert.match(pedido, /@keyframes pulso \{ 0% \{ transform:scale\(1\); \} 50% \{ transform:scale\(1\.15\)/);
});

test("chat: Mi cuenta y Mi pedido fijo usan estados con un solo botón; la hoja de Ayuda se arrastra", () => {
  const cli = leer("./cliente.html");
  for (const t of ["Aún no tienes pedidos", "No se ha podido cargar", "Aún no tienes pedido fijo"]) assert.ok(cli.includes(t), t);
  assert.match(cli, /boton: "Reintentar", onclick: \(\) => abrirCuenta\(irAPedidos\)/);
  assert.match(cli, /arrastrable\(c, cerrar\)/); assert.match(cli, /\.estado svg \{ width:48px; height:48px/);
});

test("modo oscuro: mismos colores en las dos páginas, contraste AA, tema guardado y Ajustes de pantalla en Ayuda", () => {
  const cli = leer("./cliente.html");
  const osc = (h) => (h.match(/:root\[data-tema="oscuro"\] \{([^}]*)\}/) || [])[1] || "";
  assert.equal(osc(cli), osc(pedido)); assert.ok(osc(pedido).length > 200);
  const v = (n) => (osc(pedido).match(new RegExp(`--${n}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];
  assert.equal(v("bg"), "#000000"); assert.equal(v("surface"), "#1C1C1E"); assert.equal(v("fill"), "#2C2C2E"); assert.equal(v("line"), "#38383A");
  assert.equal(v("text"), "#F5F5F7"); assert.equal(v("text-2"), "#98989F"); assert.equal(v("accent"), "#FF4D63"); assert.equal(v("ok"), "#30D158"); assert.equal(v("warn"), "#FFD60A");
  for (const [f, fo] of [["text", "bg"], ["text", "surface"], ["text-2", "surface"], ["text-2", "bg"], ["accent", "surface"], ["accent", "bg"], ["on-accent", "accent"], ["ok", "surface"], ["warn", "surface"]]) assert.ok(contraste(v(f), v(fo)) >= 4.5, `${f}/${fo} ${contraste(v(f), v(fo)).toFixed(2)}`);
  assert.match(pedido, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-tema="claro"\]\)/);
  for (const h of [cli, pedido]) { assert.match(h, /localStorage\.getItem\("vm:tema"\)/); assert.match(h, /Ajustes de pantalla/); assert.match(h, /"Automático"/); assert.match(h, /transition:background-color 250ms/); }
  assert.match(pedido, /--foto-bg:#F2F2F7/); // las fotos siguen sobre baldosa clara
});

test("ordenador y tablet: panel «Tu pedido» fijo de 340 px, menú lateral de 220 px, cuadrícula de 2 y 3 columnas, sin carrito flotante; teclado y accesibilidad", () => {
  assert.match(pedido, /@media \(min-width:1024px\) \{[\s\S]*grid-template-columns:220px minmax\(0, 1fr\) 340px/);
  assert.match(pedido, /\.app > footer \{ display:none !important; \}/); assert.match(pedido, /\.tb\[data-nav="pedido"\] \{ display:none; \}/);
  assert.match(pedido, /@media \(min-width:1440px\) \{ \.app > main#list \{ grid-template-columns:repeat\(3/); assert.match(pedido, /@media \(min-width:768px\) and \(max-width:1023px\)[\s\S]*max-width:720px/);
  assert.match(pedido, /e\.key === "\/" && !escribiendo/); assert.match(pedido, /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/); assert.match(pedido, /e\.key === "\+" \|\| e\.key === "="/); assert.match(pedido, /sugActiva >= 0/);
  assert.match(pedido, /id="anuncio" class="solo-lector" role="status"/); assert.match(pedido, /aria-describedby="errDir"/); assert.match(pedido, /:focus-visible \{ outline:3px solid var\(--accent\)/);
  assert.match(pedido, /@media \(prefers-contrast: more\) \{\s*\.pf, \.card/);
});

test("fotos: cada baldosa con foto está colocada (position:relative) para que la foto nunca se estire por toda la tarjeta", () => {
  assert.match(pedido, /\.falta-av, \.tl-av, \.pf-av, \.sug-im, \.av \{ position:relative; overflow:hidden; \}/);
  const cli = leer("./cliente.html"); assert.match(cli, /\.vm-inicio \.in-pim \{ position:relative;/); assert.match(cli, /\.vm-inicio \.in-foto \{ position:relative; \}/);
});

test("Pedido: las tarjetas (entrega, pedido fijo, observaciones, resumen) ocupan todo el ancho, alineadas con el resto", () => {
  assert.match(pedido, /#cart \.cartbody > \.card, #cart \.cartbody > \.ped-res[^{]*\{ margin-left:0; margin-right:0; width:100%;/);
  assert.match(pedido, /\.falta-fila \.falta-av img \{[^}]*max-width:82%/);
});

test("direcciones guardadas: lista con «Quitar», casilla para guardar una nueva y se guarda al enviar", () => {
  assert.match(pedido, /id="dirGuardadas" class="dirguard"/); assert.match(pedido, /id="dirGuardar"/);
  assert.match(pedido, /fetch\("\/api\/direcciones"\)/); assert.match(pedido, /quitar: d\.id/); assert.match(pedido, /\$\("dirGuardar"\)\.checked && dirEntrega\(\)\.length >= 5/);
  assert.match(pedido, /\.dirop \{[^}]*min-height:48px/);
});

test("Inicio: fila «Ofertas» con la etiqueta de % o € y la fecha de fin, antes de «Lo que sueles pedir»", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /sec\.appendChild\(el\("h3", null, "Ofertas"\)\)/); assert.match(cli, /" · hasta el " \+ o\.hasta/);
  assert.ok(cli.indexOf('"Ofertas"') < cli.indexOf('"Lo que sueles pedir"'));
  assert.match(cli, /\.vm-inicio \.in-oferta \{ position:absolute;/);
});
