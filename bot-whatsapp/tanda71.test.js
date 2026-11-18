// Fotos pequeñas para el móvil: miniaturas (copias derivadas) preparadas desde el panel y usadas por las listas de la app.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { crearFotos, LADO_MINI, MAX_MINI } from "./fotos-articulos.js";
const leer = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const crc = (b) => { let x = 0xffffffff; for (const v of b) { x ^= v; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; } return (x ^ 0xffffffff) >>> 0; };
const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 90)]); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(fila)))), ch("IEND", Buffer.alloc(0))]); };
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wAARCAAQABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Am4Ca2cAB/9k=", "base64"); // 24×16
const montar = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vm-mini-")); return { dir, f: crearFotos(dir + path.sep) }; };

test("MINIATURAS: solo valen para un artículo con foto, y tienen que ser un JPG pequeño de verdad", () => {
  const { dir, f } = montar();
  fs.writeFileSync(path.join(dir, "A1.png"), png(300, 200));
  assert.match(f.guardarMini("SINFOTO", JPG).error, /no tiene foto/);
  assert.equal(f.guardarMini("A1", JPG).ok, true); assert.ok(f.rutaMini("A1"));
  assert.match(f.guardarMini("A1", Buffer.from("no soy un jpg")).error, /JPG/);
  assert.match(f.guardarMini("A1", png(30, 30)).error, /JPG/); // un PNG no vale
  assert.match(f.guardarMini("A1", Buffer.alloc(MAX_MINI + 1, 1)).error, /no es válida/);
  assert.match(f.guardarMini("../x", JPG).error, /no válido/); assert.equal(f.rutaMini("../x"), null); // nada de rutas raras
  assert.ok(LADO_MINI >= 400);
});
test("MINIATURAS: el estado cuenta las que faltan; una miniatura más vieja que la foto vuelve a faltar; cambiar la foto la quita", async () => {
  const { dir, f } = montar();
  fs.writeFileSync(path.join(dir, "A1.png"), png(300, 200)); fs.writeFileSync(path.join(dir, "B2.png"), png(300, 200));
  f.lista(); // índice
  let e = f.estadoMinis(); assert.equal(e.total, 2); assert.equal(e.conMini, 0); assert.deepEqual(e.pendientes.sort(), ["A1", "B2"]);
  f.guardarMini("A1", JPG); e = f.estadoMinis(); assert.equal(e.conMini, 1); assert.deepEqual(e.pendientes, ["B2"]);
  const viejo = new Date(Date.now() - 3_600_000); fs.utimesSync(path.join(dir, "mini", "A1.jpg"), viejo, viejo); // la miniatura es anterior a la foto
  assert.deepEqual(f.estadoMinis().pendientes.sort(), ["A1", "B2"]);
  f.guardarMini("A1", JPG); assert.equal(f.estadoMinis().conMini, 1);
  assert.equal(f.guardar("A1", png(400, 300), "image/png").ok, true); // foto nueva: su miniatura derivada se quita
  assert.equal(f.rutaMini("A1"), null); assert.ok(f.estadoMinis().pendientes.includes("A1"));
  assert.ok(fs.existsSync(path.join(dir, "anteriores"))); // y la foto anterior sigue guardándose, como siempre
});
test("MINIATURAS en la app del cliente: la lista usa la pequeña (salvo en ordenador); la ficha y el zoom, la grande", () => {
  const h = leer("./pedido.html");
  assert.match(h, /function fotoMini\(p\) \{ return \(!escritorio\(\) && p\.mini\) \|\| p\.img; \}/);
  assert.ok((h.match(/fotoMini\(/g) || []).length >= 6); // fila, carrito, sugerencias y chips de categoría
  assert.match(h, /const b = document\.createElement\("button"\); b\.type = "button"; b\.className = "ficha-foto"[^\n]*im\.src = p\.img/); // la ficha, la grande
  const sv = leer("./server.js");
  assert.match(sv, /const miniUrl = /); assert.match(sv, /t=m/); assert.match(sv, /mini = url\.searchParams\.get\("t"\) === "m" && imgMini\.has\(idFoto\)/);
  assert.match(sv, /img: x\.mini \?\? x\.img/); assert.match(sv, /porId\.get\(id\)\?\.mini \?\? porId\.get\(id\)\?\.img/); // el Inicio, todo miniaturas
});
test("MINIATURAS en el panel: botón en «Artículos», lectura de la foto grande, reducción en el navegador y subida; no se apunta una a una en la actividad", () => {
  const e = leer("./empresa.html"), a = leer("./admin.js"), act = leer("./actividad.js");
  assert.match(e, /id="fm-preparar"/); assert.match(e, /createImageBitmap/); assert.match(e, /toBlob\(ok, "image\/jpeg", 0\.82\)/); assert.match(e, /\/foto-mini/); assert.match(e, /Math\.min\(1, 480 \/ Math\.max/);
  assert.ok(a.includes("/api/admin/fotos/minis")); assert.ok(a.includes("admin\\/foto\\/")); assert.ok(a.includes("foto-mini")); // la foto grande (solo con la clave) y la subida de la pequeña
  assert.match(act, /foto-mini\$\/, null/);
});
