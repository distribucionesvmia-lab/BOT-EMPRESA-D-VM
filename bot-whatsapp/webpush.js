// Notificaciones push (Web Push) sin dependencias: claves VAPID, firma ES256 del aviso y cifrado del mensaje (RFC 8291, aes128gcm)
// con node:crypto. Sirve para avisar al móvil de un cliente que tiene la web instalada como app («Pedido recibido», avisos de la empresa).
import crypto from "node:crypto";

const b64u = (b) => Buffer.from(b).toString("base64url");
const deB64u = (s) => Buffer.from(String(s), "base64url");

/** Claves VAPID nuevas: { publica, privada } en base64url (la pública son los 65 bytes sin comprimir de la curva P-256). */
export function generarClavesVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]);
  return { publica: b64u(pub), privada: jwk.d };
}

/** Los avisos solo se mandan a los servicios de push de los navegadores (así nadie puede hacer que el servidor llame a una dirección cualquiera). */
const SERVICIOS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function endpointValido(endpoint) {
  let u; try { u = new URL(String(endpoint)); } catch { return false; }
  if (String(endpoint).length > 700) return false;
  if (process.env.PUSH_ALLOW_HTTP === "1" && u.protocol === "http:" && u.hostname === "127.0.0.1") return true; // solo para las pruebas
  return u.protocol === "https:" && !u.port && SERVICIOS.some((r) => r.test(u.hostname));
}
export const clavesValidas = (k) => !!k && typeof k.p256dh === "string" && typeof k.auth === "string" && deB64u(k.p256dh).length === 65 && deB64u(k.p256dh)[0] === 4 && deB64u(k.auth).length === 16;

function claveFirma({ publica, privada }) {
  const pub = deB64u(publica);
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privada }, format: "jwk" });
}

/** Cabecera Authorization (VAPID) para ese servicio de push. */
export function cabeceraVapid(endpoint, vapid, { sub, ahora = Date.now() } = {}) {
  const u = new URL(endpoint);
  const cab = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const cuerpo = b64u(JSON.stringify({ aud: u.origin, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: sub || "mailto:avisos@invalid.example" }));
  const firma = crypto.sign("sha256", Buffer.from(`${cab}.${cuerpo}`), { key: claveFirma(vapid), dsaEncoding: "ieee-p1363" });
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${vapid.publica}`;
}

/** Cifra el mensaje para un navegador concreto (clave p256dh y secreto auth de su suscripción). Devuelve el cuerpo de la petición. */
export function cifrar(texto, { p256dh, auth }) {
  const uaPublica = deB64u(p256dh), authSecret = deB64u(auth), salt = crypto.randomBytes(16);
  const asEcdh = crypto.createECDH("prime256v1"); asEcdh.generateKeys();
  const asPublica = asEcdh.getPublicKey();
  const secreto = asEcdh.computeSecret(uaPublica);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secreto, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublica, asPublica]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const dato = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, "utf8"), Buffer.from([2])])), c.final(), c.getAuthTag()]); // 0x02: último (y único) bloque
  const cab = Buffer.alloc(21); salt.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = 65;
  return Buffer.concat([cab.subarray(0, 21), asPublica, dato]);
}

/**
 * Manda un aviso a una suscripción. Devuelve { ok, estado, caducada }: «caducada» = el navegador ya no la quiere (404/410) y hay que borrarla.
 * Nunca lanza: un fallo de red es { ok:false, estado:0 }.
 */
export async function enviarPush(sub, mensaje, { vapid, contacto, ttl = 86400, fetchFn = fetch } = {}) {
  try {
    if (!endpointValido(sub.endpoint) || !clavesValidas(sub.keys)) return { ok: false, estado: 0, caducada: false };
    const cuerpo = cifrar(JSON.stringify(mensaje), sub.keys);
    const r = await fetchFn(sub.endpoint, {
      method: "POST",
      headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Content-Length": String(cuerpo.length), TTL: String(ttl), Urgency: "normal", Authorization: cabeceraVapid(sub.endpoint, vapid, { sub: contacto }) },
      body: cuerpo,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: r.status >= 200 && r.status < 300, estado: r.status, caducada: r.status === 404 || r.status === 410 };
  } catch { return { ok: false, estado: 0, caducada: false }; }
}
