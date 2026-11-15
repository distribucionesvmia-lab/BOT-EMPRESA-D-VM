// Escáner de secretos: busca claves, bases de datos, Excel reales y datos de clientes en lo que va a GitHub.
// Uso:  node escaner-secretos.js            → revisa todos los archivos que git sigue
//       node escaner-secretos.js --staged   → revisa solo lo que está a punto de entrar en un commit (lo usa .githooks/pre-commit)
// Sale con código 1 si encuentra algo. Solo LEE; nunca enseña el valor encontrado entero.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const EXTENSIONES_PROHIBIDAS = /\.(sqlite3?|sqlite-wal|sqlite-shm|db|bak|xlsx?|xlsm|zip|pem|key|p12|pfx|jks|kdbx|rar|7z)$|(^|\/)\.env(\.[^/]*)?$|(^|\/)[^/]*\.env$/i;
export const PERMITIDOS = /\.(env\.example|example)$|(^|\/)\.env\.example$|(^|\/)(ejemplo|test-fixtures)\//i; // plantillas sin valores
const CARPETAS_PROHIBIDAS = /(^|\/)(inicial|entrada|respaldos|datos-iniciales[^/]*|vm\/(datos|config|logs))\//i;

/** Patrones de claves reales. Cada uno lleva su nombre; el valor nunca se muestra entero. */
export const PATRONES = [
  ["clave privada", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ["clave de Google/Firebase", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token de GitHub", /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{30,}\b/],
  ["token de Slack", /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ["clave tipo sk-", /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ["clave de AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["token de Meta/WhatsApp", /\bEAA[A-Za-z0-9]{60,}\b/],
  ["credencial de Google (JSON)", /"private_key_id"\s*:\s*"[0-9a-f]{20,}"/],
  ["dirección con usuario y clave", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:[^\s:@\/]{4,}@[^\s\/]+/i],
  ["clave del programa con valor", /^\s*(?:export\s+)?(ADMIN_TOKEN|NIF_PEPPER|LINK_SECRET|SMTP_PASS|TURNSTILE_SECRET|VAPID_PRIVATE\w*|WHATSAPP_TOKEN|APP_SECRET|VERIFY_TOKEN)[ \t]*=[ \t]*["']?(?![ \t\r\n]|["']|tu[-_ ]|pon[-_ ]|cambia|la-mis|el-mism|ejemplo|xxx|<|\$\{|\.\.\.|changeme|secreto$|clave$)[^\s"'#]{8,}/im],
];
const LIMITE_TEXTO = 2_000_000;
const parece = (b) => !b.subarray(0, 4000).includes(0);

/** Revisa una lista de {ruta, contenido?}. Devuelve [{ruta, motivo}]. */
export function revisar(archivos, leer = (r) => fs.readFileSync(r)) {
  const hallazgos = [];
  for (const ruta of archivos) {
    const r = ruta.replace(/\\/g, "/");
    if (PERMITIDOS.test(r)) { /* plantilla: solo se mira el contenido */ }
    else if (EXTENSIONES_PROHIBIDAS.test(r)) { hallazgos.push({ ruta: r, motivo: "tipo de archivo que nunca debe subirse (base de datos, copia, Excel, ZIP, clave)" }); continue; }
    else if (CARPETAS_PROHIBIDAS.test(r)) { hallazgos.push({ ruta: r, motivo: "carpeta de datos reales" }); continue; }
    let buf; try { buf = leer(ruta); } catch { continue; }
    if (buf.length > LIMITE_TEXTO || !parece(buf)) continue;
    const texto = buf.toString("utf8");
    for (const [nombre, re] of PATRONES) { const m = re.exec(texto); if (m) hallazgos.push({ ruta: r, motivo: `parece una ${nombre}: «${m[0].replace(/\s+/g, " ").slice(0, 12)}…»` }); }
  }
  return hallazgos;
}

/** Archivos que git sigue (o los preparados para commit). */
export function archivosGit(raiz, staged = false) {
  const args = staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] : ["ls-files", "-z"];
  return execFileSync("git", args, { cwd: raiz, encoding: "utf8", maxBuffer: 64e6 }).split("\0").filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const staged = process.argv.includes("--staged");
  const raiz = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const h = revisar(archivosGit(raiz, staged), (r) => fs.readFileSync(path.join(raiz, r)));
  if (h.length) {
    console.error(`\n⛔ SEGURIDAD: ${h.length} cosa(s) que NO deben subirse a GitHub:\n`);
    for (const x of h) console.error(`  • ${x.ruta}\n      ${x.motivo}`);
    console.error("\nQuítalas del commit (git reset <archivo>) y, si era una clave de verdad, CÁMBIALA: asume que ya no es secreta.\n");
    process.exit(1);
  }
  console.log(`✔ Sin secretos ni datos reales en ${staged ? "lo que vas a subir" : "el repositorio"}.`);
}
