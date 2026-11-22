// Diseño del Inicio: «Tu pedido de siempre» con jerarquía clara (principal, secundaria, resto más ligero).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("INICIO: «Repetir cada…», «Editar» y «Borrar» van más ligeros que «Enviar ya» y «Repetir y revisar»", () => {
  const c = leer("./cliente.html");
  assert.match(c, /\.vm-inicio \.in-card \.in-rec \{ background:transparent; border:1px solid var\(--line\); \}/);
  assert.match(c, /\.vm-inicio \.in-card \.in-sie-acc \.vm-btn\.ghost \{ background:transparent; color:var\(--text-2\); \}/);
  assert.match(c, /\.in-sie-acc \.vm-btn\.ghost \+ \.vm-btn\.ghost \{ border-left:1px solid var\(--line\)/);
  // los botones siguen existiendo con sus textos y alturas táctiles (no se ha quitado ninguna función)
  for (const t of ["Enviar ya", "Repetir y revisar", "Editar", "Borrar"]) assert.ok(c.includes(`"${t}"`), t);
  assert.match(c, /\.vm-inicio \.in-card \.in-sie-acc \.vm-btn \{ width:auto; flex:1; min-height:44px; \}/);
});
