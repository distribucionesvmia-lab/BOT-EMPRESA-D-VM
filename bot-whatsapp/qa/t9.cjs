const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1100,height:850}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(-45))});
  await p.goto('http://localhost:3000/distribuidor'); await p.waitForTimeout(800);
  console.log('LOGIN:',(await p.innerText('body')).split('\n').filter(Boolean).slice(0,10).join(' | '));
  console.log('controles:',await p.$$eval('input,button',e=>e.map(x=>x.tagName+':'+(x.id||x.type||'')+':'+(x.innerText||x.placeholder||'').slice(0,25)).slice(0,14)));
  // clave errónea
  const inp=p.locator('input').first(); await inp.fill('mala'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  console.log('CLAVE MALA:',(await p.innerText('body')).split('\n').filter(Boolean).slice(0,8).join(' | '));
  await inp.fill('demo'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const body=await p.innerText('body'); console.log('PANEL:',body.split('\n').filter(Boolean).slice(0,45).join(' | ').slice(0,1500));
  await p.screenshot({path:'t9-a.png'});
  console.log('ERRS',errs); await b.close();
})();
