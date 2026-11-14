// Tanda 17: publicación al día (reinicio automático, estado del actualizador en /health) y PDF que no se abre solo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estadoVersion, estadoActualizador } from "./version.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("/health dice qué programa corre (ruta, proceso, versión de Node) y lo que dice el actualizador", () => {
  const e = estadoVersion();
  for (const k of ["version", "commitFecha", "desplegado", "enDisco", "reinicioPendiente", "ruta", "pid", "node", "actualizacion"]) assert.ok(k in e, k);
  assert.equal(e.pid, process.pid); assert.match(e.node, /^v\d+/);
});
test("estadoActualizador: última comprobación, versión rechazada y último aviso del registro (nada más)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-act-"));
  assert.equal(estadoActualizador(dir), null);
  fs.writeFileSync(path.join(dir, "actualizar.ultima"), "14/11/2026 7:30 - Comprobado: todo al dia\r\n");
  fs.writeFileSync(path.join(dir, "actualizar.mala"), "abc1234def\r\n");
  fs.writeFileSync(path.join(dir, "actualizar.log"), ["===== x", "ok 1 - prueba con datos de cliente", "LAS PRUEBAS FALLAN: se vuelve a la version anterior 1111111", "otra linea", "Actualizado de 1 a 2"].join("\r\n"));
  const a = estadoActualizador(dir);
  assert.equal(a.ultimaComprobacion, "14/11/2026 7:30 - Comprobado: todo al dia"); assert.equal(a.versionRechazada, "abc1234def"); assert.equal(a.ultimoAviso, "Actualizado de 1 a 2");
  assert.ok(!JSON.stringify(a).includes("datos de cliente"));
});
test("reinicio automático: si el disco tiene una versión más nueva que la que corre, se reinicia solo a los 8 minutos (no en pruebas ni en la demo)", () => {
  const s = leer("./server.js");
  assert.match(s, /process\.env\.DEMO !== "1" && process\.env\.AUTO_REINICIO !== "0" && !process\.env\.VM_TEST/);
  assert.match(s, /Date\.now\(\) - desde >= 8 \* 60e3/); assert.match(s, /Reinicio automático para cargar la versión[^\n]*\n?[^\n]*process\.exit\(0\)/);
  assert.match(leer("./deploy/windows/iniciar-cliente.bat"), /:inicio[\s\S]*goto inicio/); assert.match(leer("./deploy/windows/iniciar-empresa.bat"), /:inicio[\s\S]*goto inicio/); // el .bat lo vuelve a arrancar
});
test("el PDF solo se abre cuando se pide: ninguna página lo carga al abrirse (sin iframe, embed ni enlaces automáticos)", () => {
  for (const f of ["./cliente.html", "./pedido.html"]) {
    const h = leer(f).replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(h, /<(iframe|embed|object)\b/i, f); assert.doesNotMatch(h, /rel="(prefetch|preload|prerender)"/i, f);
  }
  const s = leer("./server.js"); assert.match(s, /"inline"\}; filename=/); // el PDF se enseña en el navegador (descargarlo es un botón: ?descargar=1)
});
