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
| 11 | 11.1 guion de pruebas de navegador guardado en el repo y pasado (11/11) | Terminada (run 6); 1.5 pasada manual cubierta por este guion (falta móvil real) |
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
10. **8.1 / 9.1** – 8.1 CUBIERTA sin cambios: no hay promociones ni «recomendados» inventados; Histórico ya ordena por lo que más pide el cliente y los favoritos van primero. 9.1: las iniciales de color son el marcador; NO se añade campo de foto hasta que haya fotos reales verificadas (pendiente de datos).
11. ~~10.1~~ **Terminada (run 5)**: foco dentro de las capas, `inert` en el fondo, Esc, botón Atrás del móvil (pushState), «paso» a 15 px. Probado con Playwright. Pendiente menor: revisión de contraste con herramienta y prueba con lector de pantalla real.
12. ~~11.1~~ **Terminada (run 6)**: `bot-whatsapp/pruebas/catalogo-movil.cjs` (11 comprobaciones de navegador a 390 px, solo contra la DEMO local; instrucciones en la cabecera del archivo). PENDIENTE de 11.1: métricas (pasos/tiempo por pedido) y pruebas de PIN/entrega por navegador si se quiere. **12.1** Borrador en `docs/CATALOGO_REVISION_FINAL.md`; actualizarlo en la última ejecución (23:24 UTC) con el estado real.

Cuando todo esto esté hecho, 1.5 (pasada manual) y revisar de nuevo la auditoría.

## Registro de ejecuciones

- Run 1: Fase 0 completa (0.1–0.4). Solo se creó este archivo; sin cambios funcionales.
- Run 1b: Fase 1 (auditoría por código) + correcciones rápidas en pedido.html (búsqueda por palabras, "Mostrar más", etiquetas accesibles, foco, mensaje de sesión). 193 tests OK. Se creó docs/CATALOGO_AUDITORIA.md.
- Run 1c: 5.1, 7.1, 7.2 hechas y probadas con Playwright (390 px, demo, NIF 00000001R): conversión Uds/Cajas, recuperación del carrito tras recargar, subtotales, deshacer. Sin errores JS. 193 tests OK. Ojo: cuando se prueba con Playwright, `NODE_PATH=$(npm root -g)` y cliente demo `00000001R`; `fuser -k 3911/tcp` para parar el servidor.
- Run 1d: 7.3 hecha (confirmación antes de enviar, decisión del cliente: sí). Probada con Playwright: 0 POST hasta confirmar. Detectada D19 (total navegador 0,55 € vs servidor 0.50 €), pendiente 7.4. 193 tests OK.
- Run 2 (por petición del cliente + programada de las 16:24 UTC): 7.4 hecha (totales cuadran, coma decimal, test nuevo → 194 tests OK), 3.1 parcial (informe de clasificación). Demo del navegador reconstruido (demo-web/dist). Siguiente: 2.1, 4.1, 6.1, 6.2.
- Run 3 (programada 17:24 UTC): 4.1 y 6.2 hechas y probadas en navegador (repbar visible, repetir añade 7 artículos, búsqueda vacía con botón). 194 tests OK. Siguiente: 6.1 favoritos/listas (necesita tabla en clientes-db.js + endpoints; atención a la demo del navegador), 2.1, 8.1/9.1, 10.1, 11.1, 12.1.
- Run 4 (programada 18:24 UTC): 6.1 favoritos hecho (servidor + interfaz + demo + test). Siguiente: 2.1 (navegación; decidir con el cliente), 8.1/9.1, 10.1, 11.1, 12.1, 7.5 (IVA en total), 1.5.
- Run 5 (programada 19:24 UTC): 10.1 accesibilidad (foco/Esc/Atrás), 8.1 cubierta sin cambios, 9.1 sin cambios (esperan datos), 12.1 borrador `docs/CATALOGO_REVISION_FINAL.md`. Siguiente: 11.1 guardar guiones de prueba, 7.5/2.1/categorías (esperan decisión del cliente), 1.5 pasada manual, actualizar la auditoría.
- Run 6 (programada 20:24 UTC): 11.1 hecho (`pruebas/catalogo-movil.cjs`, 11/11 OK, 195 tests OK). Sin tareas nuevas que dependan solo de mí: restan 2.1, 3.1 (recategorizar), 7.5 (IVA) y 6.3 (listas) que esperan decisión del cliente; 9.1/4.1 marca-EAN esperan el Excel real. Próximas ejecuciones: revisar si el cliente decidió; si no, solo mantenimiento + actualizar CATALOGO_REVISION_FINAL.md en la de las 23:24 UTC y desactivar la tarea programada.
- Run 7 (programada 21:24 UTC): sin cambios de código; el cliente no ha respondido a las decisiones pendientes (categorías, IVA, navegación, listas). 195 tests OK, árbol limpio.
- Run 8 (programada 22:24 UTC): sin cambios; decisiones del cliente aún pendientes. 195 tests OK. La de las 23:24 UTC es la última: actualizar CATALOGO_REVISION_FINAL.md y desactivar la tarea.
- Run 9 (FINAL, programada 23:24 UTC): sin cambios de código; CATALOGO_REVISION_FINAL.md actualizado con el estado real y las 4 decisiones pendientes. Tarea programada desactivada. Para seguir: responder a las decisiones y/o aportar el Excel real; entonces ejecutar 2.1, 3.1 (recategorizar), 4.1 (marca/EAN), 6.3, 7.5.
- Run 10 (el cliente aportó la tarifa real `Tarifa_con_imagenes_centro_sport_medina.xlsx`, NO se sube al repo): 20 hojas (una por proveedor/familia), 1.527 filas, 1.180 importables, 280 sin precio numérico (#N/A de un VLOOKUP a otro libro), 0 bloqueados, ~879 imágenes incrustadas. Hecho: `readXlsxSheets` (todas las hojas), `productos-informe.js` (informe de solo lectura), el importador entiende «Artículo» como nombre, «Unidades paquete venta», códigos de IVA ORD21/RED10 y la cabecera duplicada de la hoja Aceite. **SRE queda sin tipo (no se supone)**. 196 tests OK.

## Tarifa real: pendientes (siguiente ejecución parte de aquí)
1. **Decisión del cliente – IVA «SRE»** (58 artículos, p. ej. leche y pasta): confirmar el tipo (¿4 %?). Hasta entonces el servidor aplicaría 21 % por defecto. Importante para precios con IVA.
2. **Decisión – columna «Dto%»**: valores como 0,29 / 0,1 / 0,2: ¿son porcentaje (0,29 %) o fracción (29 %)? No se importa hasta saberlo.
3. **Decisión – 280 artículos sin precio** (#N/A; hoja Papel: 153 de 181): ¿no se venden, o falta tarifa? Se excluyen del catálogo.
4. **Decisión – categorías**: las hojas coinciden con las del cliente (Pascual, Mocay=Café, Vinos, Aguas, Despensa: Helios/Aceite/Salsas/Conservas/Especias/Legumbres/Don Simón/El Pozo, Refrigerados: Reny Picot/Campofrío) y añaden Menaje, Droguería, Papel, Platos, Cubertería y Vasos (no alimentación). Proponer: categoría = hoja, agrupadas bajo las categorías del cliente + «Hostelería y menaje».
5. **Imágenes (879)**: extraer del xlsx a una carpeta de datos (NO al repo), emparejar por la fila del ancla del dibujo, redimensionar si hace falta y servir desde `/img/<código>`; mostrar la foto en la tarjeta con las iniciales como respaldo. Confirmar que las fotos son de uso propio.
6. **Cargar la tarifa**: ampliar `sincronizar.js` para leer TODAS las hojas de `productos.xlsx` (hoy solo la primera) y fijar la categoría por hoja. Subir a Drive solo cuando 1–4 estén decididos.

## Tarifa real: actualización (cliente respondió Dto%)
- **Dto% = fracción** (0,29 = 29 %): confirmado por el cliente. Aplicado en `bot-whatsapp/tarifa-a-json.js`.
- Vista previa con la tarifa real publicada en la demo privada (Artifact, v35): 1.151 productos (74 Pascual, 56 Café, 26 Vinos, 24 Aguas, 170 Despensa, 42 Refrigerados, 760 «Hostelería y menaje»), categoría fijada por hoja; la tarifa se incrusta en el build con `TARIFA_JSON=ruta.json node demo-web/build.mjs` y la salida va a `demo-web/dist-privado/` (ignorada por git; NUNCA subir la tarifa ni ese build). Los productos de la tarifa sustituyen a los de ejemplo solo en la vista (la base compartida no se ha tocado); el histórico de los clientes ficticios queda vacío porque sus códigos ya no existen.
- Sigue PENDIENTE: IVA «SRE» (58 artículos sin tipo; el servidor usaría 21 %), los 280 sin precio, 29 filas raras descartadas (precio 0 / nombre sin letras), fotos (879, sin confirmar su uso), cargar la tarifa de verdad en `sincronizar.js` (todas las hojas) y decidir si la tarifa se actualiza dejando el fichero en Drive con el mismo nombre.

## Fotos de producto (run 11, el cliente confirmó su uso)
- `node tarifa-a-json.js tarifa.xlsx salida.json --fotos` saca las imágenes incrustadas (se emparejan por la fila del dibujo con el producto) a `salida-imagenes/<código>.png|jpg`: **690 fotos de 1.151 productos** (las demás se quedan con las iniciales). Revisado a ojo con una muestra de 10: coinciden.
- Servidor: carpeta `IMG_DIR` (por defecto `bot-whatsapp/imagenes/`, ignorada por git), ruta `GET /img/<código>` solo con sesión; el índice se refresca cada 5 min. `webProducts` añade `img` solo a los productos con foto. `pedido.html` pinta la foto sobre las iniciales y, si no carga, quedan las iniciales.
- Demo: `FOTOS_DIR=carpeta TARIFA_JSON=ruta.json node demo-web/build.mjs` incrusta las fotos (≈5,6 MB) → `dist-privado/`.
- Producción: copiar la carpeta de imágenes al servidor (disco persistente) y fijar `IMG_DIR`. Las fotos son miniaturas de 64 px: se ven bien en la tarjeta, algo blandas si se amplían (pendiente: pedir fotos de más resolución al proveedor si se quiere ficha grande).

## Actualización de productos (run 12)
- Nuevo sistema `bot-whatsapp/actualizar-productos.js` (guía: `docs/ACTUALIZAR_PRODUCTOS.md`): compara el Excel nuevo de a3ERP con lo que hay y enseña añadidos, quitados, modificados (campo, antes→después), reactivados y sin precio; con `--aplicar` solo toca esos productos (con copia de seguridad y registro de cambios). Lo que el Excel no trae no se toca; la sincronización de Drive también usa ya `partial`.
- Primera actualización real (`ARTICULOS_29-10-26.xlsx`, 1.688 artículos): 764 añadidos, 257 quitados (222 de Hostelería y menaje que no están en la lista de a3ERP), 223 modificados (140 nombre, 81 precio, 38 uds/caja), 30 sin precio. Aplicada solo a la demo (1.658 productos, 1.339 fotos); la base del servidor no existe todavía.
- Pendiente de decisión del cliente: IVA «SRE» (91 productos), categoría de las familias nuevas (170 productos caen en «Otros productos»: refrescos 14.0, licores 23.0, pan/bollería 92.x, galletas 25.1, cereales 18.0, envases 21.9/69.0…), y confirmar que los 257 quitados deben salir.
- Aviso de coordinación: el artefacto lo editan varios agentes (constructor, base de datos, QA). El agente de base de datos añadió a `index.html` el cargador `#cargar-datos` (solo en el artefacto, sin commit). Al republicar la demo desde `claude/eager-hamilton-gknalq` se perdió ese cargador; se ha **recuperado y guardado en `demo-web/page.html`** para que ya salga de cada compilación. Regla: antes de republicar el artefacto, comparar la versión publicada con la última publicada por uno mismo, y no editar `index.html` del artefacto sin pasarlo al repositorio.
- La demo publicada usa la lista de ARTICULOS 29-10-26 (1.658 productos, 91 con IVA 4 %, 41 con descuento de a3ERP). Los 397 productos que están en la copia de a3ERP del 20/10 y no en ARTICULOS no se muestran (sin precio o fuera de lista): revisar.
- Decisiones del cliente (03/11): el «Dto %» de la tarifa SÍ es descuento para el cliente (manda sobre el de a3ERP; este solo completa los productos sin descuento); IVA SRE = 4 % confirmado; los 170 productos de familias nuevas sin categoría se quedan en «Otros productos»; los 257 quitados (no están en ARTICULOS_29-10-26) salen. Demo publicada con esos criterios: 1.658 productos, 57 con descuento, 91 con IVA 4 %.
