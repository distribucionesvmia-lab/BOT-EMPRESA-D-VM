const { chromium } = require('playwright');
const fs=require('fs');
(async () => {
  const b = await chromium.launch(); const ctx=await b.newContext({viewport:{width:1100,height:850},acceptDownloads:true}); const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('response',r=>{if(r.status()>=400)errs.push('HTTP '+r.status()+' '+r.url().slice(-45))});
  p.on('dialog',d=>{console.log('DIALOG:',d.message());d.accept()});
  await p.goto('http://localhost:3000/distribuidor'); await p.locator('input').first().fill('demo'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  // Exportar seleccionados con 0 marcados
  console.log('btn sel deshabilitado con 0:', await p.locator('#exportar-sel').isDisabled());
  // marcar el primero y exportar seleccionados
  await p.locator('tbody input[type=checkbox]').first().check(); await p.waitForTimeout(300);
  console.log('texto botón:', await p.locator('#exportar-sel').innerText());
  await p.locator('#exportar-sel').click(); await p.waitForTimeout(2000);
  console.log('PANEL tras exportar sel:', (await p.innerText('body')).split('\n').filter(Boolean).filter(x=>/exportad|Exportaci|VM-2026|Excel|\.xlsx|pendiente|Error|error/i.test(x)).slice(0,14).join(' | ').slice(0,900));
  // exportar todos los pendientes
  await p.locator('#exportar').click(); await p.waitForTimeout(2000);
  console.log('PANEL tras exportar todos:', (await p.innerText('body')).split('\n').filter(Boolean).filter(x=>/exportad|Exportaci|VM-2026|\.xlsx|Error|No hay/i.test(x)).slice(0,14).join(' | ').slice(0,900));
  // exportar otra vez sin pendientes
  await p.locator('#exportar').click(); await p.waitForTimeout(1500);
  console.log('2º exportar sin pendientes:', (await p.innerText('body')).split('\n').filter(Boolean).filter(x=>/No hay|nada|pendientes|Error/i.test(x)).slice(0,5).join(' | '));
  console.log('ERRS',errs); await b.close();
})();
