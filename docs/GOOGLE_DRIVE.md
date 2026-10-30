# Clientes y productos sincronizados solos con Google Drive

La empresa deja en **una carpeta de Google Drive** los Excel que exporta a3ERP (o los edita como Hoja de Google) y el servidor los **lee cada 15 minutos**: si han cambiado, actualiza las bases de datos de clientes y de productos. Nadie tiene que importar nada a mano.

## Qué hace (y qué no)
- Busca en la carpeta el Excel **más reciente cuyo nombre contenga «clientes»** y el más reciente cuyo nombre contenga **«productos»** (también vale «artículos», «tarifa» o «catálogo»). Admite `.xlsx` y Hojas de Google.
- **Clientes:** crea los nuevos y actualiza los existentes (nombre, razón social, población, dirección, teléfonos, correos, bloqueado/obsoleto). Cada cliente activo tiene ya su cuenta creada. **El NIF no se guarda**: solo una huella de sus 6 últimos caracteres. No se toca su historial ni sus precios.
- **Productos:** crea y actualiza (código, descripción, precio, unidades por caja, IVA, descuento, bloqueado/obsoleto). Cada cambio de precio queda en el historial del producto. Los que falten en el fichero **no se borran**.
- **Protecciones:** un Excel de clientes con menos del 70 % de los clientes que ya hay se **rechaza** (suele ser un fichero a medias). Si un fichero falla, el otro se importa igual y el motivo se ve en la pestaña *Clientes* de la aplicación de la empresa; se reintenta en la siguiente revisión. Un fichero que no ha cambiado no se vuelve a importar.
- Las columnas se reconocen por su cabecera: clientes («Cód. cliente», «Organización», «Razón social», «Población», «Dirección fiscal», «Teléfono», «E-Mail», «NIF», «Bloqueado», «Obsoleto») y productos («Código», «Descripción», «Precio» y, si las hay, «Uds. por caja», «% IVA», «Dto.», «Bloqueado»). **Hay que probarlo con el Excel real de productos de a3ERP**: si alguna columna no se reconoce, el panel lo dirá y se ajusta.

## Opción A · Directo desde Google Drive (cuenta de servicio)
1. En Drive, crea una carpeta (p. ej. «VM datos») y sube `clientes.xlsx` y `productos.xlsx`. Para actualizar, **sustituye** el fichero (o sube uno nuevo con la fecha en el nombre).
2. En <https://console.cloud.google.com> crea un proyecto y activa la **Google Drive API**.
3. *IAM y administración → Cuentas de servicio → Crear* (sin roles). En la cuenta, *Claves → Añadir clave → JSON*: se descarga un fichero.
4. **Comparte la carpeta de Drive con el correo de la cuenta de servicio** (acaba en `.iam.gserviceaccount.com`) con permiso de **Lector**. Así solo puede leer esa carpeta.
5. En el `.env` del servidor:
   - `DRIVE_FOLDER_ID` = lo que hay tras `/folders/` en la dirección de la carpeta.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = el contenido del JSON en una sola línea.
   - `SYNC_MINUTES` = cada cuántos minutos revisar (15 por defecto).
6. `docker compose up -d`. En la aplicación de la empresa → *Clientes* → «Sincronización automática» verás el estado y el botón **Sincronizar ahora**.

## Opción B · Sin Google Cloud: una carpeta del servidor
Instala **Google Drive para escritorio** en el servidor (o deja que a3ERP exporte los Excel a una carpeta) y pon `SYNC_DIR=/ruta/de/la/carpeta`. Es lo más sencillo si el servidor de la oficina ya tiene Drive instalado.

## Copias de seguridad en Drive
Las cuentas de servicio **no pueden subir ficheros a «Mi unidad»**, así que las copias no se suben por la API: apunta `BACKUP_DIR` a una carpeta que sincronice Google Drive para escritorio y las copias diarias de la base de pedidos quedarán en tu Drive.

## Seguridad
- El JSON de la cuenta de servicio es una **llave**: guárdalo solo en el `.env` del servidor (nunca en GitHub) y, si se filtra, bórralo en Google Cloud y crea otro.
- Los Excel de la carpeta contienen **datos de clientes (incluido el NIF)**: no la compartas con nadie más.
- Solo la aplicación de la empresa se conecta a Drive; la que ven los clientes no tiene las credenciales.
