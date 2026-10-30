// Identificación de un cliente por el nombre que escribe en el chat.
// Función pura (sin base de datos ni red): recibe la lista de clientes y devuelve los que encajan.
//
// Reglas, pensadas para no identificar a nadie por error ni revelar nombres de otros clientes:
//  - Coincidencia exacta del nombre comercial o del código de cliente.
//  - O bien: todas las palabras que escribe están en el nombre y cubren al menos el 60 % de las palabras
//    significativas del nombre ("Bar El Ejemplo" encaja con "Bar El Ejemplo (ficticio)"; "bar" solo, no).
//  - Se ignoran tildes, mayúsculas y palabras de relleno (el, la, de…). Nunca se devuelven coincidencias parciales.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
// Palabras que no identifican: artículos y, sobre todo, la forma jurídica (SL, S.A., CB…): «Tienda Ficticia SL» = «Tienda Ficticia»
const FILLER = new Set(["el", "la", "los", "las", "de", "del", "y", "e", "un", "una", "mi", "me", "es", "soy", "somos", "cliente", "nombre", "negocio", "se", "llama", "sl", "sa", "slu", "sll", "cb", "scp", "sc", "slp", "coop"]);
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w)); // se ignoran las letras sueltas ("S.L." → "s", "l")
const significant = (s) => tokens(s).filter((w) => !FILLER.has(w));
// misma palabra, o prefijo de al menos 3 letras
const match = (q, t) => q === t || (q.length >= 3 && t.startsWith(q));

export const MIN_COVERAGE = 0.6;
// Palabras genéricas de negocio: «bar alegría» y «alegría» son el mismo nombre (solo en modo `lenient`)
const GENERIC = new Set(["bar", "cafe", "cafeteria", "restaurante", "meson", "hotel", "pub", "taberna", "tienda", "bodega", "pizzeria", "asador", "cerveceria"]);

/**
 * Clientes que encajan con lo escrito; [] si ninguno encaja con suficiente seguridad.
 * lenient: para el acceso con NIF (el NIF es lo que identifica de verdad): basta que todas las palabras escritas estén en el
 * nombre, sin exigir cobertura, y se ignoran palabras genéricas como «bar» o «cafetería». Devuelve todos los que encajan.
 */
export function findCustomers(customers, query, { lenient = false } = {}) {
  const q = norm(query);
  const sig = lenient ? (s) => significant(s).filter((w) => !GENERIC.has(w)) : significant;
  const qWords = sig(q);
  if (!q || !qWords.length) return [];
  const compact = q.replace(/\s+/g, "");
  const strong = [];
  for (const c of customers) {
    if (c.active === false) continue;
    const names = [c.name, c.legalName].filter(Boolean); // nombre comercial y razón social valen por igual
    if (norm(c.id) === compact || names.some((n) => norm(n) === q)) {
      strong.push({ c, score: 3 });
      continue;
    }
    let best = 0;
    for (const n of names) {
      const nWords = sig(n);
      if (!nWords.length) continue;
      const allKnown = qWords.every((w) => nWords.some((t) => match(w, t)));
      const covered = nWords.filter((t) => qWords.some((w) => match(w, t))).length / nWords.length;
      if (allKnown && (lenient || covered >= MIN_COVERAGE)) best = Math.max(best, 2 + covered / 10);
    }
    if (best) strong.push({ c, score: best });
  }
  if (lenient) return strong.map((s) => s.c);
  const best = Math.max(0, ...strong.map((s) => s.score));
  return strong.filter((s) => s.score >= best - 0.05).map((s) => s.c);
}
