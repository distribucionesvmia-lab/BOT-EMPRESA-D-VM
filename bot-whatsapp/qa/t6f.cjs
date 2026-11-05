const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000006',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const row=()=>p.locator('text=CERVEZA RUBIA').first().locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]');
  const state=async l=>console.log(l,'| botones on:',await row().locator('button.on').allInnerTexts(),'| barra:',(await p.innerText('#verCarrito')).replace(/\n/g,' '));
  await state('inicio');
  await row().locator('button:has-text("Cajas")').click(); await state('tras clic Cajas (sin añadir)');
  await row().locator('.add').click(); await p.waitForTimeout(300); await state('tras Añadir 1 caja (esperado 24 uds ×0,62 -5% = 14,13)');
  await p.click('#verCarrito'); await p.waitForTimeout(500);
  console.log('CARRITO:', (await p.innerText('body')).split('\n').filter(x=>/CERVEZA|caja|uds|€|Total|IVA/i.test(x)).slice(0,14).join(' | '));
  await b.close();
})();
