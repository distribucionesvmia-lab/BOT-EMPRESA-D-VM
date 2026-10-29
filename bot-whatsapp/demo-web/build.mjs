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

const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const page = fs
  .readFileSync(path.join(here, "page.html"), "utf8")
  .replace("/*__BUNDLE__*/", () => safe(fs.readFileSync(bundle, "utf8")))
  .replace("/*__MINI__*/", () => safe(JSON.stringify(mini)));

fs.writeFileSync(path.join(dist, "artifact.html"), page);
fs.writeFileSync(
  path.join(dist, "demo-online.html"),
  `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);
fs.rmSync(bundle);
console.log("Listo:", fs.readdirSync(dist).join(", "));
