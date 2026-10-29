# Bot de ventas para WhatsApp (gratis)

Bot por menú sobre la API oficial de WhatsApp (Meta Cloud API). Sin dependencias: solo Node 22.13+ (usa el SQLite integrado).

Flujo: menú → productos → cantidad → carrito → nombre y dirección → confirmar. El pedido se guarda en la base de datos SQLite `pedidos.sqlite` y (opcional) te llega por WhatsApp.

## 1. Personalizar
Edita `config.js` con el nombre, horarios y tus productos/precios.

## 1a. Base de datos de pedidos (SQLite)
Los pedidos confirmados se guardan en `pedidos.sqlite` (ruta configurable con `DB_PATH`), separados de los datos del ERP.
- Cada pedido recibe un **número correlativo y una referencia** (`VM-2026-000123`), el código de cliente, las líneas exactas (referencia, nombre, precio, unidades) y la fecha/hora. Nace como `confirmed` y `export_status = pending` (pendiente de exportar a Excel).
- **Sin duplicados:** cada pedido lleva una clave única (`wa:<id del mensaje de WhatsApp>` o `web:<id del enlace>`). Si Meta reenvía el mensaje, el cliente pulsa dos veces o abre dos pestañas, no se crea un segundo pedido. Los ids de mensaje ya procesados también se guardan, así que sobrevive a reinicios.
- El guardado es atómico (cabecera y líneas juntas o nada). Si falla, el pedido no se da por registrado.
- **Hosting:** el fichero debe estar en un disco persistente (en Render gratis se pierde en cada despliegue; usa un disco de pago o un VPS) y conviene hacer copia periódica.

## 1a-bis. Exportación diaria a Excel
- Cada día a partir de las `EXPORT_TIME` (21:00 hora de Madrid por defecto) el servidor genera un `.xlsx` en `EXPORT_DIR` (`exportaciones/`) con los pedidos confirmados y pendientes, y los marca como exportados. Si el servidor estaba apagado a esa hora, exporta al arrancar.
- **Formato (para pasar los pedidos a a3ERP a mano):** hoja **«Pedidos»** con un bloque por pedido: *cabecera* (Nº pedido, Código cliente, Nombre comercial, Fecha recepción, Hora pedido), *líneas* (Código artículo, Cajas, Descripción, Unidades, Precio, Dto. %, Importe, IVA %, Observaciones línea) y *pie* (Total base imponible, Total IVA, Total R.E., TOTAL PEDIDO, Observaciones del cliente). La hoja **«Líneas»** trae lo mismo en plano, una fila por línea.
- **Cálculo (`pricing.js`):** unidades = las del cliente, o cajas × unidades por caja de la ficha del artículo · precio = precio especial artículo/cliente, o precio de venta de la ficha · descuento = descuento artículo/cliente, o el general de la ficha · IVA por tipo de la ficha · R.E. si el cliente lo tiene. Los impuestos se calculan por tipo de IVA como en el detalle de impuestos de a3ERP; está comprobado con un pedido real (base 84,12 · IVA 15,26 · total 99,38).
- **De dónde salen los datos de las fichas:** (unidades por caja, IVA, descuentos, precios especiales, R.E.) vendrán de la sincronización con a3ERP, que aún no existe. Mientras tanto hay datos **ficticios** en `ejemplo/`. Si faltan, el pedido se marca para revisar (p. ej. si piden cajas y no se sabe cuántas unidades trae cada una).
- Nunca se exporta dos veces el mismo pedido ni se sobrescribe un fichero anterior. Cada exportación queda en el historial (fecha, nº de pedidos y líneas, nombre de fichero y huella SHA-256).
- **Todo o nada:** si falla la generación del fichero o el registro, ningún pedido se marca y se reintenta en la siguiente ejecución.
- **Pedidos retenidos:** no se exportan los de cliente desconocido (sin código de ERP), sin líneas, o con la marca *revisar*. Se avisa en el log. Para liberar uno ya revisado: `node exportar.js --aprobar VM-2026-000123`.
- Manual: `node exportar.js` (exporta ahora) · `node exportar.js --lista` (historial).
- **Cajas y unidades (ambas):** el cliente elige. En el chat, al elegir un artículo que se vende en cajas, el bot pregunta *cajas o unidades* (también vale escribir «3 cajas», «12 uds» o «2 cajas de agua»). En la mini-app hay un selector *Uds | Cajas* en cada artículo con caja. Si no se conocen las unidades por caja, el pedido queda retenido para revisar.
- **Observaciones:** en el chat, `nota: servir el jueves` (todo el pedido) o `nota jamón: pieza de peso grande` (un artículo). En la mini-app hay un cuadro para el pedido y otro por artículo. Salen en el Excel (*Observaciones del cliente* y *Observaciones línea*).

## 1b. Copia de pedidos en hoja de Google (opcional)
Cada pedido confirmado se añade como una fila nueva: fecha, teléfono, nombre, dirección, lo que escribió el cliente, lo que el bot ha interpretado, total y estado.
1. Crea una hoja nueva en https://sheets.google.com (ponle "Pedidos").
2. Menú **Extensiones → Apps Script**. Borra lo que haya y pega el contenido de `google-sheets.gs`.
3. En Apps Script: **Configuración del proyecto (engranaje) → Propiedades de la secuencia de comandos → Agregar** → nombre `SECRET`, valor una clave inventada por ti.
4. **Implementar → Nueva implementación → Tipo: Aplicación web** → Ejecutar como: *Yo* → Quién tiene acceso: *Cualquier usuario* → Implementar. Autoriza los permisos y copia la **URL de la aplicación web**.
5. En `.env`: `SHEET_WEBHOOK_URL=` esa URL y `SHEET_SECRET=` la misma clave del paso 3.

Si la hoja falla, el pedido no se pierde: ya está en la base de datos.

## 1c. Reconocer al cliente y su historial (ERP)
El bot identifica al cliente por su teléfono, le saluda por su nombre y le deja **repetir un pedido anterior** o escribir lo que quiere. Los datos vienen de `erp.js`:
- `getCustomerByPhone(phone)` busca al cliente y su historial.
- `createOrder(order)` graba el pedido (ahora: SQLite + hoja de Google opcional).

Mientras no haya API del ERP, el historial se carga desde una exportación de Excel con las líneas de venta (columnas: Artículo, Descripción, Unidades, Fecha, Precio, Nº Documento, Cliente):
```bash
python3 importar_historial.py exportacion.xlsx --nombre "Bar Alegría" --telefono "+34 600 111 222" --direccion "Plaza Mayor 3"
```
Esto crea `historial-demo.json` (catálogo con precios + pedidos del cliente). No copia costes ni márgenes. **Contiene datos de clientes: no lo subas a GitHub** (ya está en `.gitignore`).

Cuando haya API del ERP, solo hay que cambiar el interior de las funciones de `erp.js`; el bot no cambia.

**Cuestionario interactivo (cliente conocido):** el bot envía una *lista desplegable* con los artículos que el cliente suele comprar (ordenados por frecuencia, con las unidades de la última vez) y *botones* para las unidades, para añadir otro artículo, finalizar y confirmar. Usa los mensajes interactivos de la API de WhatsApp, que **solo se pueden enviar dentro de las 24 h posteriores al último mensaje del cliente** (el cliente siempre escribe primero, así que no es problema). Límites de WhatsApp: la lista admite 10 filas (el bot pagina con "Ver más artículos"), los botones 3, el título de una fila 24 caracteres y el de un botón 20. Estos mensajes no se han probado todavía con WhatsApp real (a falta del número de prueba de Meta); en la demo se simulan igual que los vería el cliente. Como mejora futura existe *WhatsApp Flows* (formulario completo dentro de WhatsApp).

## 1d. Mini-aplicación de pedido (catálogo estilo app)
A los clientes conocidos el bot les envía un botón **Hacer pedido** con un **enlace personal** a `/pedido/<token>`: una página para móvil con sus artículos habituales (precio, "Última vez: N uds", botón "+" y contador de unidades), buscador, catálogo completo, carrito, nota y confirmación. Al confirmar, el pedido se graba igual que los del chat (con código de cliente y de artículo) y el cliente recibe la confirmación por WhatsApp.
- El enlace va **firmado y caduca a las 24 h**, solo sirve para ese cliente y **para enviar un solo pedido**. Los artículos y precios se validan en el servidor.
- Necesita que el servidor esté en una dirección pública **HTTPS** (`PUBLIC_URL`) y una `LINK_SECRET` fija en `.env`.
- El botón usa el mensaje interactivo *cta_url* de la API de WhatsApp (no probado aún con WhatsApp real). Si no hay enlace, el bot usa la lista y los botones del chat; el cliente también puede escribir *lista*.
- No hay fotos de producto: se muestran iniciales de color. Las fotos, las promociones y las unidades/cajas pueden venir del ERP si lo permite (o de un fichero con una URL de imagen por artículo).

## 2. Probar sin WhatsApp
```bash
npm test
npm run demo  # abre http://localhost:3000/demo: chat simulado + pedidos + botón «Exportar a Excel ahora»
npm run dev   # sin credenciales imprime las respuestas por consola
```
La demo usa **clientes y productos ficticios** (`ejemplo/historial-ficticio.json`) salvo que exista un `historial-demo.json` propio, y guarda todo en `demo.sqlite` y `exportaciones-demo/`, sin tocar los datos reales.

## 2b. Demo en línea (sin servidor)
`demo-web/` contiene una versión de la demo que funciona **entera en el navegador** (mismo bot, mismos cálculos y mismo Excel, con datos ficticios): no se duerme, no hay datos que perder ni nada que mantener.
- Reconstruir: `node demo-web/build.mjs` (descarga esbuild con `npx` la primera vez). Genera `demo-web/dist/demo-online.html`.
- Compartir gratis: sube `demo-online.html` a cualquier alojamiento estático (GitHub Pages, Netlify, Cloudflare Pages) o ábrelo directamente en el navegador.
- Es solo una demostración: los pedidos viven en la memoria del navegador y se pierden al recargar.

## 3. Crear la app en Meta (gratis)
1. Entra en https://developers.facebook.com con tu cuenta de Facebook → **Crear app** → tipo **Empresa** → añade el producto **WhatsApp**.
2. En **WhatsApp → API Setup** verás un **número de prueba**, el `Phone number ID` y un token temporal (24 h). Añade tu móvil como destinatario de prueba.
3. Para producción: añade **tu propio número** (no puede estar en uso en la app WhatsApp normal) y crea un **usuario del sistema** en Business Settings con token permanente (permiso `whatsapp_business_messaging`).
4. Copia `.env.example` a `.env` y rellena `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET` (App settings → Basic) y un `VERIFY_TOKEN` inventado.

## 4. Publicar el servidor (gratis)
Meta necesita una URL pública HTTPS.
- **Pruebas rápidas:** `npm run dev` y, en otra terminal, `npx cloudflared tunnel --url http://localhost:3000` (te da una URL https temporal).
- **Producción gratis:** sube esta carpeta a GitHub y despliégala en Render (Web Service, Build: vacío, Start: `npm start`), poniendo las variables del `.env` en su panel. Nota: el plan gratis de Render se duerme tras 15 min sin tráfico y el primer mensaje puede tardar ~1 min; un ping gratuito (UptimeRobot a la URL cada 5 min) lo evita.

## 4b. Siempre encendido y sin perder datos
Las dos limitaciones del plan gratuito de Render (se suspende a los 15 min y los datos se borran al reiniciar) no se pueden quitar con código: son del plan. Opciones:

| Opción | Suspensión | Datos | Coste aprox. (verificar) |
|---|---|---|---|
| Render **starter** + disco (`render.yaml`) | No | Persistentes | ≈ 7 $/mes + ≈ 0,25 $/GB |
| Servidor propio (VPS) con Docker (`docker compose up -d`) | No | Persistentes (volumen) | ≈ 4–6 €/mes |
| Render gratis + UptimeRobot (ping a `/health` cada 5 min) | Casi no (puede seguir reiniciando) | **Se pierden** al reiniciar; copia de los pedidos en la hoja de Google (sección 1b) | 0 € |

- `GET /health` responde 200 solo si la base de datos funciona: úsalo para vigilar el servicio.
- Cada noche, tras la exportación, se guarda una **copia de seguridad** de `pedidos.sqlite` en `BACKUP_DIR` (se conservan las 14 últimas). Si el disco no es persistente, estas copias se pierden igual: en producción usa un disco/volumen y descarga copias fuera del servidor.
- En producción quita `DEMO=1`.

## 5. Conectar el webhook
En Meta: **WhatsApp → Configuration → Webhook**
- Callback URL: `https://TU-URL/webhook`
- Verify token: el mismo `VERIFY_TOKEN`
- Suscríbete al campo **messages**.

Escribe "hola" al número de WhatsApp y debería responder.

## Costes y reglas a tener en cuenta
- Los mensajes que respondes dentro de las 24 h posteriores al mensaje del cliente son **gratuitos**. Escribir tú primero (plantillas) sí se cobra.
- Los avisos a `OWNER_PHONE` solo llegan si tú escribiste al bot en las últimas 24 h. Si no, mira la base de datos o los logs.
- Las sesiones están en memoria: si el servidor se reinicia, los clientes a mitad de pedido vuelven al menú. En Render gratis, `pedidos.sqlite` se borra en cada despliegue; usa un disco persistente.
- No uses librerías no oficiales con tu número de negocio: pueden bloquearlo.
