const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs=[];
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34690000002',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const link=d.ui.url;
  for (const rm of ['no-preference','reduce']) {
    const ctx = await b.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,reducedMotion:rm});
    const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(e.message));
    await p.goto(link); await p.waitForTimeout(1300);
    // duración de animaciones/transiciones en elementos clave
    const dur = await p.evaluate(()=>{
      const out={}; const sel=['.big','#verCarrito','.add','.tab','.screen','body'];
      for(const s of sel){const e=document.querySelector(s); if(!e) continue; const c=getComputedStyle(e); out[s]=`t=${c.transitionDuration}|a=${c.animationDuration}`}
      return out;});
    console.log(`[reducedMotion=${rm}]`,JSON.stringify(dur));
    // añadir último producto y ver que la barra no tapa la última fila
    await p.locator('.add').last().scrollIntoViewIfNeeded(); await p.locator('.add').last().click(); await p.waitForTimeout(400);
    await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await p.waitForTimeout(300);
    const geo = await p.evaluate(()=>{const a=[...document.querySelectorAll('.add, button.on, button:not(.add)')]; const bar=document.querySelector('#verCarrito').getBoundingClientRect(); const rows=[...document.querySelectorAll('.add')].map(e=>e.getBoundingClientRect()); const lastBottom=Math.max(...rows.map(r=>r.bottom)); return {barTop:Math.round(bar.top),barH:Math.round(bar.height),lastAddBottom:Math.round(lastBottom),vh:innerHeight,tapados:lastBottom>bar.top}});
    console.log('  geometría tras scroll al final:',JSON.stringify(geo));
    await p.click('#verCarrito'); await p.waitForTimeout(500);
    const cart = await p.evaluate(()=>({over:document.documentElement.scrollWidth-document.documentElement.clientWidth,confirmVisible:!!document.querySelector('#confirm')?.getBoundingClientRect().height, confirmBottom:Math.round(document.querySelector('#confirm').getBoundingClientRect().bottom), vh:innerHeight}));
    console.log('  pantalla carrito 320x568:',JSON.stringify(cart));
    await p.screenshot({path:`t10-cart-${rm}.png`}); await ctx.close();
  }
  console.log('ERRS',errs); await b.close();
})();
