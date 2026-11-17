// «Tu resumen del mes» (Mi cuenta): cuánto ha comprado el cliente, qué es lo que más pide y cuánto se ha ahorrado frente a la tarifa
// (descuentos y ofertas). Función pura: el servidor le pasa los pedidos ya valorados. Solo LEE; no guarda nada.
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const mesDe = (fecha) => String(fecha ?? "").slice(0, 7);
export const nombreMes = (mes) => { const m = /^(\d{4})-(\d{2})$/.exec(mes ?? ""); return m ? `${MESES[Number(m[2]) - 1] ?? mes} de ${m[1]}` : String(mes ?? ""); };
export const mesAnterior = (mes) => { const [a, m] = mes.split("-").map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`; };
const c2 = (n) => Math.round(n * 100) / 100;

/**
 * pedidos: [{ fecha: "AAAA-MM-DD", aprox: bool, total: € con IVA, lineas: [{ nombre, unidades, ahorro: € }] }]
 *   (aprox = pedido de a3ERP sin precios guardados: valorado con los precios de hoy).
 * mes: "AAAA-MM" (si no viene o no tiene pedidos, el último mes con pedidos); hoy: "AAAA-MM-DD" (para no enseñar meses futuros).
 */
export function resumenMensual({ pedidos, mes = null, hoy = null }) {
  const validos = (pedidos ?? []).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p?.fecha)) && (!hoy || mesDe(p.fecha) <= mesDe(hoy)));
  const meses = [...new Set(validos.map((p) => mesDe(p.fecha)))].sort().reverse().slice(0, 12);
  if (!meses.length) return { hay: false, meses: [] };
  const elegido = meses.includes(mes) ? mes : meses[0];
  const calcula = (m) => {
    const del = validos.filter((p) => mesDe(p.fecha) === m), art = new Map();
    let total = 0, ahorro = 0, aprox = false;
    for (const p of del) {
      total += Number(p.total) || 0; if (p.aprox) aprox = true;
      for (const l of p.lineas ?? []) {
        ahorro += Math.max(0, Number(l.ahorro) || 0);
        const k = String(l.nombre ?? "").trim(); if (!k) continue;
        art.set(k, (art.get(k) ?? 0) + (Number(l.unidades) || 0));
      }
    }
    return { pedidos: del.length, total: c2(total), ahorro: c2(ahorro), aprox, masPedidos: [...art].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).slice(0, 5).map(([nombre, unidades]) => ({ nombre, unidades })) };
  };
  const act = calcula(elegido), antM = mesAnterior(elegido), ant = calcula(antM);
  return {
    hay: true, mes: elegido, titulo: nombreMes(elegido), meses: meses.map((m) => ({ mes: m, titulo: nombreMes(m) })), ...act,
    anterior: { mes: antM, titulo: nombreMes(antM), pedidos: ant.pedidos, total: ant.total },
    variacion: ant.total > 0 ? Math.round(((act.total - ant.total) / ant.total) * 100) : null, // % de gasto frente al mes anterior; sin mes anterior, nada
  };
}
