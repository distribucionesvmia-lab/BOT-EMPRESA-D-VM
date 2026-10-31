# Catálogo de pedidos – Progreso de trabajo

Archivo de continuidad para las ejecuciones periódicas del plan "Catálogo de pedidos de Distribuciones VM".
Cada ejecución: leer este archivo, elegir 2–4 tareas pendientes con dependencias resueltas, hacerlas y actualizar aquí.

- Repo: `distribucionesvmia-lab/BOT-EMPRESA-D-VM`
- Rama de trabajo: `claude/eager-hamilton-gknalq` (única rama; no publicar, no PR, no tocar ramas protegidas)
- Código: `bot-whatsapp/` · Docs: `docs/` (no existe AGENTS.md ni CLAUDE.md)

## Cómo arrancar y revisar

```bash
cd bot-whatsapp
npm test                      # 193 tests (node --test)
npm run demo                  # servidor con datos de demostración (DEMO=1)
node --env-file=.env server.js  # modo real (necesita .env)
node demo-web/build.mjs       # regenera demo-web/dist/artifact.html
```

Pantalla del cliente: `/` (`cliente.html`); catálogo: `/catalogo` (`pedido.html`).

## Estado de las fases

| Fase | Tarea | Estado |
|---|---|---|
| 0 | 0.1 Confirmar repo y rama | Terminada (run 1) |
| 0 | 0.2 Leer docs, scripts y estructura | Terminada (run 1) |
| 0 | 0.3 Localizar la experiencia de catálogo actual | Terminada (run 1) – ver mapa abajo |
| 0 | 0.4 Crear este archivo de continuidad | Terminada (run 1) |
| 1 | 1.1 Auditar recorrido móvil (por código) | Terminada (run 1b) – ver CATALOGO_AUDITORIA.md |
| 1 | 1.2 Auditar riesgos de compra | Terminada (run 1b) |
| 1 | 1.3 Auditar accesibilidad | Terminada (run 1b) |
| 1 | 1.4 Registrar defectos con prioridad | Terminada (run 1b): D1–D18 |
| 1 | 1.5 Pasada manual en navegador móvil 390 px con datos demo (confirmar D1–D18) | Pendiente (baja prioridad, hacer cuando sobre tiempo) |
| 1 | 1.6 Correcciones rápidas de la auditoría (D4, D5 orden, D8, D10–D13) | Terminada (run 1b) |
| 5/7 | 5.1, 7.1, 7.2 (D1, D2, D6, D7, D14) | Terminadas (run 1c), probadas en navegador móvil con cliente demo 00000001R |
| 3/7 | 7.4 (D19) hecha; 3.1 parcial (informe sí, recategorizar pendiente de decisión) | run 2 |
| 4/6 | 4.1 (estados vacíos) y 6.2 (repetir pedido) | Terminadas (run 3) |
| 6 | 6.1 favoritos | Terminada (run 4), probada en navegador y con test (195 OK) |
| 2 | Navegación y portada (Comprar/Explorar/Pedidos/Cuenta) | Pendiente |
| 3 | Estructura del catálogo y revisión de clasificación | Pendiente |
| 4 | Búsqueda y filtros | Pendiente |
| 5 | Tarjetas de producto y ficha | Pendiente |
| 6 | Habituales, favoritos, listas, repetir pedido | Pendiente |
| 7 | Carrito y entrega | Pendiente |
| 8 | Recomendaciones y promociones (sin inventar) | Pendiente |
| 9 | Fotos y datos de producto | Pendiente |
| 10 | Estética y accesibilidad | Pendiente |
| 11 | Pruebas y métricas (sin pedidos reales) | Pendiente |
| 12 | Revisión final para publicación manual | Pendiente |

## Mapa de la experiencia actual (archivo:línea)

Login / portada (`bot-whatsapp/cliente.html`)
- Portada "Bienvenido a DistribucionesVM": línea 116.
- Acceso con últimos 6 del NIF (`#a-nif`): 124; acceso alternativo teléfono + PIN: 127–130, `modoAcceso` 218.
- Alta de cliente nuevo (requiere aceptación de la empresa): ~164–210.

Catálogo / mini-app (`bot-whatsapp/pedido.html`)
- Buscador `#q`: línea 152. La búsqueda filtra por nombre normalizado y por código (`renderList`, línea 319).
- Pestañas "★ Histórico" / "☰ Catálogo" y filtro "Ver solo lo que he marcado" (solo en Histórico): 152–154, `renderList` 303.
- Categorías → subcategorías → productos: `renderCategorias` 272, `renderSubs` 290.
- Tarjeta de producto: `row` 249 (iniciales como avatar, "Caja de N uds").
- Selector unidades/cajas y − cantidad +: `control` 220.
- Carrito, observaciones por línea (`.lnote`) y generales (`#note`, línea 163): `renderCart` 332.
- Entrega (lista de días y calendario): `pintarOpciones` 373, `pintarCal` 392, `abrirCal` 411; envío `enviarPedido` 421.

Servidor
- Datos del catálogo: `server.js` ~260 y ~407 (`/catalogo/datos`), `weborder.js` (`webProducts`, `webTree`, `webHistory`, `webOrderFromBody`).
- Categorías: `categorias.js` (`CATEGORIAS`, `categorizar`, `arbolCategorias`).
- Reglas de entrega: `delivery.js`. Precios: `pricing.js` (solo servidor).
- Repetir pedido: solo en el chat (`bot.js` `repeatOptions` 112, uso 423). El mini-app no tiene pantalla de repetir pedido ("Mis pedidos" se retiró a petición del cliente); `webHistory` existe en servidor.

## Observaciones iniciales (hipótesis NO confirmadas; se verifican en Fase 1)

- La búsqueda solo cubre nombre y código; no hay marca ni EAN.
- El carrito no se guarda entre sesiones (no hay localStorage/persistencia en `pedido.html`).
- No hay favoritos ni listas privadas.
- No hay fotos: se usan iniciales como marcador.
- Las categorías actuales (`categorias.js`) no coinciden aún con la propuesta comercial del plan (Bebidas, Café e infusiones, Lácteos y bebidas vegetales, Despensa, Aperitivos, Pan y bollería, Refrigerados, Congelados, Otros).
- No hay pestañas Comprar/Explorar/Pedidos/Cuenta; la navegación es por las pestañas Histórico/Catálogo.

## Decisiones de diseño ya tomadas (del cliente)

- Acceso por últimos 6 caracteres del NIF; PIN personal opcional; sin campo "nombre de empresa" salvo desambiguación.
- Pestañas "Histórico" y "Catálogo"; no usar la palabra "habitual"; sin "Mis pedidos".
- Entrega: hoy solo si pedido antes de las 10:00 y municipio 47085; mañana; siguientes días de servicio (L–V, 5 días) y calendario sin fines de semana ni días contradictorios.
- Estética roja de marca; chat con aspecto de app.
- Precios y descuentos se calculan siempre en servidor.

## Datos reales pendientes (no inventar)

- Excel real de productos (columnas, familias a3, marcas, EAN, formatos).
- Precios especiales y descuentos por cliente (no importados desde Drive).
- Fotos reales de producto y datos de alérgenos/etiquetado verificados.
- Reglas oficiales de entrega por zona/ruta y pedido mínimo, si existen.
- Columna "Cód. municipio" puede faltar en el Excel (hay fallback por población).
- Revisión humana de la clasificación por categorías.

## Problemas detectados

Ver `docs/CATALOGO_AUDITORIA.md` (D1–D18). Abiertos más graves: D1 carrito no persiste, D2 cambio Uds↔Cajas sin aviso, D3 envío sin confirmación final (consultar al cliente).

## Próximas tareas (AUTOPLAN: la siguiente ejecución empieza aquí, en este orden)

Cada ejecución coge 2–4. Marca terminada aquí y en la tabla. Ejecuta `npm test` antes de commitear.

1. ~~5.1 (D2, D6, D14)~~ **Terminada (run 1c)**: cambio Uds↔Cajas convierte (confirma si no es exacto), aviso de tope 999, "Deshacer" al quitar línea.
2. ~~7.1 (D1)~~ **Terminada (run 1c)**: carrito en `localStorage` (clave por cliente, 24 h, se borra al enviar).
3. ~~7.2 (D7)~~ **Terminada (run 1c)**: subtotal por línea en el carrito.
4. ~~7.3 (D3)~~ **Terminada (run 1d)**: el cliente confirmó que SÍ quiere confirmación. Al elegir el día aparece "Confirma tu pedido" (día, dirección, líneas, observaciones, total) con "Confirmar y enviar" / "Cambiar el día". Probado: no se envía nada hasta confirmar.
4b. ~~7.4 (D19)~~ **Terminada (run 2)**: causa = el navegador sumaba precio de lista × unidades e ignoraba el descuento (y el precio especial) que sí aplica el servidor. Ahora `webProducts` envía `price` (especial si existe) y `discount` con el mismo criterio que `pricing.js` y `pedido.html` calcula el importe igual (verificado: 0,50 € en pantalla y en el mensaje). No se tocaron reglas de precios. El mensaje de confirmación usa coma decimal. Observación abierta: el mensaje dice «total aprox.» SIN IVA, mientras que el correo de empresa dice «con IVA»; revisar con la gestoría qué quiere enseñar al cliente (tarea 7.5).
5. **3.1 (D18) – PARCIAL (run 2)**: hecho `bot-whatsapp/categorias-informe.js` (informe de solo lectura: `node categorias-informe.js catalogo.sqlite`). **NO se han cambiado las categorías**: el cliente eligió explícitamente Café, Pascual, Vinos, Aguas, Despensa, Refrigerados y Congelados (+ Otros), y el plan propone otras (Bebidas, Café e infusiones, Lácteos…). **Pendiente de decisión del cliente** (ver docs/CATALOGO_AUDITORIA.md, sección «Decisiones por tomar»). Cuando el cliente tenga el Excel real: ejecutar el informe y afinar palabras en `categorias.js` (sin inventar subcategorías).
6. **2.1 (DECISIÓN PREVIA: el cliente quitó «Mis pedidos»; proponer solo barra Comprar/Explorar/Cuenta o mantener las pestañas actuales y preguntar)**  Navegación inferior Comprar / Explorar / Pedidos / Cuenta (si encaja con lo ya decidido: sin "Mis pedidos" por ahora; proponer "Repetir" en su lugar) y orden de la portada.
7. ~~4.1~~ **Terminada (run 3)**: sin resultados ahora explica y ofrece «Borrar la búsqueda»; marca/EAN siguen PENDIENTES de que el Excel real traiga esas columnas (no se inventan).
8. ~~6.1~~ **Terminada (run 4)**: favoritos privados por cliente (♡/♥ en cada producto). Guardados en `cuentas.sqlite` (tabla `favorites`, se copia en las copias de seguridad, no los toca la sincronización con a3ERP), máx. 300; ruta `POST /catalogo/favorito`; en Histórico los favoritos salen primero aunque no tengan historial. Demo del navegador: favoritos en memoria. NO hay «listas» con nombre todavía (6.3, opcional, solo si el cliente las pide).
9. ~~6.2~~ **Terminada (run 3)**: botón «↻ Repetir un pedido anterior» en Histórico: pantalla con los últimos 5 pedidos, casillas por línea, se añade al carrito (en unidades) con aviso de revisar. Probado en navegador móvil con el cliente demo.
10. **8.1 / 9.1** Recomendaciones sin inventar (solo "más pedido por ti"); placeholder de foto con iniciales ya existe; campo de imagen opcional si los datos lo traen.
11. **10.1** Accesibilidad: foco en diálogos, Esc, botón Atrás (history.pushState), contraste, tamaños.
12. **11.1** Tests nuevos para búsqueda, límites y persistencia; **12.1** revisión final para publicación manual (checklist, riesgos, datos pendientes).

Cuando todo esto esté hecho, 1.5 (pasada manual) y revisar de nuevo la auditoría.

## Registro de ejecuciones

- Run 1: Fase 0 completa (0.1–0.4). Solo se creó este archivo; sin cambios funcionales.
- Run 1b: Fase 1 (auditoría por código) + correcciones rápidas en pedido.html (búsqueda por palabras, "Mostrar más", etiquetas accesibles, foco, mensaje de sesión). 193 tests OK. Se creó docs/CATALOGO_AUDITORIA.md.
- Run 1c: 5.1, 7.1, 7.2 hechas y probadas con Playwright (390 px, demo, NIF 00000001R): conversión Uds/Cajas, recuperación del carrito tras recargar, subtotales, deshacer. Sin errores JS. 193 tests OK. Ojo: cuando se prueba con Playwright, `NODE_PATH=$(npm root -g)` y cliente demo `00000001R`; `fuser -k 3911/tcp` para parar el servidor.
- Run 1d: 7.3 hecha (confirmación antes de enviar, decisión del cliente: sí). Probada con Playwright: 0 POST hasta confirmar. Detectada D19 (total navegador 0,55 € vs servidor 0.50 €), pendiente 7.4. 193 tests OK.
- Run 2 (por petición del cliente + programada de las 16:24 UTC): 7.4 hecha (totales cuadran, coma decimal, test nuevo → 194 tests OK), 3.1 parcial (informe de clasificación). Demo del navegador reconstruido (demo-web/dist). Siguiente: 2.1, 4.1, 6.1, 6.2.
- Run 3 (programada 17:24 UTC): 4.1 y 6.2 hechas y probadas en navegador (repbar visible, repetir añade 7 artículos, búsqueda vacía con botón). 194 tests OK. Siguiente: 6.1 favoritos/listas (necesita tabla en clientes-db.js + endpoints; atención a la demo del navegador), 2.1, 8.1/9.1, 10.1, 11.1, 12.1.
- Run 4 (programada 18:24 UTC): 6.1 favoritos hecho (servidor + interfaz + demo + test). Siguiente: 2.1 (navegación; decidir con el cliente), 8.1/9.1, 10.1, 11.1, 12.1, 7.5 (IVA en total), 1.5.
