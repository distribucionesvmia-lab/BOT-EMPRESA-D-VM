// Deja conectada la herramienta «vm-pedidos» en Claude Desktop SIN tener que editar a mano el archivo de configuración (donde una coma de más lo estropea todo).
// Busca el archivo claude_desktop_config.json (también el de la versión de la tienda de Windows), guarda una copia, añade la conexión conservando todo lo demás y comprueba que queda bien.
//   Uso: node conectar-claude-desktop.js            → conecta
//        node conectar-claude-desktop.js --quitar   → desconecta
//        node conectar-claude-desktop.js --archivo "C:\ruta\claude_desktop_config.json"   → si no lo encuentra solo
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOMBRE = "vm-pedidos";
// El bloque que se pidió pegar a mano (si alguien lo pegó mal, se retira antes de volver a ponerlo bien)
const BLOQUE_A_MANO = /\s*"mcpServers"\s*:\s*\{\s*"vm-pedidos"\s*:\s*\{[^{}]*\{[^{}]*\}[^{}]*\}\s*\}\s*,?/;

/** Rutas posibles del archivo de configuración de Claude Desktop que existen en este ordenador. */
export function buscarConfiguraciones(env = process.env) {
  const rutas = [], NOMBRE_ARCHIVO = "claude_desktop_config.json";
  const carpetasClaude = (base) => { try { return fs.readdirSync(base).filter((n) => /^claude/i.test(n)).map((n) => path.join(base, n)); } catch { return []; } };
  if (env.APPDATA) for (const c of carpetasClaude(env.APPDATA)) rutas.push(path.join(c, NOMBRE_ARCHIVO)); // «Claude» y variantes («Claude-3p»…)
  if (env.LOCALAPPDATA) { // instalación de la tienda de Windows: la configuración vive dentro de la carpeta del paquete (el nombre del paquete varía)
    const paquetes = path.join(env.LOCALAPPDATA, "Packages");
    try { for (const p of fs.readdirSync(paquetes)) for (const c of carpetasClaude(path.join(paquetes, p, "LocalCache", "Roaming"))) rutas.push(path.join(c, NOMBRE_ARCHIVO)); } catch { /* sin carpeta de paquetes */ }
    for (const c of carpetasClaude(env.LOCALAPPDATA)) { // p. ej. Local\\Claude-Data\\claude_pzs8sxrjxfjjc\\claude_desktop_config.json (el archivo, o una subcarpeta con él)
      rutas.push(path.join(c, NOMBRE_ARCHIVO));
      try { for (const sub of fs.readdirSync(c, { withFileTypes: true })) if (sub.isDirectory()) rutas.push(path.join(c, sub.name, NOMBRE_ARCHIVO)); } catch { /* sin subcarpetas */ }
    }
  }
  return [...new Set(rutas)].filter((r) => fs.existsSync(r));
}

/**
 * Pone (o quita) la conexión en un archivo de configuración. Devuelve { cambio: "añadida"|"actualizada"|"quitada"|"sin cambios", arreglado: bool }.
 * Nunca toca el archivo si no queda JSON válido. Guarda una copia «.antes-de-vm-pedidos» la primera vez.
 */
export function configurar(archivo, { node, script, envFile, url = "http://localhost:3001", quitar = false }) {
  const texto = fs.readFileSync(archivo, "utf8").replace(/^\uFEFF/, "");
  let json, arreglado = false;
  const leer = (t) => (t.trim() ? JSON.parse(t) : {});
  try { json = leer(texto); }
  catch (e) {
    // quizá lo pegado a mano está mal puesto: se retira el bloque y cualquier resto de texto suelto (comillas invertidas, la palabra «json»…) entre la primera «{» y la primera clave
    const limpio = texto.replace(BLOQUE_A_MANO, "").replace(/^(\s*\{)([^"}]*)/, (m, llave, resto) => (resto.trim() ? llave + "\n  " : m));
    try { json = leer(limpio); arreglado = limpio !== texto; } catch { json = null; }
    if (!arreglado) { const err = new Error(`El archivo de configuración tiene un error y no he querido tocarlo (${e.message}).`); err.codigo = "json"; throw err; }
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("El archivo de configuración no tiene el formato esperado.");
  const copia = archivo.replace(/\.json$/, ".antes-de-vm-pedidos.json");
  const antes = JSON.stringify(json.mcpServers?.[NOMBRE] ?? null);
  let cambio;
  if (quitar) {
    if (!json.mcpServers?.[NOMBRE]) return { cambio: "sin cambios", arreglado };
    delete json.mcpServers[NOMBRE]; if (!Object.keys(json.mcpServers).length) delete json.mcpServers; cambio = "quitada";
  } else {
    const entrada = { command: node, args: [script], env: { VM_URL: url, VM_ENV_FILE: envFile } };
    json.mcpServers = { ...(json.mcpServers ?? {}), [NOMBRE]: entrada };
    cambio = antes === "null" ? "añadida" : antes === JSON.stringify(entrada) ? "sin cambios" : "actualizada";
    if (cambio === "sin cambios" && !arreglado) return { cambio, arreglado };
  }
  const nuevo = JSON.stringify(json, null, 2) + "\n";
  JSON.parse(nuevo); // por si acaso: lo que se escribe es JSON válido
  if (!fs.existsSync(copia)) fs.writeFileSync(copia, texto);
  fs.writeFileSync(archivo + ".tmp", nuevo); fs.renameSync(archivo + ".tmp", archivo); // se escribe entero y de golpe
  return { cambio, arreglado };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quitar = process.argv.includes("--quitar");
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "vm-mcp.js");
  const envFile = process.env.VM_ENV_FILE || "C:\\vm\\config\\empresa.env";
  const i = process.argv.findIndex((x) => x === "--archivo" || x.startsWith("--archivo=")), indicado = i < 0 ? null : process.argv[i].includes("=") ? process.argv[i].split("=").slice(1).join("=") : process.argv[i + 1];
  const hallados = indicado ? (fs.existsSync(indicado) ? [path.resolve(indicado)] : []) : buscarConfiguraciones(); // --archivo "ruta": si no lo encuentra solo
  if (!hallados.length) { console.log("No encuentro el archivo de configuración de Claude Desktop.\nAbre Claude Desktop → Ajustes → Desarrollador → «Editar configuración» una vez (así se crea) y vuelve a ejecutar esto."); process.exit(1); }
  if (!quitar && !fs.existsSync(envFile)) console.log(`Aviso: no existe ${envFile}. La conexión necesita la clave de la empresa de ese archivo (si está en otro sitio, ejecútalo con la variable VM_ENV_FILE).`);
  let mal = false;
  for (const archivo of hallados) {
    try {
      const r = configurar(archivo, { node: process.execPath, script, envFile, quitar });
      console.log(`${archivo}\n  → ${r.cambio === "sin cambios" ? "ya estaba como debe" : "conexión " + r.cambio}${r.arreglado ? " (he retirado lo que se había pegado a mano y estaba mal puesto)" : ""}.`);
    } catch (e) { mal = true; console.log(`${archivo}\n  → NO se ha tocado: ${e.message}`); }
  }
  if (!mal && !quitar) console.log("\nAhora CIERRA Claude Desktop del todo (también el icono junto al reloj) y ábrelo otra vez. En «Servidores MCP locales» debe salir vm-pedidos.");
  process.exit(mal ? 1 : 0);
}
