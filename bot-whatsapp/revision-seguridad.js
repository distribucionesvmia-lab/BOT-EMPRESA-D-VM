// «Revisión de seguridad» del panel: una lista en verde/ámbar/rojo con lo que está bien y lo que conviene arreglar, en cristiano y con qué hacer.
// Función PURA (recibe los datos ya leídos): así se prueba sin tocar nada. La aplicación de los clientes y el panel son dos programas distintos y cada uno tiene su
// propia configuración (cliente.env / empresa.env): el de los clientes deja un resumen SIN claves en la base de cuentas (`estadoCliente`) y el panel lo lee aquí.
import { claveDebil } from "./seguridad.js";

/** Lo que la aplicación de los clientes cuenta de sí misma (sin claves ni datos personales). */
export function estadoCliente(env, { turnstile = false, smtp = false, geo = null } = {}, ahora = new Date().toISOString()) {
  const https = /^https:\/\//i.test(String(env.PUBLIC_URL ?? ""));
  return {
    at: ahora, https, trustProxy: env.TRUST_PROXY === "1", hsts: env.HSTS === "1", turnstile: !!turnstile, smtp: !!smtp,
    modo: env.ACCESO_MODO === "oficina" ? "oficina" : "contraseña", legacyAbierto: env.ACCESO_SOLO_OFICINA === "0", altaAutomatica: env.ALTA_AUTOMATICA === "1",
    geo: geo && { modo: geo.modo, lista: !!geo.lista, fecha: geo.fecha ?? null, es: geo.es ?? 0, fuera: geo.fuera ?? 0, local: geo.local ?? 0, sinDato: geo.sinDato ?? 0 }, cspEstricta: env.CSP_ESTRICTA !== "0", escudo: !(env.DEMO === "1" || env.VM_TEST) || env.ESCUDO === "1",
  };
}

const MIN_30 = 30 * 60_000;
/**
 * entradas: { cliente (estadoCliente o null), env (la del panel), copias (estadoCopias), eventos24h { total, porTipo }, bloqueadas, accesosNuevos7, pausa, ahora }
 * Devuelve { lista: [{ id, nivel: ok|aviso|mal|info|manual, titulo, detalle, arreglo? }], resumen: { mal, aviso, ok } }.
 */
export function revisar({ cliente = null, env = {}, copias = null, eventos24h = { total: 0, porTipo: [] }, bloqueadas = 0, accesosNuevos7 = 0, pausa = {}, panel2fa = null, ahora = Date.now() } = {}) {
  const L = [], add = (id, nivel, titulo, detalle = "", arreglo = "") => L.push({ id, nivel, titulo, detalle, ...(arreglo ? { arreglo } : {}) });
  // ── El panel y las claves ──
  if (claveDebil(env.ADMIN_TOKEN)) add("clave-panel", "mal", "La clave del panel es corta o fácil de adivinar", "Quien la adivine puede ver todos los pedidos y clientes.", "En C:\\vm\\config\\empresa.env cambia ADMIN_TOKEN por una de 20 letras y números y reinicia «VM Empresa».");
  else add("clave-panel", "ok", "La clave del panel es larga");
  if (env.PANEL_PERMITIR_PUBLICO === "1") add("panel-privado", "mal", "El panel está abierto a cualquier dirección de internet", "Debe verse solo desde la oficina o por Tailscale.", "Quita PANEL_PERMITIR_PUBLICO=1 de empresa.env y reinicia «VM Empresa».");
  else add("panel-privado", "ok", "El panel solo se abre desde la oficina o Tailscale");
  if (panel2fa) {
    if (panel2fa.ilegible) add("panel-2fa", "mal", "El segundo factor del panel no se puede leer", "Se cambió la clave del panel (ADMIN_TOKEN) y el secreto del móvil ya no se descifra: nadie podría entrar.", "En el ordenador de la oficina ejecuta deploy\\windows\\desactivar-2fa.bat y vuelve a activarlo desde «Cuentas de clientes».");
    else if (!panel2fa.activo) add("panel-2fa", "aviso", "El panel no tiene segundo factor", "Quien consiga la clave del panel entra sin más. Con el segundo factor también hace falta el móvil.", "Actívalo aquí mismo, en «Segundo factor del panel» (10 minutos).");
    else add("panel-2fa", "ok", "El panel pide un código del móvil además de la clave");
  }
  // ── La aplicación de los clientes ──
  const viejo = !cliente || !cliente.at || ahora - Date.parse(cliente.at) > MIN_30;
  if (viejo) add("cliente-estado", "aviso", "La aplicación de los clientes no ha dado señales en los últimos 30 minutos", "Puede estar parada o no haberse reiniciado con la última versión; sin ella no se puede revisar su configuración.", "Mira http://localhost:3000/health y, si no responde, reinicia «VM Cliente».");
  if (cliente && !viejo) {
    if (!cliente.https) add("https", "mal", "La web de los clientes no usa HTTPS", "Sin HTTPS, las contraseñas viajan sin cifrar.", "Pon en cliente.env PUBLIC_URL con la dirección https://… y reinicia «VM Cliente».");
    else add("https", "ok", "La web de los clientes usa HTTPS");
    if (cliente.https && !cliente.trustProxy) add("trust-proxy", "aviso", "Falta TRUST_PROXY=1 (detrás del túnel todos los clientes parecen una sola dirección)", "Los límites de intentos pueden bloquear a todos a la vez o no frenar a nadie.", "Añade TRUST_PROXY=1 a cliente.env y reinicia «VM Cliente».");
    else if (cliente.https) add("trust-proxy", "ok", "Se distingue a cada cliente por su dirección real");
    if (cliente.https && !cliente.hsts) add("hsts", "info", "HSTS está apagado", "Obliga al navegador a usar siempre HTTPS. Conviene activarlo cuando el HTTPS ya funcione bien.", "Añade HSTS=1 a cliente.env.");
    add("modo", "info", cliente.modo === "oficina" ? "Entrada de clientes: la oficina da paso" : "Entrada de clientes: nombre + NIF + contraseña", cliente.modo === "oficina" ? "ACCESO_MODO=oficina." : "Es el modo normal.");
    if (cliente.legacyAbierto) add("legacy", "mal", "Están abiertas las formas antiguas de entrar (solo con el NIF)", "Es solo para emergencias: cualquiera con un NIF podría entrar.", "Quita ACCESO_SOLO_OFICINA=0 de cliente.env y reinicia «VM Cliente».");
    else add("legacy", "ok", "Las formas antiguas de entrar están cerradas");
    if (cliente.altaAutomatica) add("alta-auto", "aviso", "Las altas nuevas entran solas", "Con ALTA_AUTOMATICA=1 una solicitud que encaje con un cliente entra sin que la mires.", "Quita ALTA_AUTOMATICA=1 de cliente.env.");
    if (!cliente.turnstile) add("turnstile", "aviso", "«No soy un robot» (Cloudflare Turnstile) no está activado", "Es la mejor defensa contra bots al crear una contraseña o darse de alta. Es gratis y opcional.", "Crea una cuenta gratuita en Cloudflare y pon TURNSTILE_SITE y TURNSTILE_SECRET en cliente.env.");
    else add("turnstile", "ok", "«No soy un robot» está activado");
    if (!cliente.cspEstricta) add("csp", "aviso", "La política estricta de scripts está desactivada (CSP_ESTRICTA=0)", "Protege contra código inyectado en las páginas.", "Quita CSP_ESTRICTA=0 de cliente.env cuando ya no haga falta.");
    if (!cliente.escudo) add("escudo", "aviso", "El escudo contra inundaciones de peticiones está apagado", "", "Es normal solo en pruebas (DEMO).");
    // Filtro por país (lista local de rangos de IP de España)
    const g = cliente.geo;
    if (!g || g.modo === "off") add("geo", "aviso", g && !g.lista ? "No hay lista de direcciones de España: el filtro por país no funciona" : "El filtro por país está apagado", "Las conexiones desde fuera de España pasan sin controles extra.", "Ejecuta deploy\\windows\\actualizar-geo.bat y quita GEO_MODO=off de cliente.env si lo tiene.");
    else {
      const total = g.es + g.fuera + g.local + g.sinDato, internas = g.local + g.sinDato;
      const dias = g.fecha ? Math.floor((ahora - Date.parse(g.fecha)) / 86_400_000) : null;
      if (cliente.https && total >= 20 && internas / total >= 0.9) add("geo-ip", "aviso", "El programa no está viendo la dirección real de los clientes", "Casi todas las conexiones parecen internas, así que el filtro por país no puede distinguir a nadie.", "Comprueba TRUST_PROXY=1 en cliente.env y que el túnel (Tailscale Funnel o Cloudflare) pasa la dirección del cliente.");
      else if (dias !== null && dias > 120) add("geo", "aviso", `La lista de direcciones de España tiene ${dias} días`, "Los rangos de direcciones cambian poco a poco.", "Ejecuta deploy\\windows\\actualizar-geo.bat.");
      else add("geo", "ok", g.modo === "aprobar" ? "Filtro por país activo: un aparato nuevo desde fuera de España necesita que la oficina dé paso" : "Filtro por país en modo vigilar (solo anota)", g.fuera ? `${g.fuera} conexión${g.fuera === 1 ? "" : "es"} desde fuera de España desde que arrancó el programa.` : "");
    }
    add("correo", cliente.smtp ? "ok" : "info", cliente.smtp ? "El correo de salida está configurado" : "El correo de salida no está configurado", cliente.smtp ? "" : "Sin él no salen las confirmaciones de pedido ni los códigos por correo.");
  }
  // ── Copias de seguridad ──
  if (copias) {
    if (copias.ok) add("copias", "ok", "Hay copia reciente de las 4 bases de datos");
    else add("copias", "mal", "Falta alguna copia de seguridad o es demasiado vieja", (copias.problemas ?? []).join(" · "), "Mira «Datos y Excel» → «Copias de seguridad» y comprueba que el programa se está ejecutando.");
  }
  if (!env.BACKUP_DIR2) add("copias-2", "aviso", "No hay una segunda carpeta de copias", "Si el disco del ordenador se estropea o lo roban, las copias se pierden con él.", "Pon BACKUP_DIR2 en empresa.env con la ruta de un USB o disco externo.");
  else add("copias-2", "ok", "Hay una segunda carpeta de copias");
  // ── Lo que ha pasado ──
  const t = eventos24h.total ?? 0;
  if (t >= 10) add("hechos", "aviso", `${t} hechos sospechosos en las últimas 24 horas`, (eventos24h.porTipo ?? []).slice(0, 4).map((x) => `${x.tipo}: ${x.n}`).join(" · "), "Míralos en «Cuentas de clientes» → «Seguridad y actividad del panel». Si es un ataque, usa la pausa de emergencia.");
  else add("hechos", "ok", t ? `${t} hecho${t === 1 ? "" : "s"} raro${t === 1 ? "" : "s"} en 24 horas (normal)` : "Nada raro en las últimas 24 horas");
  if (bloqueadas > 0) add("bloqueadas", "info", `${bloqueadas} cuenta${bloqueadas === 1 ? "" : "s"} bloqueada${bloqueadas === 1 ? "" : "s"} por intentos fallidos`, "Puede ser un cliente que olvidó su contraseña o alguien probando.", "Míralas en «Cuentas de clientes».");
  if (accesosNuevos7 > 0) add("accesos-nuevos", "info", `${accesosNuevos7} contraseña${accesosNuevos7 === 1 ? "" : "s"} creada${accesosNuevos7 === 1 ? "" : "s"} en los últimos 7 días`, "Repasa «Hoy → Accesos nuevos» por si alguna no es del cliente.");
  if (pausa.entradas || pausa.pedidos) add("pausa", "aviso", "La pausa de emergencia está ACTIVA", [pausa.entradas ? "entradas nuevas cerradas" : "", pausa.pedidos ? "pedidos cerrados" : ""].filter(Boolean).join(" y "), "Reactívala en «Hoy» cuando haya pasado el problema.");
  // ── Cosas que el programa NO puede comprobar: solo usted ──
  const MANUAL = [
    ["github-2fa", "Verificación en dos pasos en la cuenta de GitHub y rama protegida", "La actualización automática descarga código de GitHub y lo ejecuta aquí: si entraran en esa cuenta, podrían meter código malicioso."],
    ["bitlocker", "Disco del ordenador de la oficina cifrado (BitLocker)", "Si lo roban o lo pierden, sin cifrar se pueden leer todos los datos."],
    ["usb", "Una copia de las bases de datos en un USB o disco externo que no esté siempre conectado", "Si algo borra o cifra todo en el ordenador, la copia desconectada se salva."],
    ["windows", "Windows y el antivirus al día", "La mayoría de los ataques entran por programas sin actualizar."],
    ["dobles", "Doble factor en el correo del dominio, en Tailscale y en Cloudflare (si lo usa)", "Son las llaves de acceso desde fuera."],
  ];
  for (const [id, titulo, detalle] of MANUAL) add(id, "manual", titulo, detalle);
  return { lista: L, resumen: { mal: L.filter((x) => x.nivel === "mal").length, aviso: L.filter((x) => x.nivel === "aviso").length, ok: L.filter((x) => x.nivel === "ok").length } };
}
