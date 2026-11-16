// Segundo factor del PANEL de la empresa: además de la clave, un código de 6 cifras de una aplicación del móvil (tipo Google Authenticator).
// El secreto se guarda en la base de cuentas (`ajustes`) CIFRADO con una llave derivada de la clave del panel (ADMIN_TOKEN): quien solo tenga la base o una copia no lo puede leer,
// y la aplicación pública de los clientes (que no tiene ADMIN_TOKEN) tampoco. Si se cambia ADMIN_TOKEN, el segundo factor deja de poder leerse: `desactivar-2fa.bat` lo quita.
// Tras acertar el código, el panel recibe un permiso de 12 horas (solo en la memoria del programa: al reiniciar hay que volver a poner un código).
import crypto from "node:crypto";
import { nuevoSecreto, verificarTotp, urlOtp, agrupar } from "./totp.js";

const HORAS = 12, MAX_FALLOS = 5, BLOQUEO_MS = 15 * 60_000;
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const llave = (token) => crypto.scryptSync(String(token ?? ""), "vm-panel-2fa-v1", 32);
const cifrar = (txt, token) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", llave(token), iv), ct = Buffer.concat([c.update(txt, "utf8"), c.final()]); return `v1$${iv.toString("base64")}$${c.getAuthTag().toString("base64")}$${ct.toString("base64")}`; };
const descifrar = (txt, token) => { try { const [v, iv, tag, ct] = String(txt).split("$"); if (v !== "v1") return null; const d = crypto.createDecipheriv("aes-256-gcm", llave(token), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"); } catch { return null; } };
const mismo = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

export function crear2fa(accounts, { token = () => process.env.ADMIN_TOKEN, ahora = () => Date.now(), bypass = () => process.env.ADMIN_2FA_BYPASS, emisor = "Distribuciones VM" } = {}) {
  const sesiones = new Map(), fallos = new Map();
  const secreto = (clave) => { const t = accounts.ajuste(clave); return t ? descifrar(t, token()) : null; };
  const limpia = () => { const n = ahora(); for (const [k, v] of sesiones) if (v <= n) sesiones.delete(k); };
  const api = {
    activo: () => accounts.ajuste("totp_activo") === "1",
    /** true si está activado pero ya no se puede leer el secreto (se cambió ADMIN_TOKEN). */
    ilegible: () => api.activo() && !secreto("totp_secreto"),
    /** ¿Puede esta dirección probar un código ahora? (5 fallos = 15 minutos de espera) */
    puedeProbar(ip) { const f = fallos.get(ip); return !f || f.hasta <= ahora() || f.n < MAX_FALLOS; },
    fallo(ip) { const n = ahora(), f = fallos.get(ip); const nuevo = f && f.hasta > n ? { n: f.n + 1, hasta: n + BLOQUEO_MS } : { n: 1, hasta: n + BLOQUEO_MS }; fallos.set(ip, nuevo); if (fallos.size > 500) for (const [k, v] of fallos) if (v.hasta <= n) fallos.delete(k); return nuevo.n; },
    acierto(ip) { fallos.delete(ip); },
    /** Empieza a activar: crea un secreto nuevo (todavía NO vale para entrar). */
    preparar() {
      const s = nuevoSecreto(); accounts.ajusteGuardar("totp_pendiente", cifrar(s, token()));
      return { clave: agrupar(s), url: urlOtp(s, "panel de la empresa", emisor) };
    },
    /** Confirma con un código de la aplicación y lo activa. Devuelve los códigos de emergencia (se enseñan UNA vez) o null. */
    activar(codigo) {
      const s = secreto("totp_pendiente"); if (!s) return null;
      const c = verificarTotp(s, codigo, ahora()); if (c === null) return null;
      const rec = Array.from({ length: 8 }, () => { const h = crypto.randomBytes(5).toString("hex").toUpperCase(); return `${h.slice(0, 5)}-${h.slice(5)}`; });
      accounts.ajusteGuardar("totp_secreto", cifrar(s, token())); accounts.ajusteGuardar("totp_ultimo", String(c));
      accounts.ajusteGuardar("totp_recuperacion", JSON.stringify(rec.map(sha))); accounts.ajusteGuardar("totp_activo", "1"); accounts.ajusteGuardar("totp_pendiente", "");
      return rec;
    },
    /** Código de la aplicación (cada código vale una sola vez) o código de emergencia (se gasta). */
    verificar(codigo) {
      const s = secreto("totp_secreto"); if (!s) return false;
      const c = verificarTotp(s, codigo, ahora());
      if (c !== null) { const ult = Number(accounts.ajuste("totp_ultimo") || 0); if (c <= ult) return false; accounts.ajusteGuardar("totp_ultimo", String(c)); return true; }
      const t = String(codigo ?? "").trim().toUpperCase();
      if (/^[0-9A-F]{5}-[0-9A-F]{5}$/.test(t)) { let lista = []; try { lista = JSON.parse(accounts.ajuste("totp_recuperacion") || "[]"); } catch { /* vacía */ } const h = sha(t), i = lista.indexOf(h); if (i >= 0) { lista.splice(i, 1); accounts.ajusteGuardar("totp_recuperacion", JSON.stringify(lista)); return true; } }
      return false;
    },
    recuperacionRestante() { try { return JSON.parse(accounts.ajuste("totp_recuperacion") || "[]").length; } catch { return 0; } },
    desactivar() { for (const k of ["totp_activo", "totp_secreto", "totp_pendiente", "totp_ultimo", "totp_recuperacion"]) accounts.ajusteGuardar(k, ""); sesiones.clear(); },
    abrirSesion() { limpia(); const t = crypto.randomBytes(32).toString("base64url"); sesiones.set(sha(t), ahora() + HORAS * 3_600_000); return t; },
    /** ¿Trae la petición un permiso válido (cabecera X-VM-2FA) o la llave de la conexión con Claude (ADMIN_2FA_BYPASS)? */
    permitida(req) {
      const h = String(req.headers["x-vm-2fa"] ?? ""); if (!h) return false;
      const b = bypass(); if (b && String(b).length >= 20 && mismo(h, b)) return true;
      const exp = sesiones.get(sha(h)); return !!exp && exp > ahora();
    },
  };
  return api;
}
