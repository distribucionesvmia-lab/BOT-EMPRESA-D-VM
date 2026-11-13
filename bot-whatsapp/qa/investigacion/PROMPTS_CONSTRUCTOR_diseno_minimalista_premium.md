# Prompts para el agente constructor — diseño minimalista premium (estilo Apple) de la parte del cliente

**Cómo usarlos**
1. Adjunta siempre la imagen `maqueta_minimalista_apple.png` (está en esta misma carpeta) como referencia visual.
2. Pega primero la **CABECERA COMÚN** y justo debajo **un** prompt (1, 2, 3, 4, 5 o 6). Hazlos **en orden** y publica una versión después de cada uno.
3. Al terminar cada uno, el constructor te da su informe; pásamelo y lo mido en 9 tamaños de pantalla antes de pasar al siguiente.

**Qué significa «estilo Apple» aquí:** principios de diseño (simplicidad, jerarquía clara, mucho aire, un solo color de acento, fotografía protagonista, movimiento suave y con propósito), **no** copiar logos, iconos ni imágenes de Apple. Todo el contenido es de Valentín.

**Qué NO cambia en ningún prompt:** datos de tarifa y clientes, precios, descuentos, IVA, reglas de entrega (hoy solo Medina del Campo antes de las 10:00), el aviso de «entrega hoy», el pedido fijo, los recordatorios, el panel de la empresa, la letra A−/A+ (hasta +30 %) y lo ya arreglado (botón y contador estables, zonas táctiles ≥ 44 px, apaisado usable).

---

## CABECERA COMÚN (pégala antes de cada prompt)

```text
Trabajas sobre el artefacto «Pedidos por WhatsApp» (https://claude.ai/artifact/5R8CeLCQi6uTPXkzEfsETP): app de pedidos de Distribuciones Valentín Martín, con acceso, chat y un catálogo de pedido (MINI_HTML, en un iframe con srcdoc), más el panel de la empresa. Estamos rediseñando SOLO la parte del cliente con un estilo minimalista y premium, inspirado en los principios de diseño de Apple. Te adjunto una maqueta como referencia visual: sigue su dirección, no copies sus datos de ejemplo.

REGLAS GENERALES
- Lee primero la versión publicada actual y parte de ella. Publica una versión al terminar y dime su número. Si algo falla, no publiques: dímelo.
- No cambies datos (tarifa, clientes), precios, descuentos, IVA, reglas de entrega ni el panel de la empresa. No quites ninguna función existente: se rediseña su aspecto y su sitio, no se elimina. Si una función no tiene sitio claro en el nuevo diseño, déjala accesible y dímelo.
- Un solo color de acento: el rojo de Valentín (#C8102E), solo para la acción principal, el estado activo y detalles puntuales. El resto es neutro. Los avisos usan verde (correcto) o ámbar (atención); el rojo no se usa como color de error en texto pequeño.
- Toda zona pulsable mide al menos 44×44 px. Todo texto cumple contraste AA (4,5:1; 3:1 en texto grande).
- Respeta la letra del cliente (A−/A+, hasta +30 %) usando unidades relativas; nada puede romperse a 130 %.
- Respeta prefers-reduced-motion (cambia deslizamientos y muelles por fundidos cortos), prefers-reduced-transparency (superficies sólidas, sin desenfoque) y prefers-contrast: more (bordes definidos).
- No añadas librerías externas ni fuentes web: usa la fuente del sistema. Iconos como SVG propios en línea (trazo 1,8 px, estilo lineal), nunca emojis.
- Nada de lo nuevo puede desbordar ni cortar texto en 320×568, 360×640, 390×844, 568×320 (apaisado), 768×1024, 1024×768 y 1440×900.
- Si falta un dato que no puedes deducir del artefacto, NO lo inventes: deja la función oculta y dímelo.

AL TERMINAR dime: qué cambiaste, qué probaste (por tamaño de pantalla) y el resultado, lo que no pudiste cumplir y por qué, y el número de versión publicada. No des nada por hecho sin haberlo probado.
```

---

## PROMPT 1 · Sistema de diseño y cabecera (base de todo)

```text
OBJETIVO: crear el sistema de diseño minimalista y aplicarlo a las pantallas de acceso, chat y catálogo (solo aspecto: colores, tipografía, espacios, cabecera y botones). La estructura de pantallas no cambia en este prompt.

1. TOKENS (variables CSS en :root, y las mismas dentro del iframe del catálogo)
   Color: fondo de la app #F5F5F7; superficie/tarjeta #FFFFFF; texto #1D1D1F; texto secundario #6E6E73; relleno suave #F2F2F7; línea fina #E5E5EA; acento #C8102E; acento suave #FBEAED; correcto #1D7A45 sobre #E8F5EC; atención #9A6B00 sobre #FFF4DB.
   Tipografía: pila del sistema: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, system-ui, sans-serif. Pesos solo 400, 600 y 700. Escala base 17 px para cuerpo (multiplicada por la escala A−/A+ ya existente): Título grande 34/1.1 peso 700 interletrado −0,022 em · Título de sección 22/1.2 peso 700 −0,015 em · Título de tarjeta 20/1.2 peso 700 −0,015 em · Nombre de producto 17/1.2 peso 600 −0,01 em · Cuerpo 17/1.4 peso 400 · Secundario 15/1.35 · Pie/etiqueta 13/1.3 · Micro 11,5/1.2 en mayúsculas con +0,04 em. Cifras con font-variant-numeric: tabular-nums en precios y cantidades. El interletrado es negativo en tamaños grandes y neutro o ligeramente positivo en pequeños; nunca un valor único.
   Espaciado: múltiplos de 4 (4, 8, 12, 16, 20, 24, 32, 40). Margen lateral de pantalla 20 px.
   Radios: tarjetas y agrupaciones 20 px; imágenes de producto 14 px; botones, chips y contador: píldora (999 px); campos de texto 12 px.
   Sombras: ninguna por defecto; separar con color de fondo y líneas finas de 0,5–1 px. Solo el botón flotante del carrito lleva una sombra suave.
   Movimiento: pulsar = escala 0,97 en 100 ms desde el instante de pulsar; transiciones normales 250 ms con curva cubic-bezier(.2,.8,.2,1); nada dura más de 400 ms.
   Materiales: barras fijas (cabecera al hacer scroll, barra de pestañas, barra de pedido) con fondo rgba(255,255,255,.78), backdrop-filter: blur(22px) saturate(180%) y línea superior/inferior de 0,5 px rgba(0,0,0,.14); con prefers-reduced-transparency, fondo sólido.

2. CABECERA Y MARCO
   - Quita la barra verde «Cerrar · Catálogo de pedido» y la cabecera roja a pantalla completa.
   - Nueva cabecera ligera sobre fondo #F5F5F7: logo de Valentín dentro de una pastilla roja pequeña (alto 34 px) a la izquierda; a la derecha botones circulares blancos de 44 px (letra Aa, ayuda). «Cerrar» pasa a ser un botón circular con una X en la misma fila.
   - Título de pantalla en «título grande» (34 px) que, al hacer scroll, se reduce a un título de 17 px centrado en la barra translúcida.
   - El contador del carrito se muestra con un círculo rojo pequeño sobre el icono, no como botón rojo grande.

3. COMPONENTES BASE
   - Botón principal: píldora roja, alto 50, texto blanco 17/600. Secundario: píldora con fondo acento suave y texto rojo. Terciario: texto rojo sin fondo.
   - Chips y filtros: píldora de alto 44, fondo blanco, texto 15/500; activo: fondo #1D1D1F y texto blanco.
   - Campos: fondo rgba(118,118,128,.12), radio 12, alto 44–52, sin borde; foco con anillo de 3 px en acento suave.
   - Agrupaciones tipo «lista inset»: un contenedor blanco de radio 20 con filas separadas por línea fina de 0,5 px que empieza a la altura del texto, no del borde.
   - Elimina el aspecto de botón 3D (sombras duras, degradados marcados) y los marcos de color alrededor de las fotos.

4. ACCESO Y CHAT (solo aspecto)
   - Acceso: fondo claro, logo grande centrado, título «Bienvenido», campos y un botón rojo en píldora; sin fondo rojo a pantalla completa.
   - Chat: burbujas recibidas #F2F2F7 con texto oscuro; enviadas con el acento y texto blanco; radio 20 con la esquina cercana a 6; cabecera ligera como en el punto 2; atajos como chips blancos.

5. COMPRUEBA: contraste AA en textos y botones; a 130 % de letra nada se corta; reduced-motion y reduced-transparency; capturas antes y después en los 7 tamaños; el catálogo (iframe) usa los mismos tokens.
```

---

## PROMPT 2 · Tarjeta de producto de una fila y nombres limpios

```text
OBJETIVO: sustituir la tarjeta de producto actual (216 px, dos filas) por una fila compacta y limpiar los nombres. Se ven al menos 5 productos por pantalla en 390×844.

1. FILA DE PRODUCTO (lista «inset»: todos los productos de una categoría dentro de un único contenedor blanco de radio 20, separados por líneas finas)
   - Altura de fila ≤ 104 px en 390 px de ancho. Izquierda: baldosa de 72×72 (radio 14, fondo #F2F2F7) con la foto en object-fit: contain y sin marcos de color. Centro: marca (micro 11,5 px, mayúsculas, gris), nombre (17/600, máximo 2 líneas), línea secundaria (13 px gris: «Caja de 35 · 10,71 €»), precio (17/600 con «/ud» en 13 px gris). Derecha: acción.
   - Acción: botón circular «+» de 44 px rojo. Al pulsarlo se convierte, en el MISMO sitio y con la misma altura, en un contador en píldora «− 2 +» (animación de 250 ms; respeta reduced-motion). La fila NO cambia de alto ni mueve las demás. Al bajar a 0 vuelve el «+». Pulsar el número abre el teclado numérico (inputmode="numeric", sin ceros ni negativos, máximo 999).
   - Si el artículo se vende en cajas y en unidades, un selector «Caja | Ud» en píldora pequeña (alto visual 32, zona pulsable 44) bajo el precio, siempre en el mismo sitio. Si solo se vende en cajas, no hay botón: aparece la etiqueta de texto «Solo cajas» en la línea secundaria. Si solo en unidades, nada.
   - El corazón de favoritos pasa a un icono de 44 px en la esquina superior derecha de la baldosa de foto (no encima del nombre).
   - Etiqueta «Lo compras» como micro-etiqueta gris junto a la línea secundaria, si el cliente ya lo compra.

2. PRECIOS: dos decimales siempre («2,80 €»), salvo cuando el precio unitario sea menor de 1 € y el tercer decimal no sea cero, que se muestran tres («0,306 €»). Cifras tabulares. No cambia ningún importe real, solo cómo se muestra.

3. NOMBRES LIMPIOS (solo presentación; el nombre original se conserva, se sigue pudiendo buscar por él y se muestra completo en el detalle)
   - Convertir a minúsculas con inicial mayúscula («COPA AGUA VESUBIO 23 CL.VALENCIA-VICRIL.» → «Copa agua Vesubio 23 cl»). Mantener en mayúsculas siglas conocidas (PET, IVA, ES, UHT) y poner unidades en minúscula (cl, ml, l → «L» para litros, kg, g).
   - Quitar puntos finales, comillas sueltas y espacios dobles; «" 12 " LITROS» → «12 L»; separar con espacio los puntos pegados («23 CL.VALENCIA» → «23 cl · Valencia»).
   - La marca se muestra aparte (micro-etiqueta sobre el nombre). Úsala del campo subcategoría de la tarifa cuando es una marca, o del primer término del nombre si coincide con una lista de marcas conocidas que deduzcas de los datos. Si no estás seguro, no pongas marca.
   - Mantén una tabla de excepciones editable (nombre original → nombre limpio) para los casos que las reglas no resuelvan.
   - Entrégame un listado de 40 ejemplos «antes → después» de categorías distintas y el número total de nombres que han cambiado, para que yo lo revise. No publiques si más del 5 % de tus ejemplos quedan peor que el original.

4. LISTA DE CATEGORÍAS: tarjetas de 2 columnas, baldosa blanca de radio 20 con el nombre (17/600) y el número de productos (13 gris); sin foto de un producto cualquiera como portada: usa un icono lineal SVG de 28 px por categoría.

5. COMPRUEBA: en 390×844 se ven ≥ 5 productos; pulsar «+» no mueve nada (mide la posición de la fila siguiente antes y después); 130 % de letra: los nombres largos pasan a 2 líneas sin cortar; zonas pulsables ≥ 44 px; reduced-motion.
```

---

## PROMPT 3 · Navegación inferior, buscador y carrito flotante

```text
OBJETIVO: sustituir el «Paso 1 de 3», las pestañas Histórico/Catálogo de la parte alta y las migas de pan por una navegación inferior de 5 pestañas, un buscador siempre visible y un carrito flotante. Las funciones existentes se reubican; no se elimina ninguna.

1. BARRA DE PESTAÑAS INFERIOR (fija, material translúcido del Prompt 1, 5 pestañas, icono lineal SVG de 24 px + etiqueta de 11,5 px, alto táctil ≥ 48 px, activa en acento y las demás en #8E8E93, aria-current="page")
   Inicio · Catálogo · Pedido (con globo rojo con el número de artículos) · Mis pedidos · Ayuda.
   - Inicio: la pantalla nueva del Prompt 4 (hasta entonces, una pantalla provisional con el saludo y «Tu pedido de siempre» si ya existe).
   - Catálogo: categorías y listas de productos.
   - Pedido: el carrito actual (paso 2) y el día de entrega.
   - Mis pedidos: último pedido, histórico, «Modificar pedido», pedido fijo («Mi pedido fijo») y favoritos.
   - Ayuda: el botón de ayuda actual (llamar / WhatsApp / horario) y, debajo, «Ajustes de pantalla» con el control de letra A−/A+/Automático.
   El botón «Aa» de la cabecera sigue abriendo el control de letra directamente.

2. TÍTULOS Y NAVEGACIÓN INTERNA: cada pestaña lleva su título grande (34 px). Dentro de una categoría: botón «‹ Catálogo» (chevrón + texto, 44 px) arriba a la izquierda, en lugar de las migas de pan; el título pasa a ser el nombre de la categoría.

3. BUSCADOR: campo con lupa (fondo gris translúcido, 44 px) pegado bajo el título, siempre visible en Catálogo y Mis pedidos. Busca en TODO el catálogo desde cualquier categoría, con sugerencias desde la primera letra (hasta 6, con miniatura, precio y el botón «+»), tolerante a una errata de una letra en palabras de 5 o más letras y sin distinguir tildes ni mayúsculas. Búsquedas recientes (las últimas 5, por dispositivo) cuando está vacío. Filtros en chips bajo el buscador (marca, «Solo cajas»), quitables con un toque, mostrando el número de resultados. Sin resultados: mensaje claro y botón «Hablar con una persona».

4. CARRITO FLOTANTE: cuando hay algo en el pedido, una píldora roja de alto 54 flotando sobre la barra de pestañas con «N artículos · total sin IVA» a la izquierda y «Ver pedido» a la derecha; sombra suave; no tapa contenido (reserva espacio al final de la lista). Con el pedido vacío no aparece. Se anuncia con role="status" cuando cambia.

5. COMPORTAMIENTO: al cambiar de pestaña se conserva la posición de scroll y el pedido en curso; el botón «atrás» del móvil vuelve a la pestaña anterior sin salir de la app; el aviso «Quitado · Deshacer» se coloca sobre el carrito flotante.

6. COMPRUEBA: las 5 pestañas caben y se leen en 320 px (etiquetas sin cortar, también a 130 % de letra); en apaisado la barra es más baja y las etiquetas van al lado del icono; ninguna función ha desaparecido (haz una lista de dónde está cada una); zonas ≥ 44 px; navegación con teclado.
```

---

## PROMPT 4 · Pantalla de Inicio y pedido en una sola pantalla

```text
OBJETIVO: crear la pantalla «Inicio» y unir carrito + entrega + confirmación en una única pantalla «Pedido». Mantén todas las reglas de negocio existentes.

1. INICIO (primera pestaña; título grande «Buenos días» / «Buenas tardes» / «Buenas noches» según la hora de Madrid y, debajo, el nombre comercial del cliente en gris)
   - Aviso de entrega «hoy»: solo si procede con la regla existente (cliente de Medina del Campo, día laborable, antes de las 10:00). Píldora verde suave: «Pide antes de las 10:00 y te lo entregamos hoy». Desaparece sola a las 10:00. Si no procede, no hay nada ni hueco.
   - Tarjeta «Tu pedido de siempre» (solo si hay pedido anterior): título 20/700, línea «Martes 3 nov · 12 artículos», una fila de miniaturas solapadas (máx. 4 + «+N»), «Total con IVA» y el importe grande (26/700), botón principal «Repetir y revisar» y debajo botón suave «Repetir cada martes» (pedido fijo existente). «Repetir y revisar» carga el pedido con precios de hoy y abre la pantalla Pedido; nunca envía nada.
   - Si hoy toca el pedido fijo del cliente, una tarjeta «Hoy toca tu pedido de los martes» con «Revisar y enviar» por encima de todo.
   - «Lo que sueles pedir»: fila horizontal de tarjetas (148 px de ancho: foto, nombre, precio, botón «+»), con «Ver todo».
   - Tarjeta del comercial (solo si hay teléfono/horario configurados para la Ayuda): iniciales o foto, nombre, horario y botón circular de llamar.
   - Categorías como chips (nombres, sin emojis).
   - Cliente sin historial: en lugar de «Tu pedido de siempre», una tarjeta «Empieza tu primer pedido» con botón «Ver catálogo» y «Lo más pedido» (solo nombres de artículos, nunca de otros clientes).

2. PEDIDO EN UNA SOLA PANTALLA (pestaña Pedido; desaparece el paso aparte «¿Cuándo quieres recibirlo?»)
   - Título «Tu pedido» con «Vaciar» en texto rojo a la derecha. Lista inset con las líneas: foto de 52, nombre limpio, «2 cajas · 70 uds», importe a la derecha; tocar la línea abre el contador y la observación; deslizar a la izquierda (o botón) para quitar con «Quitado: X · Deshacer» durante 8 s.
   - Sección «Entrega»: dirección en gris y fila horizontal de chips de día (alto 64): Hoy (solo si procede, con la regla de las 10:00; si ya no procede, no aparece), Mañana, y los siguientes días de servicio, más «Otro día» (calendario existente). Seleccionado: fondo oscuro. Si el cliente estaba en «Hoy» y pasan las 10:00, se avisa con claridad y se deselecciona.
   - Barra de «Portes gratis / pedido mínimo»: SOLO si existe esa regla en el artefacto; si no existe, no la pongas ni la inventes.
   - Resumen: base, IVA y total, con el mismo cálculo y las mismas reglas que ahora (no cambies ningún importe ni cuándo se calcula el IVA; si hoy el IVA se muestra al elegir el día, mantén ese comportamiento).
   - Botón fijo inferior (material translúcido): «Confirmar pedido · 169,91 €» y debajo, en gris, «Puedes modificarlo hasta las 10:00 del martes» con la hora límite de edición ya implementada.
   - Pantalla de confirmación: marca de verificación grande que se dibuja en 400 ms (estática con reduced-motion), «Pedido recibido», la referencia (VM-…), el resumen, la fecha de entrega y los botones «Ver pedido» y «Volver al inicio».

3. COMPRUEBA: recorrido completo repetir pedido → revisar → elegir día → confirmar; que el pedido llega al panel de la empresa igual que antes (mismos importes y referencia); casos de hora (9:30, 9:59→10:00, 11:00, sábado) para el aviso y la opción «Hoy»; cliente sin historial; 130 % de letra; 7 tamaños de pantalla.
```

---

## PROMPT 5 · Fotos, micro-interacciones y estados vacíos

```text
OBJETIVO: que las fotos se vean nítidas y cuidadas aunque algunas sean pequeñas, que el movimiento dé confirmación sin llamar la atención y que ningún estado vacío quede en blanco.

1. FOTOS
   - Todas las baldosas de producto: cuadradas 1:1, fondo #F2F2F7, foto con object-fit: contain y un margen interior para que el producto ocupe el 80–85 % del marco. Sin marcos de color ni anillos.
   - NO estires las fotos pequeñas: si una foto mide menos de 160 px de lado, muéstrala a su tamaño natural (o como mucho ×1,5) centrada en la baldosa en lugar de ampliarla a 72–88 px; así no se ve borrosa.
   - Fotos marcadas como generadas con IA (lista __VM_FOTOS_IA__): micro-etiqueta «Imagen orientativa» en la esquina inferior de la baldosa.
   - Carga bajo demanda: saca las fotos incrustadas de la página (hoy 14 MB de base64) y cárgalas por categoría solo cuando se abre esa categoría, en paquetes por categoría (un artefacto admite como máximo 511 archivos, así que un archivo por categoría, no por foto). Mientras llegan, baldosa neutra y fundido de 200 ms al aparecer (sin animaciones de destello).
   - Meta: la página inicial (sin fotos) debe abrir en menos de 3 s con buena cobertura. Dime el peso antes y después.
   - ENTRÉGAME un listado (CSV) de los artículos cuya foto mide 200 px o menos de lado: código, nombre, categoría y tamaño actual, para que yo busque fotos mejores. No sustituyas ninguna foto tú.

2. MICRO-INTERACCIONES (todas ≤ 400 ms, curva suave, sin rebote salvo tras un gesto con inercia; con prefers-reduced-motion pasan a fundido breve o a nada)
   - «+» → contador: el círculo se ensancha hasta la píldora en 250 ms.
   - El globo del carrito de la barra de pestañas da un pequeño pulso (escala 1 → 1,15 → 1) al añadir.
   - Pulsar cualquier botón: escala 0,97 al instante de tocar.
   - Hoja inferior (selector de ayuda, observaciones): sube desde abajo y se cierra deslizando hacia abajo, siguiendo el dedo 1:1 y pudiéndose interrumpir.
   - Confirmación del pedido: el check se dibuja.
   - Vibración suave opcional (navigator.vibrate(8)) solo al añadir y al confirmar, y nunca con reduced-motion.

3. ESTADOS VACÍOS Y DE ERROR (icono lineal SVG de 48 px en gris, un título de 20/700, una frase de 15 px gris y UN botón)
   - Histórico vacío: «Aún no tienes pedidos» + «Ver catálogo».
   - Sin resultados de búsqueda: «No encontramos “…”» + «Quitar filtros» y «Hablar con una persona».
   - Pedido vacío: «Tu pedido está vacío» + «Ver catálogo».
   - Sin conexión: «Sin conexión. Tu pedido está guardado en este móvil» + «Reintentar».
   - Error al enviar: frase clara y «Reintentar»; el pedido no se pierde.

4. COMPRUEBA: ninguna foto se ve estirada; el contador no mueve nada; con reduced-motion no hay movimiento; peso y tiempo de apertura antes/después; el CSV de fotos pequeñas me llega completo.
```

---

## PROMPT 6 · Escritorio, modo oscuro y accesibilidad

```text
OBJETIVO: que en ordenador y tablet no sea un móvil estirado, añadir modo oscuro opcional y repasar la accesibilidad.

1. ESCRITORIO Y TABLET (≥ 1024 px)
   - Dos columnas: izquierda el catálogo en rejilla de 2 columnas (3 desde 1440 px) con tarjetas cuadradas (foto grande en baldosa, marca, nombre, formato, precio y «+»/contador); derecha un panel fijo «Tu pedido» de 340 px con las líneas, el selector de día, el resumen y el botón «Confirmar pedido». El carrito flotante y la pestaña Pedido desaparecen en este ancho.
   - La barra de pestañas pasa a barra lateral izquierda de 220 px con las mismas 5 secciones.
   - Entre 768 y 1023 px: una columna ancha máx. 720 px centrada, con barra de pestañas inferior.
   - Teclado: «/» enfoca el buscador; flechas arriba/abajo recorren resultados; Intro añade el producto resaltado; «+» y «−» cambian la cantidad con el foco en la fila; Esc cierra hojas y sugerencias. Foco visible (anillo de 3 px) y orden de tabulación lógico.

2. MODO OSCURO OPCIONAL (en Ayuda → Ajustes de pantalla: Automático / Claro / Oscuro; por defecto Automático = prefers-color-scheme)
   - Tokens oscuros: fondo #000000; superficie #1C1C1E; relleno #2C2C2E; línea #38383A; texto #F5F5F7; secundario #98989F; acento #FF4D63 (más claro para mantener el contraste); verde #30D158; ámbar #FFD60A.
   - Las fotos de producto van sobre baldosa clara (#F2F2F7) también en modo oscuro para que no se vean recortadas. Comprueba contraste AA en todo.
   - Nada de transiciones bruscas de brillo: el cambio de tema se hace en 250 ms.

3. ACCESIBILIDAD: lector de pantalla (etiquetas con el nombre del producto en «Quitar …», «Añadir …»; la cantidad anunciada al cambiar; avisos con role="status"); orden de foco; contraste; mensajes de error junto al campo, no solo al enviar; objetivos ≥ 44 px; prefers-reduced-motion, prefers-reduced-transparency y prefers-contrast: more funcionando; texto hasta 130 % sin desbordes y sin perder funciones.

4. RENDIMIENTO: informa del peso total y del tiempo hasta poder pulsar con red lenta simulada (Fast 3G / 4G) antes y después de los seis prompts; objetivo < 3 s en 4G.

5. COMPRUEBA: 1024×768, 1440×900 y 1920×1080 (dos y tres columnas, panel lateral fijo, sin huecos enormes); modo oscuro en todas las pantallas; recorrido completo con solo teclado; los 7 tamaños de móvil siguen igual que tras el Prompt 5.
```

---

## Qué pasa después de cada prompt
- Me pasas el informe del constructor y su número de versión.
- Yo mido la versión publicada en los 9 tamaños (desbordes, zonas táctiles, altura de tarjetas, apaisado, letra al 130 %), la comparo con la maqueta y te digo qué ajustar antes del siguiente prompt.
