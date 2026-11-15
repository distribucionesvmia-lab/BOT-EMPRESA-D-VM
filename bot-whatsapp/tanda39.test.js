// Fotos de los artículos en el panel: ver su tamaño, filtrar las pequeñas y cambiar una foto sin perder la anterior.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearFotos, PEQUENA, BUENA } from "./fotos-articulos.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// PNG mínimo válido de w×h (solo cabecera: lo que lee el programa)
const png = (w, h, extra = 0) => { const b = Buffer.alloc(33 + extra); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const montar = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-fotos-")); return { dir, f: crearFotos(dir + "/") }; };

test("FOTOS: se mide cada foto y se clasifica (pequeña, justa, buena); sin foto, también se sabe", () => {
  const { dir, f } = montar();
  fs.writeFileSync(path.join(dir, "A1.png"), png(120, 120)); fs.writeFileSync(path.join(dir, "B2.png"), png(450, 300)); fs.writeFileSync(path.join(dir, "C3.png"), png(1000, 800));
  assert.deepEqual(f.info("A1"), { existe: true, w: 120, h: 120, calidad: "pequena" }); assert.equal(f.info("B2").calidad, "justa"); assert.equal(f.info("C3").calidad, "buena");
  assert.deepEqual(f.info("ZZ"), { existe: false, calidad: null }); assert.ok(PEQUENA < BUENA);
});

test("FOTOS: cambiar una foto la sustituye y guarda la anterior en «anteriores» (nunca se pierde); rechaza lo que no es una foto", () => {
  const { dir, f } = montar(); fs.writeFileSync(path.join(dir, "A1.png"), png(120, 120));
  const r = f.guardar("A1", png(800, 800), "image/png", new Date("2026-11-15T10:30:00Z")); assert.equal(r.ok, true); assert.equal(r.calidad, "buena"); assert.equal(f.info("A1").w, 800);
  assert.deepEqual(fs.readdirSync(path.join(dir, "anteriores")), ["A1-20261115-1030.png"]); assert.equal(fs.readFileSync(path.join(dir, "anteriores", "A1-20261115-1030.png")).length, 33); // la vieja sigue ahí
  assert.match(f.guardar("A1", Buffer.from("no soy una foto"), "image/png").error, /JPG, PNG o WebP/); assert.match(f.guardar("A1", png(800, 800), "text/html").error, /JPG, PNG o WebP/);
  assert.match(f.guardar("A1", png(800, 800), "image/jpeg").error, /no es del tipo/); // dice ser JPG y es PNG
  assert.match(f.guardar("A1", png(20, 20), "image/png").error, /demasiado pequeña/); assert.match(f.guardar("A1", Buffer.alloc(7_000_000), "image/png").error, /pesa demasiado/);
  assert.match(f.guardar("../../etc/x", png(800, 800), "image/png").error, /no válido/); assert.match(f.guardar("A1", Buffer.alloc(0), "image/png").error, /ninguna foto/);
  assert.equal(f.info("A1").w, 800); // nada de lo rechazado cambió la foto
  assert.match(crearFotos(null).guardar("A1", png(800, 800), "image/png").error, /carpeta de fotos/);
});

test("PANEL: en Artículos se ve el tamaño de la foto, se filtran las pequeñas y hay botón para cambiarla; la URL de la foto cambia con la foto", () => {
  const h = leer("./empresa.html"), a = leer("./admin.js"), sv = leer("./server.js");
  assert.match(h, /Foto pequeña \(se ve borrosa\)/); assert.match(h, /value="sinfoto"/); assert.match(h, /Cambiar foto/); assert.match(h, /guardada en la carpeta «anteriores»|se guarda en la carpeta «anteriores»/);
  assert.match(h, /\/api\/admin\/articulos\/\$\{encodeURIComponent\(a\.id\)\}\/foto/);
  assert.match(a, /\\\/foto\$\/\.exec\(p\)/); assert.match(a, /filtro !== "fotopequena"/); assert.match(a, /foto: fotos\.info\(x\.id\)/);
  assert.match(sv, /\?v=\$\{imgVer\.get\(id\)/); assert.match(sv, /imgDir: process\.env\.IMG_DIR/);
});
