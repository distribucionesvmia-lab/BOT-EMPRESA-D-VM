import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rateLimiter } from "./auth.js";

test("límite de intentos: dice cuántos minutos faltan (espera) y el mensaje del servidor los incluye", () => {
  const lim = rateLimiter(2, 10 * 60_000), t0 = 1_000_000;
  assert.equal(lim("ip", t0), true); assert.equal(lim("ip", t0 + 60_000), true);
  assert.equal(lim("ip", t0 + 120_000), false);
  assert.equal(lim.espera("ip", t0 + 120_000), 8 * 60_000); // el primer intento caduca a los 10 min: faltan 8
  assert.equal(lim.espera("otra", t0), 0);
  assert.equal(lim("ip", t0 + 10 * 60_000 + 1), true); // pasado el tiempo, vuelve a dejar
  const src = fs.readFileSync(new URL("./auth.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /Prueba de nuevo en \$\{min\} minuto\$\{min === 1 \? "" : "s"\}/); assert.match(src, /"Retry-After"/);
  assert.doesNotMatch(src, /Prueba más tarde/);
});
