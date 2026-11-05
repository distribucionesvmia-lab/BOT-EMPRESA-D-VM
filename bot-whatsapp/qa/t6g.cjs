const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:800}}); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(0,80))});
  const r = await fetch('http://localhost:3000/api/acceso',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nif:'00001R'})});
  const ck=r.headers.get('set-cookie').split(';')[0].split('='); await ctx.addCookies([{name:ck[0],value:ck.slice(1).join('='),url:'http://localhost:3000'}]);
  await p.goto('http://localhost:3000/catalogo'); await p.waitForTimeout(1500);
  const hearts = p.locator('button[aria-label^="Marcar como favorito"]');
  console.log('corazones vacíos:', await hearts.count());
  const name = (await hearts.first().getAttribute('aria-label')).replace('Marcar como favorito ','');
  await hearts.first().click(); await p.waitForTimeout(700);
  console.log('tras clic:', await p.locator(`button[aria-label="Quitar de favoritos ${name}"]`).count(), '(1 = marcado) —', name);
  await p.reload(); await p.waitForTimeout(1200);
  console.log('tras recargar sigue marcado:', await p.locator(`button[aria-label="Quitar de favoritos ${name}"]`).count());
  // filtros/ordenación: favoritos primero
  console.log('primer producto:', (await p.locator('.add').first().locator('xpath=ancestor::*[.//button[normalize-space()="Cajas"]][1]').innerText()).split('\n').slice(0,3).join(' | '));
  await p.fill('#q','aqua').catch(()=>{}); await p.waitForTimeout(300);
  await p.fill('#q','agua'); await p.waitForTimeout(400); console.log('buscar agua:', (await p.innerText('body')).split('\n').filter(x=>/AGUA|No hemos/.test(x)).slice(0,3).join(' | '));
  await p.fill('#q','cervesa'); await p.waitForTimeout(400); console.log('buscar «cervesa» (errata):', (await p.innerText('body')).split('\n').filter(x=>/CERVEZA|No hemos/.test(x)).slice(0,2).join(' | '));
  await p.fill('#q','  '); await p.waitForTimeout(300);
  await p.fill('#q','%'); await p.waitForTimeout(300); console.log('buscar «%»:', (await p.innerText('body')).split('\n').filter(x=>/No hemos|REFRESCO/.test(x)).slice(0,2).join(' | '));
  await p.locator(`button[aria-label="Quitar de favoritos ${name}"]`).click(); await p.waitForTimeout(500);
  console.log('quitado:', await p.locator(`button[aria-label="Marcar como favorito ${name}"]`).count());
  console.log('ERRS',errs); await b.close();
})();
