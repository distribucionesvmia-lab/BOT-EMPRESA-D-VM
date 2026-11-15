// Lectura de tablas para las importaciones (clientes, productos, historial): Excel (.xlsx) o texto delimitado (.csv/.tsv/.txt).
// El texto lo puede dejar directamente sqlcmd (separador «|») desde el .bat de la oficina, sin instalar nada más; también vale el CSV de Excel.
import { readXlsx } from "./xlsx-read.js";

/** Texto del fichero: UTF-8 (con o sin BOM); si no es UTF-8 válido, Windows-1252 (lo habitual en Windows). */
function decodificar(buf) {
  let t;
  try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { t = new TextDecoder("windows-1252").decode(buf); }
  return t.replace(/^﻿/, "");
}

/** Separador más probable según la primera línea (fuera de comillas): tabulador, «|», «;» o «,». */
function separador(primera) {
  const cuenta = { "\t": 0, "|": 0, ";": 0, ",": 0 };
  let q = false;
  for (const c of primera) { if (c === '"') q = !q; else if (!q && c in cuenta) cuenta[c]++; }
  return Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0];
}

/** CSV/TSV → filas (arrays de texto). Con «,» o «;» (los CSV que guarda Excel) admite comillas dobles con saltos de línea y comillas escapadas.
 *  Con «|» o tabulador (el texto de sqlcmd) las comillas son parte del nombre —p. ej. "2025" BORNOS VERDEJO— y no se interpretan. */
export function leerCsv(buf) {
  const t = decodificar(buf);
  const sep = separador(t.split(/\r?\n/, 1)[0] ?? "");
  const comillas = sep === "," || sep === ";";
  const rows = [];
  let fila = [], campo = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c;
    } else if (comillas && c === '"' && campo === "") q = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x !== "")) rows.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x !== "")) rows.push(fila);
  return rows;
}

/** Filas de un fichero según su nombre: .csv/.tsv/.txt como texto; cualquier otro, como Excel. */
export function leerFilas(buf, nombre = "") {
  return /\.(csv|tsv|txt)$/i.test(nombre) ? leerCsv(buf) : readXlsx(buf);
}
