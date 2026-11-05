const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('requestfailed',r=>errs.push('REQFAIL '+r.url().slice(0,80)));
  p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(0,90))});
  const r = await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000001',text:'hola'})}); 
  await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000001',text:'hola'})})).json();
  const d = await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34670000001',text:'Bar El Ejemplo'})})).json();
  const url = d.ui.url; console.log('url',url.slice(0,60));
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({path:'t6-a.png'});
  console.log('TEXT', (await p.innerText('body')).slice(0,900));
  console.log('BUTTONS', await p.$$eval('button,input,select',e=>e.map(x=>x.tagName+':'+(x.id||x.className||'').toString().slice(0,25)+':'+((x.innerText||x.placeholder||x.ariaLabel||'')+'').slice(0,20)).slice(0,40)));
  console.log('ERRS',errs); await b.close();
})();
