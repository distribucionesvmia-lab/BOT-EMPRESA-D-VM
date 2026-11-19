// «No soy un robot» PROPIO (sin servicios externos): reto de trabajo firmado por el servidor.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { nuevoReto, verificarReto, retoPropioActivo, robotActivo, verificarRobot } from "./seguridad.js";

process.env.RETO_PROPIO = "1"; process.env.RETO_BITS = "10"; // 10 bits: instantáneo en la prueba
const resolver = ({ reto, bits }) => { for (let n = 0; ; n++) { const h = crypto.createHash("sha256").update(`${reto}:${n}`).digest(); let c = 0; for (const b of h) { if (b === 0) { c += 8; continue; } c += Math.clz32(b) - 24; break; } if (c >= bits) return `${reto}|${n}`; } };

test("RETO PROPIO: un reto bien resuelto vale UNA vez; sin resolver, inventado, manipulado o caducado, no", () => {
  assert.equal(retoPropioActivo(), true); assert.equal(robotActivo(), true);
  const r = nuevoReto(), tk = resolver(r);
  assert.equal(verificarReto(tk).ok, true);
  assert.equal(verificarReto(tk).ok, false);                                   // gastado: no se puede reutilizar
  const r2 = nuevoReto(); assert.equal(verificarReto(`${r2.reto}|99999999999`).ok, false); // trabajo sin hacer (casi seguro)
  const [t, nonce, mac] = r2.reto.split("."); assert.equal(verificarReto(`${t}.${nonce}.${"0".repeat(mac.length)}|1`).ok, false); // firma falsa
  const viejo = nuevoReto(Date.now() - 16 * 60_000); assert.equal(verificarReto(resolver(viejo)).ok, false); // caducado
  const futuro = nuevoReto(Date.now() + 3600_000); assert.equal(verificarReto(resolver(futuro)).ok, false);
  for (const malo of [undefined, null, 5, "", "a|b", "x.y.z|1", "a".repeat(500)]) assert.equal(verificarReto(malo).ok, false);
});

test("RETO PROPIO: se apaga con RETO_PROPIO=0, cede ante Turnstile y sin ninguno de los dos todo vale", async () => {
  const r = nuevoReto(); assert.equal((await verificarRobot("nada", "1.1.1.1")).ok, false); assert.equal((await verificarRobot(resolver(r), "1.1.1.1")).ok, true);
  process.env.RETO_PROPIO = "0"; assert.equal(retoPropioActivo(), false); assert.equal((await verificarRobot(undefined, "1.1.1.1")).ok, true);
  process.env.RETO_PROPIO = "1"; process.env.TURNSTILE_SITE = "s"; process.env.TURNSTILE_SECRET = "k"; assert.equal(retoPropioActivo(), false); // con Turnstile manda Turnstile
  delete process.env.TURNSTILE_SITE; delete process.env.TURNSTILE_SECRET;
});

test("RETO PROPIO: la pantalla lo resuelve en segundo plano y lo manda como «cf»; el servidor tiene /api/reto", () => {
  const cli = fs.readFileSync(new URL("./cliente.html", import.meta.url), "utf8").replace(/\r\n/g, "\n"), au = fs.readFileSync(new URL("./auth.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(cli, /async function retoResolver\(\)/); assert.match(cli, /crypto\.subtle\.digest\("SHA-256"/); assert.match(cli, /ts === "local"/);
  assert.match(au, /p === "\/api\/reto"/); assert.match(au, /retoPropio: retoPropioActivo\(\)/);
  assert.ok(!/verificarTurnstile\(b\.cf/.test(au)); // todos los controles pasan por verificarRobot
});
