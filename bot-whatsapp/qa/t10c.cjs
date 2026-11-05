const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34690000003',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const link=d.ui.url;
  for (const rm of ['no-preference','reduce']) {
    const ctx = await b.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,reducedMotion:rm});
    const p = await ctx.newPage(); await p.goto(link); await p.waitForTimeout(1300);
    const probe=async l=>{const r=await p.evaluate(()=>{const W=document.documentElement.clientWidth;const off=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.right>W+1&&cs.visibility!=='hidden'&&cs.display!=='none'}).map(e=>(e.id||e.className||e.tagName)+' right='+Math.round(e.getBoundingClientRect().right)+' pos='+getComputedStyle(e).position+' tr='+getComputedStyle(e).transform.slice(0,30)).slice(0,6);return {sw:document.documentElement.scrollWidth,cw:W,iw:innerWidth,ih:innerHeight,off}});console.log(`[${rm}] ${l}`,JSON.stringify(r))};
    await probe('catálogo');
    await p.locator('.add').first().click(); await p.waitForTimeout(300); await probe('tras añadir');
    await p.click('#verCarrito'); await p.waitForTimeout(700); await probe('carrito');
    await p.click('#confirm'); await p.waitForTimeout(700); await probe('paso 3');
    await ctx.close();
  }
  await b.close();
})();
