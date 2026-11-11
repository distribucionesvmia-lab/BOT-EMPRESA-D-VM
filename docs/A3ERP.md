# a3ERP — lo que sabemos

## Confirmado por la empresa (29/10/2026)
- a3ERP está **instalado en un servidor físico propio, en la oficina** (no está en la nube).
- Pendiente de confirmar: que SQL Server esté en ese mismo servidor, la versión de a3ERP y de Windows, la DLL/SDK para crear pedidos y la salida a internet del servidor (ver `docs/INFORME_SERVIDOR.md`).

 (confirmado con capturas de pantalla, 28/10/2026)

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

## Excel de pedidos (formato `pedidos-v4`, para imprimirlos y pasarlos a mano a a3ERP)
Sigue la hoja modelo de la empresa. **Una hoja por pedido** (se llama «5900 · 000004»), lista para imprimir en **A4 vertical**, ajustada al ancho, con márgenes pequeños, área de impresión automática y las páginas numeradas abajo a la derecha («1/3»). No lleva figuras flotantes (ni casillas ni cuadros de texto sueltos): todo va dentro de las celdas.
- **Cartel azul oscuro**: «Cliente 5900» (columnas A-C) y el nombre comercial (D-H); debajo del nombre, la **población**. Después: Nº pedido · Fecha recep. · Hora.
- **Líneas**: Código artículo · ☐ (casilla de «preparado», un carácter de la celda) · Cajas · Descripción · Unidades · Precio (3 decimales) · Dto. % · Importe. Sin IVA. Filas de 17 pt, alternas gris claro/blanco, con bordes finos. Cajas en negrita; unidades, precio, dto. e importe en gris; **si no hay cajas, las unidades van en negrita y negro**.
- **Totales** justo debajo de las líneas (base, IVA, R.E., total) → **Entrega** (rojo hoy, amarillo mañana, verde más de 24 h) → **Observaciones del cliente** (cuadro; el texto sale en rojo si lo hay).
- **Observaciones línea**, al pie de la hoja (abajo de la página): código + descripción + «*observación». Si ninguna línea tiene observación, esa parte queda totalmente en blanco.
- Última hoja «Líneas»: lo mismo en plano (una fila por línea, con IVA y observaciones), para filtrar o importar.
Los totales se calculan por tipo de IVA y reproducen el pedido real de la captura (base 84,12 · IVA 15,26 · total 99,38).

## Consecuencias para el diseño

1. **Cajas y unidades.** Un artículo se pide en cajas y el ERP calcula las unidades (ej.: 2 cajas = 12 uds, 1 caja = 4 uds, 1 caja = 6 uds). El catálogo necesita el dato **«unidades por caja»** y el bot debe aclarar si el cliente pide cajas o unidades.
2. **Precio, descuento e IVA los pone a3ERP** (tarifa del cliente, descuentos, tipo de IVA por artículo). El Excel de importación probablemente solo necesite cliente + artículo + cantidad. Los precios del bot son orientativos.
3. **Líneas con descuento 100 %** (regalos/promociones): el bot no debe inventarlas; hay que decidir si las aplica el ERP.
4. **Número de pedido:** lo asigna a3ERP. Guardar nuestra referencia en «Referencia» o «Observaciones».
5. **Pendiente:** cómo se importa un pedido (¿herramienta de importación? ¿API de pago? ¿nada?) y el formato de las copias de seguridad.

> Las capturas contienen datos de un cliente real: no se guardan en el repositorio.
