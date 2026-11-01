const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1100,height:850}});
  const errs=[]; let n403=0; p.on('pageerror',e=>errs.push(e.message)); p.on('response',r=>{if(r.status()===403)n403++; else if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(-45))});
  await p.goto('http://localhost:3000/distribuidor'); await p.waitForTimeout(1200);
  console.log('403 solo por abrir la página (sin teclear nada):',n403);
  await p.locator('input').first().fill('demo'); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
  console.log('tras entrar con la clave buena, 403 acumulados:',n403);
  console.log('PANEL:',(await p.innerText('body')).split('\n').filter(Boolean).slice(0,60).join(' | ').slice(0,1800));
  await p.screenshot({path:'t9-b.png'});
  console.log('ERRS',errs); await b.close();
})();
