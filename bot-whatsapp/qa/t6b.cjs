const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(0,90))});
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000002',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo');
  await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const cart=async()=> (await p.innerText('.cartIcon, #cartIcon, button.cartIcon').catch(()=>'?')).replace(/\n/g,' ');
  const dump=async(l)=>{const t=await p.innerText('body'); console.log('\n##',l,'| carrito:',await cart()); return t;};
  // 1 añadir primer producto en unidades
  await p.click('button.add >> nth=0'); await p.waitForTimeout(500);
  let t=await dump('tras + Añadir cola'); console.log(t.split('\n').slice(0,14).join(' | '));
  // 2 cajas del agua
  await p.click('text=Cajas >> nth=1'); await p.click('button.add >> nth=1'); await p.waitForTimeout(500);
  t=await dump('agua en cajas'); console.log((await p.innerText('body')).split('\n').filter(x=>/€|caja|uds/i.test(x)).slice(-10).join(' | '));
  // 3 buscar
  await p.fill('#q','zzzz'); await p.waitForTimeout(400); t=await dump('buscar zzzz'); console.log(t.split('\n').slice(3,12).join(' | '));
  await p.fill('#q','vino'); await p.waitForTimeout(400); t=await dump('buscar vino'); console.log(t.split('\n').filter(x=>/VINO|resultado|No hay|no encontr/i.test(x)).join(' | '));
  await p.fill('#q',''); 
  // 4 pestaña catálogo
  await p.click('text=☰ Catálogo'); await p.waitForTimeout(500); t=await dump('pestaña catálogo'); console.log(t.split('\n').slice(0,30).join(' | '));
  console.log('ERRS',errs); await p.screenshot({path:'t6-b.png'}); await b.close();
})();
