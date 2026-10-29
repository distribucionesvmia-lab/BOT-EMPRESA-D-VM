// Escritor mínimo de ficheros .xlsx (sin dependencias): varias hojas, texto y números, estilos por celda.
// El resultado es determinista (mismos datos -> mismos bytes), lo que permite comprobar su huella SHA-256.
import { zip } from "./zip.js";
import { STYLE, workbookFiles } from "./xlsx-files.js";

export { STYLE, workbookFiles };

/** Una hoja con cabecera en negrita en la primera fila. rows: arrays de string | number | null | { v, s }. */
export function buildXlsx(rows, { sheetName = "Hoja1", widths = [] } = {}) {
  return buildWorkbook([{ name: sheetName, widths, rows: rows.map((row, r) => (r === 0 ? row.map((v) => ({ v, s: STYLE.bold })) : row)) }]);
}

/** Libro con varias hojas: sheets = [{ name, widths?, rows }]. Devuelve un Buffer .xlsx */
export function buildWorkbook(sheets) {
  return zip(workbookFiles(sheets));
}
