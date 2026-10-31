// Prueba de navegador del catálogo (móvil 390 px). NO forma parte de `npm test` (necesita Playwright y un servidor en marcha).
// SOLO contra la DEMO: envía un pedido de demostración a la base demo. Nunca con datos reales.
//   Terminal 1:  cd bot-whatsapp && DEMO=1 HOST=127.0.0.1 PORT=3911 node server.js
//   Terminal 2:  NODE_PATH=$(npm root -g) node pruebas/catalogo-movil.cjs        (BASE=http://127.0.0.1:3911 por defecto)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE ?? "http://127.0.0.1:3911";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) { console.error("Solo contra un servidor local en modo DEMO."); process.exit(1); }

(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const errs = [], posts = [], ok = (m) => console.log("  ✓", m);
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("request", (r) => { if (r.method() === "POST" && /\/catalogo$/.test(r.url())) posts.push(r.url()); });
  p.on("dialog", (d) => d.accept());
  const hidden = (sel) => p.$eval(sel, (e) => e.hidden);
  const entrar = async () => { await p.goto(BASE + "/catalogo"); await p.waitForSelector(".p"); };

  await p.goto(BASE + "/cliente"); await p.fill("#a-nif", "00000001R"); await p.click("button.vm-btn.primary"); await p.waitForTimeout(800);
  await entrar(); const url0 = p.url();

  // Carrito persistente
  await p.click(".p .add"); await p.reload(); await p.waitForSelector(".p");
  assert.equal(await p.$eval("#cnt", (e) => e.textContent), "1"); ok("el carrito se recupera al recargar");

  // Subtotal por línea y total coherente
  await p.click("#verCarrito");
  const subl = await p.$eval(".subl", (e) => e.textContent); assert.match(subl, /=.*€/); ok("subtotal por línea: " + subl);
  // Quitar y deshacer
  await p.click("#cart .p .step button:nth-child(1)"); assert.match(await p.$eval("#toast", (e) => e.textContent), /Deshacer/);
  await p.click("#toast button"); assert.equal(await p.$eval("#cnt", (e) => e.textContent), "1"); ok("quitar y deshacer");

  // Esc y foco
  await p.keyboard.press("Escape"); assert.equal(await hidden("#cart"), true); ok("Esc cierra el carrito");

  // Búsqueda sin resultados
  await p.fill("#q", "zzzz"); assert.match(await p.$eval("#list", (e) => e.innerText), /No hemos encontrado/); await p.click(".vacio .lnk"); ok("búsqueda sin resultados con ayuda");

  // Repetir pedido
  assert.equal(await hidden("#repbar"), false); await p.click("#repAbrir"); await p.click("#repOk"); ok("repetir pedido añade al carrito");

  // Favoritos persistentes
  await p.click(".tab[data-t=all]"); await p.click(".cat"); const todo = await p.$(".sub.todo"); if (todo) await todo.click();
  await p.click(".p .favb"); await p.waitForTimeout(300); await entrar();
  assert.ok((await p.$$eval(".favb[aria-pressed=true]", (e) => e.length)) >= 1); ok("favorito guardado en el servidor");
  await p.click(".p .favb[aria-pressed=true]"); await p.waitForTimeout(300);

  // Atrás del móvil
  await p.click("#verCarrito"); await p.click("#confirm"); await p.click("#otroDia");
  await p.goBack(); assert.equal(await hidden("#calFondo"), true);
  await p.goBack(); assert.equal(await hidden("#when"), true);
  await p.goBack(); assert.equal(await hidden("#cart"), true); assert.equal(p.url(), url0); ok("Atrás cierra capas sin salir del catálogo");

  // Confirmación antes de enviar (sin envío hasta confirmar)
  await p.click("#verCarrito"); await p.click("#confirm"); await p.click("#whenOpts .opt:nth-child(2)");
  assert.equal(posts.length, 0); assert.equal(await hidden("#resumen"), false); ok("el resumen aparece y no se ha enviado nada");
  await p.click("#resOk"); await p.waitForTimeout(800);
  assert.equal(posts.length, 1); assert.equal(await hidden("#done"), false); ok("tras confirmar se envía una sola vez");

  assert.deepEqual(errs, []); ok("sin errores de JavaScript");
  await b.close(); console.log("TODO CORRECTO");
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });
