# Clientes, productos e historial sincronizados solos con Google Drive

## Cómo encaja con las copias de a3ERP (el bot en internet, a3 en la oficina)

```
SERVIDOR DE LA OFICINA                     GOOGLE DRIVE                         BOT EN INTERNET (nube)
a3ERP ──► script de copia ──► carpeta «copias»  (PRIVADA, copias pesadas)      (no la ve)
              │
              └─► paso de extracción ──► carpeta «datos» ──────────────────────► lee cada 15 min
                  (lee la copia SOLO en        clientes.xlsx · productos.xlsx       (cuenta de servicio con permiso
                   lectura y saca solo lo      historial-ventas.xlsx                 de Lector SOLO sobre «datos»)
                   necesario)
```

- **Las copias pesadas de a3 nunca las lee el bot.** Se quedan en una carpeta «copias» que **no se comparte con la cuenta de servicio**. El bot solo ve la carpeta «datos», con tres Excel pequeños: así no baja gigas cada 15 minutos y, si alguien entrara en el bot, no tendría acceso a la contabilidad.
- El **paso de extracción** (en el servidor de la oficina, después de la copia) abre la copia en modo solo lectura y deja esos tres Excel. Se prepara aparte, cuando se conozca el formato de la copia y las tablas de a3.
- Si el bot está en internet, usa la **Opción A** de abajo (cuenta de servicio). La opción B (carpeta local) es para cuando el bot corre en el mismo servidor.

## Los tres Excel que lee el bot (carpeta «datos»)
| Fichero (el nombre debe contener…) | Columnas (por su cabecera) | Para qué |
|---|---|---|
| `clientes` | Cód. cliente · Organización · Razón social · Población · **Cód. municipio** · Dirección fiscal · Teléfono · E-Mail · NIF · Bloqueado · Obsoleto | Clientes y sus cuentas (acceso con los 6 últimos del NIF). **El código de municipio decide quién puede pedir para «hoy»**: solo `47085` (Medina del Campo); sin esa columna, nadie ve «hoy». |
| `productos` (o «artículos», «tarifa», «catálogo») | Código · Descripción · Precio · Uds. por caja · % IVA · Dto. · Categoría o Familia · Subcategoría o Subfamilia · Bloqueado | Catálogo, precios y categorías |
| `historial` (o «compras», «ventas», «albarán») | Cód. cliente · Fecha · Documento · Cód. artículo · Cantidad | La pestaña «Histórico» de cada cliente (lo que suele comprar) |

El historial guarda los **30 últimos pedidos de cada cliente**; conviene que el paso de extracción mande solo los últimos 12 meses y solo líneas de venta (los abonos, con cantidad negativa, se ignoran). El historial se importa **después** de los clientes y de los productos, y se rechaza si ninguno de sus clientes existe en la base.

La empresa deja en **una carpeta de Google Drive** los Excel que exporta a3ERP (o los edita como Hoja de Google) y el servidor los **lee cada 15 minutos**: si han cambiado, actualiza las bases de datos de clientes y de productos. Nadie tiene que importar nada a mano.

## Qué hace (y qué no)
- Busca en la carpeta el Excel **más reciente cuyo nombre contenga «clientes»** y el más reciente cuyo nombre contenga **«productos»** (también vale «artículos», «tarifa» o «catálogo»). Admite `.xlsx` y Hojas de Google.
- **Clientes:** crea los nuevos y actualiza los existentes (nombre, razón social, población, dirección, teléfonos, correos, bloqueado/obsoleto). Cada cliente activo tiene ya su cuenta creada. **El NIF no se guarda**: solo una huella de sus 6 últimos caracteres. No se toca su historial ni sus precios.
- **Productos:** crea y actualiza (código, descripción, precio, unidades por caja, IVA, descuento, bloqueado/obsoleto). Cada cambio de precio queda en el historial del producto. Los que falten en el fichero **no se borran**.
- **Protecciones:** un Excel de clientes con menos del 70 % de los clientes que ya hay se **rechaza** (suele ser un fichero a medias). Si un fichero falla, el otro se importa igual y el motivo se ve en la pestaña *Clientes* de la aplicación de la empresa; se reintenta en la siguiente revisión. Un fichero que no ha cambiado no se vuelve a importar.
- Las columnas se reconocen por su cabecera: clientes («Cód. cliente», «Organización», «Razón social», «Población», «Dirección fiscal», «Teléfono», «E-Mail», «NIF», «Bloqueado», «Obsoleto») y productos («Código», «Descripción», «Precio» y, si las hay, «Uds. por caja», «% IVA», «Dto.», «Categoría» o «Familia», «Subcategoría» o «Subfamilia», «Bloqueado»). **Hay que probarlo con el Excel real de productos de a3ERP**: si alguna columna no se reconoce, el panel lo dirá y se ajusta.

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
