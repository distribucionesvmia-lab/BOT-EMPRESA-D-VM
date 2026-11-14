// Tanda 14: pantalla de acceso y solicitud de alta (sin sesión).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { privacidadHtml } from "./privacidad.js";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8");
const cuentas = fs.readFileSync(new URL("./cuentas-db.js", import.meta.url), "utf8");

test("1. el código de entrada se guarda cifrado (scrypt con sal propia, no en claro) y el texto de privacidad lo dice bien", () => {
  assert.match(cuentas, /const hashPin = \(pin\) => \{\s*const salt = crypto\.randomBytes\(16\);\s*return `scrypt\$/);
  assert.match(cuentas, /crypto\.scryptSync\(pin, salt, 32\)/); // función de derivación de claves con memoria (misma familia que bcrypt/argon2), integrada en Node
  assert.doesNotMatch(cuentas, /pin_hash[^\n]*\.run\([^)]*\bpin\b[^)]*\)\s*;\s*\/\/ claro/);
  const t = privacidadHtml();
  assert.doesNotMatch(t, /en claro/); assert.doesNotMatch(t, /contraseña/i);
  assert.match(t, /código de entrada se guarda solo transformado con una función de cifrado irreversible/); assert.match(t, /nunca se guarda en texto legible/);
});
const nifValido = new Function(h.match(/const LETRAS_DNI = [^\n]+\nfunction nifValido\(v\) \{[\s\S]*?\n\}\n/)[0] + "return nifValido;")();
test("2. DNI, NIE y CIF: formato y letra de control", () => {
  for (const ok of ["12345678Z", "00000000T", "X1234567L", "Y1234567X", "Z1234567R", "A28015865", "A48010615", "A28017895", "Q2826000H"]) assert.equal(nifValido(ok).ok, true, ok);
  for (const mal of ["abc", "12345678A", "B12345678", "X1234567A", "123", "1234567890", "A5881850X", "ZZZZZZZZZ"]) assert.equal(nifValido(mal).ok, false, mal);
  assert.match(nifValido("abc").msg, /Faltan 6 caracteres/); assert.match(nifValido("12345678A").msg, /letra del DNI/); assert.match(nifValido("").msg, /Escribe tu DNI/);
  assert.equal(nifValido("12345678z").ok, true); assert.equal(nifValido("12345678-Z").ok, true); // mayúsculas y guion no importan
});
test("3. el campo «Entrar con mi NIF» solo admite números (las letras, solo con el botón «Mi código tiene letras») y lo explica en español", () => {
  assert.match(h, /id="a-nif"[^>]*inputmode="numeric"/);
  assert.match(h, /getAttribute\("inputmode"\) === "numeric" && \/\\D\/\.test\(v\)\) \{ v = v\.replace\(\/\\D\/g, ""\); avisoLetras = true;/);
  assert.match(h, /Aquí solo van números: los 6 primeros dígitos de tu DNI o CIF\. Si tu código de entrada tiene letras, pulsa «Mi código tiene letras»/);
  assert.doesNotMatch(h, /Please match/);
});
test("4. alta: campos obligatorios con *, todos los errores a la vez y en español (sin avisos del navegador)", () => {
  assert.match(h, /id="f-registro" autocomplete="off" novalidate/); assert.match(h, /Los campos con <b class="req">\*<\/b> son obligatorios/);
  for (const id of ["r-emp", "r-tel", "r-nif", "r-mail", "r-pin", "r-pin2"]) { assert.ok(h.includes(`id="e-${id}" role="alert"`), id); assert.match(h, new RegExp(`id="${id}"[^>]*aria-required="true"`), id); }
  assert.match(h, /for \(const id of Object\.keys\(reglasAlta\)\) \{ const m = reglasAlta\[id\]/); assert.match(h, /campos por corregir \(marcados en rojo\)/);
  assert.doesNotMatch(h, /id="r-(emp|tel|nif|mail|pin|pin2)"[^>]*\srequired[\s>]/); // nada de «required» del navegador
});
test("5. pantalla de entrar: «¿No puedes entrar? Llámanos o escríbenos» y «Solicitar acceso» arriba, sin bajar", () => {
  assert.match(h, /id="no-entro">¿No puedes entrar\? Llámanos o escríbenos</); assert.match(h, /id="ir-registro-2">¿Cliente nuevo\? Solicitar acceso</);
  assert.ok(h.indexOf('id="no-entro"') < h.indexOf('id="a-tel"')); // antes de los campos
  assert.match(h, /"¿No puedes entrar\?"/); assert.match(h, /if \(enChat\) \{ const hp/); // sin sesión no hay chat: no se ofrece «hablar por el chat»
});
