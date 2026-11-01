(async()=>{const post=async t=>(await (await fetch('http://localhost:3000/demo/mensaje',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'34610000559',text:t})})).json());
await post('hola');const d=await post('Bar El Ejemplo');const tok=d.ui.url.split('/pedido/')[1];
const r=await fetch('http://localhost:3000/pedido/'+tok,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'k1',lines:[{id:'1001',qty:1,unit:'ud'}],delivery:'2026-11-03'})});console.log('WEB:',(await r.json()).message)})();
