// Pedir hablando en el chat: micrófono que dicta y manda el mensaje; sin soporte del navegador no sale el botón.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const h = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("VOZ EN EL CHAT: botón de micrófono (oculto sin soporte), estado en voz alta y mensaje enviado como cualquier otro", () => {
  assert.match(h, /id="voz" class="voz" hidden aria-label="Pedir hablando"/); assert.match(h, /id="voz-estado" class="voz-estado" role="status" aria-live="polite"/);
  const i = h.indexOf("// ── Pedir hablando"), f = h.slice(i, h.indexOf("})();", i));
  assert.ok(i > 0); assert.match(f, /if \(!SR\) return; btn\.hidden = false/); assert.match(f, /rec\.lang = "es-ES"/); assert.match(f, /enviar\(v\)/);
  assert.match(f, /not-allowed/); assert.match(f, /no-speech/); assert.match(f, /network/);
  assert.doesNotMatch(f, /\/catalogo|fetch\(/); // no envía pedidos por su cuenta: solo escribe en el chat
  assert.match(h, /@media \(prefers-reduced-motion: reduce\) \{ form\.send \.voz\.escucha \{ animation:none; \} \}/);
});
