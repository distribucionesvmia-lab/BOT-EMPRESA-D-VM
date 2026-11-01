const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:420,height:800}});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  await p.goto('http://localhost:3000/demo'); await p.waitForTimeout(800);
  const say = async (t)=>{ await p.fill('#t',t).catch(async()=>{await p.fill('input',t)}); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
    const txt = await p.innerText('body'); const chat = txt.split('LO QUE VE EL NEGOCIO')[0]; console.log('\n>>',JSON.stringify(t),'\n', chat.split('\n').slice(-8).join('\n')); };
  for (const t of ['Panadería Fantasma 123','bar','Bar','xx','asdf qwerty','nuevo']) await say(t);
  console.log('ERRS',errs); await b.close();
})();
