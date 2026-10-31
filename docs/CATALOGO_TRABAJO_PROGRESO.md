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
| 1 | 1.1 Auditar recorrido móvil (login → pedido enviado) | Pendiente (siguiente) |
| 1 | 1.2 Auditar riesgos de compra (unidad/caja, cantidades, errores) | Pendiente (siguiente) |
| 1 | 1.3 Auditar accesibilidad (foco, etiquetas, contraste, tamaños) | Pendiente (siguiente) |
| 1 | 1.4 Registrar defectos con prioridad | Pendiente (depende de 1.1–1.3) |
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

(Ninguno registrado todavía; se rellenará en Fase 1.)

## Próximas tareas sugeridas (run 2)

1. 1.1 Auditoría del recorrido móvil en navegador (viewport 390 px) con datos demo.
2. 1.2 Auditoría de riesgos de compra.
3. 1.3 Auditoría de accesibilidad.
4. 1.4 Consolidar defectos con prioridad.

## Registro de ejecuciones

- Run 1: Fase 0 completa (0.1–0.4). Solo se creó este archivo; sin cambios funcionales.
