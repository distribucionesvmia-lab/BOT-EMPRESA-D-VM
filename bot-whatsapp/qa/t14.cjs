const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34610004067',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  const ctx = await b.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const p = await ctx.newPage(); await p.goto(d.ui.url); await p.waitForTimeout(1300);
  await p.locator('.add').first().click(); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__s=[]; const t0=performance.now(); const f=()=>{ const de=document.documentElement; const w=de.scrollWidth; if(w>de.clientWidth+1){ const off=[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>de.clientWidth+1).slice(0,5).map(e=>(e.id||e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().right)+':'+getComputedStyle(e).position); window.__s.push([Math.round(performance.now()-t0),w,off]); } if(performance.now()-t0<2500) requestAnimationFrame(f)}; f(); });
  await p.click('#verCarrito'); await p.waitForTimeout(2700);
  console.log(JSON.stringify(await p.evaluate(()=>window.__s.slice(0,4))));
  await b.close();
})();
