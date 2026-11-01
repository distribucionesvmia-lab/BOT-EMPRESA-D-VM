const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390,height:800}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34610000580',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); await p.goto(d.ui.url); await p.waitForTimeout(1200);
  const rows=async()=> (await p.locator('.add').count());
  const names=async()=> (await p.$$eval('.n',e=>e.map(x=>x.textContent))).join(' | ');
  for (const q of ['cervesa','cerbeza','refresco','refrezco','agua','vino','vinoo','zzzzz','pataats','sumo']) { await p.fill('#q',q); await p.waitForTimeout(350); console.log(`«${q}» →`, (await names()) || (await p.innerText('.vacio').catch(()=> '(vacío)')).slice(0,40)); }
  await p.fill('#q',''); await p.waitForTimeout(300);
  const fila=p.locator('.pr',{hasText:'0,62'}).first(); console.log('fila cerveza:', (await fila.innerText()).replace(/\n/g,' | '));
  console.log('ERRS',errs); await b.close();
})();
