// Qué versión del programa hay: la que se cargó al arrancar (COMMIT_ARRANQUE) y la que hay ahora en el disco (commitEnDisco).
// Si no coinciden, el programa se actualizó pero NO se reinició: sigue funcionando el código antiguo. Se lee de la carpeta .git (sin necesitar git).
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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
export const ARRANCADO = new Date().toISOString(); // cuándo se puso en marcha este programa (= cuándo se desplegó, si se reinicia al actualizar)
/** Fecha del commit (la que le puso quien lo hizo, en formato ISO), pidiéndosela a git una sola vez; null si git no está. */
function fechaDelCommit() {
  try { const r = raiz(); if (!r) return null; const s = execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: r, timeout: 4000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : null; } catch { return null; }
}
const COMMIT_FECHA = fechaDelCommit();
/** Lo que enseña /health: versión en marcha, versión en disco y si falta reiniciar. */
/** Lo que dice el actualizador de la oficina («VM Actualizar»): última comprobación, versión rechazada y última frase relevante del registro. Sin datos de clientes. */
export function estadoActualizador(dir = process.env.ACTUALIZAR_LOGS || (process.platform === "win32" ? "C:\\vm\\logs" : "")) {
  if (!dir) return null;
  const leer = (f, max = 200) => { try { return fs.readFileSync(path.join(dir, f), "utf8").replace(/\r/g, "").trim().slice(0, max); } catch { return null; } };
  const ultima = leer("actualizar.ultima"), mala = leer("actualizar.mala", 64);
  let ultimoAviso = null; try { const l = fs.readFileSync(path.join(dir, "actualizar.log"), "utf8").replace(/\r/g, "").split("\n").filter((x) => /LAS PRUEBAS FALLAN|NO ARRANCA|Actualizado de|No se pudo/.test(x)); ultimoAviso = l.length ? l[l.length - 1].slice(0, 200) : null; } catch { /* sin registro */ }
  return ultima || mala || ultimoAviso ? { ultimaComprobacion: ultima, versionRechazada: mala, ultimoAviso } : null;
}
export function estadoVersion() {
  const enDisco = commitEnDisco();
  return { version: COMMIT_ARRANQUE, commitFecha: COMMIT_FECHA, desplegado: ARRANCADO, enDisco, reinicioPendiente: !!(COMMIT_ARRANQUE && enDisco && COMMIT_ARRANQUE !== enDisco), ruta: path.dirname(fileURLToPath(import.meta.url)), pid: process.pid, node: process.version, actualizacion: estadoActualizador() };
}
