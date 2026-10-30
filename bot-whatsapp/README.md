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

## 1c-bis. Identificación por nombre y las dos bases de datos (productos y clientes)
**Flujo:** el cliente escribe «hola» → el bot pregunta *el nombre de su negocio* (o su código de cliente) → lo busca en la base de clientes → si lo encuentra, dice **«¡Identificado!»** y le muestra sus **productos habituales** (según sus últimos pedidos) con el botón «Hacer pedido». Si no lo encuentra, deja reintentar y, tras 3 fallos, avisa a una persona. «nuevo» sigue el flujo de cliente nuevo. Si varios clientes encajan con el nombre, pide el *código de cliente* para distinguirlos (nunca enseña nombres de otros clientes).
- Reglas del buscador (`identify.js`): coincidencia exacta del nombre o del código, o todas las palabras escritas dentro del nombre cubriendo al menos el 60 %; sin tildes ni mayúsculas. «bar» a secas no identifica a nadie.
- En el modo demo **siempre** se pregunta quién es. En producción, si el teléfono ya está en la base de clientes (y no lo comparten varios), se le reconoce sin preguntar; si no, se pregunta el nombre. **Quien se identifica solo por nombre desde un teléfono que no es el del cliente tiene su pedido retenido** hasta que una persona lo revise (`node exportar.js --aprobar …`).

**Dos bases de datos** (aparte de la de pedidos), solo de lectura para el bot:
| Base | Fichero (variable) | Contiene |
|---|---|---|
| Productos | `catalogo.sqlite` (`CATALOG_DB`) | código, nombre, precio, unidades por caja, IVA, descuento general, alta/baja y **registro de cada cambio** |
| Clientes | `clientes.sqlite` (`CUSTOMERS_DB`) | ficha (nombre, teléfono, dirección, recargo de equivalencia), precios especiales, descuentos personalizados e **historial de compras** |

Se gestionan con `node datos.js`: `importar <fichero.json>` (crea o actualiza; solo se tocan y se registran los campos que cambian), `ejemplo` (datos ficticios), `productos`, `clientes`, `precio <código> <precio>`, `historial <código>` y `buscar <nombre>`. Si cambian los productos o precios, el bot los usa **sin reiniciar**. La primera vez, si las bases están vacías, se cargan de `historial-demo.json` (el que genera `importar_historial.py`) o, en la demo, de `ejemplo/`. Más adelante la sincronización con a3ERP alimentará estas mismas bases.

## 1c-ter. Cuentas de clientes (sin WhatsApp): alta aprobada por la empresa, teléfono + PIN
Cada cliente entra en `/cliente` con su **teléfono y un PIN de 6 cifras**; la empresa lo gestiona en `/distribuidor`. Así **un cliente nunca ve el historial de otro**.
1. **Solicitud:** el cliente pide acceso con el nombre de su empresa, su teléfono y su correo.
2. **Aprobación:** la empresa abre `/distribuidor` (clave en `ADMIN_TOKEN`), ve la solicitud con **sugerencias de a qué cliente corresponde** (por nombre y por teléfono), llama al cliente para comprobar que es él y pulsa *Aprobar*. Se genera un **PIN que se muestra una sola vez**, para dárselo por teléfono. Con esa llamada se comprueba también que el teléfono es suyo: **un teléfono solo no es un secreto**, por eso hace falta el PIN.
3. **Acceso:** teléfono + PIN. La sesión dura 30 días en una cookie `HttpOnly` y `SameSite=Strict`.
4. **Chat y catálogo:** `/cliente` (chat con sus productos habituales) y `/catalogo` (la mini-aplicación).

**Privacidad y seguridad (comprobado con pruebas de extremo a extremo en `server.test.js`):**
- El cliente sale **siempre de la sesión**: ninguna ruta acepta un código de cliente enviado por el navegador. Un cliente no puede pedir datos ni hacer pedidos «como» otro, ni con parámetros, ni con el cuerpo, ni con una cookie falsa.
- El PIN y el token de sesión no se guardan en claro (scrypt y SHA-256). Teléfono desconocido y PIN erróneo dan **la misma respuesta**.
- 5 fallos bloquean la cuenta 15 minutos; tras 3 bloqueos queda bloqueada hasta que la empresa la reactive. Límite de intentos por IP.
- Un **nuevo PIN** o **bloquear** cierra todas las sesiones de esa cuenta.
- Los pedidos se guardan con una clave: reenviar el mismo pedido no lo duplica.
- Variables: `ACCOUNTS_DB` (por defecto `cuentas.sqlite`), `ADMIN_TOKEN` (clave de la empresa; sin ella no se puede administrar; en la demo es `demo`), `TRUST_PROXY=1` si hay un proxy delante (para leer la IP real), y `PUBLIC_URL` con `https://` para que la cookie sea `Secure`.
- Si se olvida el PIN: la empresa genera uno nuevo. Recuperarlo por correo requeriría un servicio de envío.
- El código de WhatsApp (`/webhook`) sigue en el proyecto pero ya no se usa.

## 1c-quater. Dos aplicaciones distintas: la del cliente y la de la empresa
Comparten las mismas bases de datos, pero **no se mezclan**: lo que se entrega al cliente no contiene nada de lo del empresario.

| | Aplicación del **cliente** (el bot) | Aplicación de la **empresa** (el empresario) |
|---|---|---|
| Dirección | `/cliente` y `/catalogo` | `/empresa` (también `/distribuidor`) |
| Qué ve | Acceso con teléfono + PIN, chat con sus productos habituales, catálogo de pedido | **Pedidos** recibidos (con líneas, totales y observaciones), exportación a Excel y descarga, **solicitudes de alta** de clientes y cuentas |
| Acceso | Cuenta del cliente (teléfono + PIN) | Clave de la empresa (`ADMIN_TOKEN`) |
| Arrancar solo esta | `npm run start:cliente` (`APP_MODE=cliente`) | `npm run start:empresa` (`APP_MODE=empresa`) |

- Con `APP_MODE=cliente` el servidor **no tiene ninguna ruta de administración**: ni con la clave correcta responde (comprobado en las pruebas). Con `APP_MODE=empresa` no sirve nada del cliente.
- Pueden ir en **dos servidores o procesos distintos**, por ejemplo la del cliente en internet y la de la empresa solo en la red de la oficina, apuntando a los mismos ficheros de base de datos. Con `APP_MODE=todo` (por defecto y en la demo) van juntas.
- En la aplicación de la empresa: los pedidos nuevos aparecen solos (se actualiza cada 15 segundos) y avisa de cuántos pedidos y solicitudes hay pendientes; los pedidos dudosos o de clientes sin código quedan **retenidos** hasta que se marquen como revisados.
- La exportación diaria automática a Excel solo la lanza la aplicación de la empresa.

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
`demo-web/` contiene una versión de la demo que funciona **entera en el navegador** (mismo bot, mismos cálculos y mismo Excel, con datos ficticios), con las **dos aplicaciones separadas**, cada una con su enlace:
- `…#cliente` — la del cliente: solicitar acceso, entrar con **teléfono + PIN** y chat con el bot (sus productos habituales). Nada de lo de la empresa.
- `…#empresa` — la del empresario: **Pedidos** (en directo, con exportación a Excel e historial), **Solicitudes de alta** (aprobar y dar el PIN), **Cuentas de clientes** y **Bases de datos** (precios editables).
- Cuentas de prueba: `600 000 001` PIN `111111` (Bar El Ejemplo) y `600 000 002` PIN `222222` (Tienda Ficticia).

**Las bases de datos se guardan y se actualizan** (productos, clientes, pedidos, exportaciones, solicitudes y cuentas).
- Publicada como página de Claude usan su **base compartida** (`db`): persisten y se ven en directo entre dispositivos. Permisos: cualquiera puede leer; **Colaborador** puede hacer pedidos y solicitar acceso; **Editor** puede exportar, aprobar altas, cambiar precios y restaurar los datos.
- Como archivo suelto (`demo-online.html`) se guardan en el navegador (localStorage).
- ⚠️ En la demo **no hay aislamiento real entre clientes** (la base compartida la lee cualquiera con acceso a la página). Ese aislamiento solo existe en el servidor real (sección 1c-ter), que lo comprueba con pruebas.

Reconstruir: `node demo-web/build.mjs` (descarga esbuild con `npx` la primera vez) → `demo-web/dist/artifact.html` (para publicar como página de Claude) y `demo-web/dist/demo-online.html`.

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
