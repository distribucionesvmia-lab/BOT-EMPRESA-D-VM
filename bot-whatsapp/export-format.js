// Formato del Excel que se entrega al ERP.
//
// ⚠️ PROVISIONAL: mientras no tengamos la plantilla de importación real del ERP, se usa este formato
// (una fila por línea de pedido). Cuando se conozca, SOLO hay que cambiar este fichero: nombre y orden de las
// columnas, tipos, formato de fecha, código de cliente/artículo, etc. El resto del sistema no cambia.

export const FORMAT = {
  name: "provisional-v0",
  sheetName: "Pedidos",
  columns: [
    { header: "Pedido", width: 18, value: (o) => o.ref },
    { header: "Fecha", width: 18, value: (o) => madrid(o.created_at) },
    { header: "Código cliente", width: 16, value: (o) => o.customer_id },
    { header: "Cliente", width: 30, value: (o) => o.name },
    { header: "Artículo", width: 14, value: (o, l) => l.id },
    { header: "Descripción", width: 44, value: (o, l) => l.name },
    { header: "Unidades", width: 10, value: (o, l) => l.qty },
    { header: "Precio", width: 10, value: (o, l) => l.price },
    { header: "Observaciones", width: 36, value: (o) => o.note },
  ],
};

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
