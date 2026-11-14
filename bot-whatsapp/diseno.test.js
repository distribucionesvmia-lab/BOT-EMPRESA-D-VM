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
  assert.match(pedido, /Math\.min\(Math\.max\(nat \* 2\.5, 240\)/); // el zoom se ve grande: las fotos pequeñas se amplían hasta 2,5 veces assert.match(pedido, /"Imagen orientativa"/);
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
  assert.match(pedido, /@media \(min-width:1024px\) \{[\s\S]*grid-template-columns:220px minmax\(0, 1fr\) clamp\(340px, 24vw, 420px\)/);
  assert.match(pedido, /\.app > footer \{ display:none !important; \}/); assert.match(pedido, /\.tb\[data-nav="pedido"\] \{ display:none; \}/);
  assert.match(pedido, /grid-template-columns:repeat\(auto-fill, minmax\(clamp\(170px, 14vw, 250px\), 1fr\)\)/); // las columnas se reparten solas según el ancho
  assert.match(pedido, /@media \(min-width:768px\) and \(max-width:1023px\)[\s\S]*max-width:720px/);
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

test("sustitutos: al repetir o añadir un pedido con artículos retirados se ofrecen hasta 3 parecidos y se añaden con la misma cantidad", () => {
  assert.match(pedido, /function parecidos\(r, max = 3\)/); assert.match(pedido, /function ofrecerParecidos\(lista\)/);
  assert.match(pedido, /ya no está disponible\./); assert.match(pedido, /¿Te sirve alguno de estos\?/); assert.match(pedido, /añadirComoSustituto\(p, x\.uds\)/);
  assert.match(pedido, /sinStock\.push\(\{ id, uds: u \}\)/);
  const srv = leer("./server.js"); assert.match(srv, /retirados: retiradosDe\(customer\)/); assert.match(srv, /function retiradosDe\(customer\)/);
  assert.doesNotMatch(srv.slice(srv.indexOf("function retiradosDe"), srv.indexOf("function retiradosDe") + 900), /nif/i); // solo ids y nombres de artículos de SU historial
});

test("búsqueda por voz: botón de micrófono solo si el navegador sabe, se convierte en «borrar» con texto, y explica los fallos", () => {
  assert.match(pedido, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/); assert.match(pedido, /rec\.lang = "es-ES"/);
  assert.match(pedido, /else btn\.hidden = true;/); assert.match(pedido, /"Borrar la búsqueda"/);
  for (const m of ["Permite el micrófono", "No te hemos oído", "Sin conexión: la búsqueda por voz", "No encontramos el micrófono"]) assert.ok(pedido.includes(m), m);
  assert.match(pedido, /\.vozbtn \{[^}]*width:44px; height:44px/); assert.match(pedido, /prefers-reduced-motion: reduce\) \{ \.vozbtn\.escucha \{ animation:none/);
});

test("toque premium: transiciones entre páginas y de lista, esqueletos de carga, foto que vuela al carrito y botón de confirmar con estados", () => {
  const cli = leer("./cliente.html");
  for (const h of [cli, pedido]) { assert.match(h, /@view-transition \{ navigation: auto; \}/); assert.match(h, /prefers-reduced-motion: reduce\) \{ ::view-transition-group\(\*\)/); assert.match(h, /@keyframes sk-brillo/); }
  assert.match(pedido, /function conTransicion\(fn\)/); assert.match(pedido, /document\.startViewTransition\(fn\)/); assert.match(pedido, /#list \{ view-transition-name:lista; \}/);
  assert.equal((pedido.match(/class="sk-fila"/g) || []).length, 6); assert.match(pedido, /list\.removeAttribute\("aria-busy"\)/);
  assert.match(cli, /class: "in-esq"|el\("div", "in-esq"\)/); assert.match(cli, /quitaEsq\(\)/);
  assert.match(pedido, /function volarAlCarrito\(id\)/); assert.match(pedido, /duration: 400/); assert.match(pedido, /antes === 0 && Math\.floor\(Number\(n\) \|\| 0\) > 0\) volarAlCarrito\(id\)/);
  assert.match(pedido, /class="rueda"/); assert.match(pedido, /Pedido enviado/); assert.match(pedido, /btn\.classList\.add\("sacude"\)/); assert.match(pedido, /#confirm\.hecho \{ background:var\(--ok\)/);
});

test("chat: atajos «Último pedido» e «Histórico» como dos tarjetas con icono y título; el mensaje del cliente lleva solo el título", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /<nav class="quick" id="quick"[\s\S]*data-q="último pedido"[\s\S]*class="q-ico"[\s\S]*data-q="histórico"/);
  assert.match(cli, /\.quick button \{ display:flex; align-items:center; gap:var\(--s3\); min-height:56px;/);
  assert.match(cli, /enviar\(b\.dataset\.q, b\.querySelector\("b"\)\?\.textContent \?\? b\.textContent\)/);
});

test("catálogo: botón «Mi cuenta» arriba (icono en móvil, con texto si hay sitio) que abre Mi cuenta en el chat", () => {
  assert.match(pedido, /id="cuentaBtn" class="ds-circ cuenta"[^>]*aria-label="Mi cuenta: mis datos y mis pedidos"/);
  assert.match(pedido, /\$\("cuentaBtn"\)\.onclick = \(\) => \{ location\.href = "\/cliente#cuenta"; \}/);
  assert.match(pedido, /header \.ds-circ\.cuenta\.solo-icono \{ width:44px; padding:0; \}/); assert.match(pedido, /function ajustaCuenta\(\)/); // con texto si cabe; solo icono si no
});

test("chat: los atajos son botones pequeños (44 px, ancho a su texto), sin línea de ayuda y con aire sobre la barra de escribir", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /\.quick \{ display:flex; flex-wrap:nowrap; justify-content:flex-start;[^}]*padding:var\(--s2\) max\(var\(--gutter\)[^}]*var\(--s3\); \}/);
  assert.match(cli, /\.quick button \{ flex:none; width:auto; min-height:44px;/); assert.match(cli, /\.quick \.q-tx small \{ display:none; \}/);
});

test("acceso (tanda 1): NIF primero, validación propia en español, aviso de los 6 primeros dígitos, error que se borra al editar, cerrar sesión en Mi cuenta, invitado sin 401", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /<form class="vm-card" id="f-acceso" autocomplete="off" novalidate>/); // sin avisos nativos del navegador en inglés
  assert.match(cli, /id="m-nif" aria-pressed="true">Entrar con mi NIF</); assert.match(cli, /modoAcceso\(false\);\n\/\/ Validación con mensajes propios/);
  assert.match(cli, /id="a-nif" type="text" inputmode="numeric"/); assert.doesNotMatch(cli, /id="a-nif"[^>]*pattern=/);
  for (const m of ["Escribe los 6 primeros dígitos de tu DNI o CIF", "Formato incorrecto", "Solo cuentan los 6 primeros dígitos del DNI o CIF", "Las letras no cuentan", "Escribe el nombre de tu empresa."]) assert.ok(cli.includes(m), m);
  assert.match(cli, /\$\("a-err"\)\.textContent = ""; \$\(id\)\.removeAttribute\("aria-invalid"\)/); // se borra al corregir
  assert.match(cli, /nodo\("button", "Cerrar sesión", "vm-btn ghost cu-salir"\)/); assert.match(cli, /async function cerrarSesion\(\)/);
  assert.match(cli, /sin sesión responde 200 con cliente nulo/);
  assert.doesNotMatch(cli, /id="ir-pin"/);
});

test("ordenador: la página se adapta al ancho (hasta 1240 px), el Inicio en dos columnas y las fotos llenan su baldosa", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /:root \{ --ancho:860px; \}/); assert.match(cli, /:root \{ --ancho:1240px; \}/); assert.doesNotMatch(cli, /calc\(\(100% - 860px\) \/ 2\)/);
  assert.match(cli, /\.vm-inicio > \.in-secs \{ grid-column:2;/); assert.match(cli, /\.vm-inicio \.in-pim img, \.vm-inicio \.in-foto img \{ width:82%; height:82%; \}/);
  assert.match(pedido, /\.pf-av img \{ width:82%; height:82%; max-width:none; max-height:none; \}/);
});

test("tanda 2 (inicio y diseño general): atajos sin recorte, contenedor único, menú ordenado, título sin repetir, favoritos legibles, «Hacer pedido» arriba, sin parpadeo", () => {
  const cli = leer("./cliente.html");
  assert.match(cli, /\.quick button \{ flex:0 1 auto; min-width:0; max-width:100%; white-space:normal;/); assert.match(cli, /@media \(max-width:420px\) \{ \.quick button \{ flex:1 1 0;/);   // 1
  assert.match(cli, /#chat \{ width:100%; max-width:calc\(var\(--ancho\) \+ 2 \* var\(--gutter\)\);[^}]*padding-bottom:calc\(var\(--s8\) \+ var\(--s2\)\);[^}]*scrollbar-width:thin;/); assert.match(cli, /mask-image:linear-gradient\(to bottom, #000 calc\(100% - 28px\), transparent\)/); // 2, 3, 9
  assert.match(cli, /:root \{ --ancho:720px; \}/); // 3
  assert.match(cli, /\.mpop \{ min-width:240px; \}/); assert.match(cli, /\.bar \.mpop #salir \{ margin-top:var\(--s1\); border-top:\.5px solid var\(--line\)/); assert.doesNotMatch(cli, /id="menu-letra"/); // 4 y 9 (letra solo en «Aa»)
  assert.match(cli, /\.titulo-grande \{ font-size:calc\(clamp\(24px, 7\.4vw, 34px\) \/ var\(--k,1\)\); \}/); assert.match(cli, /\.titulo-sub \{ display:none; \}/); // 5
  assert.match(cli, /\.vm-inicio \.in-pn \{ -webkit-line-clamp:3;/); assert.match(cli, /\.vm-inicio \.in-mas \{ position:static; width:44px; height:44px;/); assert.match(cli, /class", "in-vertodos"|"in-vertodos"/); assert.match(cli, /@media \(max-width:599px\) \{ \.vm-inicio \.in-hscroll \{ -webkit-mask-image/); // 6
  assert.match(cli, /c\.insertBefore\(hacer, principal\)/); assert.match(cli, /Pedido recurrente: se guarda y tú lo revisas antes de enviar/); // 7
  assert.match(cli, /html\.cargando body \{ visibility:hidden; \}/); assert.match(pedido, /html\.cargando body \{ visibility:hidden; \}/); assert.match(cli, /<img data-logo width="420" height="186"/); // 8
  assert.match(cli, /function ajustaCuenta\(\)/); assert.match(cli, /\.letra button:disabled \{ opacity:1; color:var\(--text-2\);/); assert.match(cli, /class", "in-mas-lineas"|"in-mas-lineas"/); // 9
  assert.match(pedido, /\[#&\]tab=hab/);
});
