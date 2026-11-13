#!/usr/bin/env node
// Conexión MCP (Model Context Protocol) para que un asistente de Claude pueda llevar las promociones y los avisos de Distribuciones Valentín Martín:
// «envía a todos un aviso de que hay una promoción de X», «pon un 15 % a las cervezas hasta el viernes»…
// Es un programa pequeño SIN dependencias que Claude Desktop / Claude Code arrancan en el MISMO ordenador y que habla con el panel de la empresa
// (puerto 3001, que nunca se publica en internet). Usa la misma clave de la empresa que el panel.
//
// Variables: VM_URL (por defecto http://localhost:3001) · VM_ADMIN_TOKEN (la clave de la empresa) o VM_ENV_FILE (ruta de empresa.env: de ahí se lee solo ADMIN_TOKEN).
// Las acciones que cambian algo (enviar un aviso, cambiar un precio…) exigen «confirmado_por_el_usuario: true»: el asistente tiene que haber enseñado el texto
// o el cambio al usuario y recibido un sí. El panel además limita los avisos a 10 por hora.
import fs from "node:fs";
import readline from "node:readline";

const VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const BASE = String(process.env.VM_URL || "http://localhost:3001").replace(/\/+$/, "");
function clave() {
  if (process.env.VM_ADMIN_TOKEN) return process.env.VM_ADMIN_TOKEN.trim();
  if (process.env.VM_ENV_FILE) { try { return /^ADMIN_TOKEN=(.*)$/m.exec(fs.readFileSync(process.env.VM_ENV_FILE, "utf8"))?.[1]?.trim() ?? ""; } catch { return ""; } }
  return "";
}

const CONFIRMA = { type: "boolean", description: "Pon true SOLO si el usuario ya ha visto exactamente lo que se va a hacer y ha dicho que sí. Si no, no llames a esta herramienta: enséñale primero el texto o el cambio y pídele confirmación." };
const TOOLS = [
  { name: "estado_avisos", description: "Dice cuántos clientes tienen activados los avisos en su móvil, con qué dirección se identifican los avisos y cuáles fueron los últimos enviados. Mírala antes de enviar un aviso.", inputSchema: { type: "object", properties: {} } },
  { name: "buscar_articulos", description: "Busca artículos del catálogo para ver su código, precio y oferta actual. Devuelve como mucho 20.", inputSchema: { type: "object", properties: { texto: { type: "string", description: "Parte del nombre o el código." }, filtro: { type: "string", enum: ["", "oferta", "bajada", "campana", "retirados"], description: "oferta = con oferta ahora · bajada = precio rebajado esta semana · campana = con algo que avisar." } } } },
  { name: "enviar_aviso", description: "ENVÍA una notificación REAL al móvil de los clientes (a todos los que tienen los avisos activados, o a uno). No se puede deshacer y no hay más de 10 por hora. Escribe un título corto (máx. 50 letras) y un mensaje claro (máx. 180). Úsala solo con el texto aprobado por el usuario.", inputSchema: { type: "object", required: ["titulo", "texto", "confirmado_por_el_usuario"], properties: { titulo: { type: "string", maxLength: 50 }, texto: { type: "string", maxLength: 180 }, destino: { type: "string", enum: ["todos", "cliente"], description: "Por defecto «todos»." }, cliente_id: { type: "string", description: "Código del cliente, solo si destino es «cliente»." }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "poner_oferta", description: "Pone una oferta a un artículo: un % de descuento o unos € menos por unidad, con fecha de fin opcional. Los clientes la ven en el catálogo con la etiqueta OFERTA y el pedido la aplica. NO avisa a los clientes (para eso usa avisar_oferta_articulo o enviar_aviso).", inputSchema: { type: "object", required: ["articulo_id", "tipo", "valor", "confirmado_por_el_usuario"], properties: { articulo_id: { type: "string" }, tipo: { type: "string", enum: ["pct", "eur"], description: "pct = % de descuento · eur = euros menos por unidad." }, valor: { type: "number", exclusiveMinimum: 0 }, hasta: { type: "string", description: "Fecha de fin AAAA-MM-DD (opcional; la oferta vale ese día incluido)." }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "quitar_oferta", description: "Quita la oferta de un artículo.", inputSchema: { type: "object", required: ["articulo_id", "confirmado_por_el_usuario"], properties: { articulo_id: { type: "string" }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "cambiar_precio", description: "Cambia el precio de venta de un artículo (euros por unidad). Cambia lo que pagan todos los clientes.", inputSchema: { type: "object", required: ["articulo_id", "precio", "confirmado_por_el_usuario"], properties: { articulo_id: { type: "string" }, precio: { type: "number", exclusiveMinimum: 0 }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "avisar_oferta_articulo", description: "La «campana» del panel: avisa a TODOS los clientes con avisos activados de la oferta vigente de un artículo, o de su bajada de precio de esta semana. El texto lo arma el programa. No se puede deshacer.", inputSchema: { type: "object", required: ["articulo_id", "confirmado_por_el_usuario"], properties: { articulo_id: { type: "string" }, confirmado_por_el_usuario: CONFIRMA } } },
];

async function api(metodo, ruta, cuerpo) {
  const token = clave();
  if (!token) throw new Error("Falta la clave de la empresa: pon VM_ADMIN_TOKEN o VM_ENV_FILE en la configuración de esta conexión.");
  let r;
  try { r = await fetch(BASE + ruta, { method: metodo, headers: { Authorization: "Bearer " + token, ...(cuerpo ? { "Content-Type": "application/json" } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new Error(`No se puede conectar con el panel de la empresa en ${BASE} (${e?.cause?.code || e?.name || "error"}). ¿Está encendido el ordenador de la oficina y conectado Tailscale?`); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("El panel no ha aceptado la clave de la empresa.");
  if (!r.ok) throw new Error(j.error || `El panel respondió con el error ${r.status}.`);
  return j;
}
const eur = (n) => Number(n).toFixed(3).replace(/0$/, "").replace(".", ",") + " €";
const necesitaSi = (a) => (a?.confirmado_por_el_usuario === true ? null : "NO se ha hecho nada: falta la confirmación del usuario. Enséñale exactamente lo que vas a hacer y pídele que lo confirme; después vuelve a llamar con confirmado_por_el_usuario = true.");
const idOk = (v) => typeof v === "string" && /^[\w.-]{1,40}$/.test(v);

async function llamar(nombre, a = {}) {
  switch (nombre) {
    case "estado_avisos": {
      const r = await api("GET", "/api/admin/avisos");
      return `Clientes con avisos activados: ${r.clientes} (${r.moviles} móviles). Los avisos se identifican con: ${r.contacto ?? "NINGUNA dirección válida (Apple los rechazará hasta que se arregle)"}.\nÚltimos avisos: ${r.ultimos.length ? r.ultimos.slice(0, 5).map((x) => `«${x.titulo}» (${x.destino === "todos" ? "a todos" : "a " + x.destino}, ${x.enviados} enviados${x.fallidos ? ", " + x.fallidos + " sin entregar " + (x.detalle ?? "") : ""})`).join("; ") : "ninguno todavía"}.`;
    }
    case "buscar_articulos": {
      const qs = new URLSearchParams({ ...(a.texto ? { q: String(a.texto).slice(0, 60) } : {}), ...(a.filtro ? { filtro: String(a.filtro) } : {}) }).toString();
      const r = await api("GET", "/api/admin/articulos" + (qs ? "?" + qs : ""));
      const f = r.filas.slice(0, 20).map((x) => `${x.id} · ${x.nombre} · ${eur(x.precio)}${x.oferta ? ` · OFERTA ${x.oferta.tipo === "pct" ? "−" + x.oferta.valor + " %" : "−" + eur(x.oferta.valor)}${x.oferta.hasta ? " hasta " + x.oferta.hasta : ""}` : ""}${x.campana ? " · tiene campana" + (x.avisado ? " (ya avisado)" : "") : ""}`);
      return `${r.total} artículo(s)${r.total > 20 ? " (se enseñan 20)" : ""}:\n${f.join("\n") || "ninguno"}`;
    }
    case "enviar_aviso": {
      const no = necesitaSi(a); if (no) return no;
      const titulo = String(a.titulo ?? "").trim(), texto = String(a.texto ?? "").trim(), destino = a.destino === "cliente" ? "cliente" : "todos";
      if (!titulo || titulo.length > 50) throw new Error("El título tiene que tener entre 1 y 50 letras.");
      if (!texto || texto.length > 180) throw new Error("El mensaje tiene que tener entre 1 y 180 letras.");
      if (destino === "cliente" && !idOk(a.cliente_id)) throw new Error("Falta el código del cliente.");
      const r = await api("POST", "/api/admin/avisos/enviar", { titulo, texto, destino, ...(destino === "cliente" ? { clienteId: a.cliente_id } : {}), confirmo: true });
      return r.enviados ? `Aviso enviado a ${r.enviados} móvil(es).${r.fallidos ? ` ${r.fallidos} no se han podido entregar (${(r.errores ?? []).join(" · ")}).` : ""}` : r.fallidos ? `El aviso NO ha llegado a ningún móvil (${(r.errores ?? []).join(" · ")}).` : "No había ningún móvil con los avisos activados: no se ha enviado a nadie.";
    }
    case "poner_oferta": {
      const no = necesitaSi(a); if (no) return no;
      if (!idOk(a.articulo_id)) throw new Error("Falta el código del artículo.");
      await api("POST", `/api/admin/articulos/${encodeURIComponent(a.articulo_id)}/oferta`, { tipo: a.tipo, valor: a.valor, hasta: a.hasta || null });
      return `Oferta puesta en el artículo ${a.articulo_id}: ${a.tipo === "pct" ? a.valor + " %" : eur(a.valor) + " menos por unidad"}${a.hasta ? " hasta el " + a.hasta : ""}. Los clientes ya la ven en el catálogo. No se ha avisado a nadie.`;
    }
    case "quitar_oferta": {
      const no = necesitaSi(a); if (no) return no;
      if (!idOk(a.articulo_id)) throw new Error("Falta el código del artículo.");
      const r = await api("POST", `/api/admin/articulos/${encodeURIComponent(a.articulo_id)}/oferta`, { tipo: "ninguna" });
      return r.cambio === "unchanged" ? "Ese artículo no tenía oferta." : `Oferta quitada del artículo ${a.articulo_id}.`;
    }
    case "cambiar_precio": {
      const no = necesitaSi(a); if (no) return no;
      if (!idOk(a.articulo_id)) throw new Error("Falta el código del artículo.");
      const r = await api("POST", `/api/admin/articulos/${encodeURIComponent(a.articulo_id)}/precio`, { precio: a.precio });
      return r.cambio === "unchanged" ? "El precio ya era ese." : `Precio del artículo ${a.articulo_id} cambiado a ${eur(a.precio)}. Si ha bajado, ya se puede avisar a los clientes (avisar_oferta_articulo).`;
    }
    case "avisar_oferta_articulo": {
      const no = necesitaSi(a); if (no) return no;
      if (!idOk(a.articulo_id)) throw new Error("Falta el código del artículo.");
      const r = await api("POST", `/api/admin/articulos/${encodeURIComponent(a.articulo_id)}/avisar`, { confirmo: true });
      return r.enviados ? `Aviso «${r.titulo}» enviado a ${r.enviados} móvil(es).${r.fallidos ? ` ${r.fallidos} sin entregar (${(r.errores ?? []).join(" · ")}).` : ""}` : r.fallidos ? `El aviso NO ha llegado (${(r.errores ?? []).join(" · ")}).` : "Ningún cliente tiene los avisos activados todavía.";
    }
    default: { const e = new Error("Herramienta desconocida: " + nombre); e.codigo = -32602; throw e; }
  }
}

const responder = (id, resultado) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: resultado }) + "\n");
const fallar = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
async function atender(m) {
  if (m.id === undefined) return; // notificaciones («initialized», «cancelled»…): no se contestan
  if (m.method === "initialize") return responder(m.id, { protocolVersion: VERSIONES.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONES[0], capabilities: { tools: {} }, serverInfo: { name: "vm-pedidos", version: "1.0.0" }, instructions: "Herramientas para llevar las promociones y los avisos a clientes de Distribuciones Valentín Martín. Antes de enviar un aviso o cambiar un precio, enseña al usuario el texto o el cambio y pídele confirmación." });
  if (m.method === "ping") return responder(m.id, {});
  if (m.method === "tools/list") return responder(m.id, { tools: TOOLS });
  if (m.method === "tools/call") {
    try { return responder(m.id, { content: [{ type: "text", text: await llamar(m.params?.name, m.params?.arguments) }] }); }
    catch (e) { if (e.codigo) return fallar(m.id, e.codigo, e.message); return responder(m.id, { isError: true, content: [{ type: "text", text: e.message }] }); }
  }
  return fallar(m.id, -32601, "Método no soportado: " + m.method);
}
readline.createInterface({ input: process.stdin }).on("line", (l) => { if (!l.trim()) return; let m; try { m = JSON.parse(l); } catch { return fallar(null, -32700, "JSON no válido"); } atender(m).catch((e) => m.id !== undefined && fallar(m.id, -32603, e.message)); });
