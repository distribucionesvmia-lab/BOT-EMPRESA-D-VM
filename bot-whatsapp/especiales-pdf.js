// Descuentos especiales y precios especiales de cada cliente, desde los dos listados en PDF de a3ERP. Cada uno va POR SEPARADO (tarjeta y botón propios):
// uno no toca nunca lo del otro. Siempre vista previa primero (no escribe nada) y aplicar solo las diferencias.
//   • Descuentos: «Listado de descuentos artículo/cliente».   • Precios: «Listado de precios especiales» (ventas por cliente).
// Reglas: solo valen las líneas vigentes HOY (fecha de inicio ≤ hoy ≤ fecha de fin) y sin mínimo de unidades; se comprueba el código del cliente y su nombre;
// los artículos y clientes que no están en la base se ignoran; lo guardado que ya no sale en el listado NO se borra salvo que se pida con la casilla.
import { parseListadoDescuentos, parseListadoPrecios } from "./listados-a3erp.js";
import { hoyMadrid } from "./pricing.js";

const nrm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const coma = (t) => String(t).replace(".", ",");
const eur = (n) => coma(`${Number(n).toFixed(4).replace(/\.?0+$/, "")} €`);
const pc = (n) => coma(`${Number(n)} %`);
const fechaEs = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const TOPE = 300; // filas de detalle por tipo
const PRECIO_MUY_DISTINTO = 0.5; // un precio por debajo de la mitad o por encima del doble de la tarifa se pide confirmar (puede ser un precio por caja)
const STOP = new Set(["restaurante", "cafeteria", "hotel", "sociedad", "limitada", "anonima", "hermanos", "comunidad", "bienes", "servicios", "hosteleria", "cafe", "bar"]);

export function crearEspeciales({ catalogDb, customersDb }) {
  /** Cómo reconocer artículos y clientes por su código (con o sin ceros delante) y comprobar que el nombre del listado se parece al de la base. */
  function resolutor() {
    const sinCeros = (x) => String(x).trim().replace(/^0+(?=\d)/, "");
    const indice = (ids) => { const m = new Map(); for (const id of ids) { const k = sinCeros(id); m.set(k, m.has(k) ? null : id); } return m; };
    const prods = new Map(catalogDb.list({ activeOnly: false }).map((p) => [String(p.id), p])), prodIdx = indice(prods.keys());
    const cliIdx = indice(customersDb.list().map((c) => String(c.id)));
    const producto = (pid) => { const id = prods.has(pid) ? pid : prodIdx.get(sinCeros(pid)); return id ? [id, prods.get(id)] : [null, null]; };
    const clienteId = (cid) => (customersDb.getById(cid) ? String(cid) : cliIdx.get(sinCeros(cid)) ?? null);
    const palabras = (t) => nrm(t).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
    const mismoNombre = (excel, ...base) => { const A = palabras(excel), B = base.flatMap(palabras); if (!A.length || !B.length) return null; return A.some((w) => B.some((v) => v === w || (w.length >= 5 && v.length >= 5 && (w.startsWith(v) || v.startsWith(w))))); };
    return { producto, clienteId, mismoNombre };
  }

  const vigente = (f, hoy) => (!f.desde || f.desde <= hoy) && (!f.hasta || f.hasta >= hoy);
  const ordena = (l) => l.map((x, k) => [x, k]).sort((a, b) => a[0].orden - b[0].orden || a[1] - b[1]).map(([x]) => ({ cliente: x.cliente, articulo: x.articulo, texto: x.texto }));
  const categoria = (id, titulo, lista) => ({ id, titulo, total: lista.length, filas: ordena(lista).slice(0, TOPE) });

  /** Común a los dos listados: separa lo que no vale (caducado, aún no empieza, con mínimo de unidades), reconoce cliente y artículo y devuelve lo vigente por pareja. */
  function preparar(filas, hoy, g, { alcance }) {
    const { producto, clienteId, mismoNombre } = resolutor(), validas = new Map(), cuenta = { cliSin: new Set(), conCeros: new Set(), sinComprobar: new Set(), otroNombre: new Set() };
    const nombreCli = new Map();
    for (const f of filas) {
      const base = { cliente: `${f.cliente} ${f.nombreCliente}`, articulo: `${f.articulo} ${f.nombreArticulo}`, orden: 0 };
      if (f.unidades > 0) { g.minimo.push({ ...base, texto: `solo desde ${f.unidades} unidades: no se aplica (el programa no maneja mínimos)`, orden: 1 }); continue; }
      if (f.hasta && f.hasta < hoy) { g.caducado.push({ ...base, texto: `terminó el ${fechaEs(f.hasta)}`, orden: 1 }); continue; }
      if (f.desde && f.desde > hoy) { g.futuro.push({ ...base, texto: `empieza el ${fechaEs(f.desde)}: súbelo otra vez ese día`, orden: 1 }); continue; }
      const cid = clienteId(f.cliente);
      if (!cid) { cuenta.cliSin.add(f.cliente); g.cliSin.push({ ...base, texto: "ese cliente no está en la base: súbelo antes en «Clientes»" }); continue; }
      const a = customersDb.getById(cid);
      if (cid !== String(f.cliente).trim()) cuenta.conCeros.add(cid);
      const mismo = mismoNombre(f.nombreCliente, a.name, a.legalName);
      if (mismo === null) cuenta.sinComprobar.add(cid);
      if (mismo === false) { cuenta.otroNombre.add(cid); g.otroNombre.push({ ...base, cliente: `${a.name} (en el listado: ${f.nombreCliente})`, texto: "el nombre no coincide: no se toca" }); continue; }
      const [pid, prod] = producto(f.articulo);
      if (!pid) { g.artSin.push({ ...base, cliente: a.name, texto: "no está en el catálogo: sube antes «Productos y precios»" }); continue; }
      const k = `${cid}|${pid}`, antes = validas.get(k);
      const mejor = !antes || (antes.f.hasta !== null && (f.hasta === null || f.hasta > antes.f.hasta)) || (antes.f.hasta === f.hasta && (f.desde ?? "") > (antes.f.desde ?? ""));
      if (antes) g.repetidas.push({ cliente: a.name, articulo: prod.name, texto: "aparece más de una vez y vigente: se usa la de fecha de fin más lejana", orden: 1 });
      if (mejor) validas.set(k, { f, cid, a, pid, prod });
      nombreCli.set(cid, a.name);
    }
    return { validas, cuenta, nombreCli };
  }

  /** Lo que hay guardado por cliente y no sale en el listado vigente (para enseñarlo y, si se pide, quitarlo). */
  function sobrantes(validas, campo, texto) {
    const lista = [];
    for (const c of customersDb.list()) {
      const a = customersDb.getById(String(c.id)); if (!a) continue;
      for (const [pid, valor] of Object.entries(a[campo] ?? {})) if (!validas.has(`${a.id ?? c.id}|${pid}`)) lista.push({ cid: String(a.id ?? c.id), pid, nombre: a.name, valor, art: catalogDb.get(pid)?.name ?? `Código ${pid}` });
    }
    return lista.map((s) => ({ ...s, fila: { cliente: s.nombre, articulo: s.art, texto: texto(s.valor), orden: 1 } }));
  }

  // ───────────────────────────── DESCUENTOS ─────────────────────────────
  function descuentos(buf, { quitarSobrantes = false, hoy = hoyMadrid() } = {}) {
    const { filas, stats } = parseListadoDescuentos(buf);
    if (!filas.length) throw new Error("El PDF no trae ninguna línea de descuentos.");
    const g = { nuevo: [], igual: [], sinPct: [], regalo: [], minimo: [], caducado: [], futuro: [], artSin: [], cliSin: [], otroNombre: [], repetidas: [] };
    const utiles = [];
    for (const f of filas) {
      const base = { cliente: `${f.cliente} ${f.nombreCliente}`, articulo: `${f.articulo} ${f.nombreArticulo}`, orden: 1 };
      if (f.unidades > 0 || (f.hasta && f.hasta < hoy)) { utiles.push(f); continue; } // los trata `preparar` (mínimo y caducado)
      if (f.pct === null || f.pct <= 0) { g.sinPct.push({ ...base, texto: "la línea no trae porcentaje: no se guarda nada" }); continue; }
      if (f.pct >= 100) { g.regalo.push({ ...base, texto: "descuento del 100 % (regalo): no se guarda" }); continue; }
      utiles.push(f);
    }
    const { validas, cuenta } = preparar(utiles, hoy, g, {});
    const paraGuardar = new Map(); let nuevos = 0, cambian = 0, iguales = 0, acaban = 0;
    for (const { f, cid, a, pid, prod } of validas.values()) {
      const antes = a.discounts[pid], base = { cliente: a.name, articulo: prod.name };
      const hasta = f.hasta ? ` · válido hasta el ${fechaEs(f.hasta)}: pasada esa fecha hay que quitarlo (el programa no lo quita solo)` : ""; if (f.hasta) acaban++;
      if (antes !== undefined && Math.abs(antes - f.pct) < 0.005) { iguales++; g.igual.push({ ...base, texto: `${pc(f.pct)} · ya estaba guardado${hasta}`, orden: 1 }); continue; }
      (antes === undefined ? nuevos++ : cambian++);
      g.nuevo.push({ ...base, texto: antes === undefined ? `${pc(f.pct)} de descuento · SE GUARDARÁ${hasta}` : `${pc(antes)} → ${pc(f.pct)} · SE CAMBIARÁ${hasta}`, orden: 0 });
      if (!paraGuardar.has(cid)) paraGuardar.set(cid, { precios: {}, descuentos: {}, quitarPrecios: [], quitarDescuentos: [] });
      paraGuardar.get(cid).descuentos[pid] = f.pct;
    }
    const sob = sobrantes(validas, "discounts", (v) => `${pc(v)} guardado, pero ya no sale en el listado${quitarSobrantes ? " · SE QUITARÁ" : " (no se toca)"}`);
    for (const s of sob) { g.sobran = g.sobran ?? []; g.sobran.push(s.fila); if (quitarSobrantes) { if (!paraGuardar.has(s.cid)) paraGuardar.set(s.cid, { precios: {}, descuentos: {}, quitarPrecios: [], quitarDescuentos: [] }); paraGuardar.get(s.cid).quitarDescuentos.push(s.pid); } }
    g.sobran = g.sobran ?? [];
    const aviso = [];
    if (cuenta.cliSin.size) aviso.push(`${cuenta.cliSin.size} clientes del listado no existen en la base: se ignoran (¿falta subir antes el Excel de clientes?).`);
    if (cuenta.otroNombre.size) aviso.push(`${cuenta.otroNombre.size} clientes NO se tocan porque el nombre del listado no se parece al de la base: el código puede ser de otro cliente.`);
    if (cuenta.sinComprobar.size) aviso.push(`${cuenta.sinComprobar.size} clientes no se han podido comprobar por nombre: se aplican por su código.`);
    if (cuenta.conCeros.size) aviso.push(`${cuenta.conCeros.size} clientes se han reconocido quitando ceros del código («0365» = «365»).`);
    if (stats.sinInterpretar.length) aviso.push(`${stats.sinInterpretar.length} líneas del PDF no se han entendido y NO se aplican: ${stats.sinInterpretar.slice(0, 3).join(" | ")}`);
    const confirmar = [];
    if (quitarSobrantes && sob.length) confirmar.push(`Vas a QUITAR ${sob.length} descuentos guardados que no salen en este listado. Hazlo solo si este PDF es el listado completo de todos los clientes (mira abajo «Guardados que ya no salen»).`);
    if (stats.sinInterpretar.length) confirmar.push(`Hay ${stats.sinInterpretar.length} líneas que no se han entendido (se ignoran).`);
    const categorias = [
      categoria("nuevo", "Descuento nuevo o que cambia (se guardará)", g.nuevo),
      categoria("igual", "Ya estaba guardado igual (nada que hacer)", g.igual),
      categoria("sinPct", "Línea sin porcentaje (no se guarda nada)", g.sinPct),
      categoria("regalo", "Con descuento del 100 % (regalos: no se guardan)", g.regalo),
      categoria("minimo", "Con mínimo de unidades (no se aplica)", g.minimo),
      categoria("caducado", "Caducados (no se aplican)", g.caducado),
      categoria("artSin", "Artículo que no está en tu catálogo (se ignora)", g.artSin),
      categoria("cliSin", "Cliente que no existe en la base (se ignora)", g.cliSin),
      ...(g.otroNombre.length ? [categoria("otroNombre", "Cliente cuyo nombre no coincide con el de la base (no se toca)", g.otroNombre)] : []),
      categoria("sobran", quitarSobrantes ? "Guardados que ya no salen en el listado (se quitarán)" : "Guardados que ya no salen en el listado (no se tocan)", g.sobran),
    ].filter((c) => c.total > 0 || ["nuevo", "igual"].includes(c.id));
    const resumen = { filasLeidas: filas.length, paginas: stats.paginas, descuentosNuevos: nuevos, descuentosCambian: cambian, yaGuardados: iguales, clientesConCambios: paraGuardar.size, quitaSobrantes: quitarSobrantes ? sob.length : 0, terminanConFecha: acaban };
    return {
      tipoListado: "descuentos", categorias, resumen, aviso, ...(confirmar.length ? { confirmar } : {}), aplicable: paraGuardar.size > 0,
      aplicar() { const r = customersDb.setPreciosPropios(paraGuardar); return { clientes: paraGuardar.size, descuentos: r.descuentos, quitados: r.quitados ?? 0 }; },
    };
  }

  // ───────────────────────────── PRECIOS ─────────────────────────────
  function precios(buf, { quitarSobrantes = false, hoy = hoyMadrid() } = {}) {
    const { filas, stats } = parseListadoPrecios(buf);
    if (!filas.length) throw new Error("El PDF no trae ningún precio especial.");
    const g = { nuevo: [], igual: [], tarifa: [], cero: [], minimo: [], caducado: [], futuro: [], artSin: [], cliSin: [], otroNombre: [], repetidas: [] };
    const utiles = [];
    for (const f of filas) {
      const base = { cliente: `${f.cliente} ${f.nombreCliente}`, articulo: `${f.articulo} ${f.nombreArticulo}`, orden: 1 };
      if (f.unidades === 0 && !(f.hasta && f.hasta < hoy) && !(f.desde && f.desde > hoy) && !(f.precio > 0)) { g.cero.push({ ...base, texto: "precio 0: no se guarda (¿regalo o error?)" }); continue; }
      utiles.push(f);
    }
    const { validas, cuenta } = preparar(utiles, hoy, g, {});
    const paraGuardar = new Map(); let nuevos = 0, cambian = 0, iguales = 0, quitan = 0; const muyDistintos = [];
    const poner = (cid) => { if (!paraGuardar.has(cid)) paraGuardar.set(cid, { precios: {}, descuentos: {}, quitarPrecios: [], quitarDescuentos: [] }); return paraGuardar.get(cid); };
    for (const { f, cid, a, pid, prod } of validas.values()) {
      const antes = a.specialPrices[pid], base = { cliente: a.name, articulo: prod.name }, hasta = f.hasta ? ` · válido hasta el ${fechaEs(f.hasta)}: pasada esa fecha hay que quitarlo (el programa no lo quita solo)` : "";
      if (Math.abs(f.precio - prod.price) <= 0.0005) { // igual que la tarifa: no es «especial»
        if (antes !== undefined) { quitan++; poner(cid).quitarPrecios.push(pid); g.tarifa.push({ ...base, texto: `${eur(f.precio)} = tarifa · tenía guardado ${eur(antes)}: SE QUITARÁ para que pague la tarifa`, orden: 0 }); }
        else g.tarifa.push({ ...base, texto: `${eur(f.precio)} = precio de tarifa: nada que guardar`, orden: 1 });
        continue;
      }
      if (antes !== undefined && Math.abs(antes - f.precio) <= 0.0005) { iguales++; g.igual.push({ ...base, texto: `${eur(f.precio)} (tarifa ${eur(prod.price)}) · ya estaba guardado${hasta}`, orden: 1 }); continue; }
      (antes === undefined ? nuevos++ : cambian++);
      const razon = f.precio / prod.price; if (razon < PRECIO_MUY_DISTINTO || razon > 1 / PRECIO_MUY_DISTINTO) muyDistintos.push(`${a.name}: ${prod.name} a ${eur(f.precio)} (tarifa ${eur(prod.price)})`);
      g.nuevo.push({ ...base, texto: `tarifa ${eur(prod.price)} → su precio ${eur(f.precio)} · ${antes === undefined ? "SE GUARDARÁ" : `SE CAMBIARÁ (tenía ${eur(antes)})`}${razon < PRECIO_MUY_DISTINTO || razon > 1 / PRECIO_MUY_DISTINTO ? " · MUY DISTINTO DE LA TARIFA" : ""}${hasta}`, orden: 0 });
      poner(cid).precios[pid] = f.precio;
    }
    const sob = sobrantes(validas, "specialPrices", (v) => `${eur(v)} guardado, pero ya no sale en el listado${quitarSobrantes ? " · SE QUITARÁ" : " (no se toca)"}`);
    const filasSob = [];
    for (const s of sob) { filasSob.push(s.fila); if (quitarSobrantes) poner(s.cid).quitarPrecios.push(s.pid); }
    const aviso = [];
    if (cuenta.cliSin.size) aviso.push(`${cuenta.cliSin.size} clientes del listado no existen en la base: se ignoran (¿falta subir antes el Excel de clientes?).`);
    if (cuenta.otroNombre.size) aviso.push(`${cuenta.otroNombre.size} clientes NO se tocan porque el nombre del listado no se parece al de la base: el código puede ser de otro cliente.`);
    if (cuenta.sinComprobar.size) aviso.push(`${cuenta.sinComprobar.size} clientes no se han podido comprobar por nombre: se aplican por su código.`);
    if (cuenta.conCeros.size) aviso.push(`${cuenta.conCeros.size} clientes se han reconocido quitando ceros del código («0365» = «365»).`);
    if (stats.sinInterpretar.length) aviso.push(`${stats.sinInterpretar.length} líneas del PDF no se han entendido y NO se aplican: ${stats.sinInterpretar.slice(0, 3).join(" | ")}`);
    const confirmar = [];
    if (muyDistintos.length) confirmar.push(`${muyDistintos.length} precios son menos de la mitad o más del doble de la tarifa (¿es un precio por caja y no por unidad?): ${muyDistintos.slice(0, 4).join(" · ")}${muyDistintos.length > 4 ? " …" : ""}. Si son correctos, confírmalo.`);
    if (quitarSobrantes && sob.length) confirmar.push(`Vas a QUITAR ${sob.length} precios especiales guardados que no salen en este listado. Hazlo solo si este PDF es el listado completo de todos los clientes.`);
    if (stats.sinInterpretar.length) confirmar.push(`Hay ${stats.sinInterpretar.length} líneas que no se han entendido (se ignoran).`);
    const categorias = [
      categoria("nuevo", "Precio especial nuevo o que cambia (se guardará)", g.nuevo),
      categoria("igual", "Ya estaba guardado igual (nada que hacer)", g.igual),
      categoria("tarifa", "Precio igual al de la tarifa (no es especial)", g.tarifa),
      categoria("cero", "Precio 0 (no se guarda)", g.cero),
      categoria("minimo", "Con mínimo de unidades (no se aplica)", g.minimo),
      categoria("caducado", "Caducados (no se aplican)", g.caducado),
      categoria("futuro", "Todavía no empiezan (no se aplican)", g.futuro),
      categoria("artSin", "Artículo que no está en tu catálogo (se ignora)", g.artSin),
      categoria("cliSin", "Cliente que no existe en la base (se ignora)", g.cliSin),
      ...(g.otroNombre.length ? [categoria("otroNombre", "Cliente cuyo nombre no coincide con el de la base (no se toca)", g.otroNombre)] : []),
      categoria("sobran", quitarSobrantes ? "Guardados que ya no salen en el listado (se quitarán)" : "Guardados que ya no salen en el listado (no se tocan)", filasSob),
    ].filter((c) => c.total > 0 || ["nuevo", "igual"].includes(c.id));
    const resumen = { filasLeidas: filas.length, paginas: stats.paginas, preciosNuevos: nuevos, preciosCambian: cambian, yaGuardados: iguales, seQuitanPorSerTarifa: quitan, clientesConCambios: paraGuardar.size, quitaSobrantes: quitarSobrantes ? sob.length : 0 };
    return {
      tipoListado: "precios", categorias, resumen, aviso, ...(confirmar.length ? { confirmar } : {}), aplicable: paraGuardar.size > 0,
      aplicar() { const r = customersDb.setPreciosPropios(paraGuardar); return { clientes: paraGuardar.size, precios: r.precios, quitados: r.quitados ?? 0 }; },
    };
  }

  return { descuentos, precios };
}
