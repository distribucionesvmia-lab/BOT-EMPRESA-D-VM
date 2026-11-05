const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:3000/distribuidor'); await p.waitForTimeout(600);
  for (const k of ['mala','otra mala','demo']) { await p.locator('#clave').fill(k); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
    console.log(`clave «${k}» →`, (await p.locator('#l-err').innerText()).trim()||'(sin error)', '| panel visible:', await p.locator('#app').isVisible()); }
  await b.close();
})();
