// Qué versión del programa hay: la que se cargó al arrancar (COMMIT_ARRANQUE) y la que hay ahora en el disco (commitEnDisco).
// Si no coinciden, el programa se actualizó pero NO se reinició: sigue funcionando el código antiguo. Se lee de la carpeta .git (sin necesitar git).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function raiz() {
  let d = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) { if (fs.existsSync(path.join(d, ".git"))) return d; d = path.dirname(d); }
  return null;
}
/** Los 7 primeros caracteres del commit que hay ahora en el disco, o null si no se puede saber. */
export function commitEnDisco() {
  try {
    const r = raiz(); if (!r) return null;
    const head = fs.readFileSync(path.join(r, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head.slice(0, 7);
    const ref = head.slice(5).trim(), f = path.join(r, ".git", ref);
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim().slice(0, 7);
    const linea = fs.readFileSync(path.join(r, ".git", "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(" " + ref));
    return linea ? linea.slice(0, 7) : null;
  } catch { return null; }
}
export const COMMIT_ARRANQUE = commitEnDisco();
/** Lo que enseña /health: versión en marcha, versión en disco y si falta reiniciar. */
export function estadoVersion() {
  const enDisco = commitEnDisco();
  return { version: COMMIT_ARRANQUE, enDisco, reinicioPendiente: !!(COMMIT_ARRANQUE && enDisco && COMMIT_ARRANQUE !== enDisco) };
}
