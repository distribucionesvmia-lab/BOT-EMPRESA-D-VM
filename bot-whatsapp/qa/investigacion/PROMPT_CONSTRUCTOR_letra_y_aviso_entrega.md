# Prompt para el agente constructor — letra del cliente y aviso de entrega «hoy»

Pega todo lo que hay dentro del bloque en el agente constructor.

```text
Trabajas sobre el artefacto «Pedidos por WhatsApp» (https://claude.ai/artifact/5R8CeLCQi6uTPXkzEfsETP, versión actual 1794389456-64de). Es la app de pedidos de Distribuciones Valentín Martín: portada, chat, y un catálogo de pedido (la constante MINI_HTML, que se pinta en un iframe con srcdoc). Haz DOS cambios. No toques nada más: ni los datos de la tarifa y los clientes, ni las reglas de precios, ni el panel de la empresa, ni el diseño que ya está arreglado (botón «+ Añadir» y contador estables, zonas táctiles de 44–48 px, apaisado). Antes de publicar, lee el artefacto actual y parte de él.

═══ CAMBIO 1 · Respetar la letra grande del móvil del cliente (hasta +30 %) con control A− / A+ ═══

Situación actual: al principio del código hay un script que mide la escala de letra del sistema (variable --k) y TODOS los tamaños de letra están escritos como calc(Npx / var(--k,1)). Eso ANULA a propósito la letra grande que el cliente configuró en su móvil. Ya no queremos eso: los clientes mayores necesitan la letra grande.

Qué hacer:
1. Sigue usando la misma técnica (calc(N / var(--k,1))), pero cambia lo que vale --k: el tamaño final de la letra debe ser N × T, donde T es la escala total que queremos aplicar:
   - Modo automático (por defecto): T = min(1.3, k_sistema). Es decir, se respeta la letra del móvil hasta un máximo de +30 %.
   - --k debe valer k_sistema / T. Ejemplos: letra del sistema 1.0 → --k = 1 (se ve normal); 1.15 → --k = 1 (se ve a 1.15); 1.5 → --k ≈ 1.15 (se ve a 1.3, tope); 2.0 → --k ≈ 1.54 (se ve a 1.3, tope).
2. Añade un control «Tamaño de letra» con dos botones A− y A+ (cada uno de al menos 48×48 px, con aria-label «Reducir letra» / «Aumentar letra», y un texto visible con el nivel actual). Niveles: 100 %, 115 % y 130 %. El cliente lo elige y vale por encima del modo automático; debe haber también la opción «Automático» para volver al comportamiento por defecto. Guarda la elección en localStorage dentro de try/catch (si falla, funciona igual sin guardar).
   Colócalo donde se encuentre fácil sin molestar: en el menú ⋮ del chat y en la barra superior del catálogo.
3. IMPORTANTE: el catálogo vive en OTRO documento (iframe con srcdoc, MINI_HTML). El mismo nivel de letra debe aplicarse también allí, y el cambio de A−/A+ debe notarse en el catálogo sin recargar (por ejemplo con postMessage, o reinyectando el valor al abrirlo). Comprueba si sus tamaños de letra usan la misma técnica o van en px fijos y adáptalo.
4. A 130 % no se puede romper nada. Comprueba en 320×568, 360×640, 390×844, 568×320 (apaisado), 768×1024 y 1440×900:
   - sin desbordamiento horizontal;
   - los nombres largos de producto se parten en varias líneas sin cortarse;
   - el botón «+ Añadir», el contador «− 1 +» y el selector Cajas/Uds siguen midiendo al menos 48 px de alto, sin cambiar de tamaño ni de sitio al pulsar;
   - la barra inferior «Ver carrito» no tapa contenido importante y el carrito sigue cabiendo (el botón «Elegir el día de entrega» visible);
   - en apaisado se puede seguir usando el catálogo.
   Si a 130 % algo no cabe, ajusta el diseño (más líneas, menos relleno), NO reduzcas el tope por debajo de 130 %.
5. Respeta prefers-reduced-motion y no añadas animaciones nuevas.

═══ CAMBIO 2 · Aviso de «entrega hoy» según la hora (solo Medina del Campo) ═══

Regla del negocio, tal como la ha dado el dueño:
- Si el cliente es de MEDINA DEL CAMPO y hace el pedido ANTES de las 10:00 (hora de Madrid), mientras hace el pedido le debe salir un aviso que diga: «Si haces el pedido antes de las 10:00, te lo entregamos hoy.»
- A las 10:00 en punto o más tarde (por ejemplo a las 11:00), el aviso NO debe aparecer de ninguna manera. Ya no podemos entregar ese pedido hoy y no se le dice nada al cliente.
- Los clientes de otros municipios nunca ven ese aviso.

Cómo hacerlo:
1. NO inventes reglas nuevas ni dupliques lógica. El artefacto ya tiene la regla de «hoy»: hora de corte 10 (CUTOFF_HOUR), municipio 47085 (código del Excel de clientes) o, si la ficha no trae código, población «Medina del Campo» sin tildes ni mayúsculas, y solo en día laborable (lunes a viernes). Reutiliza esas mismas funciones (puedeHoy del cliente, la hora de Madrid y el día laborable) para decidir si se muestra el aviso. Una sola fuente de verdad: el aviso y la opción «Hoy» del calendario deben decidirse con el mismo código y no pueden contradecirse nunca.
2. El aviso se muestra solo si se cumplen LAS TRES: el cliente es de Medina del Campo; es día laborable; la hora de Madrid es anterior a las 10:00. Si falta una, no se muestra nada (ni hueco vacío).
3. Hora: usa la hora de Madrid (zona horaria Europe/Madrid, con Intl.DateTimeFormat), no la hora «a pelo» del móvil sin zona. Reevalúa cada 30 segundos mientras la pantalla esté abierta: si el cliente empieza a las 9:58 y a las 10:00 todavía está eligiendo productos, el aviso desaparece solo, sin recargar. Y la opción «Hoy» del paso 3 «¿Cuándo quieres recibirlo?» debe desaparecer también en ese momento; si ya estaba elegida cuando se cruza la hora, hay que avisarle con claridad («Ya no llegamos a entregarlo hoy: elige otro día») y no dejarla enviar con «hoy».
4. Dónde se ve:
   a) En el catálogo: una franja discreta y legible bajo la cabecera, en el paso 1 (elegir productos) y en el paso 2 (revisar el pedido). No debe tapar productos ni desplazar el botón «+ Añadir» al aparecer o desaparecer (reserva el espacio o hazlo de forma que no salte el contenido de forma brusca).
   b) En el chat: un único mensaje del asistente al empezar un pedido («Hacer pedido»), con el mismo texto. Si ya son las 10:00 o más, ese mensaje no se muestra.
   Debe tener rol de aviso accesible (aria-live educado o role="status"), contraste suficiente y funcionar con la letra a 130 %.
5. Texto exacto del aviso: «Si haces el pedido antes de las 10:00, te lo entregamos hoy.» (puedes añadir un icono, pero el texto es este). No añadas cuenta atrás ni más mensajes; no pidas nada al cliente.
6. No mostrarlo en la pantalla de acceso, en el panel de la empresa ni al cliente que aún no ha iniciado sesión.

═══ Cómo comprobar antes de dar por terminado ═══

- Con el cliente de prueba «Bar El Ejemplo (ficticio)» (código 9001, municipio 47085; entra con 123456) fuerza la hora y prueba estos casos y apunta el resultado de cada uno:
  1) lunes 09:30 → se ve el aviso en el catálogo y en el chat; la opción «Hoy» aparece en el paso 3;
  2) lunes 09:59:50 → se ve; a los pocos segundos pasa a las 10:00 y el aviso y la opción «Hoy» desaparecen solos;
  3) lunes 10:00 y lunes 11:00 → no se ve el aviso y no hay «Hoy»;
  4) sábado o domingo a las 09:00 → no se ve el aviso;
  5) un cliente que NO sea de Medina del Campo (usa «Tienda Ficticia», cód. 9002, o cambia el municipio) a las 09:30 → no se ve el aviso ni la opción «Hoy».
  Para forzar la hora, añade un parámetro temporal de prueba (por ejemplo #hora=09:30) que NO esté activo para los clientes reales, o simúlalo en tu entorno de prueba; deja el artefacto publicado sin ningún atajo de prueba.
- Letra: prueba los niveles Automático, 100 %, 115 % y 130 % en los seis tamaños de pantalla indicados y confirma los puntos del cambio 1.
- Comprueba también que sigue todo lo anterior intacto: botón y contador estables, zonas táctiles ≥ 44 px, apaisado usable, el pedido se envía y aparece en el panel de la empresa.

Al terminar, dime en pocas líneas: qué cambiaste, qué casos probaste y su resultado (incluye los de la hora), cualquier cosa que no hayas podido cumplir y por qué, y el número de versión publicada. No des nada por hecho sin haberlo probado.
```

## Notas para quien supervisa

- **Mi interpretación de la regla de entrega:** el aviso aparece solo con las tres condiciones (cliente de Medina del Campo, día laborable, antes de las 10:00). A partir de las 10:00 no aparece ningún aviso, tal como pediste. Los fines de semana tampoco, porque el reparto es de lunes a viernes (así lo hace ya la opción «Hoy» del calendario).
- **Letra:** modo automático hasta +30 % del móvil del cliente y control A− / A+ con 100 %, 115 % y 130 %.
- **Después de que el constructor lo publique,** dime y vuelvo a medir en los 9 tamaños y a probar las horas, igual que con M-01 / M-02 / M-03.
