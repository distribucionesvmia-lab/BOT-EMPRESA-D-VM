const { chromium } = require('playwright'); const fs = require('fs');
const SIZES = [[320,568,'móvil muy pequeño'],[360,640,'Android típico'],[375,667,'iPhone SE'],[390,844,'iPhone 14'],[412,915,'Android grande'],[568,320,'móvil apaisado'],[768,1024,'tablet'],[1024,768,'tablet apaisada'],[1440,900,'portátil']];
const medir = () => {
  const de = document.documentElement, q = s => [...document.querySelectorAll(s)];
  const vis = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const targets = q('button,a,input,select').filter(vis);
  const small = targets.filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; });
  const add = q('.add').filter(vis).map(e => e.getBoundingClientRect());
  const bar = document.querySelector('#verCarrito')?.getBoundingClientRect();
  const cart = document.querySelector('#cartIcon')?.getBoundingClientRect();
  const first = document.querySelector('.add'); const fr = first?.getBoundingClientRect();
  const top = (() => { const hs = q('header, .head, .tabs, #q').filter(vis).map(e => e.getBoundingClientRect().bottom).filter(v => v < innerHeight*0.8); return hs.length ? Math.round(Math.max(...hs)) : 0; })();
  const fs = q('body *').filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(e)).map(e => parseFloat(getComputedStyle(e).fontSize));
  return { vw: de.clientWidth, vh: innerHeight, over: de.scrollWidth - de.clientWidth, targets: targets.length, small: small.length,
    smallList: small.slice(0,5).map(e => ((e.id||e.className||e.tagName)+'').slice(0,16)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)),
    addW: add.length ? [Math.round(Math.min(...add.map(r=>r.width))), Math.round(Math.max(...add.map(r=>r.width)))] : null, addH: add.length ? [Math.round(Math.min(...add.map(r=>r.height))), Math.round(Math.max(...add.map(r=>r.height)))] : null,
    barH: bar ? Math.round(bar.height) : null, barW: bar ? Math.round(bar.width) : null, cartH: cart ? Math.round(cart.height) : null, topFixed: top,
    listArea: Math.max(0, innerHeight - top - (bar ? Math.round(bar.height) + 24 : 0)), fontMin: Math.min(...fs), fontMax: Math.max(...fs) };
};
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const [w,h,name] of SIZES) {
    const ctx = await b.newContext({ viewport:{width:w,height:h}, hasTouch: w < 1000, isMobile: w < 800 });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0,100)));
    await p.goto('file://' + process.argv[2] + '/index.html'); await p.waitForTimeout(2000);
    await p.fill('#a-nif','123456'); await p.click('#c-acceso form button.primary, #c-acceso button[type=submit]'); await p.waitForTimeout(1800);
    const chat = await p.evaluate(medir);
    await p.locator('#chat button:has-text("Hacer pedido")').first().click(); await p.waitForTimeout(2200);
    const fr = p.frames().find(f => f !== p.mainFrame());
    await fr.locator('text=Aguas').first().click(); await p.waitForTimeout(500); await fr.locator('.sub').first().click(); await p.waitForTimeout(600);
    await fr.evaluate(() => window.scrollTo(0,0));
    const lista = await fr.evaluate(medir);
    await p.screenshot({ path: `${process.argv[3]}/b-${w}x${h}-lista.png` });
    await fr.locator('.add').first().click(); await p.waitForTimeout(400);
    const afterAdd = await fr.evaluate(() => { const r = document.querySelector('.add') ? 0 : 1; return { stepperAparece: !!document.querySelector('button[aria-label^="Quitar uno"]') }; });
    await fr.locator('.add').first().click().catch(()=>{}); await fr.click('#verCarrito'); await p.waitForTimeout(500);
    const carrito = await fr.evaluate(medir); await p.screenshot({ path: `${process.argv[3]}/b-${w}x${h}-carrito.png` });
    out.push({ pantalla: `${w}×${h}`, tipo: name, chat, lista, carrito, afterAdd, errs }); await ctx.close();
  }
  fs.writeFileSync(process.argv[3] + '/auditoria2.json', JSON.stringify(out, null, 1));
  const f = (m) => m ? `over ${m.over} · peq ${m.small}/${m.targets} · add ${JSON.stringify(m.addW)}×${JSON.stringify(m.addH)} · barra ${m.barH} · cabecera ${m.topFixed}px · zona-lista ${m.listArea}px · letra ${m.fontMin}-${m.fontMax}` : '-';
  for (const o of out) { console.log(o.pantalla.padEnd(9), o.tipo); console.log('   chat   ', f(o.chat)); console.log('   lista  ', f(o.lista), o.lista.smallList.join(', ')); console.log('   carrito', f(o.carrito), o.errs.length ? 'ERR ' + o.errs[0] : ''); }
  await b.close();
})();
