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
  { name: "buscar_clientes", description: "Busca un cliente por nombre (o código/teléfono) y devuelve su código. También encuentra pedidos por su referencia VM-… y artículos. Solo lee.", inputSchema: { type: "object", required: ["texto"], properties: { texto: { type: "string", description: "Mínimo 2 letras: nombre, código, teléfono o referencia." } } } },
  { name: "ficha_cliente", description: "Ficha de un cliente: datos de contacto, cómo compra (cada cuánto, día y hora, ticket, lo que suele pedir y lo que dejó de pedir), sus últimos pedidos y si se retrasa. Nunca incluye el NIF. Solo lee.", inputSchema: { type: "object", required: ["cliente_id"], properties: { cliente_id: { type: "string", description: "Código del cliente (sale de buscar_clientes)." } } } },
  { name: "estadisticas", description: "Estadísticas de ventas de un periodo (sin pedidos de prueba): pedidos, importe con IVA, ticket medio, clientes distintos, artículos más vendidos, categorías, horas y clientes que llevan tiempo sin pedir. Solo lee.", inputSchema: { type: "object", properties: { rango: { type: "string", enum: ["hoy", "7d", "30d", "mes", "todo"], description: "Periodo. Por defecto 30d." } } } },
  { name: "ver_excel", description: "VISTA PREVIA de un Excel (o ZIP de fotos) que está en el ordenador de la oficina, sin cambiar nada: dice qué cambiaría (artículos, precios, clientes, historial, consumo de clientes con precios y descuentos propios). Usa siempre esto ANTES de aplicar_excel y enséñale el resumen y los avisos al usuario.", inputSchema: { type: "object", required: ["ruta", "tipo"], properties: { ruta: { type: "string", description: "Ruta completa del archivo en este ordenador, p. ej. C:\\vm\\entrada\\articulos.xlsx" }, tipo: { type: "string", enum: ["productos", "clientes", "historial", "consumo", "fotos"], description: "productos = artículos y precios · clientes · historial = historial de compras · consumo = consumo de clientes (precios y descuentos propios) · fotos" }, solo_descuentos_e_historial: { type: "boolean", description: "Solo con tipo consumo: no mirar los precios propios." } } } },
  { name: "aplicar_excel", description: "APLICA un Excel que ya se ha visto con ver_excel (mismas protecciones del panel: un archivo con menos de la mitad de lo que hay se rechaza y los cambios raros piden confirmación aparte). Cambia datos reales: hace falta el sí del usuario tras enseñarle la vista previa. Hace copia de seguridad el propio programa si procede.", inputSchema: { type: "object", required: ["ruta", "tipo", "confirmado_por_el_usuario"], properties: { ruta: { type: "string" }, tipo: { type: "string", enum: ["productos", "clientes", "historial", "consumo", "fotos"] }, solo_descuentos_e_historial: { type: "boolean" }, acepta_los_avisos: { type: "boolean", description: "Pon true solo si la vista previa traía avisos a confirmar (precios que cambian mucho, precios propios distintos de la tarifa…) y el usuario los ha leído y aceptado." }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "poner_ofertas", description: "Pone VARIAS ofertas de golpe (hasta 50 artículos): cada una un % de descuento o unos € menos por unidad, con fecha de fin opcional. Enseña al usuario la lista completa (artículo, oferta y fecha) antes de llamar.", inputSchema: { type: "object", required: ["ofertas", "confirmado_por_el_usuario"], properties: { ofertas: { type: "array", maxItems: 50, items: { type: "object", required: ["articulo_id", "tipo", "valor"], properties: { articulo_id: { type: "string" }, tipo: { type: "string", enum: ["pct", "eur"] }, valor: { type: "number" }, hasta: { type: "string", description: "AAAA-MM-DD, opcional" } } } }, confirmado_por_el_usuario: CONFIRMA } } },
  { name: "ver_temporada", description: "Dice qué temporada de fiestas (Navidad, Reyes…) tiene puesta la web de los clientes y cuáles se pueden poner.", inputSchema: { type: "object", properties: {} } },
  { name: "cambiar_temporada", description: "Cambia el aspecto de fiestas de la web de los clientes: una franja de color con un mensaje bajo la cabecera (no toca precios, logo ni código). Temporadas: normal (quita los adornos), navidad, reyes, rebajas, verano. Se quita sola en la fecha de fin.", inputSchema: { type: "object", required: ["temporada", "confirmado_por_el_usuario"], properties: { temporada: { type: "string", enum: ["normal", "navidad", "reyes", "rebajas", "verano"] }, hasta: { type: "string", description: "Día en que se quita sola, AAAA-MM-DD (opcional)." }, mensaje: { type: "string", description: "Texto propio de la franja, máximo 90 letras (opcional; si no, el de la temporada)." }, confirmado_por_el_usuario: CONFIRMA } } },
];

async function api(metodo, ruta, cuerpo, { binario = false, cabeceras = {}, plazo = 30_000 } = {}) { // binario: el cuerpo es un archivo (Excel/ZIP) tal cual
  const token = clave();
  if (!token) throw new Error("Falta la clave de la empresa: pon VM_ADMIN_TOKEN o VM_ENV_FILE en la configuración de esta conexión.");
  let r;
  try { r = await fetch(BASE + ruta, { method: metodo, headers: { Authorization: "Bearer " + token, ...(process.env.VM_ADMIN_2FA_BYPASS ? { "X-VM-2FA": process.env.VM_ADMIN_2FA_BYPASS } : {}), ...(cuerpo ? { "Content-Type": binario ? "application/octet-stream" : "application/json" } : {}), ...cabeceras }, body: cuerpo ? (binario ? cuerpo : JSON.stringify(cuerpo)) : undefined, signal: AbortSignal.timeout(plazo) }); }
  catch (e) { throw new Error(`No se puede conectar con el panel de la empresa en ${BASE} (${e?.cause?.code || e?.name || "error"}). ¿Está encendido el ordenador de la oficina y conectado Tailscale?`); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error("El panel no ha aceptado la clave de la empresa.");
  if (!r.ok) { const e = new Error(j.error || `El panel respondió con el error ${r.status}.`); e.confirmar = j.confirmar; throw e; }
  return j;
}
const eur = (n) => Number(n).toFixed(3).replace(/0$/, "").replace(".", ",") + " €";
const necesitaSi = (a) => (a?.confirmado_por_el_usuario === true ? null : "NO se ha hecho nada: falta la confirmación del usuario. Enséñale exactamente lo que vas a hacer y pídele que lo confirme; después vuelve a llamar con confirmado_por_el_usuario = true.");
const recorta = (v, max = 7000) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > max ? t.slice(0, max) + "\n… (resultado recortado)" : t; };
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
    case "buscar_clientes": {
      const t = String(a.texto ?? "").trim(); if (t.length < 2) throw new Error("Escribe al menos 2 letras.");
      const r = await api("GET", "/api/admin/buscar?q=" + encodeURIComponent(t.slice(0, 60)));
      const cl = (r.clientes ?? []).slice(0, 15).map((c) => `${c.id} · ${c.nombre ?? c.name ?? ""}${c.poblacion ? " · " + c.poblacion : ""}`);
      return `Clientes (${cl.length}):\n${cl.join("\n") || "ninguno"}${r.pedidos?.length ? `\nPedidos: ${r.pedidos.slice(0, 5).map((p) => p.ref ?? p.id).join(", ")}` : ""}`;
    }
    case "ficha_cliente": {
      if (!idOk(a.cliente_id)) throw new Error("Falta el código del cliente.");
      return recorta(await api("GET", `/api/admin/cliente/${encodeURIComponent(a.cliente_id)}/ficha`));
    }
    case "estadisticas": {
      const rango = ["hoy", "7d", "30d", "mes", "todo"].includes(a.rango) ? a.rango : "30d";
      return recorta(await api("GET", "/api/admin/estadisticas?rango=" + rango));
    }
    case "ver_excel": case "aplicar_excel": {
      const aplicar = nombre === "aplicar_excel"; if (aplicar) { const no = necesitaSi(a); if (no) return no; }
      const tipo = String(a.tipo ?? ""); if (!["productos", "clientes", "historial", "consumo", "fotos"].includes(tipo)) throw new Error("Tipo de archivo no válido.");
      const ruta = String(a.ruta ?? ""); if (!ruta || /\.\.[\\/]/.test(ruta) || !/\.(xlsx|zip)$/i.test(ruta)) throw new Error("Pon la ruta completa de un archivo .xlsx o .zip.");
      let buf; try { buf = fs.readFileSync(ruta); } catch { throw new Error("No encuentro ese archivo en este ordenador: " + ruta); }
      if (buf.length > 80_000_000) throw new Error("El archivo es demasiado grande.");
      const qs = new URLSearchParams({ fichero: ruta.split(/[\\/]/).pop().slice(0, 120) }); if (a.solo_descuentos_e_historial) qs.set("sinPrecios", "1"); if (aplicar && a.acepta_los_avisos) qs.set("confirmo", "1");
      const cab = aplicar && tipo === "productos" ? { "X-VM-Reclave": clave() } : {}; // cambiar la tarifa entera pide la clave otra vez: esta conexión ya la tiene
      let r; try { r = await api("POST", `/api/admin/${aplicar ? "aplicar" : "vista-previa"}/${tipo}?${qs}`, buf, { binario: true, cabeceras: cab, plazo: 120_000 }); }
      catch (e) { if (e.confirmar?.length) return `NO se ha aplicado: hay cosas que el usuario debe aceptar primero:\n- ${e.confirmar.join("\n- ")}\nEnséñaselas; si las acepta, vuelve a llamar con acepta_los_avisos = true.`; throw e; }
      const partes = [aplicar ? "APLICADO." : "VISTA PREVIA (no se ha cambiado nada).", "Resumen: " + JSON.stringify(r.resumen ?? {})]; if (r.aviso?.length) partes.push("Avisos:\n- " + r.aviso.join("\n- ")); if (r.confirmar?.length) partes.push("Hay que confirmar antes de aplicar:\n- " + r.confirmar.join("\n- ")); if (!aplicar && r.aplicable === false) partes.push("No hay nada que cambiar.");
      return recorta(partes.join("\n"));
    }
    case "poner_ofertas": {
      const no = necesitaSi(a); if (no) return no;
      const lista = Array.isArray(a.ofertas) ? a.ofertas.slice(0, 50) : []; if (!lista.length) throw new Error("No hay ninguna oferta en la lista.");
      const hechas = [], fallos = [];
      for (const o of lista) { try { if (!idOk(o?.articulo_id)) throw new Error("código no válido"); await api("POST", `/api/admin/articulos/${encodeURIComponent(o.articulo_id)}/oferta`, { tipo: o.tipo, valor: o.valor, hasta: o.hasta || null }); hechas.push(o.articulo_id); } catch (e) { fallos.push(`${o?.articulo_id ?? "?"}: ${e.message}`); } }
      return `Ofertas puestas: ${hechas.length} (${hechas.join(", ") || "ninguna"}).${fallos.length ? `\nNo se han podido poner ${fallos.length}:\n- ${fallos.join("\n- ")}` : ""}\nNo se ha avisado a nadie.`;
    }
    case "ver_temporada": { const r = await api("GET", "/api/admin/temporada"); return `Ahora: ${r.activa.titulo}${r.activa.hasta ? " hasta el " + r.activa.hasta : ""}${r.activa.texto ? ` · «${r.activa.texto}»` : ""}.\nSe pueden poner: ${r.opciones.map((o) => o.id).join(", ")}.`; }
    case "cambiar_temporada": {
      const no = necesitaSi(a); if (no) return no;
      const r = await api("POST", "/api/admin/temporada", { id: a.temporada, hasta: a.hasta || null, mensaje: a.mensaje || "", confirmo: true });
      return r.activa.id === "normal" ? "Adornos quitados: la web vuelve a su aspecto normal." : `Temporada «${r.activa.titulo}» puesta${r.activa.hasta ? " hasta el " + r.activa.hasta : ""}: «${r.activa.texto}». Los clientes la ven ya.`;
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
