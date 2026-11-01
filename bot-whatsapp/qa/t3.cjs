const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs=[];
  for (const q of ['Bar El Ejemplo','bar el ejemplo','BAR EL EJEMPLO (FICTICIO)','soy el bar el ejemplo','9001','ejemplo','el ejemplo','Bar Ejemplo']) {
    const p = await b.newPage({viewport:{width:420,height:800}});
    p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
    await p.goto('http://localhost:3000/demo'); await p.waitForTimeout(600);
    await p.fill('#t',q); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    const chat=(await p.innerText('body')).split('LO QUE VE EL NEGOCIO')[0];
    const last=chat.split(q).pop().trim().split('\n').slice(0,9).join(' | ');
    console.log('\n>>',q,'\n  ',last.slice(0,420));
    await p.close();
  }
  console.log('ERRS',errs); await b.close();
})();
