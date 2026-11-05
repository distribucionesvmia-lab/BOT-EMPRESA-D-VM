# Subir el programa a Render, paso a paso

Render es un servicio que ejecuta el programa en internet. Las **claves no hay que inventarlas**: Render las crea solo; tú solo las copias y las guardas.

**Coste:** hace falta el plan **Starter** (unos 7 $/mes) más el disco de 1 GB (unos 0,25 $/mes). El plan gratuito no vale: se apaga solo y no guarda los datos.

## Antes de empezar, ten a mano
- Tu cuenta de GitHub (la que tiene el repositorio `BOT-EMPRESA-D-VM`).
- El fichero JSON de la cuenta de servicio de Google (el que descargaste) y el identificador de la carpeta `datos` de Drive.
- La cuenta de correo de IONOS que enviará los avisos (usuario y contraseña) y la dirección a la que llegarán los pedidos.

## 1. Crear el servicio
1. Entra en https://render.com y crea una cuenta (puedes usar «Continuar con GitHub»).
2. Pulsa **New → Blueprint**, conecta GitHub y da acceso al repositorio `BOT-EMPRESA-D-VM`.
3. Elige la rama `claude/eager-hamilton-gknalq`. Render lee solo el fichero `render.yaml` de la raíz y propone el servicio `bot-pedidos-vm` con su disco.
4. Render te pide los valores que no se pueden poner por adelantado:
   | Campo | Qué poner |
   |---|---|
   | `PUBLIC_URL` | Déjalo vacío por ahora; se rellena en el paso 3 |
   | `DRIVE_FOLDER_ID` | El identificador de la carpeta `datos` de Drive (lo último de su dirección: `drive.google.com/drive/folders/ESTO`) |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Abre el JSON descargado, copia **todo su contenido** y pégalo aquí |
   | `SMTP_USER` / `SMTP_PASS` | Usuario y contraseña de la cuenta de IONOS |
   | `MAIL_FROM` | La dirección que aparece como remitente (normalmente la misma que `SMTP_USER`) |
   | `MAIL_TO` | La dirección que recibirá los avisos de pedido (varias, separadas por comas) |
5. Pulsa **Apply**. Render construye y arranca el programa (unos minutos).

## 2. Las claves que Render crea solas
Entra en el servicio → **Environment**. Verás tres valores ya rellenos (el texto largo y raro, es normal):
- `ADMIN_TOKEN`: **tu clave para entrar a la aplicación de la empresa**. Cópiala.
- `NIF_PEPPER`: el secreto con el que se protegen los NIF de los clientes. **Cópiala y no la cambies nunca.** Si la pierdes o se regenera, los clientes dejan de poder entrar hasta volver a cargar los clientes.
- `LINK_SECRET`: firma los enlaces de pedido. No hace falta copiarla, pero tampoco la cambies.

Guarda `ADMIN_TOKEN` y `NIF_PEPPER` en un gestor de contraseñas o en un papel en lugar seguro. **No las pegues en chats, correos ni en GitHub.**

## 3. Poner la dirección pública
1. En la parte de arriba del servicio, Render muestra su dirección, del tipo `https://bot-pedidos-vm.onrender.com`.
2. En **Environment**, edita `PUBLIC_URL` y pon esa dirección completa con `https://`.
3. Guarda: Render reinicia solo.

## 4. Dar acceso a Google Drive
1. Abre el JSON de la cuenta de servicio y copia el valor de `client_email` (termina en `iam.gserviceaccount.com`).
2. En Drive, comparte la carpeta `datos` con ese correo como **Lector**.
3. Deja en esa carpeta los Excel de clientes, artículos e histórico (con «clientes», «articulos» y «historial» en el nombre).

## 5. Comprobar que funciona
1. `https://TU-DIRECCIÓN/health` debe responder «ok».
2. `https://TU-DIRECCIÓN/cliente` es lo que ven los clientes. Entra con los 6 primeros dígitos del DNI/CIF de un cliente de prueba (por ejemplo el Geli).
3. `https://TU-DIRECCIÓN/empresa` es la aplicación de la empresa: entras con `ADMIN_TOKEN`. Pulsa **Sincronizar ahora** y mira que aparecen clientes y productos.
4. Haz un pedido de prueba y comprueba que llega el correo y que se exporta el Excel.

## Detalles que conviene saber
- En Render la aplicación de la empresa (`/empresa`) también queda en internet, protegida solo por `ADMIN_TOKEN`. Es una clave larga y el programa bloquea la IP tras 10 intentos fallidos, pero no es lo ideal. Más adelante se puede restringir con un acceso aparte (por ejemplo Cloudflare Access).
- Un dominio propio (`pedidos.tuempresa.es`): en Render, **Settings → Custom Domains**, y en IONOS un registro CNAME apuntando a la dirección de Render. Después cambia `PUBLIC_URL`.
- Las copias de seguridad se guardan cada noche en el mismo disco, y Render hace además copias del disco de los últimos 7 días. Baja de vez en cuando las copias a otro sitio.
