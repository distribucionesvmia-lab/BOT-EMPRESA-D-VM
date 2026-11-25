# Seguridad: bots, accesos y virus (guía para la oficina)

## Lo que ya hace el programa (no tienes que tocar nada)
- Hace falta entrar para pedir; límite de intentos por dirección y de fallos de NIF por hora; códigos guardados con `scrypt`; el NIF no se guarda.
- **Campo trampa** en «Hazte cliente»: un campo invisible que solo rellenan los bots. Si viene relleno, la solicitud se descarta (el bot cree que ha ido bien).
- **Límite de pedidos**: 30 por cliente y hora (`PEDIDOS_LIMIT` en `C:\vm\config\cliente.env`).
- **Cabeceras de seguridad** en todas las respuestas (no se pueden incrustar en otras webs, nada de scripts de dominios ajenos salvo Cloudflare, etc.).
- Los hechos raros se apuntan en `C:\vm\logs` con la etiqueta `[VM seguridad]` (alta con campo trampa, muchas solicitudes, muchos intentos de acceso, demasiados pedidos).

## 1. «No soy un robot» (Cloudflare Turnstile, gratis) — lo haces tú
1. Crea una cuenta gratuita en Cloudflare → «Turnstile» → «Add site» (tipo «Managed»; dominio: el de tu web de pedidos).
2. Te da dos claves: **Site key** (pública) y **Secret key** (privada).
3. En `C:\vm\config\cliente.env` añade (guardado en UTF-8):
   `TURNSTILE_SITE=la-clave-publica` y `TURNSTILE_SECRET=la-clave-privada`
4. Reinicia «VM Cliente». Desde ese momento el formulario de alta pide la comprobación, y el acceso la pide solo tras 5 intentos seguidos desde la misma dirección (`CAPTCHA_DESPUES_DE`).
5. **No pegues nunca la clave privada en chats, correos ni GitHub.** Sin las dos claves no se pide nada.

## 2. HTTPS y escudo delante de la web (Cloudflare Tunnel, gratis) — lo haces tú
Es lo que más protege: no abres puertos del router, tienes HTTPS y Cloudflare filtra bots y ataques. En Cloudflare → «Zero Trust» → «Networks» → «Tunnels» → crea un túnel con la aplicación `cloudflared` en el ordenador de la oficina y apunta tu dominio a `http://localhost:3000`. **Nunca publiques el 3001 (panel).** Cuando funcione con HTTPS, añade `HSTS=1` en `cliente.env` y reinicia (obliga al navegador a usar siempre HTTPS). En Cloudflare puedes activar «Bloquear países» (dejar solo España) y «Bot Fight Mode».

## 3. Virus y ordenador de la oficina — lo haces tú
- Windows Update al día y Microsoft Defender activado (gratis y suficiente).
- No navegar ni abrir correos en ese ordenador.
- Copia de seguridad **fuera** del ordenador (disco externo o nube) de `C:\vm\datos` y de `BACKUP_DIR`: si un virus cifra el disco, las copias del mismo disco también se pierden.
- Contraseñas largas y distintas para `ADMIN_TOKEN` y para cualquier acceso remoto (TeamViewer, etc.).

## Añadido después (segunda tanda de seguridad)
- **Si usas Cloudflare Tunnel (o cualquier proxy): pon `TRUST_PROXY=1` en `C:\vm\config\cliente.env`.** Sin eso, todos los clientes llegan «desde la misma dirección» (la del túnel) y los límites de intentos pueden bloquear a todos a la vez. El programa avisa en `C:\vm\logs` si falta. Con `TRUST_PROXY=1` se usa la dirección que pone Cloudflare (`CF-Connecting-IP`), que un cliente no puede falsear. **Solo activarlo si la web está DETRÁS del túnel** (nunca con el puerto abierto directamente a internet).
- **Segunda carpeta de copias:** `BACKUP_DIR2=D:\copias-vm` (un disco USB) o la carpeta de OneDrive/Drive en `empresa.env`. Cada noche, tras la copia de siempre, se copia ahí y se guardan las 14 últimas. Si no se llena (USB desconectado), llega un aviso `[VM vigilancia]`.
- **Panel → «Cuentas de clientes» → «Seguridad y actividad del panel»:** lo que el programa ha parado y lo que se ha hecho en el panel (precios, ofertas, borrados, enlaces…) con hora y dirección.
- **Avisos por correo:** si en 24 h se paran 10 o más intentos sospechosos (`SEGURIDAD_AVISO_DESDE`), llega un `[VM vigilancia]`; también si la clave del panel (`ADMIN_TOKEN`) es corta o fácil (cámbiala por una de 20 letras y números como mínimo).
- **Al cliente:** le llega un aviso al móvil si cambian su código de entrada o si alguien entra desde un aparato nuevo (solo si tiene los avisos activados).

## Escudo general contra inundaciones y escáneres (tercera tanda)
- **Límite por dirección** en la web pública (puerto 3000): 300 peticiones por minuto (`ESCUDO_POR_MINUTO`) y 1.500 de fotos y estilos (`ESCUDO_ESTATICO_POR_MINUTO`). Quien se pasa recibe «429 Demasiadas peticiones» y queda bloqueado 10 minutos; si reincide, el doble, el cuádruple… hasta 24 h.
- **Escáneres**: quien pide rutas que este programa no tiene y que solo busca un bot (`/.env`, `/.git`, `/wp-login.php`, `phpmyadmin`, `*.php`, `*.sql`, `..`) queda bloqueado 30 minutos a la primera.
- Se apunta en el registro como `inundacion-de-peticiones` y `busca-rutas-de-ataque` (cuentan para el aviso por correo de «intentos sospechosos»). `/health` y el webhook de WhatsApp (que ya va firmado) no pasan por el escudo; la propia máquina tampoco.
- **Tope de conexiones a la vez**: 2.000 (`MAX_CONEXIONES`).
- **Importante**: con Cloudflare Tunnel hay que tener `TRUST_PROXY=1`; si no, todos los clientes parecen una sola dirección y el escudo podría bloquearlos a la vez. `ESCUDO=0` lo apaga.

## Virus y fuga de información (cuarta tanda)
**Qué protege el programa por sí mismo**
- **Antivirus de entrada** (`xlsx-read.js`, `NOMBRE_PELIGROSO`): todo Excel o ZIP que se sube al panel (productos, clientes, historial, fotos, bandeja de entrada) se revisa ANTES de abrirlo. Si lleva programas (`.exe`, `.dll`, `.msi`…), scripts (`.bat`, `.ps1`, `.vbs`, `.js`…), accesos directos (`.lnk`), macros de Office (`vbaProject.bin`), objetos incrustados, páginas web o SVG, o rutas con `..`, se **rechaza entero** con un mensaje claro. Además: tope de 20.000 ficheros dentro, tope de tamaño descomprimido (contra «bombas» ZIP) y las fotos se comprueban por su contenido real, no por la extensión. Nada de lo que se sube se ejecuta nunca. (No sustituye a Windows Defender: es una capa más.)
- **Escáner de secretos** (`node escaner-secretos.js`): mira todo lo que git sigue y falla si encuentra bases de datos, copias, Excel, ZIP, claves (`.pem`, `.key`), ficheros `*.env`, carpetas de datos reales o textos que parecen claves (GitHub, Google, AWS, Meta, `ADMIN_TOKEN=…` con valor, direcciones con usuario y clave…). Nunca enseña la clave entera. También está en las pruebas (`npm test`): si algo así llegara a GitHub, la actualización automática lo detectaría.
- **Gancho antes de cada commit** (`.githooks/pre-commit`): bloquea el commit si lleva algo de eso (incluso con `git add -f`). **Hay que activarlo una vez en cada copia del repositorio**: `git config core.hooksPath .githooks` (en `C:\vm\bot` también).
- **`.gitignore` reforzado**: `*.env` (salvo `*.env.example`), bases de datos, `*.bak`, Excel, ZIP, claves y las carpetas `config/`, `datos/`, `logs/`, `respaldos/`, `inicial/`, `entrada/`. Se comprobó que el historial de GitHub **nunca** ha contenido nada de esto.
- El cliente solo ve lo suyo, el panel (3001) no se publica, el NIF no se guarda, los códigos van con `scrypt`, las claves nunca salen en respuestas, avisos ni registros (ya vigilado por pruebas anteriores).

**Lo que tienes que hacer tú en el ordenador de la oficina** (el programa no puede hacerlo por ti)
1. `git config core.hooksPath .githooks` en `C:\vm\bot`.
2. Ejecutar `deploy\windows\proteger-equipo.bat` (primero sin nada: solo enseña quién puede entrar a `C:\vm\config`, `datos` y `respaldos`; luego, como administrador, con `aplicar`: deja entrar solo a tu usuario, al sistema y a los administradores, y pasa Defender). **Sin probar en Windows real**: si algo falla, `icacls C:\vm\datos /reset /T` lo deja como estaba.
3. Windows Update y Defender activados; no navegar ni abrir correos en ese ordenador; no abrir adjuntos de nadie en él.
4. **Copia fuera del ordenador** (disco USB desconectado después o nube) de `C:\vm\datos` y `BACKUP_DIR`: un virus que cifre el disco cifra también las copias del mismo disco (`BACKUP_DIR2`).
5. Si alguna vez se sube una clave a GitHub por error: **cámbiala** (borrar el archivo no basta, queda en el historial). `NIF_PEPPER` es la excepción: no se cambia nunca (ver CLAUDE.md); avisa antes.

## Quinta tanda: otras webs, puerta del panel y cadena de suministro
- **Una web ajena no puede mandar órdenes con la sesión de nadie** (CSRF, `origenAjeno` en `seguridad.js`): toda petición que CAMBIA algo (POST, PUT, DELETE…) y que el navegador marca como venida de otra web (`Sec-Fetch-Site`, `Origin`) recibe «403 Petición no permitida desde otra web». Se suma a la cookie `SameSite=Strict`. Lo que no es un navegador (la conexión MCP, WhatsApp, pruebas) pasa porque no lleva sesión. Si algún día usas otro dominio propio para la web, ponlo en `PUBLIC_URL` o `CLIENTE_URL`.
- **Puerta del panel** (`panelPermitido`): el panel (`/api/admin`, `/empresa` y todo el puerto 3001) solo responde a la propia máquina, la red de la oficina (10.x, 172.16-31.x, 192.168.x) y Tailscale (100.64-127.x). **Si alguien publicara el 3001 por error, desde internet contesta 404** (ni siquiera dice que existe), también si entra por un túnel (se mira la dirección pública que pone Cloudflare). Quedó apuntado como `panel-desde-fuera`. Para dejar entrar a una dirección concreta: `PANEL_IPS_EXTRA="1.2.3.4"` en `empresa.env`; `PANEL_PERMITIR_PUBLICO=1` lo desactiva (no recomendado).
- **Cabeceras nuevas**: `Cross-Origin-Resource-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`, `X-DNS-Prefetch-Control: off`.
- **Registro a prueba de falsificaciones**: lo que llega de fuera (direcciones, rutas) se limpia de saltos de línea antes de escribirse en `[VM seguridad]`, para que nadie pueda inventar líneas falsas en el log.
- **Cadena de suministro**: el programa NO tiene dependencias de npm (una prueba lo vigila, y que no haya scripts de instalación). Es la mejor defensa contra paquetes infectados: no hay ninguno que pueda infectarse. No añadas ninguna sin hablarlo.

## Sexta tanda: si alguien logra colar código en una página, no se ejecuta
- **Política de scripts estricta** (`cspEstricta` en `seguridad.js`): hasta ahora las páginas permitían cualquier script «en línea» (`'unsafe-inline'`), que es justo lo que usa un ataque de inyección (XSS). Ahora cada página (acceso, catálogo, panel de la empresa y la página `/pedido/<enlace>`) se sirve con una política que solo deja ejecutar los scripts propios y los **que tienen la huella exacta** de los que lleva esa página (calculada al servirla). Un `<script>`, un `onclick` o un `onerror` que alguien consiguiera meter **no se ejecutan**. Comprobado en un navegador real: con la política nueva el código inyectado quedó bloqueado (3 bloqueos); con la antigua se ejecutaba.
- **Si algo dejara de funcionar** en la oficina (un botón que no responde, una pantalla en blanco): pon `CSP_ESTRICTA=0` en `cliente.env` (y `empresa.env`) y reinicia; vuelve a la política antigua. Avísame para arreglarlo bien.
- **Regla para quien toque el código**: no escribir `onclick=…`, `onerror=…` ni otros manejadores dentro del HTML (ni en plantillas de JavaScript): usar `addEventListener`. Una prueba lo vigila.
- **Cookie de sesión siempre «segura» por HTTPS**: antes solo llevaba `Secure` si `PUBLIC_URL` empezaba por `https://`; ahora también si la petición llegó por HTTPS a través de Cloudflare (con `TRUST_PROXY=1`). Así nunca viaja sin cifrar aunque falte esa línea.
- **Registro sin teléfonos enteros**: la línea «ATENCIÓN HUMANA solicitada por…» ya no escribe el número completo.

## Séptima tanda: entrar SOLO con nombre + NIF + correo + código que llega al correo
**Cómo lo ve el cliente**: en la pantalla de acceso escribe el **nombre de su empresa**, su **NIF** y su **correo electrónico**; le llega un **código de 6 cifras** a ese correo y, al escribirlo, entra. **No hay otra forma de entrar** (se cerraron la de solo el NIF y la de teléfono + código). Ya no hay «código de entrada» que elegir ni cambiar.

**Altas: todas pasan por ti.** Quien pide acceso («Hazte cliente») queda **pendiente hasta que lo aceptes en «Solicitudes de alta»**, aunque coincida con un cliente que ya tienes (antes entraba solo). Para que luego pueda entrar, el **correo es obligatorio** en el alta. En «Qué encajó» ves con qué cliente se parece y **si el NIF que escribió coincide con el de ese cliente** (si dice «NO coincide», desconfía: puede ser alguien que se hace pasar por otro). Al aceptarla, el cliente entra con su nombre, su NIF y su correo.

**Qué lo protege**
- El código **solo se manda a un correo que ya consta** en la ficha del cliente (a3ERP o lo escrito a mano en el panel) o en su cuenta, y solo si **coinciden el nombre, el NIF y el correo**. Escribir el correo de otro no sirve: no recibe nada.
- **No se puede averiguar qué NIF, nombres o correos existen**: la respuesta es siempre la misma, coincida o no.
- El código vale **10 minutos**, **una sola vez**, se **anula tras 5 fallos** y no se guarda (solo una huella atada al cliente). Entre un código y otro hay **60 segundos**.
- **No se pueden llenar buzones**: máximo 3 peticiones por NIF+correo cada 10 minutos, 8 por dirección y 120 códigos por hora en total (`CODIGO_CLAVE_LIMIT`, `CODIGO_IP_LIMIT`, `CODIGO_GLOBAL_LIMIT`). Se apunta `codigo-correo-muchas-peticiones` / `codigo-correo-tope-global`.
- Si el programa tiene «No soy un robot» (Turnstile), también se pide tras varios intentos.
- El correo lleva solo el código: ni NIF, ni código de cliente, ni enlaces (no se puede imitar con un enlace falso) y avisa de que no se comparta.
- Si el NIF + correo + nombre encajan con DOS clientes, no se adivina cuál: no se manda nada (esos clientes llaman a la oficina).

**Qué hace falta**: el correo de salida en **`cliente.env`**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (el mismo que usa la confirmación de pedido). **Sin él, la entrada nueva no existe y se queda la antigua**: hasta que lo configures, el cierre de las otras formas no se aplica (si no, nadie podría entrar). En cuanto el correo está configurado, **solo se entra con código**. `CODIGO_CORREO=0` apaga todo esto (vuelve lo de antes); `ACCESO_SOLO_CORREO=0` reabre las otras formas de entrar manteniendo la nueva (solo para emergencias).

**Quién no podrá entrar hasta que lo arregles**: los clientes **sin correo en su ficha** y los que **no tienen NIF** en a3ERP. Míralos en «Datos y Excel» → Clientes → «Ver cambios»: listas **«sin correo»** y **«sin NIF»**. Se arregla añadiendo el correo en la ficha del cliente (**«Editar datos»**) o volviendo a subir el Excel de clientes con el dato.

**Lo que sigue funcionando sin código** (lo crea la empresa a propósito): los **enlaces de acceso** que generas en el panel y el enlace del chat de WhatsApp.

## Si no puedes entrar al panel de la empresa («Clave incorrecta» aunque la sepas)
La clave del panel es `ADMIN_TOKEN` en **`C:\vm\config\empresa.env`** (no es la del correo: esa es `SMTP_PASS`). Causas, de más a menos habitual:
1. **Cambiaste la clave en `empresa.env` y no reiniciaste** «VM Empresa»: sigue valiendo la antigua. `schtasks /End /TN "VM Empresa"` y `schtasks /Run /TN "VM Empresa"`.
2. **Espacios pegados** al copiar la clave, o **comillas / espacios** en el archivo: ya no importan (el programa los quita en los dos lados).
3. **Caracteres especiales** (`€`, `—`, `ñ`, emojis…): ya valen (el panel los manda codificados). Si no quieres líos, usa una clave de letras y números.
4. **Bloqueo temporal**: 10 claves distintas erróneas en 10 minutos desde el mismo ordenador bloquean el panel 10 minutos, **incluso con la clave buena**. El panel avisa «Demasiados intentos». Espera 10 minutos, o reinicia «VM Empresa» (borra el contador).
5. **Estás en otra red**: el panel solo abre desde el propio ordenador, la red de la oficina o Tailscale (si no, ni carga la pantalla: ver «Quinta tanda»).
6. La clave se guarda en el navegador solo mientras la pestaña esté abierta: al cerrarla hay que escribirla otra vez.

## Octava tanda: los 12 puntos de ciberataque más comunes (25/11/2026)
Revisados uno a uno y vigilados por `tanda89.test.js`: panel de administración cerrado, cada cliente solo ve lo suyo, sin claves en respuestas ni en GitHub, precio siempre del servidor, cantidades limitadas (también al repetir una línea), sin pagos ni cupones, sin forma de hacerse administrador al registrarse, datos de clientes encerrados como «datos» ante la IA (Claude por MCP, con tope de ofertas del 50 %), XSS (escape con comillas y lista de revisión) e inyección SQL (todo con «?»). Un cambio de precio de más del 25 % se confirma también en el servidor. Los errores internos ya no enseñan detalles a los clientes: solo un código para buscar en el registro (`[VM error XXXXXX]`).
**Lo que tienes que hacer tú**: activar el doble factor en tu cuenta de GitHub y proteger la rama, BitLocker en el PC de la oficina, una copia de seguridad fuera del PC, y revisar de vez en cuando «Revisión de seguridad» en el panel.
