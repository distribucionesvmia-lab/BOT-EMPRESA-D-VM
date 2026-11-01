const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000008',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const url=d.ui.url;
  // enviar un pedido directo por la API para "gastar" el enlace
  const tok=url.split('/pedido/')[1];
  const r=await fetch('http://localhost:3000/pedido/'+tok,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'x',lines:[{id:'1001',qty:1,unit:'ud'}],delivery:'2026-11-03'})}); console.log('envío 1:',r.status,(await r.text()).slice(0,100));
  await p.goto(url); await p.waitForTimeout(1200);
  await p.locator('.add').nth(1).click(); await p.click('#verCarrito'); await p.click('#confirm'); await p.waitForTimeout(400);
  await p.locator('#whenOpts button').first().click(); await p.waitForTimeout(500); await p.click('#resOk'); await p.waitForTimeout(1200);
  const vis=await p.evaluate(()=>[...document.querySelectorAll('section.screen')].filter(s=>!s.hidden).map(s=>s.id));
  console.log('pantalla visible tras enviar en enlace usado:',vis,'| errRes:',await p.innerText('#errRes'),'| errWhen:',await p.innerText('#errWhen'));
  await b.close();
})();
