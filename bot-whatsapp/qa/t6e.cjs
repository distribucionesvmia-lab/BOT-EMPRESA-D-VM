const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000005',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const bar=async l=>console.log(l,'=>',(await p.innerText('#verCarrito')).replace(/\n/g,' '));
  await p.locator('.add').nth(0).click(); await p.waitForTimeout(300);
  const minus=p.locator('button[aria-label^="Quitar uno de"]').first();
  await p.locator('button:text-is("+")').first().click(); await bar('cola 2');
  await minus.click(); await bar('cola 1'); await minus.click(); await p.waitForTimeout(300); await bar('cola 0 (vuelve a «+ Añadir»?)');
  console.log('+Añadir visible de nuevo:', await p.locator('.add').first().isVisible());
  // unidades vs cajas en cerveza (nth 2)
  await p.locator('.add').nth(2).click(); await p.waitForTimeout(300); await bar('cerveza 1 ud (0,62)');
  // cambiar a Cajas con cantidad ya añadida
  const r = p.locator('.add, button:text-is("+")'); 
  const rowText=async()=> (await p.locator('text=CERVEZA RUBIA').first().locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]').innerText()).replace(/\n/g,' | ');
  console.log('fila cerveza:', await rowText());
  await p.locator('text=CERVEZA RUBIA').first().locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]').locator('button:has-text("Cajas")').click(); await p.waitForTimeout(300);
  console.log('fila cerveza tras Cajas:', await rowText()); await bar('cerveza tras pasar a Cajas (¿1 caja=14,88?)');
  // marcar (corazón/estrella) y filtro
  const marks = await p.$$eval('button',bs=>bs.filter(x=>/marc|favorit|heart|♥|♡/i.test((x.ariaLabel||'')+x.className+x.innerText)).map(x=>x.className+'|'+x.ariaLabel+'|'+x.innerText).slice(0,5)); console.log('marcadores:',marks);
  console.log('ERRS',errs); await b.close();
})();
