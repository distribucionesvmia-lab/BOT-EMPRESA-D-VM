# Investigación de mejoras de la app de pedidos — documento vivo

**Qué es:** investigación continua para que al cliente le sea fácil, rápido y cómodo pedir, y para vender mejor.
**Cómo se trabaja:** yo investigo, mido y propongo; tú decides. Cada propuesta tiene un código y un estado (tabla de seguimiento, sección 5). Nada se cambia en la app sin tu «aplícalo».
**Última actualización:** 10-nov-2026 · **Ronda:** 1

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
| M-01 | Catálogo usable en apaisado | Alto | Bajo | Propuesta | |
| M-02 | Botón y contador de tamaño estable | Alto | Bajo-Medio | Propuesta | Lo que más te preocupa |
| M-03 | Zonas táctiles ≥ 48 px | Medio | Bajo | Propuesta | |
| M-04 / F-07 | Vista de escritorio en tabla / 2 columnas | Medio | Medio | Propuesta | |
| M-05 / F-08 | Respetar letra del sistema + A−/A+ | Medio | Bajo | Propuesta | Necesita tu decisión |
| M-06 / F-06 | Poca cobertura: carrito local + instalable | Alto | Medio | Propuesta | Medir primero con red lenta |
| M-07 | Quitar el «Hacer pedido» repetido | Bajo | Bajo | Propuesta | |
| M-08 | Precio de caja en la fila | Medio | Bajo | Propuesta | |
| F-01 | Pedido rápido por lista | Alto | Medio | Propuesta | |
| F-02 | «Tu pedido de siempre» en la portada | Alto | Bajo | Propuesta | Buen primer paso |
| F-03 | Listas guardadas | Medio | Medio | Propuesta | |
| F-04 | «¿Te falta algo?» | Alto | Medio | Propuesta | |
| F-05 | Hora límite, mínimos, agotados | Medio | Medio | Propuesta | Necesito vuestras reglas |
| F-09 | WhatsApp tras el pedido | Medio | Medio | Propuesta | Coste por mensaje |
| F-10 | Pedir por audio/foto | Alto | Alto | Propuesta | Estudiar antes |
| F-11 | Ofertas y venta cruzada | Medio | Medio | Propuesta | Necesito vuestras ofertas |
| F-12 | Escáner de barras | Bajo-Medio | Alto | Propuesta | Depende de los EAN |
| F-13 | Pedido asistido por el comercial | Medio | Medio | Propuesta | |
| F-14 | Medir el uso | Alto | Bajo-Medio | Propuesta | Sin esto no hay seguimiento real |

**Mi recomendación de orden:** 1) M-02 + M-03 (lo que notas ya hoy), 2) M-01, 3) F-02, 4) F-14, 5) F-01.

### Registro de actividad

| Fecha | Qué se hizo |
|---|---|
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
