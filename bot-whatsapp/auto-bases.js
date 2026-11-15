// Actualización AUTOMÁTICA desde las carpetas BASE-ARTICULOS, BASE-CLIENTES y BASE-HISTORICO.
//
// Cada minuto (lo pone en marcha server.js, solo en la aplicación de la empresa) mira el archivo MÁS RECIENTE de cada carpeta y, si es nuevo, lo aplica solo:
//   1. espera a que el archivo lleve 2 minutos sin cambiar (por si aún se está copiando o sincronizando);
//   2. solo se usa si su contenido es del tipo de la carpeta (un Excel de clientes en BASE-HISTORICO se deja y se avisa);
//   3. hace la vista previa de siempre y, si no hay nada que cambiar, lo archiva sin tocar nada;
//   4. copia de seguridad de las bases ANTES de aplicar (si la copia falla, no se aplica);
//   5. aplica con las mismas protecciones de «Datos y Excel»: se rechaza un Excel con menos de la mitad de lo que hay; si hay cosas que confirmar (precios que cambian
//      más de un 25 %, muchos artículos que se quitan, datos raros) NO se aplica solo: se queda esperando y se avisa para que lo revise una persona;
//   6. al terminar pasa el archivo a la subcarpeta «aplicados» de su carpeta y apunta la actividad.
// Nunca se aplica un archivo MÁS VIEJO que el último aplicado de ese tipo (al archivar el más reciente, el de debajo no se carga solo).
// Un archivo que falla no se reintenta en bucle: se reintenta cuando cambia (otro tamaño u otra hora) o al reiniciar el programa.

const ORDEN = ["productos", "clientes", "historial"];
const NOMBRE = { productos: "artículos y precios", clientes: "clientes", historial: "historial de compras" };

export function crearAutoBases({ activa, listar, leer, archivar, actualizador, respaldar = () => {}, leerAjuste = () => null, guardarAjuste = () => {}, registrar = () => {}, estableMs = 120_000, ahora = () => Date.now(), log = console }) {
  const pendientes = new Map(); // clave del archivo → { carpeta, nombre, tipo, motivo, clave }
  let ultimaRevision = null, ocupado = false;
  const claveDe = (a) => `${a.carpeta}|${a.nombre}|${a.tamano}|${a.modificado}`;
  const ajuste = (tipo) => `auto_bases_${tipo}`;

  /** Revisa las carpetas y aplica lo que toque. Devuelve lo hecho (para las pruebas). */
  async function revisar() {
    const hecho = [];
    if (!activa() || ocupado) return hecho;
    ocupado = true;
    try {
      const l = listar();
      ultimaRevision = new Date(ahora()).toISOString();
      if (!l?.configurada) return hecho;
      const vigentes = new Set();
      for (const tipo of ORDEN) {
        const a = (l.archivos ?? []).find((x) => x.carpeta && x.ultimo && x.tipoCarpeta === tipo);
        if (!a) continue;
        const k = claveDe(a);
        if (a.tipo !== tipo) { vigentes.add(k); pendientes.set(k, { carpeta: a.carpeta, nombre: a.nombre, tipo, clave: k, motivo: a.aviso ?? "El contenido no parece de este tipo." }); continue; }
        const ya = leerAjuste(ajuste(tipo));
        if (ya && Date.parse(a.modificado) <= Date.parse(ya)) continue; // más viejo (o igual) que lo último aplicado: no se toca
        if (ahora() - Date.parse(a.modificado) < estableMs) continue; // aún se está copiando o sincronizando
        if (pendientes.has(k) && pendientes.get(k).fijo) { vigentes.add(k); continue; } // ya se intentó con este mismo archivo y falló: espera a que cambie
        vigentes.add(k);
        const fallo = (motivo) => { pendientes.set(k, { carpeta: a.carpeta, nombre: a.nombre, tipo, clave: k, motivo, fijo: true }); log.error?.(`[VM actualización automática] ${a.carpeta}/${a.nombre}: ${motivo}`); };
        let buf;
        try { buf = leer(a.nombre, a.carpeta); } catch (e) { fallo(`No se pudo abrir el archivo (¿lo tienes abierto en Excel?): ${e.message}`); continue; }
        if (!buf?.length) { fallo("El archivo está vacío o no se puede leer."); continue; }
        let prev;
        try { prev = actualizador.vistaPrevia(tipo, buf); } catch (e) { fallo(`No se pudo leer el Excel: ${e.message}`); continue; }
        if (!prev.aplicable) {
          const duro = (prev.aviso ?? []).find((x) => /No se puede aplicar|no se pueden añadir/.test(x));
          if (duro) { fallo(duro); continue; }
          try { archivar(a.nombre, a.carpeta); guardarAjuste(ajuste(tipo), a.modificado); registrar(`Revisó automáticamente ${NOMBRE[tipo]} desde ${a.carpeta}: sin cambios (${a.nombre})`); hecho.push({ tipo, nombre: a.nombre, sinCambios: true }); log.log?.(`[VM actualización automática] ${a.carpeta}/${a.nombre}: sin cambios, archivado.`); } catch (e) { fallo(`Sin cambios, pero no se pudo archivar: ${e.message}`); }
          continue;
        }
        if (prev.confirmar?.length) { fallo(`Hay que confirmarlo a mano en «Datos y Excel»: ${prev.confirmar.join(" ")}`); continue; } // precios que saltan, muchos artículos que se quitan, datos raros
        try { respaldar(); } catch (e) { fallo(`No se pudo hacer la copia de seguridad previa, así que no se ha aplicado: ${e.message}`); continue; }
        let r;
        try { r = actualizador.aplicar(tipo, buf, { fichero: a.nombre, confirmo: false }); } catch (e) { fallo(e.confirmar ? `Hay que confirmarlo a mano en «Datos y Excel»: ${e.confirmar.join(" ")}` : `No se pudo aplicar: ${e.message}`); continue; }
        try { archivar(a.nombre, a.carpeta); } catch (e) { log.error?.(`[VM actualización automática] aplicado, pero no se pudo archivar ${a.nombre}: ${e.message}`); }
        guardarAjuste(ajuste(tipo), a.modificado);
        registrar(`Actualizó automáticamente ${NOMBRE[tipo]} desde ${a.carpeta} (${a.nombre})`);
        hecho.push({ tipo, nombre: a.nombre, resultado: r });
        log.log?.(`[VM actualización automática] ${a.carpeta}/${a.nombre}: aplicado.`);
      }
      for (const k of [...pendientes.keys()]) if (!vigentes.has(k)) pendientes.delete(k); // lo que ya no está o cambió, deja de estar pendiente
    } finally { ocupado = false; }
    return hecho;
  }
  return {
    revisar,
    /** Para el panel y el vigilante: si está activa, cuándo miró por última vez y qué archivos esperan a una persona. */
    estado: () => ({ activa: !!activa(), ultimaRevision, pendientes: [...pendientes.values()].map(({ carpeta, nombre, tipo, motivo }) => ({ carpeta, nombre, tipo, motivo })) }),
  };
}
