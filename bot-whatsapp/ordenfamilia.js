// Orden de los artículos como en a3ERP: CÓDIGO DE FAMILIA, CÓDIGO DE SUBFAMILIA y CÓDIGO DE ARTÍCULO.
// El código de familia estadística de a3ERP es «F.S» (p. ej. «1.0» leche, «1.1» botella 1,5 L de Pascual, «27.3» Helios salsas):
//   · F (antes del punto) = familia, se ordena como número (1, 10, 11, 12, 14, 15…);
//   · S (después del punto) = subfamilia, se ordena como en el listado de familias de a3ERP (1.1 < 1.12 < 1.2 < 27.1 < 27.10 < 27.2);
//   · después, el código del artículo (con números ordenados como números: 2 < 10 < 110012).
// Sin código de familia → al final, en el orden que traían. Esta función se usa en el Excel de exportación para a3ERP, en los pedidos que recibe
// la empresa, en el histórico del cliente y en el pedido. (pedido.html lleva una copia del bloque ORDEN-FAMILIA: una prueba vigila que den igual.)

let famDe = () => null;
/** Dice cómo averiguar la familia de un artículo por su código (la pone erp.js con el catálogo). */
export const usarFamilias = (fn) => { famDe = typeof fn === "function" ? fn : () => null; };
export const familiaDe = (id) => { try { return famDe(String(id)) ?? null; } catch { return null; } };

// ORDEN-FAMILIA-INICIO
const limpiaFam = (f) => String(f ?? "").trim().replace(/\.+$/, "");
export function compararFamilias(a, b) {
  const x = limpiaFam(a), y = limpiaFam(b);
  if (!x || !y) return !x && !y ? 0 : !x ? 1 : -1; // sin familia, al final
  const [fa, ...sa] = x.split("."), [fb, ...sb] = y.split(".");
  const na = Number(fa), nb = Number(fb);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (!(Number.isFinite(na) && Number.isFinite(nb)) && fa !== fb) return fa < fb ? -1 : 1;
  const ta = sa.join("."), tb = sb.join(".");
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}
export const compararCodigos = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), "es", { numeric: true });
/** a y b: { family, id }. */
export const compararArticulos = (a, b) => {
  const x = limpiaFam(a.family), y = limpiaFam(b.family);
  if (!x && !y) return 0; // los dos sin familia (datos sin importar de a3ERP todavía): se deja el orden que tenían
  return compararFamilias(x, y) || compararCodigos(a.id, b.id);
};
/** Familia y subfamilia con el nombre de a3ERP: «LECHE» (1.0) o «LECHE › PSC BOTEL 1.5 Y HOSTELERIA» (1.1). */
export function nombreFamilia(codigo, nombres) {
  const c = limpiaFam(codigo); if (!c) return "Sin familia";
  const fam = nombres?.[`${c.split(".")[0]}.0`] ?? null, sub = nombres?.[c] ?? null;
  if (/\.0$/.test(c) || !sub) return fam ?? sub ?? `Familia ${c}`;
  return fam && sub !== fam ? `${fam} › ${sub}` : sub;
}
// ORDEN-FAMILIA-FIN

/** Ordena líneas de pedido o de histórico (estable). Usa l.family si la trae; si no, la busca por el código del artículo. */
export function ordenarLineas(lineas, idDe = (l) => l.id ?? l.product_id ?? l.productId) {
  if (!Array.isArray(lineas) || lineas.length < 2) return lineas;
  return lineas
    .map((l, i) => ({ l, i, a: { family: l.family ?? familiaDe(idDe(l)), id: idDe(l) } }))
    .sort((p, q) => compararArticulos(p.a, q.a) || p.i - q.i)
    .map((x) => x.l);
}

