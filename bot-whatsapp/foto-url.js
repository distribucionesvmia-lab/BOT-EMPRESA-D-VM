// Descargar una foto desde una dirección web (para «arrastrar una foto de Google» en el panel de la empresa). Solo la baja y la devuelve:
// NO la guarda (el panel la enseña y, si la oficina confirma, la sube por el camino de siempre). Protegido contra SSRF: solo http/https,
// solo direcciones públicas (se resuelve el nombre, se comprueba CADA dirección y se conecta justo a la comprobada), redirecciones revisadas una a una,
// tiempo y tamaño limitados, y se comprueba que lo descargado es de verdad una foto JPG, PNG o WebP.
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";

export const MAX_BYTES = 6_000_000, MAX_REDIRECCIONES = 3, TIEMPO_MS = 12_000;

/** ¿Es una dirección IP de internet de verdad (no la propia máquina, ni la red de la oficina, ni especiales)? */
export function ipPublica(ip) {
  const t = String(ip ?? "").trim().toLowerCase();
  if (net.isIPv4(t)) {
    const [a, b] = t.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // Tailscale / CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(t)) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(t); if (m) return ipPublica(m[1]);
    if (t === "::" || t === "::1") return false;
    if (/^f[cd]/.test(t) || /^fe[89ab]/.test(t) || /^ff/.test(t)) return false;
    return true;
  }
  return false;
}

/** Tipo de imagen por el contenido (no por lo que diga la dirección o el servidor). */
export function tipoDeImagen(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export function pedir(url, ip, { maxBytes, tiempoMs }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: "GET", servername: net.isIP(url.hostname) ? undefined : url.hostname,
      lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address: ip, family: net.isIPv6(ip) ? 6 : 4 }]) : cb(null, ip, net.isIPv6(ip) ? 6 : 4)), // conecta justo a la dirección que se comprobó (nada de volver a preguntar al DNS)
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VM-fotos)", Accept: "image/jpeg,image/png,image/webp,image/*;q=0.8", "Accept-Encoding": "identity" }, timeout: tiempoMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redir: res.headers.location }); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`La página contestó ${res.statusCode}.`)); }
      const len = Number(res.headers["content-length"]); if (len > maxBytes) { res.destroy(); return reject(new Error("La foto pesa demasiado.")); }
      const trozos = []; let total = 0;
      res.on("data", (c) => { total += c.length; if (total > maxBytes) { res.destroy(); reject(new Error("La foto pesa demasiado.")); } else trozos.push(c); });
      res.on("end", () => resolve({ buf: Buffer.concat(trozos) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("La página tarda demasiado en contestar.")));
    req.on("error", reject);
    req.end();
  });
}

/** Baja la foto de una dirección. Devuelve { buf, tipo } o lanza un Error con un mensaje en español. `resolver` y `maxBytes` se pueden cambiar solo en las pruebas. */
export async function descargarFoto(direccion, { resolver = (h) => dns.lookup(h, { all: true }), maxBytes = MAX_BYTES, tiempoMs = TIEMPO_MS, pedirFn = pedir } = {}) {
  let url;
  try { url = new URL(String(direccion ?? "").trim()); } catch { throw new Error("Esa dirección no es válida."); }
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Solo valen direcciones que empiecen por http o https.");
    if (url.username || url.password) throw new Error("La dirección no puede llevar usuario ni contraseña.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let ips;
    if (net.isIP(host)) ips = [host]; else { try { ips = (await resolver(host)).map((x) => x.address); } catch { throw new Error("No encuentro esa página en internet."); } }
    if (!ips.length || !ips.every(ipPublica)) throw new Error("Esa dirección no es de una página de internet.");
    const r = await pedirFn(url, ips[0], { maxBytes, tiempoMs }).catch((e) => { throw new Error(e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND" ? "No he podido conectar con esa página." : e.message || "No he podido bajar la foto."); });
    if (r.redir) { try { url = new URL(r.redir, url); } catch { throw new Error("La página redirige a una dirección rara."); } continue; }
    const tipo = tipoDeImagen(r.buf);
    if (!tipo) throw new Error("Eso no es una foto JPG, PNG o WebP (puede que la página la proteja). Guárdala en el ordenador y arrástrala desde ahí.");
    return { buf: r.buf, tipo };
  }
  throw new Error("La página redirige demasiadas veces.");
}
