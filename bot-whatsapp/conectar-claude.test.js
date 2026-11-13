import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configurar, buscarConfiguraciones } from "./mcp/conectar-claude-desktop.js";

const datos = { node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\vm\\bot\\bot-whatsapp\\mcp\\vm-mcp.js", envFile: "C:\\vm\\config\\empresa.env" };
const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), "vm-claude-"));
const escribir = (txt) => { const f = path.join(carpeta(), "claude_desktop_config.json"); fs.writeFileSync(f, txt); return f; };
const leer = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

test("CONECTAR CLAUDE: añade la conexión conservando todo lo demás, con copia del original, y es repetible", () => {
  const original = JSON.stringify({ preferences: { a: true, b: { c: [1, 2] } }, otraCosa: "x" }, null, 2);
  const f = escribir(original);
  assert.deepEqual(configurar(f, datos), { cambio: "añadida", arreglado: false });
  const j = leer(f);
  assert.deepEqual(j.preferences, { a: true, b: { c: [1, 2] } }); assert.equal(j.otraCosa, "x");
  assert.deepEqual(j.mcpServers["vm-pedidos"], { command: datos.node, args: [datos.script], env: { VM_URL: "http://localhost:3001", VM_ENV_FILE: datos.envFile } });
  assert.equal(fs.readFileSync(f.replace(".json", ".antes-de-vm-pedidos.json"), "utf8"), original); // copia del archivo tal como estaba
  const antes = fs.readFileSync(f, "utf8");
  assert.equal(configurar(f, datos).cambio, "sin cambios"); assert.equal(fs.readFileSync(f, "utf8"), antes); // repetirlo no cambia nada
  assert.equal(fs.readFileSync(f.replace(".json", ".antes-de-vm-pedidos.json"), "utf8"), original); // y la copia sigue siendo la original
  assert.equal(configurar(f, { ...datos, script: "D:\\otro\\vm-mcp.js" }).cambio, "actualizada"); assert.equal(leer(f).mcpServers["vm-pedidos"].args[0], "D:\\otro\\vm-mcp.js");
});

test("CONECTAR CLAUDE: respeta otras conexiones, archivos vacíos o con marca BOM, y se puede quitar", () => {
  const f = escribir(JSON.stringify({ mcpServers: { otro: { command: "x" } }, preferences: {} }));
  configurar(f, datos); assert.deepEqual(Object.keys(leer(f).mcpServers).sort(), ["otro", "vm-pedidos"]);
  assert.equal(configurar(f, { ...datos, quitar: true }).cambio, "quitada"); assert.deepEqual(leer(f).mcpServers, { otro: { command: "x" } });
  assert.equal(configurar(f, { ...datos, quitar: true }).cambio, "sin cambios");
  const g = escribir(JSON.stringify({ preferences: { a: 1 } })); configurar(g, datos); configurar(g, { ...datos, quitar: true }); assert.deepEqual(leer(g), { preferences: { a: 1 } }); // al quitar la única, desaparece «mcpServers»
  const vacio = escribir(""); assert.equal(configurar(vacio, datos).cambio, "añadida"); assert.ok(leer(vacio).mcpServers["vm-pedidos"]);
  const bom = escribir("\uFEFF" + JSON.stringify({ preferences: { a: 1 } })); configurar(bom, datos); assert.equal(leer(bom).preferences.a, 1);
});

test("CONECTAR CLAUDE: si el bloque pegado a mano dejó el archivo roto (falta una coma), lo retira y lo deja bien; si el error es otro, no toca nada", () => {
  const roto = `{\n  "mcpServers": {\n    "vm-pedidos": {\n      "command": "node",\n      "args": ["C:\\\\vm\\\\bot\\\\bot-whatsapp\\\\mcp\\\\vm-mcp.js"],\n      "env": {\n        "VM_URL": "http://localhost:3001",\n        "VM_ENV_FILE": "C:\\\\vm\\\\config\\\\empresa.env"\n      }\n    }\n  }\n  "preferences": { "a": 1 }\n}\n`;
  assert.throws(() => JSON.parse(roto)); // (el archivo de partida de verdad está roto)
  const f = escribir(roto);
  assert.deepEqual(configurar(f, datos), { cambio: "añadida", arreglado: true });
  assert.equal(leer(f).preferences.a, 1); assert.equal(leer(f).mcpServers["vm-pedidos"].command, datos.node);
  const mal = '{ "preferences": { "a": 1, }'; const g = escribir(mal);
  assert.throws(() => configurar(g, datos), (e) => e.codigo === "json" && /no he querido tocarlo/.test(e.message));
  assert.equal(fs.readFileSync(g, "utf8"), mal); assert.equal(fs.existsSync(g.replace(".json", ".antes-de-vm-pedidos.json")), false);
  assert.throws(() => configurar(escribir("[1,2]"), datos), /formato esperado/);
});

test("CONECTAR CLAUDE: encuentra el archivo normal y el de la versión de la tienda de Windows", () => {
  const raiz = carpeta(), APPDATA = path.join(raiz, "Roaming"), LOCALAPPDATA = path.join(raiz, "Local");
  assert.deepEqual(buscarConfiguraciones({ APPDATA, LOCALAPPDATA }), []);
  const normal = path.join(APPDATA, "Claude", "claude_desktop_config.json"); fs.mkdirSync(path.dirname(normal), { recursive: true }); fs.writeFileSync(normal, "{}");
  const tienda = path.join(LOCALAPPDATA, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"); fs.mkdirSync(path.dirname(tienda), { recursive: true }); fs.writeFileSync(tienda, "{}");
  fs.mkdirSync(path.join(LOCALAPPDATA, "Packages", "Otro_abc", "LocalCache", "Roaming", "OtraApp"), { recursive: true }); fs.writeFileSync(path.join(LOCALAPPDATA, "Packages", "Otro_abc", "LocalCache", "Roaming", "OtraApp", "claude_desktop_config.json"), "{}");
  assert.deepEqual(buscarConfiguraciones({ APPDATA, LOCALAPPDATA }).sort(), [normal, tienda].sort()); // (una carpeta que no se llama «Claude…» no cuenta)
  // el nombre del paquete de la tienda y de la carpeta puede variar
  const rara = path.join(LOCALAPPDATA, "Packages", "AnthropicPBC.ClaudeDesktop_8wekyb3d8bbwe", "LocalCache", "Roaming", "Claude-3p", "claude_desktop_config.json"); fs.mkdirSync(path.dirname(rara), { recursive: true }); fs.writeFileSync(rara, "{}");
  const roam = path.join(APPDATA, "Claude-3p", "claude_desktop_config.json"); fs.mkdirSync(path.dirname(roam), { recursive: true }); fs.writeFileSync(roam, "{}");
  assert.deepEqual(buscarConfiguraciones({ APPDATA, LOCALAPPDATA }).sort(), [normal, tienda, rara, roam].sort());
  // la ruta real de una instalación: Local\\Claude-Data\\claude_<paquete>\\claude_desktop_config.json
  const datosL = path.join(LOCALAPPDATA, "Claude-Data", "claude_pzs8sxrjxfjjc", "claude_desktop_config.json"); fs.mkdirSync(path.dirname(datosL), { recursive: true }); fs.writeFileSync(datosL, "{}");
  assert.deepEqual(buscarConfiguraciones({ APPDATA, LOCALAPPDATA }).sort(), [normal, tienda, rara, roam, datosL].sort());
});

test("CONECTAR CLAUDE: también arregla restos sueltos pegados al principio (comillas invertidas o la palabra «json» de un bloque de código copiado)", () => {
  for (const basura of ["```json", "json", "`", "..."]) {
    const roto = `{\n${basura}\n  "mcpServers": {\n    "vm-pedidos": {\n      "command": "node",\n      "args": ["C:\\\\x\\\\vm-mcp.js"],\n      "env": {\n        "VM_URL": "http://localhost:3001",\n        "VM_ENV_FILE": "C:\\\\e.env"\n      }\n    }\n  },\n  "preferences": { "a": 1 }\n}\n`;
    assert.throws(() => JSON.parse(roto), basura);
    const f = escribir(roto), r = configurar(f, datos);
    assert.deepEqual(r, { cambio: "añadida", arreglado: true }, basura); assert.equal(leer(f).preferences.a, 1); assert.equal(leer(f).mcpServers["vm-pedidos"].command, datos.node);
  }
  // un archivo bueno nunca se «arregla»: lo que hay entre la llave y la primera clave solo se toca si es texto suelto
  const bueno = escribir(JSON.stringify({ preferences: { a: 1 } }, null, 2)); assert.equal(configurar(bueno, datos).arreglado, false);
});

test("CONECTAR CLAUDE: repara el archivo aunque lo pegado a mano esté estropeado de cualquier manera (comillas rizadas, sin comilla inicial, bloque a medias…), conservando lo de Claude", () => {
  const prefs = `  "preferences": {\n    "a": true,\n    "b": { "c": [1, 2] }\n  },\n  "otra": "x"\n}\n`;
  const casos = {
    "comillas rizadas": `{\n  “mcpServers”: {\n    “vm-pedidos”: { “command”: “node” }\n  },\n${prefs}`,
    "sin la comilla inicial": `{\nmcpServers": {\n    "vm-pedidos": { "command": "node" }\n  },\n${prefs}`,
    "bloque a medias": `{\n  "mcpServers": {\n    "vm-pedidos": {\n      "command": "node",\n${prefs}`,
    "texto de una explicación": `{\nPaso 1: pega esto\n  "mcpServers": { "vm-pedidos": { "command": "node" } },\n${prefs}`,
    "bloque duplicado": `{\n  "mcpServers": { "vm-pedidos": { "command": "node" } }\n  "mcpServers": { "vm-pedidos": { "command": "node" } },\n${prefs}`,
  };
  for (const [nombre, texto] of Object.entries(casos)) {
    assert.throws(() => JSON.parse(texto), nombre);
    const f = escribir(texto), r = configurar(f, datos);
    assert.equal(r.arreglado, true, nombre); assert.deepEqual(leer(f).preferences, { a: true, b: { c: [1, 2] } }, nombre); assert.equal(leer(f).otra, "x", nombre);
    assert.equal(leer(f).mcpServers["vm-pedidos"].command, datos.node, nombre);
    assert.equal(fs.readFileSync(f.replace(".json", ".antes-de-vm-pedidos.json"), "utf8"), texto, nombre); // la copia es el archivo roto, tal cual
  }
  // lo que no se puede arreglar: no se toca y se enseña cómo empieza el archivo
  const f = escribir('{ esto no tiene arreglo'); assert.throws(() => configurar(f, datos), (e) => e.codigo === "json" && /Así empieza el archivo.*esto no tiene arreglo/.test(e.message));
});
