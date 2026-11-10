// Actualización de datos desde la aplicación de la empresa: se sube un Excel (productos, clientes o histórico), se ENSEÑAN los
// cambios respecto a lo que ya hay y, al confirmar, se escriben SOLO las diferencias. Sin estado en el servidor: al aplicar
// se vuelve a leer y comparar el mismo Excel, así lo que se aplica es siempre lo que acaba de verse.
import fs from "node:fs";
import path from "node:path";
import { parseClientesXlsx } from "./clientes-import.js";
import { parseHistorialXlsx } from "./historial-import.js";
import { leerExcel, categoriaPorFamilia, saltosDePrecio } from "./actualizar-productos.js";
import { compararProductos, aplicarProductos, CAMPOS, vendible } from "./productos-diff.js";

const MUESTRA = 40; // filas de detalle que se enseñan por apartado
const MIN_RATIO = 0.5; // un Excel con menos de la mitad de lo que hay se rechaza: casi seguro está incompleto
export const TIPOS = ["productos", "clientes", "historial"];

const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const claveHistorial = (o) => `${o.date}|${o.doc}|${[...o.lines].map((l) => `${l.productId}x${l.qty}`).sort().join(",")}`;

export function crearActualizador({ catalogDb, customersDb, accountsDb, imgDir = null, copiaCatalogo = null, familias = {}, registro = () => {}, onChange = () => {} }) {
  // ---------- productos ----------
  function productos(buf) {
    const { productos: lista, sinPrecioIds, fotos } = leerExcel(buf);
    if (!lista.length) throw new Error("El Excel no tiene productos con precio.");
    const actual = catalogDb.list({ activeOnly: false });
    const activos = actual.filter((p) => p.active !== false).length;
    const catNueva = categoriaPorFamilia(familias);
    const hoy = new Set(actual.map((p) => String(p.id)));
    const nuevos = lista.map((p) => ({ ...p, ...(p.category || hoy.has(p.id) ? {} : catNueva(p)) }));
    const cmp = compararProductos(actual, nuevos, { sinPrecioIds });
    const aviso = [];
    if (activos >= 20 && lista.length < activos * MIN_RATIO) aviso.push(`El Excel tiene ${lista.length} productos y hay ${activos} activos: parece incompleto. No se puede aplicar.`);
    const sinIva = cmp.anadidos.filter((p) => p.vat === undefined).length;
    if (sinIva) aviso.push(`${sinIva} productos nuevos tienen un código de IVA sin porcentaje conocido: no se pueden añadir hasta que se indique su tipo.`);
    // fotos nuevas o cambiadas
    let fotosNuevas = 0, fotosCambiadas = 0;
    const fotoRuta = (f) => path.join(imgDir, `${f.id}.${f.ext === "jpeg" ? "jpg" : f.ext}`);
    if (imgDir) for (const f of fotos) {
      const r = fotoRuta(f);
      if (!/^[\w-]{1,40}$/.test(f.id)) continue;
      if (!fs.existsSync(r)) fotosNuevas++; else if (!fs.readFileSync(r).equals(f.data)) fotosCambiadas++;
    }
    const resumen = { anadidos: cmp.anadidos.length, quitados: cmp.quitados.length, modificados: cmp.modificados.length, reactivados: cmp.reactivados.length, sinPrecio: cmp.sinPrecio.length, iguales: cmp.iguales, fotosNuevas, fotosCambiadas };
    const detalle = {
      modificados: cmp.modificados.slice(0, MUESTRA).map((m) => ({ id: m.id, nombre: m.name, cambios: m.cambios.map((c) => ({ campo: CAMPOS[c.campo] ?? c.campo, antes: c.antes, despues: c.despues })) })),
      anadidos: cmp.anadidos.slice(0, MUESTRA).map((p) => ({ id: p.id, nombre: p.name, precio: p.price })),
      quitados: cmp.quitados.slice(0, MUESTRA).map((p) => ({ id: p.id, nombre: p.name, motivo: p.motivo })),
      saltosPrecio: saltosDePrecio(cmp).slice(0, MUESTRA),
    };
    const hayCambios = !!(cmp.anadidos.length || cmp.quitados.length || cmp.modificados.length || cmp.reactivados.length || fotosNuevas || fotosCambiadas);
    return {
      resumen, detalle, aviso, aplicable: hayCambios && !aviso.length,
      aplicar() {
        const resultado = aplicarProductos(actual, nuevos);
        const r = catalogDb.upsertProducts(resultado.map((p) => ({ ...p, unitsPerBox: p.unitsPerBox ?? null })), { partial: true, deactivateMissing: true });
        let fotosGuardadas = 0;
        if (imgDir) {
          fs.mkdirSync(imgDir, { recursive: true });
          for (const f of fotos) {
            if (!/^[\w-]{1,40}$/.test(f.id)) continue;
            const ruta = fotoRuta(f);
            if (!fs.existsSync(ruta) || !fs.readFileSync(ruta).equals(f.data)) { fs.writeFileSync(ruta, f.data); fotosGuardadas++; }
          }
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

  const por = { productos, clientes, historial };
  const preparar = (tipo, buf) => {
    if (!por[tipo]) throw new Error("Tipo de datos desconocido.");
    return por[tipo](buf);
  };
  return {
    vistaPrevia(tipo, buf) {
      const { aplicar: _a, ...r } = preparar(tipo, buf);
      return r;
    },
    aplicar(tipo, buf, { fichero = "" } = {}) {
      const p = preparar(tipo, buf);
      if (!p.aplicable) throw new Error(p.aviso.find((a) => /No se puede aplicar|no se pueden añadir/.test(a)) ?? "No hay nada que aplicar.");
      if (tipo === "productos" && copiaCatalogo) try { catalogDb.backupTo(`${copiaCatalogo}.antes-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`); } catch { /* sin copia no se bloquea */ }
      const r = p.aplicar();
      registro({ at: new Date().toISOString(), tipo, fichero, resumen: p.resumen, resultado: r });
      onChange(tipo);
      return { ...r, resumen: p.resumen };
    },
  };
}
