// Comparación de dos listas de productos (la que hay ahora y la que llega en un Excel nuevo), sin tocar ninguna base de datos.
// Sirve para ver de un vistazo qué se añade, qué se quita y qué cambia (precio, nombre, unidades por caja, IVA, descuento…)
// y para generar la lista resultante. Función pura: la usan el script de actualización y las pruebas.
//
// Regla de oro: lo que el Excel nuevo NO trae, no se toca. Por ejemplo, si el Excel no tiene columna de descuento
// o de categoría, los descuentos y categorías que ya hay se conservan.

const round = (n, d = 4) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);
const limpia = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const upb = (v) => (Number.isInteger(Number(v)) && Number(v) > 1 ? Number(v) : null); // «1» y vacío son lo mismo: se vende suelto

export const CAMPOS = {
  name: "Nombre",
  price: "Precio",
  unitsPerBox: "Unidades por caja",
  vat: "IVA %",
  discount: "Descuento %",
  category: "Categoría",
  subcategory: "Subcategoría",
  active: "Activo",
};

const valor = (p, k) => {
  if (k === "name") return limpia(p.name);
  if (k === "price") return round(p.price);
  if (k === "unitsPerBox") return p.unitsPerBox === undefined ? undefined : upb(p.unitsPerBox); // sin dato: no se toca
  if (k === "vat" || k === "discount") return p[k] == null ? undefined : round(p[k], 2);
  if (k === "category" || k === "subcategory") return limpia(p[k]) || undefined;
  if (k === "active") return p.active !== false;
};

/** ¿Tiene precio válido para poder pedirse? (precio 0 o sin precio: no se puede vender) */
export const vendible = (p) => Number.isFinite(Number(p?.price)) && Number(p.price) > 0;

/**
 * actual: lista que hay ahora (con inactivos si se quiere reconocer los reactivados) · nuevo: lista del Excel · sinPrecioIds: códigos del Excel sin precio.
 * Devuelve { anadidos, quitados, modificados, reactivados, sinPrecio, iguales } donde
 *   anadidos: productos del Excel que no estaban · quitados: estaban activos y ya no vienen (o vienen bloqueados / sin precio)
 *   modificados: [{ id, name, cambios: [{ campo, antes, despues }] }]
 */
export function compararProductos(actual, nuevo, { sinPrecioIds = [] } = {}) {
  const hoy = new Map(actual.map((p) => [String(p.id), p]));
  const sinPrecio = new Set(sinPrecioIds.map(String));
  const res = { anadidos: [], quitados: [], modificados: [], reactivados: [], sinPrecio: [], iguales: 0 };
  const vistos = new Set();
  for (const n of nuevo) {
    const id = String(n.id), a = hoy.get(id);
    vistos.add(id);
    if (!vendible(n)) { sinPrecio.add(id); continue; } // precio 0: tampoco se vende
    if (n.active === false) continue; // bloqueado u obsoleto en a3ERP: se trata más abajo como «quitado»
    if (!a) { res.anadidos.push(n); continue; }
    if (a.active === false) { res.reactivados.push(n); continue; }
    const cambios = [];
    for (const k of Object.keys(CAMPOS)) {
      if (k === "active") continue;
      const nv = valor(n, k);
      if (nv === undefined) continue; // el Excel no trae este dato: se deja como está
      const av = valor(a, k);
      if ((av ?? null) !== (nv ?? null) && !(k === "vat" && av === undefined)) cambios.push({ campo: k, antes: av ?? null, despues: nv });
    }
    if (cambios.length) res.modificados.push({ id, name: limpia(a.name), cambios });
    else res.iguales++;
  }
  for (const a of actual) {
    const id = String(a.id);
    if (a.active === false) continue;
    const n = nuevo.find((x) => String(x.id) === id);
    if (!vistos.has(id)) res.quitados.push({ ...a, motivo: "ya no está en el Excel" });
    else if (n.active === false) res.quitados.push({ ...a, motivo: "bloqueado u obsoleto en a3ERP" });
    else if (!vendible(n)) res.quitados.push({ ...a, motivo: "sin precio en el Excel" });
  }
  res.sinPrecio = [...sinPrecio].filter((id) => !hoy.has(id) || hoy.get(id).active !== false).map((id) => ({ id, name: limpia((nuevo.find((x) => String(x.id) === id) ?? hoy.get(id) ?? {}).name) }));
  return res;
}

/**
 * Lista resultante de aplicar el Excel: los productos activos del Excel (con precio), conservando de la lista actual
 * lo que el Excel no trae (descuento, categoría, IVA si no viene). Los quitados desaparecen de la lista.
 */
export function aplicarProductos(actual, nuevo, { categoriaNueva = () => ({}) } = {}) {
  const hoy = new Map(actual.map((p) => [String(p.id), p]));
  const out = [];
  for (const n of nuevo) {
    if (!vendible(n) || n.active === false) continue;
    const a = hoy.get(String(n.id));
    const base = a ? { ...a } : { ...categoriaNueva(n) };
    const p = { ...base, id: String(n.id), name: limpia(n.name), price: round(n.price) };
    if (n.unitsPerBox !== undefined) p.unitsPerBox = upb(n.unitsPerBox) ?? undefined; // sin dato: se conserva
    if (!p.unitsPerBox) delete p.unitsPerBox;
    for (const k of ["vat", "discount"]) if (n[k] != null) p[k] = round(n[k], 2);
    for (const k of ["category", "subcategory"]) if (limpia(n[k])) p[k] = limpia(n[k]);
    out.push(p);
  }
  return out;
}
