# Informe final de la sesión de pruebas «persona real» — 1 de noviembre de 2026

Tareas: 10 de 10 completadas. Hallazgos: 31 (3 altos, 8 medios, 20 bajos/informativos). Arreglados: 30. Pendiente: 1 (F6-1, esperando la respuesta del usuario).

## Altos (todos arreglados)
- F3-1 Privacidad: quien se identificaba por nombre desde otro teléfono veía el histórico, precios especiales, código y dirección del cliente.
- F9-1 Una clave de empresa errónea bloqueaba al administrador (el panel lanza 7 peticiones por intento; 10 fallos = bloqueo 10 min).
- F8-1 El chat de WhatsApp no incluía los pedidos recientes en «último pedido», «histórico» y «repetir».

## Medios (arreglados)
F2-1 siguiente a derivar a una persona seguía pidiendo el nombre · F4-1 el chat enseñaba precio de tarifa y no el especial · F5-1 «-3 aguas» se aceptaba como 3 · F5-2 mensaje engañoso con cantidades > 999 · F7-1 texto falso «al tocarlo se envía tu pedido» · F8-2 texto no entendido en «Revisa tu pedido» borraba el carrito.

## Bajos / informativos (arreglados)
F2-2, F2-3, F4-2 (referencia), F4-3, F5-3, F5-4, F6-2, F6-3, F7-2/F8-3 (singulares y coma decimal), F9-2, F10-1, F10-2, F10-3, F3-2.

## Pendiente
- F6-1 (datos): «VINO … (CAJA 6)» sale como «Caja de 6 uds» a 21,00 €. ¿Precio por botella o por caja?

## Lo que funcionó bien
Doble clic al enviar (1 solo pedido), 409 en reenvíos, exportación a Excel (totales, IVA y hora de Madrid correctos), carrito y catálogo web, XSS en chat y notas (se muestra como texto), móvil 320/360 px.

Detalle en HALLAZGOS.md. Tests: 216/216.
