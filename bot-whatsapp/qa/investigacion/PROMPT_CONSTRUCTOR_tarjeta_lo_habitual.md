# Prompt para el constructor — tarjetas de «Lo que más consumes» (lo habitual)

Adjunta la imagen `tarjeta_habitual_antes_despues.png` (a la izquierda, la captura actual; a la derecha, la propuesta).

```text
DÓNDE SE HACE EL CAMBIO: en el código fuente del programa (rama claude/eager-hamilton-gknalq; haz git pull y lee CLAUDE.md antes). Las tarjetas de «Lo que más consumes» / lo habitual están en la parte del cliente (bot-whatsapp/cliente.html y/o pedido.html). npm test debe pasar entero; si cambias comportamiento, añade o ajusta su prueba. Respeta la política de seguridad (CSP): sin scripts ni estilos externos; iconos SVG propios; fuente del sistema. Al terminar, haz commit y push y regenera la demo. No toques datos, precios, descuentos, IVA ni reglas de entrega.

OBJETIVO: rediseñar esas tarjetas para que se vean limpias, iguales entre sí y claras, y mostrar lo último que pidió el cliente de cada artículo con el texto «Último pedido: N uds / N cajas». Te adjunto una captura de cómo están y la propuesta.

PROBLEMAS DE LA TARJETA ACTUAL
- Borde verde grueso y fondo verde en toda la tarjeta: parece un estado de «seleccionado» y choca con el rojo de la marca.
- Nombre en mayúsculas, de hasta 4 líneas y muy grande; las tarjetas salen de alturas distintas y el botón «+» queda a alturas distintas.
- Texto largo «Has dejado grabado: 1 caja del último pedido».
- El precio se parte en dos líneas («12,996 €» / «/caja»).
- La foto cambia de fondo de una tarjeta a otra (gris, blanco…).

CÓMO DEBE QUEDAR
1. TARJETA: fondo blanco, radio 20, relleno 12, SIN borde verde ni fondo de color (el fondo de la zona es el gris claro de la app). Ancho 188 px (y al menos el 60 % del ancho disponible cuando la letra del cliente está agrandada; en ese caso la tarjeta crece en ancho, no solo en alto). TODAS las tarjetas del carrusel tienen la misma altura, y el bloque inferior (precio y botón) queda siempre en la misma línea en todas.
2. FOTO: baldosa blanca con línea fina de 1 px (#EBEBF0), radio 14, alto 140; la foto con object-fit: contain ocupando el 80–85 %. Si la foto mide menos de 160 px de lado, no la estires: muéstrala a su tamaño natural centrada.
3. TEXTO (de arriba a abajo):
   a) Marca en micro-etiqueta (11 px, mayúsculas, gris, +0,04 em), solo si se conoce.
   b) Nombre en 16 px peso 600, máximo 2 líneas (corta con «…» y pon el nombre completo en el atributo title y en el lector de pantalla). Usa el nombre limpio (minúsculas con inicial mayúscula) si ya existe esa función; si no, el actual.
   c) Línea de formato en 13 px gris: «Solo cajas de 12» o «Caja de 12»; nada si solo se vende en unidades.
   d) ETIQUETA DE ÚLTIMO PEDIDO (píldora gris #F2F2F7 con un icono de reloj de 13 px y texto de 12 px peso 600): «Último pedido · 1 caja». Reglas del texto:
      - Cantidad y unidad tal como las pidió el cliente la última vez que pidió ESE artículo: «1 caja», «2 cajas», «1 ud», «12 uds».
      - Si lo pidió en unidades y es un múltiplo exacto de la caja, añade las cajas entre paréntesis: «24 uds (2 cajas)».
      - Si ese artículo estaba en el último pedido del cliente: «Último pedido · …». Si no, pero sí en uno anterior: «Última vez · 1 caja · 3 nov» (con el día y mes de ese pedido).
      - Si no hay historial de ese artículo, no se muestra la etiqueta (ni hueco que descuadre la altura: reserva el espacio).
      - Desaparece por completo la frase «Has dejado grabado: …».
      - La píldora se puede pulsar: añade al pedido exactamente esa cantidad, con aria-label «Añadir 1 caja de <nombre>». Una vez añadido, la etiqueta pasa a acento suave con «En tu pedido · 1 caja».
   e) FILA INFERIOR: a la izquierda el precio en 17 px peso 600 con cifras tabulares y la unidad en 12,5 px gris en la MISMA línea (white-space: nowrap), y debajo en 12 px gris el otro precio («1,083 € /ud» si se vende por caja; «81,00 € /caja» si es por unidad y tiene caja). A la derecha, botón circular «+» rojo de 40–44 px siempre en la misma posición en todas las tarjetas.
4. AL AÑADIR: el «+» se convierte en un contador en píldora «− 1 +» en el mismo sitio, sin cambiar la altura de la tarjeta ni mover las demás. Si el contador no cabe junto al precio, que ocupe la fila inferior y el precio pase a la línea de formato; en ningún caso puede desbordar, cortarse ni cambiar el alto de la tarjeta. Mantén la cantidad mínima y la lógica actual de cajas/unidades.
5. CARRUSEL: desplazamiento horizontal con ajuste a cada tarjeta (scroll-snap), margen lateral de 20 px, se ve un trozo (≥ 24 px) de la siguiente para indicar que hay más, sin barra de desplazamiento visible, accesible con teclado. Título de la sección en 22 px peso 700. Mantén «Ver todo» si existe.
6. COLORES: sin verde en la tarjeta; el rojo solo en el «+» y en el estado activo; contraste de texto AA (el gris de las líneas secundarias, #6E6E73 sobre blanco).
7. ACCESIBILIDAD: cada tarjeta es un grupo con nombre accesible («Batido cacao intenso 200 ml, 12,996 € la caja, último pedido 1 caja»); zonas pulsables ≥ 44 px; respeta reduced-motion; texto hasta +30 % sin romper nada.

COMPRUEBA (y dime el resultado de cada punto): 1) en 320, 360, 390, 568×320, 768 y 1440 de ancho todas las tarjetas miden lo mismo de alto y el precio y el «+» están a la misma altura; 2) con letra al 130 % no se corta ningún texto y la etiqueta no se desborda; 3) la etiqueta muestra bien «1 caja», «2 cajas», «1 ud», «12 uds» y «24 uds (2 cajas)»; 4) un artículo sin historial no muestra etiqueta y no descuadra la altura; 5) pulsar la etiqueta añade exactamente esa cantidad; 6) al añadir, la tarjeta no cambia de alto; 7) npm test en verde. Entrégame capturas antes y después en 390 px de ancho y con letra al 130 %.
```
