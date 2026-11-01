# Hallazgos

## Tarea 1 (abrir /demo y saludar) — OK
- Página carga (200), sin errores de consola. El saludo pide el nombre del negocio o código y ofrece «nuevo». Correcto.
- Base: `npm test` 206/206 pasan.
- Observación menor: el «hola» aparece ya escrito en el chat al abrir (lo envía la propia demo).

## Tarea 2 (identificación fallida) — 3 observaciones
- OK: nombre inexistente («Panadería Fantasma 123») → «No encuentro ese nombre», sin errores de consola.
- OK: «bar» a secas no identifica a nadie (según README). A los 3 fallos avisa a una persona.
- ⚠️ F2-1 (media) Tras avisar a una persona, el bot sigue en modo identificación: «xx» y «asdf qwerty» devuelven otra vez «No encuentro ese nombre…». El cliente acaba de leer «te responderá una persona» y el bot sigue pidiéndole el nombre, sin estado de «derivado a persona».
- ⚠️ F2-2 (baja) «bar» (nombre demasiado genérico) da el mismo mensaje que un nombre inexistente; no explica que es ambiguo/corto. Cuenta como fallo y acerca al cliente al bloqueo de 3.
- ⚠️ F2-3 (a confirmar) «nuevo» muestra el mismo «Bienvenido» del cliente conocido y no pide ningún dato (nombre, NIF, dirección). Un cliente nuevo queda sin registrar/aviso a la empresa que el usuario vea. ¿Es intencionado?

### Arreglados (identificación, F2-1/F2-2/F2-3)
- F2-1: tras derivar a una persona el bot ya no vuelve a pedir el nombre (estado «derivado»; «menu» reinicia).
- F2-2: «bar», «cafetería», «S.L.»… responden «demasiado general, escribe el nombre completo» y no cuentan como fallo.
- F2-3: «nuevo» avisa a una persona (handoff) y explica que su pedido se revisará; sigue pudiendo ver productos y pedir.
- Tests: 207/207. Verificado a mano contra la demo.

## Tarea 3 (identificación correcta) — 2 observaciones
- OK: «Bar El Ejemplo», «bar el ejemplo», «BAR EL EJEMPLO (FICTICIO)», «soy el bar el ejemplo», «Bar Ejemplo» y el código «9001» identifican al cliente correcto. Sin errores de consola.
- ⚠️ F3-1 (ALTA, privacidad) Quien escriba el nombre de un negocio desde cualquier teléfono ve su «histórico de productos» (qué compra y cuántas unidades). `identifiedIntro` (bot.js) muestra `habitualBlock` siempre; `holdUnverified` solo retiene el pedido, no oculta el historial. Contradice la idea del README de que un cliente nunca ve datos de otro. Propuesta: si el teléfono no coincide con el del cliente (en producción), no mostrar el histórico (solo saludo y catálogo) hasta verificar.
- ⚠️ F3-2 (baja) «ejemplo» o «el ejemplo» (solo la palabra distintiva) no identifica: cobertura 50 % < 60 % porque «bar» cuenta. Es una decisión de seguridad, pero el mensaje no sugiere añadir más palabras; con «Bar Ejemplo» sí funciona.

## Tarea 4 (pedido por el chat) — flujo completo OK, 3 observaciones
Flujo probado: identificar → lista → artículo → cajas/unidades → cantidad → «nota: servir el jueves» → Finalizar → Confirmar → día de entrega («mañana») → pedido guardado (VM-2026-000001, entrega 2026-11-02, nota guardada). Cajas bien convertidas (3 cajas = 18 uds).
- ⚠️ F4-1 (media) El chat enseña el precio de tarifa y no el especial del cliente: Cola 0,55 € (tarifa) vs 0,50 € (precio especial del cliente 9001, el que se guarda). Total mostrado 10,86 € / total guardado 10,56 €. El aviso «orientativos, sin IVA ni descuentos» no cubre los precios especiales; el cliente ve un importe distinto del que se le cobrará.
- ⚠️ F4-2 (baja) El mensaje final «¡Pedido recibido!» no muestra la referencia (VM-2026-000001), ni el resumen ni el total; el cliente no tiene número para reclamar.
- ⚠️ F4-3 (baja) Tras «Cambiar»/escribir un texto no reconocido (probé un id de botón erróneo, mi error) el bot responde «No he reconocido ese artículo» sin mostrar el pedido actual: no es fallo, pero conviene recordar el carrito en ese mensaje.

## Tarea 5 (casos raros en el chat) — 4 observaciones, sin fallos graves
- OK: cantidad 0 («He quitado ese artículo»), negativa, letras y emojis en el prompt de cantidad → mensaje de ayuda, no se rompe nada. Texto de 3000 caracteres: responde sin error. HTML/`<img onerror>` en el chat y en notas: se muestra como texto, sin ejecutar nada (sin XSS en la demo).
- ⚠️ F5-1 (media) «-3 aguas» se acepta como 3 aguas: el signo menos se ignora en silencio. Debería rechazarse o avisar.
- ⚠️ F5-2 (media) En el prompt de cantidad, 99999 / 1000000 (y «doce», «1.5», «12 y 3») dan «Escribe solo el número (por ejemplo 6)…», que es engañoso: el límite real es 3 cifras (bot.js:660, `\d{1,3}`) y no se dice. Un cliente que quiera 1000 latas recibe un mensaje que no explica el motivo. «doce» tampoco vale aunque en otros sitios entiende «media docena».
- ⚠️ F5-3 (baja) «1.5» suelto desde el menú se interpreta como el artículo «AGUA MINERAL 1,5 L» ×1 (coincide con el nombre del producto). Y «0 aguas» responde «No he reconocido ese artículo» (debería decir que 0 no es una cantidad válida).
- ⚠️ F5-4 (baja) Callejón: con la pregunta «¿cajas o unidades?» pendiente, cualquier otro texto (un pedido nuevo, «3 cervezas», un número) repite la misma pregunta sin ofrecer salida; solo valen los botones, «cajas/unidades», «menu» o «cancelar», y el mensaje no los menciona.

### Arreglados tras las tareas 3, 4 y 5 (por petición del usuario)
- F3-1 (privacidad): quien se identifica por nombre desde un teléfono que no es el del cliente (producción, `holdUnverified`) ya no ve histórico, precios especiales, código ni dirección: ni en el chat (lista, «último pedido», «histórico», «repetir») ni en la mini-app (`/pedido/…/datos` con `u:1`). Su pedido sigue retenido para revisión. Verificado con token real: historial 5 → 0, precio 0,50 → 0,55 (tarifa), dirección oculta.
- F4-1: el chat enseña el precio especial del cliente (0,50 €) en el artículo, el carrito y el resumen: ya coincide con lo que se guarda.
- F5-1: «-3 aguas» → «Las cantidades no pueden ser negativas»; «0 aguas» → «La cantidad tiene que ser mayor que 0».
- F5-2: >999 explica el máximo (999) y ofrece «persona»; «doce» vale; el mensaje genérico dice «entero de 1 a 999».
- F5-4: el aviso de «cajas o unidades» menciona `menu`.
- Tests: 210/210. NO tocado: F4-2 (referencia en «Pedido recibido»), F4-3, F5-3.

## Tarea 6 (catálogo web: buscar, añadir, cajas/uds, favorito, total) — funciona; 4 observaciones
Probado en móvil (390 px) con el enlace del chat (`/pedido/…`) y con `/catalogo` (acceso con 6 últimos del NIF). Sin errores de consola ni respuestas HTTP ≥ 400.
- OK: «+ Añadir» / «+» / «−» (al llegar a 0 vuelve «+ Añadir» y la barra a «Añade productos para empezar»); Uds↔Cajas (1 caja de agua = 6 uds = 2,52 €); descuento del 5 % de la cerveza bien redondeado (24 × 0,62 − 5 % = 14,14 €); buscador («agua», «vino», sin resultados con mensaje claro); pestañas Histórico/Catálogo con categorías; ♡ favorito se marca, persiste al recargar y se quita.
- ⚠️ F6-1 (a confirmar, datos) «VINO BLANCO VERDEJO 75 CL (CAJA 6)» sale como «Caja de 6 uds» a 21,00 €: el nombre ya dice «caja 6» y además hay «caja de 6». ¿21 € es por botella o por caja? Si es por caja, «1 caja» costaría 126 €.
- ⚠️ F6-2 (baja) En la fila la cerveza figura a 0,62 € pero al añadir 1 ud la barra marca 0,59 € (descuento 5 % del cliente); la fila no indica el descuento, solo el carrito.
- ⚠️ F6-3 (baja) El buscador de la web no tolera erratas («cervesa» → «No hemos encontrado»), mientras que el chat sí («cerbeza»). Inconsistente.
- ℹ️ El ♡ solo existe en `/catalogo` (con cuenta), no en el enlace del chat (`/pedido`), por diseño (comentario en pedido.html:306).

## Tarea 7 (revisar y enviar pedido, doble clic) — sin duplicados; 2 observaciones de textos
Recorrido: añadir 2 artículos → «Ver carrito» (paso 2) → «Elegir el día de entrega» (paso 3) → día «Mañana» → «Confirma tu pedido» → «✓ Confirmar y enviar pedido».
- OK (lo importante): **doble clic rápido en «Confirmar y enviar» = 1 solo POST y 1 solo pedido** (VM-2026-000002, 21,42 €, entrega 2026-11-02). 3 POST directos simultáneos tras enviar → los 3 responden 409 «Este pedido ya se envió». Reabrir el enlace gastado muestra «Este pedido ya se envió · Vuelve al chat para hacer otro pedido». Total del resumen = total guardado. Sin errores de consola ni HTTP ≥ 400.
- ⚠️ F7-1 (media, textos) El paso 3 dice «Toca el día de entrega. **Al tocarlo se envía tu pedido.**» (pedido.html:269), pero al tocar el día se abre otra pantalla «Confirma tu pedido» y el pedido NO se envía hasta pulsar «Confirmar y enviar». El texto es falso y puede hacer creer al cliente que ya ha enviado.
- ⚠️ F7-2 (baja, gramática) «1 uds · AGUA MINERAL…» en el resumen y «1 artículos, total aprox.» en el mensaje de confirmación: falta el singular.
