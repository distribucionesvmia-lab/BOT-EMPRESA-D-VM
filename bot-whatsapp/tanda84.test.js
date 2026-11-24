// Fotos desde internet para el panel: solo direcciones públicas, redirecciones revisadas, y comprobar que es una foto de verdad. Sin red: todo con funciones de mentira.
import test from "node:test";
import assert from "node:assert/strict";
import { ipPublica, tipoDeImagen, descargarFoto } from "./foto-url.js";

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]), PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const dns = (m) => async (h) => (m[h] ?? []).map((address) => ({ address }));

test("IP PÚBLICAS: ni la propia máquina, ni la red de la oficina, ni Tailscale ni especiales", () => {
  for (const ip of ["8.8.8.8", "142.250.1.1", "2606:4700::1111"]) assert.equal(ipPublica(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.1.1.1", "no es ip"]) assert.equal(ipPublica(ip), false, ip);
  assert.equal(ipPublica("172.32.0.1"), true);
});

test("TIPO DE IMAGEN: se mira el contenido, no lo que diga la dirección", () => {
  assert.equal(tipoDeImagen(JPG), "image/jpeg"); assert.equal(tipoDeImagen(PNG), "image/png");
  assert.equal(tipoDeImagen(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  assert.equal(tipoDeImagen(Buffer.from("<html>no soy una foto</html>")), null); assert.equal(tipoDeImagen(Buffer.alloc(3)), null);
});

test("DESCARGAR: rechaza lo raro antes de conectar y solo devuelve fotos de verdad", async () => {
  let llamadas = 0; const pedirFn = async () => { llamadas++; return { buf: JPG }; };
  const ok = await descargarFoto("https://fotos.ejemplo/a.jpg", { resolver: dns({ "fotos.ejemplo": ["93.184.216.34"] }), pedirFn });
  assert.equal(ok.tipo, "image/jpeg"); assert.equal(llamadas, 1);
  for (const u of ["ftp://fotos.ejemplo/a.jpg", "file:///etc/passwd", "javascript:alert(1)", "https://usuario" + ":clave@fotos.ejemplo/a.jpg", "esto no es una dirección", "http://127.0.0.1/a.jpg", "http://[::1]/a.jpg", "http://10.0.0.1/a.jpg"]) await assert.rejects(descargarFoto(u, { resolver: dns({}), pedirFn }), Error, u);
  // un nombre que apunta a una dirección interna (o a una pública y otra interna a la vez) no vale
  await assert.rejects(descargarFoto("https://malo.ejemplo/a.jpg", { resolver: dns({ "malo.ejemplo": ["127.0.0.1"] }), pedirFn }), /no es de una página de internet/);
  await assert.rejects(descargarFoto("https://doble.ejemplo/a.jpg", { resolver: dns({ "doble.ejemplo": ["93.184.216.34", "192.168.1.9"] }), pedirFn }), /no es de una página de internet/);
  await assert.rejects(descargarFoto("https://nada.ejemplo/a.jpg", { resolver: async () => { throw new Error("x"); }, pedirFn }), /No encuentro esa página/);
  assert.equal(llamadas, 1, "en ningún caso malo se llegó a conectar");
  // no es una foto (aunque la dirección acabe en .jpg)
  await assert.rejects(descargarFoto("https://fotos.ejemplo/a.jpg", { resolver: dns({ "fotos.ejemplo": ["93.184.216.34"] }), pedirFn: async () => ({ buf: Buffer.from("<html>hola mundo, esto es una web</html>") }) }), /no es una foto/i);
});

test("REDIRECCIONES: se revisa cada salto y hay tope", async () => {
  const r = dns({ "a.ejemplo": ["93.184.216.34"], "b.ejemplo": ["93.184.216.35"], "interno.ejemplo": ["10.0.0.7"] });
  const salta = (m) => async (url) => m[url.href] ? (m[url.href].startsWith("{") ? { buf: PNG } : { redir: m[url.href] }) : { buf: PNG };
  const bien = await descargarFoto("https://a.ejemplo/1", { resolver: r, pedirFn: salta({ "https://a.ejemplo/1": "https://b.ejemplo/2", "https://b.ejemplo/2": "/3" }) });
  assert.equal(bien.tipo, "image/png");
  await assert.rejects(descargarFoto("https://a.ejemplo/1", { resolver: r, pedirFn: salta({ "https://a.ejemplo/1": "http://interno.ejemplo/secreto" }) }), /no es de una página de internet/);
  await assert.rejects(descargarFoto("https://a.ejemplo/1", { resolver: r, pedirFn: salta({ "https://a.ejemplo/1": "http://127.0.0.1:3001/api/admin/estado" }) }), /no es de una página de internet/);
  await assert.rejects(descargarFoto("https://a.ejemplo/1", { resolver: r, pedirFn: async () => ({ redir: "https://a.ejemplo/1" }) }), /redirige demasiadas veces/);
});
