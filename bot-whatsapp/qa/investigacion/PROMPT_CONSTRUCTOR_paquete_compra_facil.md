# Prompt para el agente constructor — paquete «comprar más fácil» (F-02, F-16, F-17, F-18, F-20, F-21, F-22, F-23, F-24)

Antes de pegarlo, rellena los dos datos de F-24 (teléfono y horario) en las líneas marcadas con `[RELLENAR]`.
No incluye F-19 (estado del pedido) ni F-25 (recordar notas), tal como pediste. Aplícalo DESPUÉS del prompt de «letra y aviso de entrega».

```text
Trabajas sobre el artefacto «Pedidos por WhatsApp» (https://claude.ai/artifact/5R8CeLCQi6uTPXkzEfsETP). Es la app de pedidos de Distribuciones Valentín Martín: portada de acceso, chat, y un catálogo de pedido (la constante MINI_HTML, que se pinta en un iframe con srcdoc), más el panel de la empresa. Quiero NUEVAS funciones para que al cliente le resulte más fácil y rápido comprar. Son nueve, en este orden. Hazlas de una en una y publica una versión después de cada bloque (A, B, C…), para que si algo falla se pueda volver atrás sin perder lo anterior.

REGLAS GENERALES (valen para todo)
- Parte de la versión publicada actual y léela antes de cambiar nada. Este trabajo va DESPUÉS del prompt «letra del cliente y aviso de entrega hoy»: si ese cambio ya está publicado, reutiliza su variable de tamaño de letra, su función de hora de Madrid y su regla de «hoy» (puedeHoy, corte a las 10:00); no los dupliques. Si no estuviera publicado, avísame y no sigas.
- No cambies datos (tarifa, clientes), reglas de precios ni el cálculo de IVA. No rompas lo que ya está arreglado: botón «+ Añadir» y contador estables (la tarjeta del producto NO cambia de alto al pulsar), zonas táctiles de 44–48 px, apaisado usable, letra hasta 130 %.
- Todo lo nuevo debe: medir al menos 48 px de alto en lo que se pulsa; funcionar con letra a 130 %; no desbordar en 320×568, 360×640, 390×844, 568×320 (apaisado), 768×1024 y 1440×900; respetar prefers-reduced-motion; tener nombres accesibles (aria-label) y avisos con role="status" o aria-live="polite".
- Privacidad: en esta demo las bases las puede ver cualquiera con acceso a la página. No muestres nunca a un cliente datos de otro (nombres, pedidos, direcciones). Si necesitas algo agregado entre clientes, que sean solo recuentos de productos sin ningún dato personal.
- Si para algo falta un dato que no puedes sacar del artefacto (teléfono, horario, hora límite…), NO lo inventes: deja la función oculta o desactivada y dímelo al terminar.
- Guardado en el móvil: solo preferencias o borradores por dispositivo, en localStorage dentro de try/catch; la app debe funcionar igual si falla.

════════ BLOQUE A · Que el cliente vea primero lo suyo ════════

F-21 · Abrir en «lo mío»
- Al abrir el catálogo, si el cliente tiene historial de pedidos, la pestaña por defecto es «★ Histórico» (sus artículos ordenados por frecuencia y recencia). Si no tiene historial, abre «Catálogo» con una fila «Lo más pedido» (los artículos más pedidos entre todos los clientes, solo con el nombre del artículo; nunca de quién).
- Dentro de cada categoría y subcategoría, los artículos que ese cliente ya compra van arriba, marcados con una etiqueta discreta «Lo compras».
- Antes de dar por buena esta función, comprueba con el cliente de prueba (123456) si tiene historial y qué pestaña abre ahora, y dime el antes y el después.

F-02 · «Tu pedido de siempre»
- Si el cliente tiene un pedido anterior (incluidos los hechos desde la propia app), en la portada del catálogo y como tarjeta en el chat al empezar un pedido, muestra una tarjeta «Tu pedido de siempre» con hasta 5 líneas (cantidad y artículo) y «y N más», el total con IVA de hoy y un botón grande «Repetir y revisar».
- «Repetir y revisar» añade esas líneas al carrito con los precios y descuentos de HOY y abre directamente el paso 2 (Revisa tu pedido), donde se puede quitar o cambiar cualquier cosa antes de continuar. Nunca envía nada sin que el cliente confirme.
- Los artículos que ya no existan o estén dados de baja no se añaden y se le avisa («1 artículo ya no está disponible»).
- Si no hay pedido anterior, la tarjeta no aparece (ni hueco vacío).

════════ BLOQUE B · Pedir más rápido y con menos fallos ════════

F-22 · Cantidades rápidas
- Tocar el número del contador abre el teclado numérico del móvil (inputmode="numeric", pattern de solo dígitos) para escribir la cantidad directamente; sin ceros ni negativos; máximo razonable (999) con mensaje claro si se pasa.
- Atajos de salto junto al contador, sin cambiar el tamaño ni la altura de la tarjeta (reserva el espacio): «+6», «+12» y, si el artículo se vende por cajas, «+1 caja». Cada atajo mide al menos 48 px.
- Al cambiar de «Uds» a «Cajas» la cantidad se convierte con claridad (y se muestra «1 caja · 35 uds») sin saltos.

F-23 · Deshacer al quitar
- Al quitar un artículo del carrito (papelera, o bajar el contador a 0) o al vaciar el pedido, muestra un aviso «Quitado: <artículo> · Deshacer» durante 8 segundos (que se pause mientras el cliente lo toca o tiene el foco encima), con un botón «Deshacer» de 48 px que lo devuelve con la misma cantidad y observación. role="status". No debe tapar el botón «Elegir el día de entrega» ni la barra del carrito.
- Los botones de quitar tienen nombre accesible con el artículo («Quitar AGUA BEZOYA 0.33 ml»).

F-24 · Botón de ayuda siempre a mano
- Un botón «¿Necesitas ayuda?» (48 px) en el menú ⋮ del chat y en la barra superior del catálogo. Abre una hoja pequeña con dos botones grandes: «Llamar» (enlace tel:) y «WhatsApp» (enlace https://wa.me/ con un mensaje ya escrito: «Hola, necesito ayuda con mi pedido» y el nombre del cliente), más el horario.
- Datos que debes usar: teléfono [RELLENAR], WhatsApp [RELLENAR], horario [RELLENAR]. Guárdalos como constantes bien visibles al principio del código. Si alguno está vacío, ese botón no se muestra; si están todos vacíos, el botón de ayuda no aparece y me lo dices.

════════ BLOQUE C · Encontrar productos en un catálogo grande (más de 640) ════════

F-20 · Búsqueda mejor
- El buscador está siempre visible y busca en TODO el catálogo desde cualquier pantalla (no solo en la categoría abierta); un interruptor «Solo en esta categoría» es opcional.
- Sugerencias desde la primera letra, mientras escribe: hasta 6 coincidencias de nombre, con la miniatura, el precio y el botón «+ Añadir» o el contador; tolerantes a una errata de una letra en palabras de 5 o más letras y sin distinguir tildes ni mayúsculas.
- Filtros bajo el buscador en los resultados: por marca (la subcategoría de la tarifa suele ser la marca) y por formato (déjalo deducido de los datos que haya; si no hay formato fiable, deja solo el de marca y dímelo). Los filtros se pueden quitar con un toque y muestran cuántos resultados hay.
- «Búsquedas recientes» (las últimas 5) bajo el buscador cuando está vacío, por dispositivo.
- Sin resultados: mensaje claro y un botón «Hablar con una persona» que use los datos de F-24.

════════ BLOQUE D · Pedido fijo, recordatorio y editar lo enviado ════════

F-16 · Pedido fijo semanal (siempre con revisión)
- En «Tu pedido de siempre» y en el carrito, una opción «Repetir cada semana»: el cliente elige uno o más días de reparto (lunes a viernes) y se guarda esa plantilla (líneas y cantidades) para su cuenta; se puede ver, editar, pausar y borrar desde su menú («Mi pedido fijo»).
- NO se envía nada solo. El día elegido, al abrir la app (o con un aviso al entrar), el cliente ve una tarjeta «Hoy toca tu pedido de los martes» con «Revisar y enviar»: crea el borrador en el carrito con precios de hoy y pasa por el paso 2 y el día de entrega como cualquier pedido. Las modificaciones son siempre posibles antes de confirmar.
- Guarda las plantillas con el mismo mecanismo y las mismas reglas de acceso que ya usa la app para los pedidos y las cuentas; no inventes una forma nueva de guardar datos. Respeta el aviso de privacidad de la demo y no mezcles datos de clientes.

F-17 · Recordatorio de reposición (versión sin API de WhatsApp)
- Esta app no puede enviar mensajes de WhatsApp por sí sola. Construye la versión que sí se puede: en el panel de la empresa, una sección «Recordatorios de hoy» con los clientes a los que les toca reponer. Para cada cliente se calcula su ciclo habitual a partir de su historial (mediana de días entre pedidos, mínimo 3 pedidos) y aparece cuando ha pasado entre el 75 % y el 100 % de ese ciclo desde su último pedido, o cuando hoy es uno de sus días de pedido fijo (F-16) y todavía no ha pedido.
- Cada fila muestra el nombre, el último pedido y el ciclo estimado, y un botón «Abrir WhatsApp» que abre https://wa.me/<teléfono> con este texto ya escrito y editable: «Hola <nombre comercial>, ¿te preparo tu pedido de siempre? Puedes revisarlo y enviarlo tú aquí: <enlace de la app>. Si no quieres recordatorios, dínoslo y los quitamos.» Y un botón «Ya avisado» para no repetirlo ese día; y «No avisar más» por cliente.
- Es la empresa quien pulsa y envía a mano. No se envía nada automático. Deja anotado en el código dónde se enchufaría el envío automático cuando exista la API de Meta.
- Solo se muestran clientes que tengan teléfono en la ficha.

F-18 · Editar el pedido ya enviado hasta una hora límite
- En «Mis pedidos» (o en la pantalla de pedido recibido), un botón «Modificar pedido» mientras se pueda editar. Reabre el pedido en el carrito, lleva a los pasos 2 y 3 y, al confirmar, sustituye al anterior (no crea uno duplicado) y queda marcado en el panel de la empresa como «modificado» con la hora.
- Hora límite de edición (supuesto a confirmar; déjala en UNA constante fácil de cambiar): hasta las 10:00 (hora de Madrid) del último día laborable anterior al de entrega; si la entrega es hoy (cliente de Medina del Campo), hasta las 10:00 de hoy. Un pedido ya exportado al Excel NO se puede editar.
- La hora límite se dice con claridad al confirmar el pedido («Puedes modificarlo hasta las 10:00 del martes») y, pasada, el botón desaparece y aparece «Para cambiar este pedido, llámanos» con los datos de F-24.
- Cuida el caso de dos pestañas o un doble clic: nunca debe quedar el pedido duplicado ni perderse.

════════ Cómo comprobar (por bloque, antes de publicar) ════════
- Con el cliente de prueba «Bar El Ejemplo (ficticio)» (código 9001; entra con 123456) y con «Tienda Ficticia» (9002), recorre cada función: caso normal, caso sin datos (cliente sin historial), caso límite (999 unidades, nombre largo, producto dado de baja) y caso con letra al 130 %.
- Mide con el script de la carpeta qa/investigacion (auditoria-artefacto.cjs) en los 9 tamaños de pantalla: sin desbordes, ninguna zona pulsable < 44 px en lista, carrito ni tarjetas nuevas, y la altura de las tarjetas igual antes y después de pulsar «+ Añadir».
- Comprueba con el teclado (Tab, Enter, Esc) y que los avisos se leen (role="status").
- Para F-16, F-17 y F-18, prueba el recorrido completo: crear el pedido fijo, que aparezca «Hoy toca…», editarlo, enviarlo; que el panel de la empresa muestre el pedido, el «modificado» y la lista de recordatorios; que un pedido exportado no se pueda editar.
- No dejes atajos de prueba en la versión publicada (por ejemplo, un parámetro para forzar la fecha debe estar desactivado).

Al terminar CADA bloque dime: qué cambiaste, qué casos probaste y el resultado de cada uno, lo que no pudiste cumplir y por qué, los datos que te faltaron (teléfono, horario, hora límite…) y el número de versión publicada. No des nada por hecho sin haberlo probado.
```

## Notas para quien supervisa

- **Qué incluye:** F-02, F-16, F-17, F-18, F-20, F-21, F-22, F-23 y F-24. **No incluye** F-19 ni F-25, como pediste. Tampoco incluye los pendientes pequeños (N-01, N-02, M-07, M-08) ni F-01, F-04, F-05, F-14: dime si los quieres en otro prompt.
- **F-17 sin API:** el artefacto no puede mandar WhatsApp solo. El prompt pide una versión que sí se puede hacer ahora: una lista de «a quién le toca» en el panel y un botón que abre WhatsApp con el mensaje escrito, para enviarlo a mano.
- **F-18, hora límite:** puse como supuesto «hasta las 10:00 del último día laborable antes de la entrega» (o de hoy si es entrega en el día). Cámbialo si la regla real es otra.
- **Antes de pegarlo:** rellena teléfono, WhatsApp y horario de F-24.
