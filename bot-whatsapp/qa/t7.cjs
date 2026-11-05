const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  const posts=[]; p.on('request',r=>{if(r.method()==='POST')posts.push(r.url().slice(-30))});
  p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(-40))});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000007',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const url=d.ui.url;
  await p.goto(url); await p.waitForTimeout(1200);
  await p.locator('.add').nth(1).click(); await p.locator('.add').nth(3).click(); await p.waitForTimeout(300);
  console.log('barra:',(await p.innerText('#verCarrito')).replace(/\n/g,' '));
  await p.click('#verCarrito'); await p.waitForTimeout(500);
  console.log('¿pantalla carrito visible? confirm:',await p.locator('#confirm').isVisible());
  console.log('CARRITO:',(await p.locator('#confirm').locator('xpath=ancestor::section').innerText()).split('\n').filter(Boolean).slice(0,16).join(' | '));
  await p.click('#confirm'); await p.waitForTimeout(500);
  console.log('PASO 3:',(await p.locator('#when').innerText()).split('\n').filter(Boolean).slice(0,10).join(' | '));
  console.log('opciones día:', await p.$$eval('#whenOpts button',e=>e.map(x=>x.innerText.replace(/\n/g,' / ')).slice(0,8)));
  await p.locator('#whenOpts button').first().click(); await p.waitForTimeout(600);
  console.log('RESUMEN:',(await p.locator('#resumen').innerText()).split('\n').filter(Boolean).slice(0,16).join(' | '));
  // DOBLE CLIC rápido en Confirmar y enviar
  await p.locator('#resOk').dblclick({delay:10}); await p.waitForTimeout(1500);
  console.log('DONE:',(await p.locator('#done').innerText()).split('\n').filter(Boolean).join(' | ').slice(0,300));
  console.log('POSTs enviados por el navegador:',posts);
  // reabrir el mismo enlace y reenviar
  const p2 = await b.newPage({viewport:{width:390,height:800}}); await p2.goto(url); await p2.waitForTimeout(1200);
  console.log('REABRIR enlace usado:',(await p2.innerText('body')).split('\n').filter(Boolean).slice(0,8).join(' | '));
  // POST directo duplicado con la misma clave
  const tok=url.split('/pedido/')[1];
  const body={lines:[{id:'1001',qty:1,unit:'ud'}],delivery:'2026-11-03'};
  const rs=await Promise.all([1,2,3].map(()=>fetch('http://localhost:3000/pedido/'+tok,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(async r=>r.status+' '+(await r.text()).slice(0,80))));
  console.log('3 POST directos tras enviar:',rs);
  console.log('ERRS',errs); await b.close();
})();
