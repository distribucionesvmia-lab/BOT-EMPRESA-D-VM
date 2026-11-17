// Memoria de resultados por cliente con caducidad corta: lo que se calcula igual para el mismo cliente, el mismo catálogo y los mismos pedidos
// (p. ej. los precios de todo su catálogo, que se piden al abrir el chat y otra vez al abrir el catálogo) se hace UNA vez. Nunca guarda nada en disco.
/** max: entradas como máximo (se va la más antigua); ttlMs: cuánto vale cada resultado. */
export function crearMemo({ max = 30, ttlMs = 20_000, ahora = Date.now } = {}) {
  const m = new Map(); // clave → { v, hasta }; el orden de inserción es el de antigüedad
  return {
    /** Devuelve lo guardado para `clave` o, si no hay o caducó, lo calcula con `calcula()` y lo guarda. Si `calcula` falla, no se guarda nada. */
    get(clave, calcula) {
      const t = ahora(), e = m.get(clave);
      if (e && e.hasta > t) return e.v;
      if (e) m.delete(clave);
      const v = calcula();
      m.set(clave, { v, hasta: t + ttlMs });
      while (m.size > max) m.delete(m.keys().next().value);
      return v;
    },
    borrar() { m.clear(); },
    get tamano() { return m.size; },
  };
}

/** Huella corta de lo que de un cliente cambia lo que se le enseña: sus pedidos (cuántos y el último), precios y descuentos propios, recargo y municipio. */
export function firmaCliente(c) {
  if (!c) return "-";
  let p = 0, d = 0;
  for (const v of Object.values(c.specialPrices ?? {})) p += Math.round(Number(v) * 10000) | 0;
  for (const v of Object.values(c.discounts ?? {})) d += Math.round(Number(v) * 100) | 0;
  const o = c.orders ?? [], u = o[0];
  return [c.id, c.name, (c.usual ?? []).length, JSON.stringify(c.usual ?? []).length, o.length, u?.date ?? "", u?.doc ?? "", o.reduce((t, x) => t + (x.lines?.length ?? 0), 0), Object.keys(c.specialPrices ?? {}).length, p, Object.keys(c.discounts ?? {}).length, d, c.recargoEquivalencia ? 1 : 0, c.municipio ?? ""].join("|");
}
