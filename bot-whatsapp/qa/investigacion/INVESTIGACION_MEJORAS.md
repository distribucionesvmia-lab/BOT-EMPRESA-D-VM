# Investigación de mejoras de la app de pedidos — documento vivo

**Qué es:** investigación continua para que al cliente le sea fácil, rápido y cómodo pedir, y para vender mejor.
**Cómo se trabaja:** yo investigo, mido y propongo; tú decides. Cada propuesta tiene un código y un estado (tabla de seguimiento, sección 5). Nada se cambia en la app sin tu «aplícalo».
**Última actualización:** 13-nov-2026 · **Ronda:** 1 (con verificación de tus arreglos)

---

## 1. Qué se ha analizado (y qué no)

- **Versión analizada:** el artefacto de Claude **«Pedidos por WhatsApp»** (versión `1794350748-e111`, actualizada el 10-nov-2026). Es la versión que tú das por buena.
- **Cómo:** descargué el artefacto, lo abrí en un navegador automático con el cliente de prueba («Bar El Ejemplo (ficticio)»), y recorrí portada → chat → catálogo → lista de productos → carrito → día de entrega, en **9 tamaños de pantalla**. Capturas y medidas automáticas.
- **No he podido comprobar:** un móvil real (Samsung/iPhone), la escala de letra del sistema, la velocidad con mala cobertura, ni el panel de empresa. Lo marco abajo como «por medir».
- **Un aviso sobre mi trabajo anterior:** mis medidas de los días 1–5 de noviembre eran de una copia antigua del código del repositorio (65 cambios por detrás de la rama principal). **Ya no valen**; todo lo de este documento sale del artefacto actual.
- El artefacto incluye la tarifa completa y clientes reales; **no se sube a git** (solo los scripts de medición).

## 2. Medición en 9 tamaños de pantalla (artefacto actual)

| Pantalla | Tipo | Ancho del botón «+ Añadir» | Alto útil para productos* | Desborde horizontal |
|---|---|---|---|---|
| 320×568 | móvil muy pequeño | 138–258 px | 404 px | ninguno |
| 360×640 | Android típico | 178–298 px | 476 px | ninguno |
| 375×667 | iPhone SE | 193–313 px | 503 px | ninguno |
| 390×844 | iPhone 14 | 208–328 px | 477 px | ninguno |
| 412×915 | Android grande | 230–350 px | 596 px | ninguno |
| **568×320** | **móvil apaisado** | 108 px | **82 px** (carrito: **0 px**) | ninguno |
| 768×1024 | tablet | 108 px | 687 px | ninguno |
| 1024×768 | tablet apaisada | 108 px | 431 px | ninguno |
| 1440×900 | portátil | 108 px | 563 px | ninguno |

\* Alto de pantalla menos la cabecera fija y la barra inferior «Ver carrito». Alto del botón «+ Añadir»: 46 px en todos. Sin errores de JavaScript en ningún tamaño.

**Lo que está bien:** nada se sale de la pantalla en ningún tamaño; el alto de los botones principales es constante (46–58 px); las fotos de producto y las tarjetas de categoría se ven limpias; la pantalla del carrito y la del día de entrega son claras; el aviso «Después podrás revisar el pedido y confirmarlo» ya está corregido.

> **Actualización 11-nov (versión `1794389456-64de`):** M-02 **hecho y verificado**, M-03 **hecho en la lista**, M-01 **mejorado** (apaisado: 100 px útiles en la lista y 159 en el carrito, antes 82 y 0). Quedan N-01 y N-02 (nuevos), M-04…M-09 sin cambios. Los textos de la tabla describen el problema original.

## 3. Hallazgos de diseño (lo que hace que botones y pantallas «se muevan» o cuesten)

| Código | Hallazgo | Evidencia | Gravedad |
|---|---|---|---|
| **M-01** | **En móvil apaisado el catálogo es casi inutilizable.** La cabecera y la barra «Ver carrito» ocupan ~80 % de los 320 px de alto: solo se ve una franja del primer producto, y en el carrito no queda sitio para nada. | 568×320: 82 px útiles en lista, 0 px en carrito (captura `b-568x320-lista`) | Alta |
| **M-02** | **El botón «+ Añadir» cambia de tamaño y de forma.** En la misma pantalla mide 138 px si el artículo tiene selector Cajas/Uds y 258 px si no; y al pulsarlo se convierte en un contador «− 1 +» que ocupa todo el ancho y **estira la tarjeta**, así que el contenido de debajo salta. En tablet y portátil mide 108 px fijos. | Capturas 320, 390 y 1440 de la lista | Media-Alta (es justo lo que te preocupa) |
| **M-03** | **Zonas táctiles pequeñas.** Corazón de favorito 30×30 px, selector Cajas/Uds 61×34 px, pestañas Histórico/Catálogo 40–42 px de alto. Apple recomienda 44 px, Google 48 px; WCAG 2.2 exige 24 px (AA) y recomienda 44 (AAA). Los dueños de bar suelen tener las manos ocupadas o mojadas y algunos son mayores. | Medida automática en los 9 tamaños | Media |
| **M-04** | **Ordenador: mucho vacío y pocos productos a la vez.** Una sola columna de 860 px: el nombre y el botón quedan separados por ~500 px vacíos y solo caben ~3 productos por pantalla. Quien pide desde el PC de la barra no puede ir rápido. | Captura 1440×900 | Media |
| **M-05** | **La letra del sistema se anula a propósito.** El código mide la escala de letra del móvil y divide todos los tamaños para que «se vea igual que en iPhone». Quien tiene la letra grande por necesidad (vista cansada) **no la ve grande en tu app**. Es decisión de diseño, no un error, pero choca con la accesibilidad (WCAG 1.4.4). | Comentario y script al inicio del código del artefacto | Media — **decisión tuya** |
| **M-06** | **Peso de la página: 10,4 MB.** De ellos ~10 MB son la tarifa embebida. Con mala cobertura (bares en sótanos, pueblos) puede tardar mucho en abrir. | Tamaño de `index.html` | Por medir con red lenta |
| **M-07** | **Dos botones «Hacer pedido» a la vez** en la misma pantalla del chat (el de la tarjeta y el atajo de abajo): redundante. | Captura del chat | Baja |
| **M-08** | **Precio de la caja no visible en la fila.** Se ve «0,306 €» y «Caja de 35 uds», pero el precio de la caja (10,71 €) solo aparece en el carrito. Precios con 3 decimales mezclados con totales de 2. | Capturas lista y carrito | Baja-Media |
| **M-09** | **Cabecera de altura variable.** Ocupa 44 px en 320×568 y 247 px en 390×844 (cuando el contenido de arriba se expande), lo que cambia cuánto producto se ve sin que el cliente haga nada. | Medida automática | Baja — a verificar |

## 4. Ideas de funcionalidades y de venta

Cada una indica de dónde sale. **Ojo con las fuentes:** casi todas son blogs de fabricantes de software; sus porcentajes de mejora no están verificados y **no los doy por buenos**. Lo que sí es consistente entre fuentes son los patrones.

| Código | Idea | Por qué | Impacto | Esfuerzo |
|---|---|---|---|---|
| **F-01** | **Pedido rápido escribiendo o pegando una lista** («6 aguas, 2 cerveza, 1 caja de patatas»), con vista previa antes de añadir. El chat ya lo entiende; falta en el catálogo. | Los formularios de pedido rápido (pegar SKU + cantidad, vista previa, avisos de línea desconocida) son el patrón más repetido en B2B. | Alto | Medio |
| **F-02** | **«Tu pedido de siempre» en la portada**, con las líneas visibles y botón «Repetir y revisar». | Reordenar rápido es «la función de más valor» en B2B; Sysco permite duplicar un pedido y editarlo antes de enviar. | Alto | Bajo |
| **F-03** | **Listas guardadas con nombre** («Lunes», «Fin de semana», «Evento»). | Sysco (guías personalizadas) y otras tiendas B2B ofrecen listas con nombre y «añadir todo». | Medio | Medio |
| **F-04** | **«¿Te falta algo?»**: antes de enviar, sugerir lo que suele pedir y esta vez no lleva. | Sysco avisa de artículos habituales olvidados al hacer el pedido. | Alto | Medio |
| **F-05** | **Hora límite visible** («pide antes de las 14:00 para recibirlo mañana»), **mínimo de pedido** y **agotado con alternativa**. | Mostrar mínimos y formatos al momento evita llamadas; un cliente de Sysco dejó la plataforma por artículos que faltaban. | Medio | Medio |
| **F-06** | **Funcionar con poca cobertura**: guardar el carrito en el móvil, reintentar al volver la red, y poder instalar la app como icono en el móvil. | Cubre M-06; hosteleros con mala señal. | Alto | Medio |
| **F-07** | **Vista de escritorio en tabla** (código, producto, precio, cantidad) navegable con teclado. | Cubre M-04. | Medio | Medio |
| **F-08** | **Tamaño de letra elegible por el cliente** (A− / A+) en vez de anularlo en silencio. | Cubre M-05. | Medio | Bajo |
| **F-09** | **Mensaje de WhatsApp tras el pedido** con referencia, resumen y estado (preparado / en reparto). | WhatsApp es el canal que ya usan; las plantillas de WhatsApp tienen coste por mensaje, hay que valorarlo. | Medio | Medio |
| **F-10** | **Pedir por audio o foto de la lista de papel** en WhatsApp. | Hay bots que interpretan texto y audio contra el catálogo; encaja con clientes mayores. Requiere comprobar coste, privacidad y errores. | Alto | Alto |
| **F-11** | **Ofertas y novedades** («oferta de la semana», «quien pide esta cerveza suele pedir esto»). | Es venta cruzada clásica; necesito saber qué ofertas manejáis. | Medio | Medio |
| **F-12** | **Escáner de código de barras** para reponer lo que se acaba. | Existe en Sysco y Europastry; solo si la tarifa trae los EAN. | Bajo-Medio | Alto |
| **F-13** | **Pedido asistido**: el comercial deja un borrador y el cliente solo confirma. | Usado por distribuidores que reciben pedidos por teléfono. | Medio | Medio |
| **F-14** | **Medir el uso** (frecuencia de repetición, carritos abandonados, tiempo hasta pedir) para saber qué cambios funcionan. | Varias fuentes insisten en medir la repetición de compra; sin datos no hay seguimiento real. | Alto (para decidir) | Bajo-Medio |

### Reglas de diseño que propongo para que nada se «distorsione» (M-02, M-03, M-01)

1. **Objetivo táctil mínimo de 48 px** en todo lo pulsable (corazón, selector Cajas/Uds, pestañas) y 8 px de separación.
2. **Botones con tamaño propio, no estirados**: ancho fijo o con máximo, el mismo en móvil y en PC.
3. **Un solo componente antes y después de pulsar «Añadir»**: el contador aparece en el mismo sitio y con la misma altura que el botón, sin mover la tarjeta.
4. **Cabecera compacta en apaisado y pantallas bajas** (una línea) y barra inferior más fina, para dejar al menos la mitad de la pantalla a los productos.
5. **Letra que respete la preferencia del usuario hasta un límite razonable** (por ejemplo hasta +30 %) y un control A−/A+.
6. **Probar siempre en la matriz de 9 tamaños** con los scripts de esta carpeta, más al menos un móvil real antes de dar un cambio por bueno.

## 5. Seguimiento (tu panel de control)

Estados: **Propuesta** → **Aprobada** (tú dices sí) → **En curso** → **Hecha** (medida de nuevo) · **Descartada**.

| Código | Resumen | Impacto | Esfuerzo | Estado | Notas |
|---|---|---|---|---|---|
| M-01 | Catálogo usable en apaisado | Alto | Bajo | **Mejorada** (11-nov) | Apaisado: lista 82 → 100 px útiles, carrito 0 → 159 px. Resto: N-02 |
| M-02 | Botón y contador de tamaño estable | Alto | Bajo-Medio | **Hecha y verificada** (11-nov) | Un tamaño por pantalla; la tarjeta no cambia de alto al pulsar (216 px antes y después) |
| M-03 | Zonas táctiles ≥ 44 px | Medio | Bajo | **Hecha en la lista** (11-nov) | Lista: 98 → 0 zonas pequeñas. Carrito: ver N-01 |
| N-01 | Carrito: controles a 48 px (Cajas/Uds 61×42, − y + 44×40, cantidad 56×40, «+ Añadir observación» 251×40) | Medio | Bajo | **Hecha casi del todo** (13-nov) · quedan 2 controles de 40–42 px en el carrito (4 en 320 px) | Hallada al verificar M-03 |
| N-02 | Quitar la barra gris «Añade productos para empezar» mientras el carrito esté vacío; en apaisado, cabecera que se colapsa al hacer scroll | Medio | Bajo | **Hecha** (13-nov) | Hallada al verificar M-01 |
| M-04 / F-07 | Vista de escritorio en tabla / 2 columnas | Medio | Medio | Propuesta | |
| M-05 / F-08 | Respetar letra del sistema (hasta +30 %) + A−/A+ | Medio | Bajo | **Aprobada** (11-nov) | Decisión 1 = sí. Prompt listo: `PROMPT_CONSTRUCTOR_letra_y_aviso_entrega.md` |
| M-06 / F-06 | Poca cobertura: carrito local + instalable | Alto | Medio | Propuesta | Medir primero con red lenta |
| M-07 | Quitar el «Hacer pedido» repetido | Bajo | Bajo | Propuesta | |
| M-08 | Precio de caja en la fila | Medio | Bajo | Propuesta | |
| F-01 | Pedido rápido por lista | Alto | Medio | Propuesta | |
| F-02 | «Tu pedido de siempre» en la portada | Alto | Bajo | **Aprobada** (11-nov) | Buen primer paso · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-03 | Listas guardadas | Medio | Medio | Propuesta | |
| F-04 | «¿Te falta algo?» | Alto | Medio | Propuesta | |
| F-05 | Hora límite, mínimos, agotados | Medio | Medio | Propuesta | Necesito vuestras reglas |
| F-09 | WhatsApp tras el pedido | Medio | Medio | Propuesta | Coste por mensaje |
| F-10 | Pedir por audio/foto | Alto | Alto | Propuesta | Estudiar antes |
| F-11 | Ofertas y venta cruzada | Medio | Medio | Propuesta | Necesito vuestras ofertas |
| F-12 | Escáner de barras | Bajo-Medio | Alto | Propuesta | Depende de los EAN |
| F-13 | Pedido asistido por el comercial | Medio | Medio | Propuesta | |
| F-15 | Aviso «Si haces el pedido antes de las 10:00, te lo entregamos hoy» (solo Medina del Campo, día laborable, antes de las 10:00; desaparece a las 10:00) | Medio | Bajo | **Aprobada** (11-nov) | Regla dada por el dueño. Mismo prompt que M-05. Casos de hora a probar incluidos |
| F-16 | Pedido fijo semanal: «cada martes lo mismo» genera un borrador que el cliente revisa y confirma | Alto | Medio-Alto | **Aprobada** (11-nov) | Orumio, The Usual, Commercetools. Siempre con revisión: las modificaciones manuales causan errores · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-17 | Recordatorio por WhatsApp cuando toca reponer («¿te preparo tu pedido de siempre? Responde SÍ») | Alto | Medio-Alto | **Aprobada** (11-nov) | Necesita API de Meta y plantillas aprobadas (decisión 6). Enviar al 75–85 % del ciclo habitual, con opción de baja · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-18 | Poder editar el pedido ya enviado hasta una hora límite, y repetir la hora límite al confirmar | Medio-Alto | Medio | **Aprobada** (11-nov) | Ordermentum, Sysco. Hay que fijar la hora límite de edición · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-19 | «Mis pedidos» con estado (recibido / preparado / en reparto) y albarán | Medio | Medio | Propuesta (nueva) | Sin seguimiento el cliente llama (Edify). Necesita que la empresa cambie el estado en su panel |
| F-20 | Búsqueda para un catálogo grande (640+ productos): sugerencias desde la 1.ª letra, filtros por marca y formato, búsquedas recientes | Alto | Medio | **Aprobada** (11-nov) | Baymard: en catálogos grandes la búsqueda es la navegación principal. Disbesa filtra por marca y formato · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-21 | Abrir en «lo mío»: histórico por frecuencia primero y, en cada categoría, lo que ya compra arriba; a clientes nuevos, lo más pedido por otros | Alto | Bajo-Medio | **Aprobada** (11-nov) | Instacart. Comprobar con un cliente real con historial qué pestaña abre hoy · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-22 | Cantidades rápidas: teclado numérico al tocar el número y saltos «+6 / +12 / +1 caja» | Medio-Alto | Bajo | **Aprobada** (11-nov) | Observación propia (hoy «−/+» de uno en uno); sin fuente externa · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-23 | «Quitado · Deshacer» al borrar un artículo, anunciado de forma accesible | Medio | Bajo | **Aprobada** (11-nov) | W3C: deshacer errores reduce el coste de un fallo · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-24 | Botón fijo «¿Necesitas ayuda?»: llamar o WhatsApp con el comercial en un toque | Medio | Bajo | **Aprobada** (11-nov) | Guías de accesibilidad para mayores. Necesita teléfono y horario · Incluida en `PROMPT_CONSTRUCTOR_paquete_compra_facil.md` |
| F-25 | Recordar notas del cliente («descargar por detrás», «llamar antes») y precargarlas | Medio | Bajo-Medio | Propuesta (nueva) | Observación propia; sin fuente externa |
| F-14 | Medir el uso | Alto | Bajo-Medio | Propuesta | Sin esto no hay seguimiento real |

**Mi recomendación de orden:** 1) M-02 + M-03 (lo que notas ya hoy), 2) M-01, 3) F-02, 4) F-14, 5) F-01.

### Registro de actividad

| Fecha | Qué se hizo |
|---|---|
| 11-nov-2026 | Aprobadas e incluidas en el prompt del constructor `PROMPT_CONSTRUCTOR_paquete_compra_facil.md`: F-02, F-16, F-17 (versión sin API: lista en el panel + botón wa.me), F-18, F-20, F-21, F-22, F-23, F-24. Excluidas por decisión: F-19 y F-25. |
| 13-nov-2026 | Ronda 2: puesta al día con la versión instalada, verificación de lo hecho, diagnóstico visual (D-1 a D-8), maqueta de tres pantallas y propuestas P-01 a P-12. PDF `Diseno_premium_app_cliente.pdf`. |
| 11-nov-2026 | Segunda búsqueda de ideas para facilitar la compra: añadidas F-16 a F-25 (pedido fijo, recordatorio por WhatsApp, editar pedido enviado, estado del pedido, búsqueda, abrir en «lo mío», cantidades rápidas, deshacer, ayuda, notas recordadas). |
| 11-nov-2026 | Decisiones: letra = respetarla (aprobada); aviso de entrega hoy antes de las 10:00 en Medina del Campo (nueva F-15, aprobada). Prompt para el constructor en `PROMPT_CONSTRUCTOR_letra_y_aviso_entrega.md`. |
| 11-nov-2026 | Tras tus arreglos, nueva medición de la versión `1794389456-64de` en los 9 tamaños: M-02 y M-03 (lista) verificadas, M-01 mejorada, nuevas N-01 y N-02; resto sin cambios. PDF actualizado. |
| 10-nov-2026 | Informe en PDF (`Investigacion_mejoras_app_pedidos.pdf`) con la comparativa de empresas, la medición, las propuestas por fases y las 8 decisiones pendientes. |
| 10-nov-2026 | Ronda 1: medición del artefacto actual en 9 tamaños, 4 grupos de búsqueda (pedido B2B, móvil, Sysco, pedido rápido, WhatsApp Flows, accesibilidad), primeras 9 observaciones y 14 ideas. |

### Qué investigaré en la próxima ronda
- Medir el artefacto con red lenta (3G) y con letra del sistema ampliada (necesita un móvil real o el emulador).
- Revisar el panel de empresa del artefacto con la misma matriz de pantallas.
- Estudiar costes y límites reales de WhatsApp (plantillas, Flows, catálogo) para F-09 y F-10.
- Buscar estudios de usabilidad en pedidos de hostelería (hasta ahora solo hay blogs de proveedores).

## 6. Fuentes consultadas

Todas son páginas web de terceros y deben leerse con cautela. Las cifras de mejora que citan algunos blogs (por ejemplo «+30 % de repetición») **no se han podido verificar**.

- Pedido B2B y reordenar: [StoreHippo](https://www.storehippo.com/blog/how-to-build-a-seamless-ordering-experience-for-b2b-wholesale-buyers), [IWD Agency](https://www.iwdagency.com/blogs/news/how-b2b-site-design-can-ease-shopping-for-buyers-boost-sales/), [Shopaccino](https://www.shopaccino.com/blog/how-a-mobile-app-can-speed-up-order-placement-for-your-b2b-customers)
- Sysco Shop (historial, pedidos pares, duplicar, límite de hora, escáner): [guía móvil de Sysco](https://www.syscosource.ca/pnet/customer/messages/Creating_an_Order_MOBILE_SHEET.pdf), [soporte de Sysco Shop](https://appsupport.shop.sysco.com/en/articles/15481171-sysco-shop-released-06-16-2026-internal)
- Pedido rápido por lista: [Racklify](https://racklify.com/encyclopedia/how-to-implement-a-quick-order-form-in-your-ecommerce-store/), [Elastic Path](https://documentation.elasticpath.com/storefront-react/docs/features/order-form.html), [WooCommerce Quick Order Grid](https://woocommerce.com/document/b2b-quick-order-grid/)
- Móvil y zona táctil: [Baymard, checkout móvil](https://baymard.com/blog/mobile-checkout), [Toptal](https://www.toptal.com/designers/ux/ecommerce-ux-mobile-experience)
- Accesibilidad: [WCAG 2.2 — novedades](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [tamaño de objetivo (2.5.8)](https://www.disabilityworld.org/toolkit/standards/wcag/2-5-8-target-size-minimum/)
- Distribuidores de hostelería y WhatsApp: [Disbesa Store](https://mwm.ai/ko/apps/disbesa-store/1110666868), [Europastry (escáner)](https://apps.apple.com/us/app/europastry/id910981869), [WhatsApp Flows (CM.com)](https://www.cm.com/en-za/blog/whatsapp-flows/), [WhatsApp Flows (360dialog)](https://docs.360dialog.com/partner/waba-management/whatsapp-flows), [catálogo y carrito de WhatsApp (Cliengo)](https://guiawabusiness.cliengo.com/whatsapp-commerce), [bot de pedidos por WhatsApp](https://duotach.com/blog/bot-whatsapp-tomar-pedidos)

## 7. Cómo repetir la medición

Los scripts están en esta carpeta (`auditoria-artefacto.cjs`). Necesitan el HTML del artefacto en una carpeta aparte; no lo guardes en el repositorio.

```bash
node auditoria-artefacto.cjs <carpeta-con-index.html> <carpeta-de-salida>
```

## 8. Cómo lo hacen otras empresas (ronda 1b) — resumen

El informe completo, con tabla y fiabilidad de cada fuente, está en `Investigacion_mejoras_app_pedidos.pdf`.

- **Sysco Shop:** empieza el pedido desde el historial, duplica un pedido en uno editable, permite modificar hasta la hora límite y avisa de habituales olvidados.
- **Amazon Business / Grainger:** listas de reordenar con nombre que no se vacían, listas compartidas, escáner de código de barras.
- **Instacart:** «Comprar otra vez» en la cabecera y en el inicio; con pocos pedidos enseña lo que otros compran con regularidad; «añadir todo» de un pedido pasado.
- **Faire:** mínimo menor para repetir; el carrito dice cuánto falta para el mínimo o los portes gratis.
- **Disbesa Store (hostelería, España):** compra rápida de habituales, repetir pedido completo o parcial, promociones.
- **Apps instaladas (PWA):** casos de Google (Flipkart, George.com, Lancôme) con mejoras de conversión; son tiendas enormes, orientativo.
- **No encontrado:** Mercadona, estudios de usabilidad con hosteleros, funciones de Makro PRO en España.

## 9. Decisiones pendientes del usuario

1. Letra: ¿respetar la del móvil del cliente (hasta +30 %) con control A−/A+, o fija?
2. Restos de la Fase 1: ¿cerramos N-01 (carrito a 48 px), N-02 (quitar la barra vacía) y M-07 / M-08?
3. ¿«Tu pedido de siempre» como botón principal de la portada?
4. Reglas de reparto y compra (hora límite, mínimo, portes gratis, días y zonas) para F-05.
5. Ofertas y novedades: ¿existen y de dónde salen? (F-11)
6. WhatsApp: ¿API de Meta activa y presupuesto para mensajes? (F-09, F-10)
7. Medir el uso sin datos personales (F-14).
8. Vino: ¿21 € es por botella o por caja? (F6-1)
+. ¿Se pide más desde el móvil o desde el ordenador del bar?

## 10. Ronda 2 (13-nov-2026): diseño premium de la parte del cliente

Informe en PDF: `Diseno_premium_app_cliente.pdf` (9 páginas, con maqueta de tres pantallas hecha con productos y fotos reales).

**Verificado en la versión del 12-nov (15,1 MB):** M-02, M-03, N-02, M-07 y M-08 hechos; M-01 mejorado (lista 214 px útiles, carrito 155 px apaisado); N-01 casi hecho (quedan 2 controles de 40–42 px en el carrito). Letra A−/A+ y botón de ayuda instalados; Tu pedido de siempre, Deshacer, pedido fijo, «Hoy toca», aviso de entrega, Modificar pedido y Recordatorios aparecen en el código pero **sin probar** (el cliente de prueba no tiene historial). M-04 (escritorio) sin cambios.

**Datos nuevos:** la página pesa 15,1 MB (1.655 fotos incrustadas, 14,2 MB); 1.027 fotos (62 %) miden ≤ 64 px, 306 entre 65 y 200 px, 322 > 200 px; 81 fotos marcadas como generadas con IA (80 de menaje).

| Código | Propuesta | Impacto | Esfuerzo | Estado |
|---|---|---|---|---|
| P-01 | Sistema de diseño sobrio (fondo cálido, rojo solo de acento, una tipografía, espaciado de 8) y fuera la barra verde / cabecera roja a pantalla completa | Alto | Medio | Propuesta · decisión 1 |
| P-02 | Navegación inferior de 5 pestañas + mini-carrito fijo | Alto | Medio | Propuesta · decisión 2 |
| P-03 | Pantalla Inicio personalizada | Alto | Medio | Propuesta |
| P-04 | Tarjeta de producto de una fila (~100 px en vez de 216) con «+» que pasa a contador | Alto | Medio | Propuesta |
| P-05 | Fotos ≥ 400×400, fondo uniforme, WebP, por categoría bajo demanda; «imagen orientativa» en las 81 de IA | Alto | Alto | Propuesta · decisión 3 |
| P-06 | Nombres de producto limpios (con tabla de excepciones) | Medio-Alto | Medio | Propuesta · decisión 4 |
| P-07 | Micro-interacciones útiles (200–400 ms) | Medio | Bajo | Propuesta |
| P-08 | Pedido y entrega en una sola pantalla | Alto | Medio | Propuesta |
| P-09 | Estados vacíos y de error cuidados | Medio | Bajo | Propuesta |
| P-10 | Escritorio: rejilla y carrito lateral | Medio | Medio | Propuesta · decisión 6 |
| P-11 | Tarjeta del comercial | Medio | Bajo | Propuesta · decisión 5 |
| P-12 | Rendimiento (< 3 s con buena cobertura) | Alto | Medio | Propuesta |

Fases propuestas: A (P-01, P-04, P-06) · B (P-02, P-03, P-08) · C (P-05, P-07, P-09) · D (P-10, P-11, P-12). Pendiente de decisión también: portes gratis / pedido mínimo (decisión 7).
