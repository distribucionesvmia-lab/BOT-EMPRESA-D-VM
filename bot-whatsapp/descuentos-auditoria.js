// Vigilancia de los DESCUENTOS de artículo al subir el Excel de artículos (dinero en juego: un descuento de más o de menos es un error grave).
// Compara los descuentos que hay con los que quedarían tras aplicar el Excel y dice qué hay que mirar y confirmar. Solo lee: no cambia nada.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dto = (p) => num(p?.discount);
const pc = (n) => `${String(Math.round(n * 100) / 100).replace(".", ",")} %`;

/** { ganan, pierden, cambian, conAntes, conDespues, catalogo }: qué artículos ganan, pierden o cambian de descuento. */
export function cambiosDeDescuento(actual, resultado) {
  const antes = new Map(actual.map((p) => [String(p.id), p]));
  const ganan = [], pierden = [], cambian = [];
  for (const p of resultado) {
    const a = antes.get(String(p.id)), x = a ? dto(a) : 0, y = dto(p);
    if (x === y) continue;
    const f = { id: String(p.id), nombre: p.name, antes: x, despues: y };
    (x === 0 ? ganan : y === 0 ? pierden : cambian).push(f);
  }
  return {
    ganan, pierden, cambian,
    conAntes: actual.filter((p) => p.active !== false && dto(p) > 0).length,
    conDespues: resultado.filter((p) => dto(p) > 0).length,
    catalogo: resultado.length,
  };
}

/** Lo que hay que enseñar y confirmar: { confirmar: [texto], aviso: [texto], detalle: [{ id, nombre, motivo }] }. */
export function revisarDescuentos(c, { columna = "" } = {}) {
  const confirmar = [], aviso = [], tocados = c.ganan.length + c.pierden.length + c.cambian.length;
  if (tocados >= 10 && tocados > c.catalogo * 0.05) confirmar.push(`${tocados} artículos cambian de descuento (${c.ganan.length} lo ganan, ${c.pierden.length} lo pierden, ${c.cambian.length} cambian de porcentaje). Revisa la lista «Descuentos que cambian» antes de aplicar.`);
  const altos = [...c.ganan, ...c.cambian].filter((x) => x.despues >= 50).sort((a, b) => b.despues - a.despues);
  if (altos.length) confirmar.push(`${altos.length} artículos tendrían un descuento de 50 % o más (el mayor: ${altos[0].id} ${altos[0].nombre}, ${pc(altos[0].despues)}). Comprueba que es correcto.`);
  if (c.catalogo >= 20 && c.conDespues > c.catalogo * 0.4 && c.conDespues > c.conAntes) confirmar.push(`Tras aplicarlo, ${c.conDespues} de ${c.catalogo} artículos (el ${Math.round((c.conDespues / c.catalogo) * 100)} %) tendrían descuento. Es mucho: puede que se haya leído la columna equivocada.`);
  if (columna) aviso.push(`Los descuentos se leen de la columna «${columna}». Comprueba que es el descuento de venta y no otro (por ejemplo, de compra). Hoy hay ${c.conAntes} artículos con descuento y quedarían ${c.conDespues}.`);
  else if (c.conAntes > 0) aviso.push(`El Excel no trae columna de descuento: no se cambia ningún descuento (hoy hay ${c.conAntes} artículos con descuento).`);
  const detalle = [...c.ganan.map((x) => ({ ...x, tipo: "NUEVO" })), ...c.cambian.map((x) => ({ ...x, tipo: "CAMBIA" })), ...c.pierden.map((x) => ({ ...x, tipo: "SE QUITA" }))]
    .map((x) => ({ id: x.id, nombre: x.nombre, motivo: `${x.tipo}: ${pc(x.antes)} → ${pc(x.despues)}` }));
  return { confirmar, aviso, detalle };
}
