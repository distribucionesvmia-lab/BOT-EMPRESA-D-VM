const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34690000077',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const link=d.ui.url;
  const ctx = await b.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const p = await ctx.newPage(); await p.goto(link); await p.waitForTimeout(1300);
  await p.locator('.add').first().click(); await p.waitForTimeout(300); await p.click('#verCarrito'); await p.waitForTimeout(700);
  console.log('sw/iw',await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth,document.body.scrollWidth,document.querySelector('.screen:not([hidden])')?.id+':'+Math.round(document.querySelector('.screen:not([hidden])')?.getBoundingClientRect().right)]));await p.waitForTimeout(800);console.log('sw/iw +0.8s',await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]));const r=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>321}).map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return (e.tagName+'#'+e.id+'.'+(e.className+'').slice(0,20))+' x='+Math.round(r.left)+'..'+Math.round(r.right)+' vis='+cs.visibility+' disp='+cs.display+' op='+cs.opacity+' tr='+cs.transform.slice(0,24)+' hidden='+e.hidden}).slice(0,12));
  console.log(r.join('\n')); await ctx.close(); await b.close();
})();
