const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000004',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const bar=async l=>console.log(l,'=>',(await p.innerText('#verCarrito')).replace(/\n/g,' '));
  const rowOf=n=>p.locator('.add').nth(n).locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]');
  await p.locator('.add').nth(0).click(); await p.waitForTimeout(300); await bar('cola 1 ud (0,50 esperado)');
  // ahora la fila 1 sigue siendo agua?
  const names=await p.$$eval('.add, button:has-text("+")',es=>es.length);
  console.log('2ª fila:', (await p.locator('.add').nth(0).locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]').innerText()).replace(/\n/g,' | ').slice(0,90));
  // + en cola (incrementa)
  const plus=p.locator('button:text-is("+")').first(); await plus.click(); await p.waitForTimeout(300); await bar('cola 2 uds (1,00 esperado)');
  for(let i=0;i<4;i++) await plus.click(); await p.waitForTimeout(300); await bar('cola 6 uds (3,00)');
  const minus=p.locator('button:text-is("−")').first(); for(let i=0;i<10;i++) await minus.click(); await p.waitForTimeout(300); await bar('tras 10 "−" (debe quedar 0 / vacío)');
  console.log('body tail:', (await p.innerText('body')).split('\n').slice(-4).join(' | '));
  await b.close();
})();
