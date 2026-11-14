// Tanda 7 (Mi cuenta, código de entrada, pedido fijo, ayuda y textos legales): comprobaciones sobre la pantalla del cliente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
const visible = h.replace(/<script[\s\S]*?<\/script>/g, " ");

test("un solo término: «código de entrada» en la pantalla del cliente (ya no «contraseña»)", () => {
  assert.doesNotMatch(h, /[Cc]ontrase[ñn]a/);
  assert.match(h, /<h2 id="t-codigo">Cambiar mi código de entrada<\/h2>/);
  assert.match(h, /Guardar código de entrada/); assert.match(h, /id="cambiar">Cambiar código de entrada</);
});
test("validación propia en español: el cambio de código y los campos obligatorios no enseñan «Please fill out this field»", () => {
  assert.match(h, /id="f-codigo"[^>]*novalidate/);
  for (const m of ["Escribe el nuevo código de entrada", "Repite el código de entrada para comprobar", "no coinciden"]) assert.ok(h.includes(m), m);
  assert.match(h, /addEventListener\("invalid"[\s\S]*setCustomValidity/);
  assert.doesNotMatch(h, /Please fill/);
});
test("las ventanas (pedido fijo incluido) se cierran con X, Escape, tocando fuera y «Atrás»", () => {
  assert.match(h, /id="f-x" aria-label="Cerrar">×</);
  assert.match(h, /e\.target === m\) m\.hidden = true/); assert.match(h, /e\.key !== "Escape"/); assert.match(h, /addEventListener\("popstate"/);
  assert.match(h, /history\.pushState\(\{ modal: 1 \}/);
});
test("ayuda: siempre hay contacto (hablar con una persona) y el título no promete ayuda si solo hay ajustes", () => {
  assert.match(h, /"Ayuda y ajustes de pantalla"/); assert.match(h, /Hablar con una persona \(por el chat\)/);
  assert.match(h, /a\.telHref\) enlace\("Llamar"/); // con teléfono configurado, botón tel:
});
test("privacidad y aviso legal: visibles en el menú, en la ayuda y en «Mis datos y privacidad»", () => {
  assert.match(visible, /id="legal-menu">Privacidad y aviso legal</); assert.match(visible, /id="d-legal">Política de privacidad y aviso legal</);
  assert.match(h, /lg\.textContent = "Privacidad y aviso legal"/); assert.match(visible, /id="m-legal"/); assert.match(visible, /data-aviso-legal/);
});
