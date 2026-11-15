// Empareja fotos con artículos por el NOMBRE (las fotos de la web no llevan el código de a3ERP).
// Solo se da por buena una pareja cuando es clara: si hay duda, la foto se queda sin emparejar (mejor ninguna que la foto de otro artículo).
const ABREV = { pasc: "pascual", pascual: "pascual", lt: "l", litro: "l", litros: "l", ltr: "l", gr: "g", grs: "g", kgs: "kg", cl: "cl", ml: "ml", cj: "caja", cja: "caja", uds: "ud", und: "ud", unid: "ud", unidades: "ud", bot: "botella", botellin: "botella", des: "descafeinado", descaf: "descafeinado", hosteleria: "hosteleria", cong: "congelado", congelados: "congelado", congelado: "congelado" };
const RUIDO = new Set(["congelado", "de", "del", "la", "el", "los", "las", "en", "y", "con", "para", "por", "a", "un", "una", "cj", "caja", "ud", "bolsa", "pack", "paq", "ref", "vm"]);

export function fichaNombre(txt) {
  // «Marca · Familia · Producto · formato»: la familia (2.ª parte, solo si hay 4 o más) es de la web y no suele estar en el nombre de a3ERP
  const partes = String(txt ?? "").split(" · "); if (partes.length >= 4) partes.splice(1, 1); txt = partes.join(" ");
  let s = String(txt ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[·|_\-–—/()"'´`.]+/g, " ").replace(/(\d)\s*,\s*(\d)/g, "$1.$2").replace(/(\d+)\.0+\b/g, "$1");
  s = s.replace(/(\d+(?:\.\d+)?)\s*(kg|gr|grs|g|ml|cl|lt|ltr|litros|litro|l)\b/g, (_, n, u) => n + (ABREV[u] ?? u));
  const toks = s.split(/\s+/).filter(Boolean).map((t) => ABREV[t] ?? t).filter((t) => !RUIDO.has(t));
  const medidas = toks.filter((t) => /^\d+(\.\d+)?(kg|g|ml|cl|l)$/.test(t) || /^\d+$/.test(t));
  const medidasN = toks.filter((t) => /^\d+(\.\d+)?(kg|g|ml|cl|l)$/.test(t));
  return { toks: [...new Set(toks.filter((t) => t.length > 1 || /\d/.test(t)))], medidas: medidasN, numeros: medidas };
}

/** fotos: [{clave, nombre}], articulos: [{id, name}] → { parejas:[{foto,id,nombre,puntos}], dudosas:[{foto, candidatos}], sin:[foto] } */
export function emparejar(fotos, articulos, { minimo = 0.6, margen = 0.12 } = {}) {
  const arts = articulos.map((a) => ({ ...a, f: fichaNombre(a.name) }));
  const df = new Map(); for (const a of arts) for (const t of a.f.toks) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t) => Math.log(1 + arts.length / (df.get(t) ?? 1));
  const parejas = [], dudosas = [], sin = [];
  for (const ft of fotos) {
    const f = fichaNombre(ft.nombre); if (!f.toks.length) { sin.push(ft); continue; }
    const total = f.toks.reduce((s, t) => s + idf(t), 0);
    const cand = [];
    for (const a of arts) {
      const aset = new Set(a.f.toks), prefijos = a.f.toks.filter((u) => u.length >= 4 && /^[a-z]+$/.test(u));
      const tiene = (t) => aset.has(t) || (t.length >= 5 && /^[a-z]+$/.test(t) && prefijos.some((u) => t.startsWith(u) || u.startsWith(t)));
      // si la foto dice una medida (1,5 l, 75 cl, 1 kg), el artículo tiene que decir la misma
      if (f.medidas.length && !f.medidas.every((m) => aset.has(m))) continue;
      let ok = 0; for (const t of f.toks) if (tiene(t)) ok += idf(t);
      const cubre = ok / total; if (cubre < 0.5) continue;
      const extra = a.f.toks.filter((t) => !f.toks.includes(t)).reduce((s, t) => s + idf(t), 0), propio = a.f.toks.reduce((s, t) => s + idf(t), 0);
      cand.push({ id: a.id, nombre: a.name, puntos: cubre * (0.75 + 0.25 * (1 - extra / (propio || 1))) });
    }
    cand.sort((x, y) => y.puntos - x.puntos);
    if (!cand.length) sin.push(ft);
    else if (cand[0].puntos >= minimo && (!cand[1] || cand[0].puntos - cand[1].puntos >= margen)) parejas.push({ foto: ft, ...cand[0] });
    else dudosas.push({ foto: ft, candidatos: cand.slice(0, 3) });
  }
  // un artículo no puede quedarse con dos fotos distintas: si pasa, las dos son dudosas
  const por = new Map(); for (const p of parejas) (por.get(p.id) ?? por.set(p.id, []).get(p.id)).push(p);
  const firmes = [];
  for (const [, l] of por) { if (l.length === 1) firmes.push(l[0]); else for (const p of l) dudosas.push({ foto: p.foto, candidatos: [{ id: p.id, nombre: p.nombre, puntos: p.puntos }] }); }
  return { parejas: firmes, dudosas, sin };
}
