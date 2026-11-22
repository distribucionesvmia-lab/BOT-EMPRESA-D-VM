import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tamanoImagen, informe } from "./fotos-pequenas.js";

// PNG mínimo con el tamaño que se pida (solo cabecera)
const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

test("fotos pequeñas: lee el tamaño de PNG y JPEG y lista solo las de 200 px o menos, sin tocar ninguna", () => {
  assert.deepEqual(tamanoImagen(png(120, 90)), { w: 120, h: 90 });
  assert.deepEqual(tamanoImagen(jpg(640, 480)), { w: 640, h: 480 });
  assert.equal(tamanoImagen(Buffer.from("no es una foto")), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fotos-"));
  fs.writeFileSync(path.join(d, "1001.png"), png(150, 150)); fs.writeFileSync(path.join(d, "1002.png"), png(800, 800)); fs.writeFileSync(path.join(d, "1003.jpg"), jpg(200, 120)); fs.writeFileSync(path.join(d, "notas.txt"), "x");
  const antes = fs.readdirSync(d).sort().join();
  const r = informe(d, [{ id: "1001", name: "AGUA MINERAL 1,5 L" }, { id: "1003", name: "CAFE MOLIDO 250 GR" }]);
  assert.deepEqual(r.map((x) => [x.codigo, x.tamano]), [["1001", "150x150"], ["1003", "200x120"]]);
  assert.ok(r[0].categoria.length > 0);
  assert.equal(fs.readdirSync(d).sort().join(), antes); // no cambia ni borra nada
});

test("FOTOS NO NÍTIDAS: el comando saca un CSV con las de menos de 300 px (como el panel), con límite cambiable y rutas desde la configuración", async () => {
  const { spawnSync } = await import("node:child_process"), os = await import("node:os"), fsx = await import("node:fs"), pathx = await import("node:path"), { DatabaseSync } = await import("node:sqlite");
  const d = fsx.mkdtempSync(pathx.join(os.tmpdir(), "vm-fotos-")), png = (w, h) => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  for (const [c, w, h] of [["1", 120, 120], ["2", 299, 250], ["3", 300, 300], ["4", 900, 900], ["5", 450, 200]]) fsx.writeFileSync(pathx.join(d, `${c}.png`), png(w, h));
  const db = new DatabaseSync(pathx.join(d, "c.sqlite")); db.exec("CREATE TABLE products (id TEXT, name TEXT, category TEXT, subcategory TEXT)"); db.prepare("INSERT INTO products VALUES ('1','AGUA',NULL,NULL),('2','LECHE',NULL,NULL)").run(); db.close();
  const correr = (...extra) => { const out = pathx.join(d, "o.csv"); const r = spawnSync(process.execPath, [new URL("./fotos-pequenas.js", import.meta.url).pathname, "", "", out, ...extra], { env: { ...process.env, IMG_DIR: d, CATALOG_DB: pathx.join(d, "c.sqlite") }, encoding: "utf8" }); return { r, csv: fsx.existsSync(out) ? fsx.readFileSync(out, "utf8") : "" }; };
  const a = correr(); assert.equal(a.r.status, 0, a.r.stderr); assert.match(a.csv, /"1";"AGUA"/); assert.match(a.csv, /"2";"LECHE"/); assert.ok(!/"3";|"4";/.test(a.csv), "300 px o más no cuenta como borrosa");
  const b = correr("200"); assert.ok(b.csv.includes('"1";"AGUA"') && !b.csv.includes('"2";"LECHE"'), "con límite 200 solo las muy pequeñas");
  const c = correr("1000"); assert.ok(c.csv.includes('"3";') && c.csv.includes('"4";'), "con límite 1000 salen también las «justas»");
});
