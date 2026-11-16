#!/usr/bin/env node
// Renueva la lista de rangos de direcciones IP de España (carpeta geo/) desde la fuente pública ipdeny.com. Solo descarga y guarda dos archivos de texto: no manda nada.
// Uso: node actualizar-geo.js        (o deploy\windows\actualizar-geo.bat). Si algo falla o la lista parece rota, NO toca la que hay.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearGeo } from "./geoip.js";

const DIR = process.env.GEO_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "geo");
const FUENTES = [
  ["es-ipv4.txt", "https://www.ipdeny.com/ipblocks/data/aggregated/es-aggregated.zone", "IPv4", 1500],
  ["es-ipv6.txt", "https://www.ipdeny.com/ipv6/ipaddresses/aggregated/es-aggregated.zone", "IPv6", 300],
];
const bajar = (url) => new Promise((ok, mal) => https.get(url, { timeout: 30_000 }, (r) => {
  if (r.statusCode !== 200) { r.resume(); return mal(new Error(`${url} respondió ${r.statusCode}`)); }
  const trozos = []; r.on("data", (c) => trozos.push(c)); r.on("end", () => ok(Buffer.concat(trozos).toString("utf8")));
}).on("error", mal).on("timeout", function () { this.destroy(new Error("sin respuesta")); }));

const hoy = new Date().toISOString().slice(0, 10), nuevos = [];
for (const [archivo, url, nombre, minimo] of FUENTES) {
  const texto = await bajar(url), lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const buenas = lineas.filter((l) => /^[0-9a-fA-F:.]+\/\d{1,3}$/.test(l));
  if (buenas.length < minimo || buenas.length < lineas.length * 0.98) throw new Error(`La lista ${nombre} no parece buena (${buenas.length} rangos de ${lineas.length} líneas). No se cambia nada.`);
  nuevos.push([archivo, `# Rangos de direcciones ${nombre} de España (fuente pública: ipdeny.com). Descargado ${hoy}. Se actualiza con deploy/windows/actualizar-geo.bat\n${buenas.join("\n")}\n`, buenas.length]);
}
if (crearGeo(nuevos[0][1], nuevos[1][1]).clase("8.8.8.8") !== "fuera") throw new Error("La lista nueva no pasa la comprobación. No se cambia nada.");
fs.mkdirSync(DIR, { recursive: true });
for (const [archivo, texto, n] of nuevos) { fs.writeFileSync(path.join(DIR, archivo + ".tmp"), texto); fs.renameSync(path.join(DIR, archivo + ".tmp"), path.join(DIR, archivo)); console.log(`${archivo}: ${n} rangos`); }
console.log("Listo. El programa la recoge solo en unos minutos (o al reiniciar).");
