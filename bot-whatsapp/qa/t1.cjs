const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:420,height:800}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  const r = await p.goto('http://localhost:3000/demo'); console.log('status',r.status());
  await p.waitForTimeout(1000);
  console.log('INPUTS', await p.$$eval('input,textarea,button',e=>e.map(x=>x.tagName+':'+(x.id||x.placeholder||x.innerText).slice(0,40))));
  console.log('TEXT', (await p.innerText('body')).slice(0,600));
  await p.screenshot({path:'t1-a.png'});
  console.log('ERRS',errs);
  await b.close();
})();
