const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); let dlg=null;
  p.on('dialog',d=>{dlg=d.message();d.dismiss()});
  await p.goto('http://localhost:3000/demo'); await p.waitForTimeout(600);
  for (const t of ['<img src=x onerror=alert(1)>','Bar El Ejemplo','<img src=x onerror=alert(2)> 2 aguas','nota: <b>hola</b><img src=x onerror=alert(3)>']) { await p.fill('#t',t); await p.keyboard.press('Enter'); await p.waitForTimeout(700); }
  console.log('dialog:',dlg, '| imgs en chat:', await p.$$eval('img[src="x"]',e=>e.length));
  await b.close();
})();
