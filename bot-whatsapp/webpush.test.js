import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { generarClavesVapid, cifrar, cabeceraVapid, enviarPush, endpointValido, clavesValidas } from "./webpush.js";

const deB64u = (s) => Buffer.from(s, "base64url");
// Un «navegador» de mentira: genera su par de claves y su secreto, y sabe descifrar lo que le llega (RFC 8291)
function navegador() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    descifrar(cuerpo) {
      const salt = cuerpo.subarray(0, 16), rs = cuerpo.readUInt32BE(16), idlen = cuerpo[20], asPub = cuerpo.subarray(21, 21 + idlen), datos = cuerpo.subarray(21 + idlen);
      assert.equal(rs, 4096); assert.equal(idlen, 65);
      const uaPub = ecdh.getPublicKey();
      const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdh.computeSecret(asPub), auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
      const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
      const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
      const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(datos.subarray(datos.length - 16));
      const claro = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()]);
      assert.equal(claro[claro.length - 1], 2); // marca de último bloque
      return claro.subarray(0, claro.length - 1).toString("utf8");
    },
  };
}

test("WEB PUSH: las claves VAPID tienen el formato que piden los navegadores", () => {
  const v = generarClavesVapid();
  assert.equal(deB64u(v.publica).length, 65); assert.equal(deB64u(v.publica)[0], 4); assert.equal(deB64u(v.privada).length, 32);
  assert.notEqual(generarClavesVapid().publica, v.publica);
});

test("WEB PUSH: el mensaje se cifra y el navegador lo descifra tal cual (con tildes y emojis incluidos)", () => {
  const nav = navegador(), msg = JSON.stringify({ title: "Pedido recibido", body: "Hemos recibido tu pedido VM-2026-000001 · ñandú 🎉" });
  assert.equal(nav.descifrar(cifrar(msg, nav.keys)), msg);
  assert.notEqual(cifrar(msg, nav.keys).toString("hex"), cifrar(msg, nav.keys).toString("hex")); // sal distinta cada vez
  assert.throws(() => navegador().descifrar(cifrar(msg, nav.keys))); // otro navegador no puede leerlo
});

test("WEB PUSH: la cabecera VAPID lleva una firma ES256 válida con la clave pública", () => {
  const v = generarClavesVapid(), ahora = Date.now();
  const h = cabeceraVapid("https://fcm.googleapis.com/fcm/send/abc", v, { sub: "https://ejemplo.invalid", ahora });
  const [, t, k] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(h);
  assert.equal(k, v.publica);
  const [cab, cuerpo, firma] = t.split(".");
  assert.deepEqual(JSON.parse(deB64u(cab)), { typ: "JWT", alg: "ES256" });
  const c = JSON.parse(deB64u(cuerpo)); assert.equal(c.aud, "https://fcm.googleapis.com"); assert.equal(c.sub, "https://ejemplo.invalid"); assert.ok(c.exp > ahora / 1000 && c.exp <= ahora / 1000 + 12 * 3600 + 1);
  const pub = deB64u(v.publica), clave = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33, 65).toString("base64url") }, format: "jwk" });
  assert.equal(crypto.verify("sha256", Buffer.from(`${cab}.${cuerpo}`), { key: clave, dsaEncoding: "ieee-p1363" }, deB64u(firma)), true);
});

test("WEB PUSH: solo se manda a servicios de push de navegadores (nada de direcciones cualesquiera)", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.equal(endpointValido(ok), true, ok);
  for (const mal of ["http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x", "https://localhost/x", "https://169.254.169.254/x", "https://fcm.googleapis.com:8443/x", "javascript:alert(1)", "", "https://fcm.googleapis.com/" + "a".repeat(800)]) assert.equal(endpointValido(mal), false, mal);
  const nav = navegador();
  assert.equal(clavesValidas(nav.keys), true); assert.equal(clavesValidas({ p256dh: "abc", auth: "x" }), false); assert.equal(clavesValidas(null), false);
});

test("WEB PUSH: enviarPush manda la petición correcta, descifrable, y avisa de las suscripciones caducadas", async () => {
  process.env.PUSH_ALLOW_HTTP = "1";
  try {
    const nav = navegador(), vapid = generarClavesVapid(), vistos = [];
    let estado = 201;
    const srv = http.createServer((req, res) => { const trozos = []; req.on("data", (d) => trozos.push(d)); req.on("end", () => { vistos.push({ cab: req.headers, cuerpo: Buffer.concat(trozos) }); res.writeHead(estado).end(); }); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const sub = { endpoint: `http://127.0.0.1:${srv.address().port}/push/abc`, keys: nav.keys };
    const r = await enviarPush(sub, { title: "Hola", body: "Prueba" }, { vapid, contacto: "https://ejemplo.invalid" });
    assert.deepEqual([r.ok, r.estado, r.caducada], [true, 201, false]);
    assert.equal(vistos[0].cab["content-encoding"], "aes128gcm"); assert.equal(vistos[0].cab.ttl, "86400"); assert.match(vistos[0].cab.authorization, /^vapid t=.+, k=.+$/);
    assert.deepEqual(JSON.parse(nav.descifrar(vistos[0].cuerpo)), { title: "Hola", body: "Prueba" });
    estado = 410; assert.deepEqual(await enviarPush(sub, { title: "x" }, { vapid }), { ok: false, estado: 410, caducada: true });
    estado = 500; assert.deepEqual(await enviarPush(sub, { title: "x" }, { vapid }), { ok: false, estado: 500, caducada: false });
    srv.close();
    assert.deepEqual(await enviarPush({ endpoint: "https://evil.example.com/x", keys: nav.keys }, { title: "x" }, { vapid }), { ok: false, estado: 0, caducada: false }); // no sale a direcciones raras
  } finally { delete process.env.PUSH_ALLOW_HTTP; }
});
