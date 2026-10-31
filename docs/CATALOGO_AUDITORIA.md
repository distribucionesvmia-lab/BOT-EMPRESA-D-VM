# Auditoría del catálogo (Fase 1)

Método: lectura del código de `bot-whatsapp/pedido.html` y `cliente.html`. Aún NO se ha hecho una pasada manual en un móvil real: los hallazgos marcados "código" están confirmados leyendo el código; la experiencia real queda por confirmar (tarea 1.5).

Prioridad: A = puede causar un pedido erróneo o bloquear la compra · M = molesta o confunde · B = detalle.

| ID | Prio | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| D1 | A | El carrito se pierde al recargar o cerrar la página (no se guarda). | código: `qty` es un `Map` en memoria | Pendiente (Fase 7) |
| D2 | A | Cambiar "Uds"↔"Cajas" con cantidad ya puesta mantiene el número: 24 uds pasan a 24 cajas sin aviso. | código `control()` | Pendiente (Fase 5) |
| D3 | A | Tocar un día de entrega envía el pedido al instante, sin resumen final: un toque erróneo envía. (Decisión previa del cliente: "al tocarlo se envía"). | código `pintarOpciones` | Pendiente: consultar al cliente si quiere un paso de confirmación (Fase 7) |
| D4 | M | Con 150+ productos solo se veían 150 sin aviso. | código | **Corregido** (botón "Mostrar más") |
| D5 | M | Búsqueda: solo nombre y código, y la frase exacta ("entera leche" no encontraba "leche entera"). Sin marca ni EAN. | código | Orden de palabras **corregido**; marca/EAN pendientes de datos reales (Fase 4) |
| D6 | M | Bajar a 0 con "−" quita la línea y su observación sin deshacer. | código `setQty` | Pendiente (Fase 5/7) |
| D7 | M | El carrito no muestra el subtotal de cada línea, solo el precio unitario. | código `row` | Pendiente (Fase 7) |
| D8 | M | Los botones "−", "+", la cantidad y Uds/Cajas no tenían etiqueta accesible ni estado. | código | **Corregido** |
| D9 | M | Pantallas (carrito, entrega, calendario) no se comportan como diálogos: el foco no se traslada, el fondo sigue enfocable, Esc no cierra el calendario; el botón Atrás del móvil sale de la app. | código | Pendiente (Fases 7 y 10) |
| D10 | M | Mensaje de sesión caducada hablaba de teléfono y PIN. | código | **Corregido** |
| D11 | M | Si fallaba la red al cargar, la pantalla se quedaba en "Cargando…". | código | **Corregido** (muestra el aviso de sesión/entrada) — mejorar con mensaje de red (Fase 7) |
| D12 | B | Color del foco muy claro (#ffb3b3 sobre blanco). | código | **Corregido** |
| D13 | B | Errores del carrito sin `role="alert"`; aviso de "llevas N artículos" sin zona viva. | código | **Corregido** |
| D14 | M | Cantidades máximas: se recorta a 999 sin avisar. | código `setQty` | Pendiente (Fase 5) |
| D15 | M | Textos pequeños (14 px, paso) y revisar contraste del gris `#5f6368` sobre fondos. | código | Pendiente (Fase 10) |
| D16 | M | No hay favoritos, listas ni "repetir pedido" en la mini-app (solo en el chat). | código | Pendiente (Fase 6) |
| D17 | M | Sin fotos: solo iniciales. Sin marca/formato/EAN en las fichas. | código | Pendiente; necesita datos reales (Fase 9) |
| D18 | M | Las categorías no coinciden con la propuesta comercial del plan. | `categorias.js` | Pendiente (Fase 3) |

Revisión humana necesaria: D3 (decisión de negocio), D18 (clasificación real), D17 (datos y fotos).
