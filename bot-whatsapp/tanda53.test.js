import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { origenAjeno, esRedPrivada, panelPermitido, cabecerasSeguridad, eventoSeguridad } from "./seguridad.js";

const peticion = (metodo, cab = {}, ip = "203.0.113.4") => ({ method: metodo, headers: cab, socket: { remoteAddress: ip } });

test("CSRF: lo que cambia datos desde otra web se rechaza; lo propio y lo que no es navegador pasa", () => {
  const h = { host: "pedidos.ejemplo.es" };
  assert.equal(origenAjeno(peticion("GET", { ...h, origin: "https://malo.com" })), null, "leer no cambia nada");
  assert.ok(origenAjeno(peticion("POST", { ...h, origin: "https://malo.com" })));
  assert.ok(origenAjeno(peticion("POST", { ...h, "sec-fetch-site": "cross-site" })));
  assert.ok(origenAjeno(peticion("POST", { ...h, "sec-fetch-site": "same-site" })), "ni un subdominio hermano");
  assert.ok(origenAjeno(peticion("DELETE", { ...h, origin: "null" })), "origen null (iframes, archivos locales)");
  assert.equal(origenAjeno(peticion("POST", { ...h, origin: "https://pedidos.ejemplo.es", "sec-fetch-site": "same-origin" })), null);
  assert.equal(origenAjeno(peticion("POST", h)), null, "sin cabeceras de navegador (MCP, WhatsApp, pruebas)");
  assert.equal(origenAjeno(peticion("POST", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })), null);
  assert.equal(origenAjeno(peticion("POST", { host: "interno:3000", origin: "https://pedidos.ejemplo.es" }), ["https://pedidos.ejemplo.es"]), null, "dominio propio configurado");
});

test("panel: solo red privada, localhost y Tailscale; internet no", () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.50", "::ffff:192.168.0.7", "100.101.102.103", "fd12:3456::1", "fe80::1"]) assert.ok(esRedPrivada(ip), ip);
  for (const ip of ["8.8.8.8", "203.0.113.4", "172.32.0.1", "172.15.0.1", "100.63.0.1", "100.128.0.1", "2a00:1450::1", "", "abc", "999.1.1.1x"]) assert.ok(!esRedPrivada(ip), ip);
  assert.ok(panelPermitido(peticion("GET", {}, "192.168.1.20")));
  assert.ok(!panelPermitido(peticion("GET", {}, "203.0.113.4")), "conexión directa desde internet");
  assert.ok(!panelPermitido(peticion("GET", { "cf-connecting-ip": "203.0.113.4" }, "127.0.0.1")), "entra por el túnel pero quien llama es público");
  assert.ok(!panelPermitido(peticion("GET", { "x-forwarded-for": "203.0.113.4" }, "10.0.0.2")));
  assert.ok(panelPermitido(peticion("GET", { "cf-connecting-ip": "192.168.1.9" }, "127.0.0.1")));
  assert.ok(!panelPermitido(peticion("GET", { "x-forwarded-for": "10.0.0.1" }, "203.0.113.4")), "falsear la cabecera no sirve: la conexión real manda");
  assert.ok(panelPermitido(peticion("GET", {}, "203.0.113.4"), ["203.0.113.4"]), "dirección añadida a mano");
});

test("cabeceras nuevas y registro a prueba de saltos de línea", () => {
  const c = cabecerasSeguridad();
  assert.equal(c["Cross-Origin-Resource-Policy"], "same-origin"); assert.equal(c["X-Permitted-Cross-Domain-Policies"], "none");
  const lineas = []; const w = console.warn; console.warn = (m) => lineas.push(String(m));
  try { eventoSeguridad("prueba-log-" + Date.now(), "1.2.3.4\n[VM seguridad] falso · todo bien\r\n"); } finally { console.warn = w; }
  assert.equal(lineas.length, 1); assert.ok(!/[\r\n]/.test(lineas[0]));
});

test("sin dependencias externas: nada que pueda venir infectado de npm", () => {
  const p = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.ok(!p[k] || Object.keys(p[k]).length === 0, k);
  assert.ok(!(p.scripts && Object.keys(p.scripts).some((n) => /^(pre|post)?install$|^prepare$/.test(n))), "ningún script que se ejecute al instalar");
});

test("server.js aplica la puerta del panel y la defensa CSRF", () => {
  const s = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /panelPermitido\(req, panelExtra\)/); assert.match(s, /origenAjeno\(req, origenesPropios\)/);
});
