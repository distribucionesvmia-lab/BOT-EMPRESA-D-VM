# Informe de visita al servidor: qué mirar y qué anotar

**Objetivo:** reunir los datos que faltan para construir el conector entre a3ERP y el sistema de pedidos (`docs/PROMPT_CONECTOR.md`). Sobre todo cuatro cosas: **cómo está instalado a3ERP**, **el esquema de su base de datos**, **cómo se crean pedidos por programa** y **si el servidor puede salir a internet**.

## Reglas de oro (léelas antes de entrar)

1. **No cambies nada.** Todo lo de este informe es de lectura. Nada de instalar, borrar, reiniciar ni modificar datos.
2. **Pide permiso por escrito** a la empresa y, si lo hay, al informático o al distribuidor de a3ERP. Que alguien de confianza esté presente.
3. **No copies datos de clientes.** Solo interesa la **estructura** (nombres de tablas y columnas, versiones, configuraciones). Para comprobar un campo, usa un cliente de prueba o enmascara los datos.
4. **No apuntes contraseñas** en este informe. Si te dan una cuenta, que sea temporal y de solo lectura.
5. **Haz fotos de las pantallas**, sin que salgan datos personales de clientes.
6. Si algo de la lista de «Señales de alarma» (final del documento) se cumple, **para y avisa** antes de seguir.

## Antes de ir

- [ ] Autorización de la empresa, por escrito (correo vale).
- [ ] Contacto del informático y del distribuidor de a3ERP, por si hay dudas.
- [ ] Una **copia de seguridad reciente** de a3ERP (confirma que existe; no la restaures).
- [ ] Acceso al servidor (escritorio remoto o en persona) con una cuenta que **pueda ver** la configuración.
- [ ] Hora acordada en la que no se esté facturando (mejor fuera de horario).
- [ ] Móvil con cámara y este documento. Mejor llevar un portátil para pegar resultados.

---

## 1. El servidor (sistema y red)

Anota en la tabla de resultados del final. Comandos de solo lectura, en PowerShell:

```powershell
systeminfo | findstr /B /C:"Nombre de host" /C:"Nombre del sistema operativo" /C:"Versión del sistema" /C:"Memoria física total"
Get-PSDrive -PSProvider FileSystem
Get-Service | Where-Object { $_.DisplayName -match "SQL|a3|Wolters" }
Test-NetConnection -ComputerName example.com -Port 443
w32tm /query /status
```

| Qué mirar | Por qué importa |
|---|---|
| Sistema operativo y versión (Windows Server 2012/2016/2019/2022…) | Decide la versión de .NET que podemos usar |
| ¿Es un servidor físico o una máquina virtual? RAM y espacio libre | Que aguante un servicio adicional |
| ¿Es **el mismo servidor** el que tiene a3ERP y SQL Server? | Dónde se instalaría el conector |
| ¿Tiene **salida a internet por HTTPS (puerto 443)**? Resultado de `Test-NetConnection` | El conector **solo sale**; si no puede salir, no funciona |
| ¿Hay proxy, filtro web o cortafuegos que bloquee? ¿Quién lo gestiona? | Puede exigir autorización de dominios |
| ¿La **hora** está sincronizada? (`w32tm`) | Las peticiones firmadas caducan a los 5 minutos |
| Antivirus o EDR instalado | Puede bloquear un servicio nuevo; pedir excepción |
| ¿Se puede instalar el runtime **.NET 8**? ¿Quién lo autoriza? | Necesario para el conector |
| Acceso remoto habitual (RDP, VPN, TeamViewer) | Para soporte y mantenimiento |
| Copias del propio servidor y quién las hace | Recuperación ante desastre |

---

## 2. a3ERP (el programa)

| Qué mirar | Cómo | Por qué importa |
|---|---|---|
| **Versión exacta** | Ayuda → Acerca de (foto) | Todo depende de la versión |
| **¿Instalación en el servidor de la empresa o en la nube?** | Cómo se abre, dónde está el ejecutable | Si es en la nube, **no hay acceso a la base de datos**: cambia el plan |
| Carpeta de instalación y de datos | Propiedades del acceso directo | Localizar las DLL |
| **DLL / SDK / ejemplos** | Mira la carpeta de instalación por subcarpetas llamadas *SDK, Enlace, API, Ejemplos, Docs* | Es la vía oficial para **crear pedidos** |
| Nº de usuarios, **módulos y licencias contratados** | Ayuda → Licencia, o el contrato | Puede haber un módulo de importación o de enlace |
| **Empresas** que hay y si existe una **empresa de pruebas** | Selector de empresa al entrar | Para probar sin tocar la real |
| Ejercicio actual, **series de pedidos** (p. ej. `PD1`) y numeración | Ventana de pedidos de venta | Para el campo serie y referencias |
| Menús **Importar / Exportar / Utilidades / Enlaces / Documentos** | Recorrer los menús, foto de cada uno | Puede haber importación de pedidos desde Excel o texto |
| **Plantilla de importación de pedidos** (si existe) | Pedir una con datos ficticios | Define las columnas exactas del Excel |
| Ficha de artículo: campos de **unidades por caja, tipo de IVA, descuento, tarifas, activo** | Foto de la ficha, sin datos sensibles | Mapear a nuestro catálogo |
| Ficha de cliente: **nombre comercial, teléfonos (¿cuántos?), dirección, recargo de equivalencia, tarifa, forma de pago, representante, baja** | Foto de la ficha | Mapear a nuestra base de clientes |
| Dónde se definen **precios especiales** y **descuentos** por cliente y artículo | Foto de esas pantallas | Para calcular precios como lo hace a3ERP |
| Si un pedido creado por programa **recalcula precios, IVA y descuentos** o hay que enviarlos | Pregunta al distribuidor | Define qué datos manda el conector |
| ¿Hay **control de stock**, **límite de crédito** o bloqueos que puedan rechazar un pedido? | Pregunta al personal | Un pedido podría fallar por esto |

**Cómo localizar las DLL (solo lectura):** desde PowerShell, en la carpeta de instalación, lista los ficheros con su versión.

```powershell
Get-ChildItem -Path "C:\RUTA\DE\a3ERP" -Recurse -Filter *.dll -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "a3|wk|enlace|api" } |
  Select-Object Name, @{n="Version";e={$_.VersionInfo.FileVersion}}, DirectoryName
```
(Sustituye la ruta por la real. Solo anota nombres y versiones: no copies los ficheros.)

---

## 3. SQL Server (la base de datos)

Pide al informático que ejecute estas consultas (o ejecútalas tú con su permiso) en SQL Server Management Studio. **Son todas de lectura.**

```sql
-- Versión y edición
SELECT @@VERSION;

-- Bases de datos (suele haber una por empresa y una de sistema)
SELECT name, state_desc, recovery_model_desc, collation_name FROM sys.databases;

-- Tablas más grandes de una empresa (cambiar NOMBRE_BD por la base de la empresa)
USE NOMBRE_BD;
SELECT s.name AS esquema, t.name AS tabla, SUM(p.rows) AS filas
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY s.name, t.name
ORDER BY filas DESC;

-- Columnas de las tablas candidatas (sustituir los nombres cuando se identifiquen)
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('TABLA1', 'TABLA2')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Usuarios y roles que existen (para saber si hay uno de solo lectura)
SELECT name, type_desc FROM sys.database_principals WHERE type IN ('S', 'U', 'G');
```

**Qué hay que averiguar en la base (solo estructura):**

| Entidad | Datos que necesitamos localizar |
|---|---|
| **Artículos** | código, descripción, precio de venta, unidades por caja, tipo de IVA, descuento general, baja |
| **Clientes** | código, nombre comercial, razón social, teléfono(s), dirección, recargo de equivalencia, tarifa, baja |
| **Precios especiales** artículo/cliente | tabla y campos |
| **Descuentos** artículo/cliente | tabla y campos |
| **Tarifas** | tablas y cómo se asignan a clientes |
| **Tipos de IVA y recargo** | tabla y porcentajes |
| **Pedidos / albaranes / facturas de venta** (cabecera y líneas) | para el historial de compras (cliente, fecha, nº de documento, artículo, unidades) |
| **Series y numeración** | cómo se asigna el siguiente número |

Además anota:
- [ ] Versión y edición de SQL Server, nombre de la instancia y puerto.
- [ ] Modo de autenticación (solo Windows o mixto).
- [ ] ¿Existe un usuario **de solo lectura**? Si no, ¿pueden crear uno?
- [ ] ¿Los nombres de tablas y columnas son legibles o son códigos?
- [ ] **Calidad de datos** (sin ver datos personales): ¿hay clientes con el mismo teléfono? ¿Teléfonos vacíos? ¿Cuántos clientes y artículos están dados de baja?

---

## 4. Copias de seguridad

| Qué mirar | Por qué importa |
|---|---|
| ¿Dónde se guardan y **con qué extensión** (`.bak`, `.zip`, otra)? | Decide si podemos leerlas |
| Tamaño, frecuencia y **cuántas se conservan** | |
| ¿Quién las hace: a3ERP, SQL Server Agent, otro programa? | |
| La sincronización con **OneDrive**: cuenta, carpeta y cliente instalado | Si siguen subiendo a OneDrive |
| ¿Se ha probado alguna vez a **restaurar**? | Fiabilidad |

Para ver los trabajos de SQL Server: en SSMS, SQL Server Agent → Jobs (si está activo).

---

## 5. Crear pedidos desde un programa (lo más importante)

Pregunta al **distribuidor de a3ERP** (o a Wolters Kluwer) y anota la respuesta:

1. ¿Existe una **DLL o SDK oficial** para crear pedidos de venta? ¿Cómo se llama, qué versión, hay **documentación y ejemplos**?
2. ¿Requiere **licencia o módulo de pago**? ¿Cuánto cuesta y cómo se contrata?
3. ¿Puede el contrato permitir **leer la base de datos** con otro programa sin perder el soporte?
4. ¿Hay un **asistente de importación** que admita **pedidos de venta** desde Excel o texto? ¿Con qué plantilla? ¿Admite el campo «Referencia»?
5. Al crear un pedido por programa, ¿**a3ERP calcula** precio, descuento e IVA según la tarifa del cliente, o hay que enviarlos?
6. ¿Cómo se indican **cajas y unidades**?
7. ¿Se puede evitar duplicados con la **Referencia**? ¿Se puede buscar un pedido por ella?
8. ¿Qué **permisos de usuario** necesita el programa que crea pedidos?
9. ¿Hay una **empresa de pruebas** o se puede crear una copia de la real?
10. ¿Qué ocurre con las **actualizaciones** de a3ERP: avisan de cambios en la DLL?
11. ¿Existe la **Link API**? ¿Sirve para una instalación en el servidor de la empresa? ¿Qué cuesta?

---

## 6. Seguridad, instalación y legal

- [ ] ¿Qué **cuenta de Windows** ejecutaría el servicio? ¿Puede ser una cuenta de servicio con permisos mínimos?
- [ ] ¿Quién puede **autorizar instalar** un servicio de Windows en el servidor?
- [ ] ¿Dónde se guardan los **registros** y quién los revisa? ¿Hay un sistema de alertas?
- [ ] **RGPD:** ¿quién es el responsable del tratamiento? ¿Hace falta un contrato de encargado con el proveedor de nuestra aplicación? ¿Dónde estarán los datos?
- [ ] ¿La empresa tiene política sobre **conexiones salientes** y software de terceros?
- [ ] ¿Quién da **soporte** si el conector falla, y con qué horario?

---

## 7. Orden recomendado de la visita (60-90 minutos)

1. Presentaciones y confirmar permisos (5 min).
2. **a3ERP:** versión, instalación, módulos, empresa de pruebas y fotos de pantallas (20 min).
3. **DLL / SDK / importación:** buscar y preguntar (15 min).
4. **SQL Server:** versión, bases, tablas y usuarios (20 min).
5. **Servidor y red:** salida a internet, hora, .NET (10 min).
6. **Copias de seguridad** (5 min).
7. Revisar qué falta y acordar cómo mandar lo pendiente (10 min).

---

## 8. Señales de alarma (parar y avisar)

- a3ERP está **en la nube**, no en vuestro servidor → no hay acceso a la base de datos; habría que usar la Link API o el Excel.
- **No hay salida a internet** desde el servidor y no se puede abrir → el conector no puede funcionar tal como está diseñado.
- La **DLL no existe, no tiene documentación** o exige una licencia que no podéis o no queréis comprar.
- La base de datos está **cifrada** o no se permite ni siquiera el acceso de lectura.
- El **contrato** prohíbe el acceso a la base de datos por terceros.
- No existe **empresa de pruebas** y no se puede crear una copia.
- Alguien pide **contraseñas o datos de clientes** para el desarrollo: no se entregan; se usan datos ficticios.

---

## 9. Hoja de resultados (rellénala en la visita)

| Dato | Resultado | Quién lo confirma |
|---|---|---|
| Fecha y persona que acompaña | | |
| Versión de a3ERP | | |
| a3ERP: servidor propio o nube | | |
| Módulos y licencias | | |
| Empresas / ¿empresa de pruebas? | | |
| Series de pedidos y numeración | | |
| Ruta de instalación y DLL encontradas (nombre y versión) | | |
| SDK / documentación disponible | | |
| ¿Importación de pedidos desde Excel? Plantilla | | |
| Versión y edición de SQL Server | | |
| Instancia, puerto y autenticación | | |
| Bases de datos (nombres) | | |
| Tablas de artículos | | |
| Tablas de clientes | | |
| Tablas de precios especiales y descuentos | | |
| Tablas de pedidos / albaranes / facturas | | |
| ¿Usuario SQL de solo lectura? | | |
| Sistema operativo del servidor | | |
| Salida a internet (443) | | |
| Hora sincronizada | | |
| Copias: formato, frecuencia, OneDrive | | |
| Quién autoriza instalar el servicio | | |
| Respuestas del distribuidor (sección 5) | | |

## 10. Qué hacer con los resultados

| Si encuentras… | El plan será… |
|---|---|
| Servidor propio, SQL Server, DLL documentada y empresa de pruebas | El conector completo (lectura por SQL y escritura por la DLL) |
| Importación de pedidos desde Excel disponible | Conector de lectura, y la entrada de pedidos con el Excel o con importación programada |
| Solo Link API de pago | Valorar el coste frente al beneficio antes de decidir |
| Nube, sin acceso a la base | Exportaciones programadas del propio a3ERP, o la Link API |
| Sin salida a internet | Resolver primero la red con el informático |

Cuando tengas esta hoja completa (sin datos de clientes ni contraseñas), pásamela y completo los documentos `docs/DATOS_NECESARIOS.md` y las consultas reales del conector.
