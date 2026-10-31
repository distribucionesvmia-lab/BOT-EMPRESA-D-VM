# Revisión final del catálogo para publicación manual (borrador)

Estado: BORRADOR. Nada está publicado ni desplegado. Esto NO es una declaración de "listo para producción": faltan datos reales y revisión humana (ver "Bloqueos").

## Qué incluye la rama `claude/eager-hamilton-gknalq` (catálogo)
- Carrito persistente (24 h, en el navegador), conversión Uds↔Cajas con confirmación, aviso de tope y "Deshacer".
- Subtotal por línea; totales del navegador iguales a los del servidor (precio/descuento del cliente).
- Pantalla "Confirma tu pedido" antes de enviar (decisión del cliente).
- Búsqueda por palabras en cualquier orden, ayuda si no hay resultados, "Mostrar más".
- Repetir un pedido anterior con revisión línea a línea.
- Favoritos privados por cliente (`cuentas.sqlite`, tabla `favorites`).
- Accesibilidad: etiquetas, foco dentro de las pantallas superpuestas, Esc, botón Atrás del móvil, fondo inerte, zona viva.
- `categorias-informe.js`: informe de solo lectura de clasificación.

## Bloqueos antes de publicar (los resuelve una persona)
1. Excel real de productos (marca, EAN, formatos, familias) → habilita búsqueda por marca/EAN y revisar categorías con `node categorias-informe.js catalogo.sqlite`.
2. Decisión de categorías: las del cliente (Café, Pascual, Vinos, Aguas, Despensa, Refrigerados, Congelados, Otros) o las del plan.
3. Decisión del total mostrado: base sin IVA (hoy) o con IVA.
4. Precios especiales y descuentos por cliente cargados desde Drive (no se importan aún).
5. Fotos reales y datos de alérgenos verificados (no se han inventado; se usan iniciales).
6. Prueba manual en móviles reales (iOS Safari y Android Chrome) con una cuenta real y SIN enviar pedidos reales.
7. Hosting definido y variables de entorno (ADMIN_TOKEN, LINK_SECRET, NIF_PEPPER) fijadas.

## Riesgos conocidos
- El carrito guardado en `localStorage` se comparte entre personas que usen el mismo navegador y el mismo cliente (clave por nombre de cliente). En un móvil compartido, otra persona vería el pedido sin terminar. Aceptable salvo que se pida lo contrario.
- La demo del navegador (artifact) guarda favoritos solo en memoria.
- La pestaña Histórico depende de que se sincronice el historial de a3ERP; si falta, solo hay favoritos.
- `history.pushState` en la demo embebida (iframe) puede comportarse distinto que en producción.
- Las pruebas de navegador (`bot-whatsapp/pruebas/catalogo-movil.cjs`) no forman parte de `npm test` y solo funcionan contra la demo.

## Cómo revisar
```bash
git fetch origin claude/eager-hamilton-gknalq && git checkout claude/eager-hamilton-gknalq
cd bot-whatsapp && npm test        # 195 tests
npm run demo                       # http://localhost:3000/cliente · entrar con 00000001R
```
Revisar en un ancho de 390 px: añadir producto, cambiar a cajas, recargar (el carrito vuelve), repetir un pedido, marcar favorito, finalizar → elegir día → confirmar.

Para publicar (siempre manual): fusionar la rama tras revisar, desplegar con `docs/DESPLIEGUE.md`.
