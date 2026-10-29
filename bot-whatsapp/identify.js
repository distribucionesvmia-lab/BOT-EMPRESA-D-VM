// Identificación de un cliente por el nombre que escribe en el chat.
// Función pura (sin base de datos ni red): recibe la lista de clientes y devuelve los que encajan.
//
// Reglas, pensadas para no identificar a nadie por error ni revelar nombres de otros clientes:
//  - Coincidencia exacta del nombre comercial o del código de cliente.
//  - O bien: todas las palabras que escribe están en el nombre y cubren al menos el 60 % de las palabras
//    significativas del nombre ("Bar El Ejemplo" encaja con "Bar El Ejemplo (ficticio)"; "bar" solo, no).
//  - Se ignoran tildes, mayúsculas y palabras de relleno (el, la, de…). Nunca se devuelven coincidencias parciales.

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const FILLER = new Set(["el", "la", "los", "las", "de", "del", "y", "e", "un", "una", "mi", "me", "es", "soy", "somos", "cliente", "nombre", "negocio", "se", "llama"]);
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const significant = (s) => tokens(s).filter((w) => !FILLER.has(w));
// misma palabra, o prefijo de al menos 3 letras
const match = (q, t) => q === t || (q.length >= 3 && t.startsWith(q));

export const MIN_COVERAGE = 0.6;

/** Clientes que encajan con lo escrito; [] si ninguno encaja con suficiente seguridad. */
export function findCustomers(customers, query) {
  const q = norm(query);
  const qWords = significant(q);
  if (!q || !qWords.length) return [];
  const compact = q.replace(/\s+/g, "");
  const strong = [];
  for (const c of customers) {
    if (c.active === false) continue;
    if (norm(c.id) === compact || norm(c.name) === q) {
      strong.push({ c, score: 3 });
      continue;
    }
    const nWords = significant(c.name);
    if (!nWords.length) continue;
    const allKnown = qWords.every((w) => nWords.some((t) => match(w, t)));
    const covered = nWords.filter((t) => qWords.some((w) => match(w, t))).length / nWords.length;
    if (allKnown && covered >= MIN_COVERAGE) strong.push({ c, score: 2 + covered / 10 });
  }
  const best = Math.max(0, ...strong.map((s) => s.score));
  return strong.filter((s) => s.score >= best - 0.05).map((s) => s.c);
}
