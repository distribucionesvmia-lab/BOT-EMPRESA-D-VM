// Mide la mini-app de pedido en muchos tamaños de pantalla: desbordes, botones que cambian de tamaño, textos cortados.
const { chromium } = require('playwright');
const SIZES = [[320,568,'móvil muy pequeño'],[360,640,'Android típico'],[375,667,'iPhone SE'],[390,844,'iPhone 14'],[412,915,'Android grande'],[568,320,'móvil apaisado'],[768,1024,'tablet'],[1024,768,'tablet apaisada'],[1440,900,'portátil']];
(async () => {
  const b = await chromium.launch();
  const post = async (t, ph) => (await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:ph,text:t})})).json());
  const rows = [];
  for (const [w,h,name] of SIZES) {
    const ph = '3470' + String(w).padStart(3,'0') + String(h).padStart(3,'0');
    await post('hola', ph); const d = await post('Bar El Ejemplo', ph);
    const ctx = await b.newContext({ viewport:{width:w,height:h}, hasTouch: w < 1000, isMobile: w < 800 });
    const p = await ctx.newPage(); await p.goto(d.ui.url); await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const de = document.documentElement, q = s => [...document.querySelectorAll(s)];
      const vis = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden'; };
      const add = q('.add').filter(vis).map(e => e.getBoundingClientRect());
      const big = q('.big').filter(vis).map(e => e.getBoundingClientRect());
      const rowsH = q('.add').filter(vis).map(e => { const r = e.closest('.p, .prod, li, [class*=row]'); return r ? Math.round(r.getBoundingClientRect().height) : 0; });
      const clipped = q('.n').filter(vis).filter(e => e.scrollWidth > e.clientWidth + 1).length;
      const small = q('button,a,input,select').filter(vis).filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length;
      const fs = q('body *').filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(e)).map(e => parseFloat(getComputedStyle(e).fontSize));
      return { over: de.scrollWidth - de.clientWidth, addW: add.length ? [Math.round(Math.min(...add.map(r=>r.width))), Math.round(Math.max(...add.map(r=>r.width)))] : null, addH: add.length ? Math.round(add[0].height) : null,
        bigH: big.length ? Math.round(big[0].height) : null, rowH: rowsH.length ? [Math.min(...rowsH), Math.max(...rowsH)] : null, clipped, smallTargets: small, fontMin: Math.min(...fs), fontMax: Math.max(...fs),
        productsVisible: add.length, appW: Math.round(document.querySelector('.app')?.getBoundingClientRect().width || 0) };
    });
    rows.push({ pantalla: `${w}×${h}`, tipo: name, ...m });
    await p.screenshot({ path: `qa/investigacion/pantalla-${w}x${h}.png` });
    await ctx.close();
  }
  console.table(rows); require('fs').writeFileSync('qa/investigacion/auditoria-pantallas.json', JSON.stringify(rows, null, 1));
  await b.close();
})();
