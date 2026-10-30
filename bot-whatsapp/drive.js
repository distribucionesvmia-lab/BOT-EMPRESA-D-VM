// Lectura de ficheros de una carpeta de Google Drive con una CUENTA DE SERVICIO (sin dependencias: JWT firmado con node:crypto).
// La carpeta se comparte con el correo de la cuenta de servicio (permiso de «Lector»): así solo puede leer esa carpeta.
// También hay un origen local (una carpeta del servidor, p. ej. la que sincroniza «Google Drive para escritorio» o donde a3ERP deja los Excel).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const b64 = (x) => Buffer.from(x).toString("base64url");
const SHEET = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** { client_email, private_key, token_uri } desde el JSON de la cuenta de servicio (texto). Nunca se registra su contenido. */
export function parseCredentials(text) {
  let c;
  try { c = JSON.parse(text); } catch { throw new Error("Las credenciales de Google no son un JSON válido."); }
  if (!c?.client_email || !c?.private_key) throw new Error("Faltan client_email o private_key en las credenciales de Google.");
  return c;
}

/**
 * Origen Google Drive. Opciones de prueba: apiBase y tokenUrl (por defecto, los de Google).
 * Devuelve { name, list(), read(file) } con el mismo contrato que localSource.
 */
export function driveSource({ folderId, credentials, fetchFn = fetch, apiBase = "https://www.googleapis.com", tokenUrl = credentials.token_uri || "https://oauth2.googleapis.com/token", now = () => Date.now() }) {
  if (!/^[\w-]{10,}$/.test(String(folderId ?? ""))) throw new Error("El identificador de la carpeta de Drive no es válido.");
  let token = null, until = 0;
  async function accessToken() {
    if (token && now() < until - 60_000) return token;
    const iat = Math.floor(now() / 1000);
    const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64(JSON.stringify({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: tokenUrl, iat, exp: iat + 3600 }));
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claim}`), credentials.private_key).toString("base64url");
    const r = await fetchFn(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Google no dio acceso (${r.status}${j.error ? " " + j.error : ""}). Revisa las credenciales.`);
    token = j.access_token; until = now() + (Number(j.expires_in) || 3600) * 1000;
    return token;
  }
  const api = async (url) => {
    const r = await fetchFn(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!r.ok) throw new Error(r.status === 404 ? "Drive no encuentra la carpeta o el fichero: ¿está compartida con la cuenta de servicio?" : `Drive respondió ${r.status}.`);
    return r;
  };
  return {
    name: "Google Drive",
    async list() {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,md5Checksum,size)");
      const j = await (await api(`${apiBase}/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json();
      return (j.files ?? [])
        .filter((f) => f.mimeType === SHEET || f.mimeType === XLSX || /\.xlsx$/i.test(f.name))
        .map((f) => ({ id: f.id, name: f.name, modified: f.modifiedTime, mime: f.mimeType, sig: f.md5Checksum || `${f.modifiedTime}|${f.size ?? ""}` }));
    },
    async read(f) {
      const url = f.mime === SHEET ? `${apiBase}/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(XLSX)}` : `${apiBase}/drive/v3/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
      return Buffer.from(await (await api(url)).arrayBuffer());
    },
  };
}

/** Origen: una carpeta del propio servidor (los .xlsx que haya dentro). */
export function localSource(dir) {
  return {
    name: `Carpeta ${dir}`,
    async list() {
      return fs.readdirSync(dir)
        .filter((n) => /\.xlsx$/i.test(n) && !n.startsWith("~$"))
        .map((n) => { const s = fs.statSync(path.join(dir, n)); return { id: n, name: n, modified: s.mtime.toISOString(), sig: `${s.mtimeMs}|${s.size}` }; })
        .sort((a, b) => (a.modified < b.modified ? 1 : -1));
    },
    async read(f) { return fs.readFileSync(path.join(dir, f.id)); },
  };
}

/** Origen según el entorno: Drive (DRIVE_FOLDER_ID + credenciales) o carpeta local (SYNC_DIR); null si no hay ninguno. */
export function sourceFromEnv(env = process.env) {
  if (env.DRIVE_FOLDER_ID) {
    const text = env.GOOGLE_SERVICE_ACCOUNT_JSON || (env.GOOGLE_SERVICE_ACCOUNT_FILE ? fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, "utf8") : "");
    if (!text) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SERVICE_ACCOUNT_FILE.");
    return driveSource({ folderId: env.DRIVE_FOLDER_ID, credentials: parseCredentials(text) });
  }
  if (env.SYNC_DIR) return localSource(env.SYNC_DIR);
  return null;
}
