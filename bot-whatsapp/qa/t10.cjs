const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs=[];
  const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34690000001',text:t})})).json());
  await post('hola'); const d=await post('Bar El Ejemplo'); const link=d.ui.url;
  const r = await fetch('http://localhost:3000/api/acceso',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nif:'00001R'})});
  const ck=r.headers.get('set-cookie').split(';')[0].split('=');
  for (const [w,h] of [[320,568],[360,640]]) for (const [name,url,auth] of [['cliente (login)','/cliente',false],['pedido (enlace)',link,false],['catálogo (cuenta)','/catalogo',true],['acceso /','/',false]]) {
    const ctx = await b.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true,reducedMotion:'no-preference'});
    if(auth) await ctx.addCookies([{name:ck[0],value:ck.slice(1).join('='),url:'http://localhost:3000'}]);
    const p = await ctx.newPage(); p.on('pageerror',e=>errs.push(name+' '+e.message));
    await p.goto(url.startsWith('http')?url:'http://localhost:3000'+url); await p.waitForTimeout(1300);
    const m = await p.evaluate(()=>{
      const de=document.documentElement; const over=de.scrollWidth-de.clientWidth;
      const small=[...document.querySelectorAll('button,a,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&(r.height<36||r.width<36)}).map(e=>(e.id||e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)+':'+(e.innerText||e.ariaLabel||'').slice(0,12));
      const tiny=[...document.querySelectorAll('body *')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).length;
      const meta=document.querySelector('meta[name=viewport]')?.content;
      const noLabel=[...document.querySelectorAll('input,select,textarea')].filter(e=>!(e.labels?.length||e.ariaLabel||e.placeholder||e.title)).length;
      return {over,small:small.slice(0,6),smallN:small.length,tiny,meta,noLabel,title:document.title,lang:document.documentElement.lang};
    });
    console.log(`[${w}x${h}] ${name}:`,JSON.stringify(m));
    await p.screenshot({path:`t10-${w}-${name.replace(/\W+/g,'')}.png`}); await ctx.close();
  }
  console.log('ERRS',errs); await b.close();
})();
