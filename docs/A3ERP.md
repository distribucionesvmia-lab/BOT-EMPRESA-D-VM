# a3ERP — lo que sabemos (confirmado con capturas de pantalla, 28/10/2026)

**ERP confirmado:** a3ERP, de Wolters Kluwer Tax and Accounting, S.L. (la ficha "Datos del fabricante" del propio programa).
Versión y modalidad (local/nube): **pendiente de confirmar**.

## Ventana "Pedido de venta" (observada)

**Cabecera**
| Campo en a3ERP | Valor de ejemplo | Notas para el sistema |
|---|---|---|
| Código (cliente) | `1952` | Es el código de cliente que el bot ya usa |
| Fecha | 28/10/2026 | Fecha del pedido |
| Fecha entrega | 28/10/2026 | ¿La decide el cliente o la empresa? |
| Número | `1` / `PD1` / `34143` | Probablemente ejercicio / serie / nº correlativo. **Lo asigna a3ERP**, no nosotros |
| Referencia | `PD1-34143` | Campo libre: ideal para guardar nuestra referencia `VM-2026-000123` (trazabilidad y control de duplicados) |
| Moneda / Cambio | EURO / 1 | Fijo |
| Tipo de operación | Operac. interiores sujetas | Fijo para clientes nacionales |
| Idioma | Castellano | Fijo |
| Forma de pago, Documento de pago | Contado, Efectivo | Seguramente vienen de la ficha del cliente |
| Transportista, Persona | (vacíos) | |
| Almacén | Almacén central | Fijo |
| Tarifa | Tarifa al por mayor | Seguramente por cliente |
| Representante | (nombre del comercial) | ¿Qué representante se asigna a los pedidos del bot? |

**Líneas**: Artículo (código), **Cajas**, Descripción, **Unidades**, Precio (6 decimales), Desc. 1 (%), Uds. servidas, Base, Tipo de IVA/IGIC (21 % / 10 %), Uds. pendientes.

## Pie del pedido (observado)
Pestañas del pie: Resumen · Detalle impuestos · Otros datos. Todo lo que contiene **lo calcula a3ERP**: descuento/recargo financiero (pronto pago, recargo), portes/embalajes (base e IVA de portes), totales (base de líneas, base imponible, cuota IVA/IGIC, recargo de equivalencia, base de retención, % y retención, no sujeto, total documento) y el botón «Generar anticipo». **El Excel no exporta nada de esto.**

## Excel de pedidos (formato `pedidos-v2`, para introducirlos a mano en a3ERP)
Hoja «Pedidos», un bloque por pedido: **cabecera** (Nº pedido, Código cliente, Nombre comercial, Fecha recepción, Hora pedido) · **líneas** (Código artículo, Cajas, Descripción, Unidades, Precio, Dto. %, Importe, IVA %, Observaciones línea) · **pie** (Total base imponible, Total IVA, Total R.E., Total pedido, Observaciones del cliente). Hoja «Líneas»: lo mismo en plano.
Los totales se calculan por tipo de IVA y reproducen el pedido real de la captura (base 84,12 · IVA 15,26 · total 99,38).

## Consecuencias para el diseño

1. **Cajas y unidades.** Un artículo se pide en cajas y el ERP calcula las unidades (ej.: 2 cajas = 12 uds, 1 caja = 4 uds, 1 caja = 6 uds). El catálogo necesita el dato **«unidades por caja»** y el bot debe aclarar si el cliente pide cajas o unidades.
2. **Precio, descuento e IVA los pone a3ERP** (tarifa del cliente, descuentos, tipo de IVA por artículo). El Excel de importación probablemente solo necesite cliente + artículo + cantidad. Los precios del bot son orientativos.
3. **Líneas con descuento 100 %** (regalos/promociones): el bot no debe inventarlas; hay que decidir si las aplica el ERP.
4. **Número de pedido:** lo asigna a3ERP. Guardar nuestra referencia en «Referencia» o «Observaciones».
5. **Pendiente:** cómo se importa un pedido (¿herramienta de importación? ¿API de pago? ¿nada?) y el formato de las copias de seguridad.

> Las capturas contienen datos de un cliente real: no se guardan en el repositorio.
