// Formato del Excel que se entrega a a3ERP.
//
// ⚠️ BORRADOR: construido a partir de la ventana «Pedido de venta» de a3ERP (capturas de pantalla), no de la
// plantilla de importación real, que aún no tenemos. Cuando se conozca, SOLO hay que cambiar este fichero.
//
// Qué se exporta y qué no:
//  - Se exporta lo que el cliente decide: cliente, artículos y cantidades, más la referencia para trazabilidad.
//  - NO se exporta lo que calcula o asigna a3ERP: número de pedido, precio, descuento, IVA/IGIC, bases, cuotas,
//    totales, pronto pago, portes, retención, almacén, tarifa, forma de pago, transportista, representante.
//    Salen de la ficha del cliente y de las tarifas del ERP; si el bot los mandara, podría pisarlos con datos erróneos.
//  - Una fila por línea de pedido; la cabecera se repite en cada fila.

const SERIE = process.env.EXPORT_SERIE ?? "PD1"; // serie de pedidos de venta en a3ERP (ver ventana: 1/PD1/34143)

export const FORMAT = {
  name: "a3erp-borrador-v1",
  sheetName: "Pedidos",
  columns: [
    { header: "Serie", width: 8, value: () => SERIE },
    { header: "Referencia", width: 18, value: (o) => o.ref }, // campo «Referencia» de a3ERP: guarda nuestro VM-AAAA-NNNNNN
    { header: "Código cliente", width: 15, value: (o) => o.customer_id },
    { header: "Cliente", width: 30, value: (o) => o.name }, // solo para que una persona compruebe el fichero
    { header: "Fecha", width: 12, value: (o) => madridDate(o.created_at) },
    { header: "Fecha entrega", width: 14, value: () => null }, // pendiente: ¿la elige el cliente o la empresa?
    { header: "Artículo", width: 12, value: (o, l) => l.id },
    { header: "Descripción", width: 44, value: (o, l) => l.name }, // solo informativa
    { header: "Cajas", width: 8, value: () => null }, // pendiente: unidades por caja de cada artículo (ver docs/A3ERP.md)
    { header: "Unidades", width: 10, value: (o, l) => l.qty },
    { header: "Observaciones", width: 36, value: (o) => o.note },
  ],
};

// Fecha local de la empresa en formato a3ERP: "28/10/2026"
export function madridDate(iso) {
  const [d, t] = madrid(iso).split(" ");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// Fecha y hora local de la empresa (Medina del Campo): "2026-10-28 17:45"
export function madrid(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Convierte pedidos en filas de hoja: cabecera + una fila por línea de pedido. */
export function toRows(orders, format = FORMAT) {
  const rows = [format.columns.map((c) => c.header)];
  for (const o of orders) for (const l of o.items) rows.push(format.columns.map((c) => c.value(o, l) ?? null));
  return rows;
}
