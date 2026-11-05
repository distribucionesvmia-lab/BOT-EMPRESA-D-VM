const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000003',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const rows = await p.$$eval('.add', e=>e.length); console.log('rows',rows);
  const names = await p.$$eval('.add', es=>es.map(e=>{const c=e.closest('div[class]'); return (e.parentElement?.parentElement?.innerText||'').split('\n').slice(0,3).join('/')}));
  console.log(names);
  // click Cajas of 2nd row (agua) via its own container
  const row = p.locator('.add').nth(1).locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]');
  await row.locator('button:has-text("Cajas")').click(); await p.waitForTimeout(200);
  console.log('ROW:', (await row.innerText()).replace(/\n/g,' | '));
  await p.locator('.add').nth(1).click(); await p.waitForTimeout(500);
  console.log('ROW tras añadir:', (await row.innerText()).replace(/\n/g,' | '));
  console.log('barra:', (await p.innerText('#verCarrito')).replace(/\n/g,' '));
  await p.click('#verCarrito'); await p.waitForTimeout(600);
  console.log('CARRITO:', (await p.innerText('body')).split('\n').filter(Boolean).slice(0,40).join(' | '));
  console.log('ERRS',errs); await b.close();
})();
