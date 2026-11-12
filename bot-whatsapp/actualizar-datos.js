// Actualización de datos desde la aplicación de la empresa: se sube un Excel (productos, clientes o histórico), se ENSEÑAN los
// cambios respecto a lo que ya hay y, al confirmar, se escriben SOLO las diferencias. Sin estado en el servidor: al aplicar
// se vuelve a leer y comparar el mismo Excel, así lo que se aplica es siempre lo que acaba de verse.
import fs from "node:fs";
import path from "node:path";
import { parseClientesXlsx, extractPhones, extractEmails } from "./clientes-import.js";
import { parseNumber, PRECIO_MAXIMO } from "./productos-import.js";
import { nifKeys } from "./nif-key.js";
import { parseHistorialXlsx } from "./historial-import.js";
import { unzip, readXlsx } from "./xlsx-read.js";
import { leerExcel, saltosDePrecio } from "./actualizar-productos.js";
import { clasificar } from "./categorias.js";
import { compararProductos, aplicarProductos, CAMPOS, vendible } from "./productos-diff.js";

const MUESTRA = 40; // filas de detalle que se enseñan por apartado
const MIN_RATIO = 0.5; // un Excel con menos de la mitad de lo que hay se rechaza: casi seguro está incompleto
export const TIPOS = ["productos", "clientes", "historial", "fotos"];
const ETIQUETA_TIPO = { productos: "de productos o artículos", clientes: "de clientes", historial: "del historial de compras", fotos: "de fotos (ZIP)" };
const TARJETA_TIPO = { productos: "Productos y precios", clientes: "Clientes", historial: "Historial de compras", fotos: "Fotos de productos (ZIP)" };
const nrm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Mira el archivo y dice qué tipo de datos es: «productos» (artículos o tarifa de a3ERP), «clientes», «historial» (listado de compras) o «fotos» (un ZIP de imágenes);
 * null si no se reconoce. Se usa para avisar antes de aplicar nada si se ha subido en la tarjeta equivocada.
 */
export function detectarTipo(buf) {
  try {
    if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && !buf.includes("xl/workbook.xml")) return "fotos"; // un zip que no es un Excel
    for (const fila of readXlsx(buf).slice(0, 40)) {
      const h = fila.map(nrm);
      const tiene = (re) => h.some((c) => re.test(c));
      if (tiene(/^cod/) && tiene(/^organizacion/)) return "clientes";
      if (tiene(/^fecha/) && tiene(/documento/) && tiene(/^(unidades|cantidad)/)) return "historial";
      if (tiene(/(precio|tarifa|pvp)/) && tiene(/^(descrip|nombre|denomin|articulo)/) && !tiene(/^fecha/)) return "productos";
    }
  } catch { /* archivo que no se puede leer: lo dirá el proceso normal */ }
  return null;
}

/** Ancho y alto de un PNG o JPEG (null si no se reconoce). Sirve para avisar de fotos de baja resolución. */
export function dimensiones(b) {
  try {
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        const m = b[p + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
        p += 2 + b.readUInt16BE(p + 2);
      }
    }
  } catch { /* imagen rara */ }
  return null;
}
const POCA_RESOLUCION = 200; // píxeles: por debajo, la foto se ve borrosa al ampliarla (el Excel de a3ERP trae miniaturas de 64 px)

const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const claveHistorial = (o) => `${o.date}|${o.doc}|${[...o.lines].map((l) => `${l.productId}x${l.qty}`).sort().join(",")}`;

export function crearActualizador({ catalogDb, customersDb, accountsDb, imgDir = null, copiaCatalogo = null, familias = {}, registro = () => {}, onChange = () => {} }) {
  // ---------- productos ----------
  function productos(buf) {
    const { productos: lista, sinPrecioIds, fotos, rechazados, avisos: avisosLectura, columnas } = leerExcel(buf);
    if (!lista.length) throw new Error("El Excel no tiene productos con precio.");
    const actual = catalogDb.list({ activeOnly: false });
    const activos = actual.filter((p) => p.active !== false).length;
    // Categoría y subcategoría por tipo de producto (familia de a3ERP + nombre), también en los que ya existen: así una mejora de las categorías llega a todo el catálogo.
    // Si el Excel trae su propia columna «Categoría», manda esa.
    // Si el Excel no trae el código de familia, los productos que ya existen conservan su categoría (reclasificar solo por el nombre sería peor que lo que ya hay); los nuevos se clasifican siempre.
    const existentes = new Set(actual.map((p) => String(p.id)));
    const nuevos = lista.map((p) => ({ ...p, ...(p.category || (existentes.has(p.id) && !p.family) ? {} : clasificar(p, familias)) }));
    const cmp = compararProductos(actual, nuevos, { sinPrecioIds });
    const saltos = saltosDePrecio(cmp);
    const aviso = [];
    if (activos >= 20 && lista.length < activos * MIN_RATIO) aviso.push(`El Excel tiene ${lista.length} productos y hay ${activos} activos: parece incompleto. No se puede aplicar.`);
    const sinIva = cmp.anadidos.filter((p) => p.vat === undefined).length;
    if (sinIva) aviso.push(`${sinIva} productos nuevos tienen un código de IVA sin porcentaje conocido: no se pueden añadir hasta que se indique su tipo.`);
    // Fotos del Excel: solo se guardan las de productos que aún no tienen foto. Nunca sustituyen a una foto ya guardada (las del Excel son miniaturas
    // de baja calidad: no deben pisar fotos buenas subidas en un ZIP). Se avisa de las que son de poca resolución.
    let fotosNuevas = 0, fotosBajaCalidad = 0;
    const fotoRuta = (f) => path.join(imgDir, `${f.id}.${f.ext === "jpeg" ? "jpg" : f.ext}`);
    const tieneFoto = (id) => ["jpg", "png", "webp"].some((e) => fs.existsSync(path.join(imgDir, `${id}.${e}`)));
    const fotosAGuardar = [];
    if (imgDir) for (const f of fotos) {
      if (!/^[\w-]{1,40}$/.test(f.id) || tieneFoto(f.id)) continue;
      fotosAGuardar.push(f); fotosNuevas++;
      const d = dimensiones(f.data); if (d && Math.max(d.w, d.h) < POCA_RESOLUCION) fotosBajaCalidad++;
    }
    if (fotosBajaCalidad) aviso.push(`${fotosBajaCalidad} de las ${fotosNuevas} fotos nuevas del Excel son miniaturas de baja resolución (menos de ${POCA_RESOLUCION} px) y se verán borrosas: es mejor subir fotos grandes en un ZIP.`);
    const resumen = { rechazados: rechazados.length, anadidos: cmp.anadidos.length, quitados: cmp.quitados.length, modificados: cmp.modificados.length, reactivados: cmp.reactivados.length, sinPrecio: cmp.sinPrecio.length, iguales: cmp.iguales, fotosNuevas, fotosBajaCalidad };
    const detalle = {
      modificados: cmp.modificados.slice(0, MUESTRA).map((m) => ({ id: m.id, nombre: m.name, cambios: m.cambios.map((c) => ({ campo: CAMPOS[c.campo] ?? c.campo, antes: c.antes, despues: c.despues })) })),
      anadidos: cmp.anadidos.slice(0, MUESTRA).map((p) => ({ id: p.id, nombre: p.name, precio: p.price })),
      quitados: cmp.quitados.slice(0, MUESTRA).map((p) => ({ id: p.id, nombre: p.name, motivo: p.motivo })),
      saltosPrecio: saltos.slice(0, MUESTRA),
      rechazados: rechazados.slice(0, MUESTRA).map((x) => ({ id: x.id, nombre: x.name, motivo: x.motivo })),
    };
    // Cómo se ha leído el Excel: qué columna es el precio, etc., y los 3 primeros productos tal como han quedado, para comprobarlo de un vistazo
    const lectura = { columnas, ejemplos: lista.slice(0, 3).map((p) => ({ codigo: p.id, nombre: p.name, precio: p.price, iva: p.vat ?? null, unidadesPorCaja: p.unitsPerBox ?? null, descuento: p.discount ?? null })) };
    // Cosas que el empresario tiene que mirar y aceptar expresamente antes de aplicar (dinero en juego)
    const confirmar = [];
    if (saltos.length) confirmar.push(`${saltos.length} productos cambian de precio más de un 25 % (el mayor: ${saltos[0].id} ${saltos[0].antes} € → ${saltos[0].despues} €). Compruébalos en la lista de «Precios que cambian mucho».`);
    if (cmp.quitados.length >= 5 && cmp.quitados.length > activos * 0.1) confirmar.push(`Se quitan ${cmp.quitados.length} productos (el ${Math.round((cmp.quitados.length / activos) * 100)} % del catálogo).`);
    if (rechazados.length) confirmar.push(`${rechazados.length} productos con datos raros NO se importan (precio disparatado o IVA que no existe).`);
    for (const x of avisosLectura.slice(0, 5)) aviso.push(x);
    if (avisosLectura.length > 5) aviso.push(`… y ${avisosLectura.length - 5} avisos más de datos raros.`);
    const hayCambios = !!(cmp.anadidos.length || cmp.quitados.length || cmp.modificados.length || cmp.reactivados.length || fotosNuevas);
    return {
      resumen, detalle, aviso, lectura, confirmar, aplicable: hayCambios && !aviso.some((x) => /No se puede aplicar|no se pueden añadir/.test(x)),
      aplicar() {
        const resultado = aplicarProductos(actual, nuevos);
        const r = catalogDb.upsertProducts(resultado.map((p) => ({ ...p, unitsPerBox: p.unitsPerBox ?? null })), { partial: true, deactivateMissing: true });
        let fotosGuardadas = 0;
        if (imgDir && fotosAGuardar.length) {
          fs.mkdirSync(imgDir, { recursive: true });
          for (const f of fotosAGuardar) { fs.writeFileSync(fotoRuta(f), f.data); fotosGuardadas++; }
        }
        return { anadidos: r.added, modificados: r.updated, iguales: r.unchanged, desactivados: r.deactivated, fotosGuardadas };
      },
    };
  }

  // ---------- clientes ----------
  const CAMPOS_CLIENTE = [["name", "Nombre"], ["legalName", "Razón social"], ["address", "Dirección"], ["phone", "Teléfono"], ["active", "Activo"]];
  function clientes(buf) {
    const { customers: lista, stats } = parseClientesXlsx(buf);
    if (!lista.length) throw new Error("El Excel no tiene clientes.");
    const hay = customersDb.count();
    const aviso = [];
    if (hay >= 20 && lista.length < hay * MIN_RATIO) aviso.push(`El Excel tiene ${lista.length} clientes y ya hay ${hay}: parece incompleto. No se puede aplicar.`);
    const nuevos = [], modificados = [], cambiar = [];
    let iguales = 0;
    const enExcel = new Set(lista.map((c) => c.id));
    for (const c of lista) {
      const a = customersDb.getById(c.id);
      if (!a) { nuevos.push(c); cambiar.push(c); continue; }
      const cambios = [];
      for (const [k, et] of CAMPOS_CLIENTE) {
        const nv = k === "active" ? c.active !== false : (c[k] ?? ""), av = k === "active" ? a.active : (a[k] ?? "");
        if (nv !== av && !(nv === "" && k !== "active")) cambios.push({ campo: et, antes: av, despues: nv }); // un dato vacío en el Excel no borra lo que hay
      }
      if (c.emails?.length && !mismo([...c.emails].sort(), [...a.emails].sort())) cambios.push({ campo: "Correos", antes: a.emails.join(", "), despues: c.emails.join(", ") });
      if (c.phones?.length && !mismo([...c.phones].sort(), [...a.phones].sort())) cambios.push({ campo: "Teléfonos", antes: a.phones.join(", "), despues: c.phones.join(", ") });
      if (cambios.length) { modificados.push({ id: c.id, nombre: a.name, cambios }); cambiar.push(c); } else iguales++;
    }
    const ausentes = customersDb.list().filter((c) => c.active && !enExcel.has(c.id));
    const reactivar = lista.filter((c) => c.active !== false && customersDb.getById(c.id)?.active === false).length;
    const resumen = { nuevos: nuevos.length, modificados: modificados.length, iguales, ausentes: ausentes.length, reactivados: reactivar, sinNif: stats.sinNif, sinTelefono: stats.sinTelefono };
    const detalle = {
      nuevos: nuevos.slice(0, MUESTRA).map((c) => ({ id: c.id, nombre: c.name })),
      modificados: modificados.slice(0, MUESTRA),
      ausentes: ausentes.slice(0, MUESTRA).map((c) => ({ id: c.id, nombre: c.name })),
    };
    if (ausentes.length) aviso.push(`${ausentes.length} clientes que ya había no vienen en este Excel: se dejan como están (no se dan de baja solos).`);
    const bloqueante = aviso.some((a) => /No se puede aplicar/.test(a));
    return {
      resumen, detalle, aviso, aplicable: cambiar.length > 0 && !bloqueante,
      aplicar() {
        const r = customersDb.upsertCustomers(cambiar);
        const cuentasNuevas = accountsDb.ensureMany(cambiar.filter((c) => c.active !== false).map((c) => c.id));
        return { nuevos: r.added, actualizados: r.updated, cuentasNuevas };
      },
    };
  }

  // ---------- histórico ----------
  function historial(buf) {
    const { byCustomer, stats } = parseHistorialXlsx(buf);
    if (!byCustomer.size) throw new Error("El Excel del historial no tiene líneas válidas.");
    let desconocidos = 0, iguales = 0, pedidosNuevos = 0;
    const noExisten = [];
    const cambiar = new Map(), muestra = [];
    for (const [cid, pedidos] of byCustomer) {
      const a = customersDb.getById(cid);
      if (!a) { desconocidos++; noExisten.push({ id: cid, nombre: "no existe en la base de clientes" }); continue; }
      const antes = new Set(a.orders.map(claveHistorial));
      const nuevosPed = pedidos.filter((o) => !antes.has(claveHistorial(o)));
      const despues = new Set(pedidos.map(claveHistorial));
      const quitados = [...antes].filter((k) => !despues.has(k)).length;
      if (!nuevosPed.length && !quitados) { iguales++; continue; }
      cambiar.set(cid, pedidos);
      pedidosNuevos += nuevosPed.length;
      muestra.push({ id: cid, nombre: a.name, pedidosNuevos: nuevosPed.length, pedidosQuitados: quitados });
    }
    const aviso = [];
    if (desconocidos) aviso.push(`${desconocidos} clientes del historial no existen en la base: se ignoran (¿falta subir antes el Excel de clientes?).`);
    if (cambiar.size === 0 && iguales === 0) aviso.push("Ningún cliente del historial existe en la base: sube antes el Excel de clientes. No se puede aplicar.");
    const resumen = { clientesConCambios: cambiar.size, pedidosNuevos, iguales, desconocidos, lineas: stats.lineas, sinFecha: stats.sinFecha };
    return {
      resumen, detalle: { clientes: muestra.slice(0, MUESTRA), desconocidos: noExisten.slice(0, MUESTRA) }, aviso, aplicable: cambiar.size > 0,
      aplicar() { const r = customersDb.setPurchases(cambiar); return { clientes: r.clientes, lineas: r.lineas }; },
    };
  }


  // ---------- fotos (un ZIP con «<código>.jpg|png|webp», en cualquier carpeta) ----------
  function fotos(buf) {
    if (!imgDir) throw new Error("La carpeta de fotos no está configurada.");
    const entradas = unzip(buf, (n) => /\.(jpe?g|png|webp)$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n) && !/\/$/.test(n));
    // Si el ZIP trae su Excel de control (columnas «codigo» y «tipo»), las fotos con tipo «IA» se marcan como generadas con IA
    const ia = new Set(), noIa = new Set();
    for (const data of Object.values(unzip(buf, (n) => /(^|\/)[^/]*\.xlsx$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n)))) {
      try {
        const rows = readXlsx(data), h = rows[0].map((c) => String(c).trim().toLowerCase()), iC = h.findIndex((c) => /^c[oó]digo/.test(c)), iT = h.findIndex((c) => c === "tipo");
        if (iC < 0 || iT < 0) continue;
        for (const r of rows.slice(1)) { const id = String(r[iC]).trim(), t = String(r[iT]).trim().toLowerCase(); if (!id) continue; (t === "ia" ? ia : noIa).add(id); }
      } catch { /* un Excel que no es el de control se ignora */ }
    }
    const nombres = new Map(catalogDb.list({ activeOnly: false }).map((p) => [String(p.id), p.name]));
    const catalogo = new Set(nombres.keys());
    const nuevas = [], cambiadas = [], ignoradas = [];
    let iguales = 0;
    const porId = new Map();
    for (const [ruta, data] of Object.entries(entradas)) {
      const m = /^([\w-]{1,40})\.(jpe?g|png|webp)$/i.exec(path.basename(ruta));
      if (!m) { ignoradas.push({ id: path.basename(ruta), nombre: "el nombre del archivo no es un código de producto" }); continue; }
      if (data.length < 200 || data.length > 8_000_000) { ignoradas.push({ id: m[1], nombre: "tamaño de imagen no válido" }); continue; }
      if (!catalogo.has(m[1])) { ignoradas.push({ id: m[1], nombre: "ese código no está en el catálogo" }); continue; }
      porId.set(m[1], { ext: m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase(), data });
    }
    const ruta = (id, ext) => path.join(imgDir, `${id}.${ext}`);
    for (const [id, f] of porId) {
      const r = ruta(id, f.ext);
      if (!fs.existsSync(r)) { const otra = ["jpg", "png", "webp"].some((e) => fs.existsSync(ruta(id, e))); (otra ? cambiadas : nuevas).push({ id, nombre: nombres.get(id) }); }
      else if (!fs.readFileSync(r).equals(f.data)) cambiadas.push({ id });
      else iguales++;
    }
    const resumen = { fotosNuevas: nuevas.length, fotosCambiadas: cambiadas.length, iguales, ignoradas: ignoradas.length, fotosIA: [...porId.keys()].filter((i) => ia.has(i)).length };
    const aviso = ignoradas.length ? [`${ignoradas.length} archivos se ignoran (código que no está en el catálogo u otros archivos).`] : [];
    const chicas = [...porId.values()].filter((f) => { const d = dimensiones(f.data); return d && Math.max(d.w, d.h) < POCA_RESOLUCION; }).length;
    if (chicas) aviso.push(`${chicas} fotos son de baja resolución (menos de ${POCA_RESOLUCION} px) y se verán borrosas.`);
    return {
      resumen, aviso, aplicable: nuevas.length + cambiadas.length > 0 || ia.size > 0,
      detalle: { anadidos: nuevas.slice(0, MUESTRA), modificados: cambiadas.slice(0, MUESTRA), ignoradas: ignoradas.slice(0, MUESTRA) },
      aplicar() {
        fs.mkdirSync(imgDir, { recursive: true });
        let guardadas = 0;
        for (const [id, f] of porId) {
          const r = ruta(id, f.ext);
          if (fs.existsSync(r) && fs.readFileSync(r).equals(f.data)) continue;
          for (const e of ["jpg", "png", "webp"]) if (e !== f.ext) fs.rmSync(ruta(id, e), { force: true }); // una sola foto por producto
          fs.writeFileSync(r, f.data); guardadas++;
        }
        // fotos-ia.json: códigos con foto generada con IA (el catálogo lo avisa en pequeño). Las que ahora vienen como reales se quitan.
        if (ia.size || noIa.size) {
          const f = path.join(imgDir, "fotos-ia.json");
          let actuales = []; try { actuales = JSON.parse(fs.readFileSync(f, "utf8")).map(String); } catch { /* aún no existe */ }
          const nuevo = new Set(actuales.filter((i) => !noIa.has(i))); for (const i of ia) if (porId.has(i)) nuevo.add(i);
          fs.writeFileSync(f, JSON.stringify([...nuevo].sort()));
        }
        return { fotosGuardadas: guardadas, fotosMarcadasIA: [...porId.keys()].filter((i) => ia.has(i)).length };
      },
    };
  }

  // ---------- altas a mano: un producto o un cliente sueltos, sin Excel ----------
  const limpia = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  function falla(msg, extra = {}) { return Object.assign(new Error(msg), extra); }
  function anadirProducto(d, { actualizar = false } = {}) {
    const id = limpia(d.codigo);
    if (!/^[\w.-]{1,40}$/.test(id)) throw falla("Escribe el código del artículo (letras, números, punto o guion, sin espacios).");
    const name = limpia(d.nombre);
    if (name.length < 2 || name.length > 120) throw falla("Escribe el nombre del artículo.");
    const price = parseNumber(d.precio);
    if (price === null || !(price > 0) || price > PRECIO_MAXIMO) throw falla("Escribe el precio por unidad, sin IVA (mayor que 0).");
    const vat = Number(d.iva);
    if (![4, 10, 21].includes(vat)) throw falla("Elige el IVA: 4 %, 10 % o 21 %.");
    const upbTxt = limpia(d.unidadesCaja), upb = upbTxt === "" ? null : Number(upbTxt);
    if (upb !== null && (!Number.isInteger(upb) || upb < 1 || upb > 5000)) throw falla("Las unidades por caja deben ser un número entero (1 o más).");
    const saleMode = d.modo === "caja" || d.modo === "ambos" ? d.modo : undefined;
    if (saleMode === "ambos" && !(upb > 1)) throw falla("«Caja o unidad» necesita las unidades por caja (más de 1).");
    const dto = limpia(d.descuento) === "" ? null : parseNumber(d.descuento);
    if (dto !== null && (dto < 0 || dto > 100)) throw falla("El descuento debe estar entre 0 y 100.");
    const antes = catalogDb.get(id);
    if (antes && !actualizar) throw falla(`Ya existe el artículo ${id} (${antes.name}). Si quieres cambiarlo, confirma que se actualice.`, { existe: true });
    const cat = limpia(d.categoria) ? { category: limpia(d.categoria), ...(limpia(d.subcategoria) ? { subcategory: limpia(d.subcategoria) } : {}) } : antes?.category ? {} : clasificar({ id, name }, familias);
    const prod = { id, name, price: Math.round(price * 1e4) / 1e4, vat, unitsPerBox: upb && upb > 1 ? upb : null, ...(saleMode ? { saleMode } : {}), ...(dto !== null ? { discount: dto } : {}), active: true, ...cat };
    catalogDb.upsertProducts([prod], { partial: true });
    registro({ at: new Date().toISOString(), tipo: "producto a mano", fichero: "", resumen: { id, name }, resultado: { creado: !antes } });
    onChange("productos");
    return { id, nombre: name, creado: !antes, categoria: prod.category ?? null };
  }
  /** Siguiente código provisional para un cliente nuevo que aún no tiene el de a3ERP: P00001, P00002… */
  const codigoProvisional = () => { const n = customersDb.list().map((c) => /^P(\d{5})$/.exec(c.id)).filter(Boolean).map((m) => Number(m[1])); return "P" + String((n.length ? Math.max(...n) : 0) + 1).padStart(5, "0"); };
  function anadirCliente(d, { actualizar = false } = {}) {
    const name = limpia(d.nombre);
    if (name.length < 2 || name.length > 80) throw falla("Escribe el nombre comercial del cliente.");
    let id = limpia(d.codigo), provisional = false;
    if (id && !/^[\w-]{1,20}$/.test(id)) throw falla("El código del cliente solo puede llevar letras, números y guion (máximo 20).");
    if (!id) { id = codigoProvisional(); provisional = true; }
    const antes = customersDb.getById(id);
    if (antes && !actualizar) throw falla(`Ya existe el cliente ${id} (${antes.name}). Si quieres cambiarlo, confirma que se actualice.`, { existe: true });
    const nifTxt = limpia(d.nif).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (nifTxt && (!/^[A-Z0-9]{8,10}$/.test(nifTxt) || nifTxt.replace(/\D/g, "").length < 6)) throw falla("El DNI, NIE o CIF no parece válido (por ejemplo 12345678Z o B12345678).");
    const phones = extractPhones(d.telefono), emails = extractEmails(d.correo);
    if (limpia(d.telefono) && !phones.length) throw falla("El teléfono no es válido (9 cifras).");
    if (limpia(d.correo) && !emails.length) throw falla("El correo no es válido.");
    const municipio = limpia(d.municipio).replace(/\D/g, "");
    if (municipio && municipio.length !== 5) throw falla("El código de municipio tiene 5 cifras (Medina del Campo: 47085).");
    const poblacion = limpia(d.poblacion), calle = limpia(d.direccion);
    const cliente = {
      id, name, legalName: limpia(d.razonSocial) && limpia(d.razonSocial).toLowerCase() !== name.toLowerCase() ? limpia(d.razonSocial) : "",
      ...(nifTxt ? { nifKeys: nifKeys(id, nifTxt) } : {}), city: poblacion, municipio, address: calle && poblacion && !nrm(calle).includes(nrm(poblacion)) ? `${calle}, ${poblacion}` : calle || poblacion, // si la dirección ya trae la población, no se repite
      ...(phones.length ? { phones, phone: phones[0] } : {}), ...(emails.length ? { emails } : {}), active: true, ...(d.recargo !== undefined ? { recargoEquivalencia: !!d.recargo } : {}),
    };
    customersDb.upsertCustomers([cliente]);
    accountsDb.ensureMany([id]); // ya tiene su cuenta lista para entrar con el DNI/CIF o con teléfono y contraseña
    registro({ at: new Date().toISOString(), tipo: "cliente a mano", fichero: "", resumen: { id, name }, resultado: { creado: !antes, provisional } });
    onChange("clientes");
    return { id, nombre: name, creado: !antes, provisional, sinNif: !nifTxt, sinTelefono: !phones.length };
  }

  const por = { productos, clientes, historial, fotos };
  const preparar = (tipo, buf) => {
    if (!por[tipo]) throw new Error("Tipo de datos desconocido.");
    const real = detectarTipo(buf);
    if (real && real !== tipo) throw new Error(`Este archivo parece un Excel ${ETIQUETA_TIPO[real]}, no ${ETIQUETA_TIPO[tipo]}. Súbelo en la tarjeta «${TARJETA_TIPO[real]}».`);
    return por[tipo](buf);
  };
  return {
    anadirProducto, anadirCliente,
    vistaPrevia(tipo, buf) {
      const { aplicar: _a, ...r } = preparar(tipo, buf);
      return r;
    },
    aplicar(tipo, buf, { fichero = "", confirmo = false } = {}) {
      const p = preparar(tipo, buf);
      if (!p.aplicable) throw new Error(p.aviso.find((a) => /No se puede aplicar|no se pueden añadir/.test(a)) ?? "No hay nada que aplicar.");
      if (p.confirmar?.length && !confirmo) { // hay precios que cambian mucho, productos que se quitan o datos raros: se aplica solo si lo has confirmado
        const e = new Error("Hay cosas que confirmar antes de aplicar: " + p.confirmar.join(" "));
        e.confirmar = p.confirmar;
        throw e;
      }
      if (tipo === "productos" && copiaCatalogo) try { catalogDb.backupTo(`${copiaCatalogo}.antes-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`); } catch { /* sin copia no se bloquea */ }
      const r = p.aplicar();
      registro({ at: new Date().toISOString(), tipo, fichero, resumen: p.resumen, resultado: r });
      onChange(tipo);
      return { ...r, resumen: p.resumen };
    },
  };
}
