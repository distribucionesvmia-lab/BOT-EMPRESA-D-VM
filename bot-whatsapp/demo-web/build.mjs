// Construye la demo en línea (un solo archivo HTML, sin servidor):  node demo-web/build.mjs
// Necesita esbuild (se descarga con npx la primera vez). Genera:
//   demo-web/dist/artifact.html     fragmento para publicar como página de Claude (Artifact)
//   demo-web/dist/demo-online.html  página completa, para alojar en cualquier hosting estático
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const dist = path.join(here, "dist");
fs.mkdirSync(dist, { recursive: true });

const bundle = path.join(dist, "bundle.js");
execFileSync("npx", ["--yes", "esbuild@0.28.2", path.join(here, "entry.js"), "--bundle", "--format=iife", "--minify", "--target=es2020", `--outfile=${bundle}`], { stdio: "inherit" });

// La mini-aplicación de pedido es la misma pedido.html del servidor; su fetch se redirige a la demo por postMessage
const shim = `<script>(()=>{const w=new Map();let n=0;
window.fetch=(url,o)=>new Promise(r=>{const id=++n;w.set(id,r);parent.postMessage({vmApi:id,url:String(url),method:(o&&o.method)||"GET",body:(o&&o.body)||null},"*")});
addEventListener("message",e=>{const d=e.data;if(d&&d.vmApiRes){const r=w.get(d.vmApiRes);w.delete(d.vmApiRes);r({ok:d.status<400,status:d.status,json:async()=>d.json})}});
parent.postMessage({vmReady:true},"*");})();</script>`;
const mini = fs.readFileSync(path.join(root, "pedido.html"), "utf8").replace("<head>", "<head>" + shim);

// TARIFA_JSON=ruta.json (de tarifa-a-json.js): vista previa con productos reales. El resultado lleva precios reales: NO se sube al repositorio.
const tarifa = process.env.TARIFA_JSON ? `window.__VM_TARIFA__=${fs.readFileSync(process.env.TARIFA_JSON, "utf8")};` : "";
// FOTOS_DIR=carpeta (de tarifa-a-json.js --fotos): se incrustan como imágenes en la página (precio en tamaño: unos 7 MB)
let fotos = "";
if (process.env.FOTOS_DIR) {
  const mt = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }, m = {};
  const ids = process.env.TARIFA_JSON ? new Set(JSON.parse(fs.readFileSync(process.env.TARIFA_JSON, "utf8")).map((p) => String(p.id))) : null; // solo las fotos de los productos de la lista
  for (const f of fs.readdirSync(process.env.FOTOS_DIR)) { if (ids && !ids.has(f.replace(/\.[^.]+$/, ""))) continue; const [id, ext] = [f.replace(/\.[^.]+$/, ""), f.split(".").pop().toLowerCase()]; if (mt[ext]) m[id] = `data:${mt[ext]};base64,` + fs.readFileSync(path.join(process.env.FOTOS_DIR, f)).toString("base64"); }
  fotos = `window.__VM_FOTOS__=${JSON.stringify(m)};`;
}
// HISTORIAL_JSON=ruta.json (de historial-a-json.js): pone ese histórico a los clientes indicados. Lleva datos de clientes: NO se sube al repositorio.
const historial = process.env.HISTORIAL_JSON ? `window.__VM_HISTORIAL__=${fs.readFileSync(process.env.HISTORIAL_JSON, "utf8")};` : "";
// NIF_JSON=ruta.json (de nif-demo-a-json.js): huellas de los 6 últimos caracteres del NIF (no el NIF) para poder entrar aunque la base no tenga el índice.
const nifs = process.env.NIF_JSON ? `window.__VM_NIF__=${fs.readFileSync(process.env.NIF_JSON, "utf8")};` : "";
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const page = fs
  .readFileSync(path.join(here, "page.html"), "utf8")
  .replace("/*__BUNDLE__*/", () => safe(tarifa + fotos + historial + nifs + fs.readFileSync(bundle, "utf8")))
  .replace("/*__MINI__*/", () => safe(JSON.stringify(mini)));

fs.writeFileSync(path.join(dist, "artifact.html"), page);
fs.writeFileSync(
  path.join(dist, "demo-online.html"),
  `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);
fs.rmSync(bundle);
console.log("Listo:", fs.readdirSync(dist).join(", "));
