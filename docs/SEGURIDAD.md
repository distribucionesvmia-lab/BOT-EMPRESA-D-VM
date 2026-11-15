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
