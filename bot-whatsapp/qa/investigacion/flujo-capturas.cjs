const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const post = async (t, ph) => (await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:ph,text:t})})).json());
  const ph = '34700' + Math.floor(Math.random()*1e6); await post('hola', ph); const d = await post('Bar El Ejemplo', ph);
  const ctx = await b.newContext({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
  const p = await ctx.newPage(); await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const small = await p.evaluate(() => [...document.querySelectorAll('button,a,input,select')].filter(e => { const r = e.getBoundingClientRect(); return r.width>0 && r.height>0 && (r.height<44 || r.width<44); }).map(e => (e.id||e.className||e.tagName)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)+' «'+(e.innerText||e.getAttribute('aria-label')||'').slice(0,18).replace(/\n/g,' ')+'»'));
  console.log('Objetivos táctiles < 44 px en 390×844:\n  '+small.join('\n  '));
  await p.locator('.add').nth(0).click(); await p.locator('.add').nth(1).click(); await p.waitForTimeout(300);
  await p.click('#verCarrito'); await p.waitForTimeout(600); await p.screenshot({ path:'qa/investigacion/flujo-2-carrito-390.png' });
  await p.click('#confirm'); await p.waitForTimeout(600); await p.screenshot({ path:'qa/investigacion/flujo-3-dia-390.png' });
  await p.locator('#whenOpts button').first().click(); await p.waitForTimeout(600); await p.screenshot({ path:'qa/investigacion/flujo-4-resumen-390.png' });
  await b.close();
})();
