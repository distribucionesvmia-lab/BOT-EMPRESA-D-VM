# Instalación rápida (lo más fácil)

1. Instala Node.js 22 (https://nodejs.org) y deja el programa en `C:\vm\bot` (ver «2. Descargar el programa» más abajo).
2. Abre la carpeta `C:\vm\bot\bot-whatsapp\deploy\windows`, haz **clic derecho en `instalar-todo.bat` → «Ejecutar como administrador»**.
3. Hace todo solo: crea las carpetas, **inventa las claves**, deja el programa arrancando con el ordenador y te enseña **tu clave de la empresa** (apúntala).
4. Abre en el navegador `http://localhost:3001/empresa`, entra con esa clave y carga los datos (clientes → productos → historial).
5. Más tarde, cuando tengas los datos: correo de avisos y carpeta de Drive (se editan en `C:\vm\config\*.env`) y la dirección pública para los clientes (paso 5).

Los pasos largos de abajo son lo mismo hecho a mano, por si algo falla.

---

# Instalar el bot en el servidor de la oficina (Windows)

Sin Docker y sin pagar nada: Node.js + dos tareas programadas que arrancan solas con el servidor. Los datos quedan en `C:\vm\datos`.

## Carpetas que vamos a usar
```
C:\vm\bot        el programa (se descarga de GitHub)
C:\vm\config     los ficheros de configuración (cliente.env, empresa.env y la clave de Google)  ← SECRETOS
C:\vm\datos      las bases de datos, exportaciones y copias                                       ← NO borrar
C:\vm\logs       registros
```

## 1. Instalar Node.js
1. Descarga **Node.js 22 LTS** (instalador `.msi`) de https://nodejs.org e instálalo con las opciones por defecto.
2. Abre «Símbolo del sistema» y comprueba: `node -v` → debe decir `v22.x` (mínimo 22.13).

## 2. Descargar el programa
Con Git (recomendado, así se actualiza con un comando):
```
mkdir C:\vm
cd C:\vm
git clone -b claude/eager-hamilton-gknalq https://github.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM.git bot
```
Sin Git: en GitHub → botón verde «Code» → «Download ZIP», y descomprime el contenido en `C:\vm\bot` (debe quedar `C:\vm\bot\bot-whatsapp\server.js`).

## 3. Configurar
1. Crea `C:\vm\config`, `C:\vm\datos` y `C:\vm\logs`.
2. Copia `C:\vm\bot\bot-whatsapp\deploy\windows\cliente.env.example` a `C:\vm\config\cliente.env` y `empresa.env.example` a `C:\vm\config\empresa.env`.
3. Edita los dos (Bloc de notas) y rellena:
   - `ADMIN_TOKEN`: tu clave de administrador (larga y aleatoria).
   - `LINK_SECRET`: otra cadena larga, **igual en los dos ficheros**.
   - `NIF_PEPPER`: otra cadena larga, **igual en los dos ficheros y que no se cambie nunca** (si se cambia, nadie puede entrar con el NIF hasta reimportar los clientes).
   - `PUBLIC_URL` (en `cliente.env`): la dirección https pública (paso 5).
   - Drive: `DRIVE_FOLDER_ID` y `GOOGLE_SERVICE_ACCOUNT_FILE` (copia el JSON de Google a `C:\vm\config\google.json`). Ver `docs/GOOGLE_DRIVE.md`.
   - `BACKUP_DIR`: una carpeta que sincronice **Google Drive para escritorio** si quieres las copias diarias también en tu Drive.
4. Guarda estos ficheros solo en el servidor: contienen las claves.

## 4. Arrancar (y que arranque solo)
1. Abre «Símbolo del sistema» **como administrador** y ejecuta:
```
C:\vm\bot\bot-whatsapp\deploy\windows\instalar-tareas.bat
```
2. Comprueba en el navegador del servidor: `http://localhost:3000/health` y `http://localhost:3001/health` → deben decir `{"ok":true}`.
3. La aplicación de la **empresa** está en `http://localhost:3001/empresa` (entras con tu `ADMIN_TOKEN`). Escucha **solo dentro del servidor**: desde fuera no se puede ni intentar entrar. Para verla desde tu ordenador usa Tailscale o un túnel SSH (ver `docs/DESPLIEGUE.md`).
4. Los registros están en `C:\vm\logs\cliente.log` y `empresa.log`.

## 5. Publicar solo la aplicación del cliente en internet (gratis)
Hay que publicar **únicamente el puerto 3000**. Nunca el 3001 (empresa).
- **Tailscale Funnel**: instala Tailscale en el servidor, activa Funnel y ejecuta `tailscale funnel 3000`. Te da una dirección fija `https://…ts.net`: ponla en `PUBLIC_URL` (cliente.env) y reinicia la tarea «VM Cliente».
- **Cloudflare Tunnel**: gratis, pero para tener una dirección fija necesitas un dominio propio.
No abras puertos en el router.

## 6. Actualizar el programa más adelante
```
cd C:\vm\bot
git pull
schtasks /End /TN "VM Cliente" & schtasks /End /TN "VM Empresa"
schtasks /Run /TN "VM Cliente" & schtasks /Run /TN "VM Empresa"
```
Las bases de datos están en `C:\vm\datos`, fuera del programa: actualizar no las toca.

## 7. Poder actualizarlo SIN ir a la oficina
Hay dos tipos de actualización y ninguna obliga a ir al ordenador:

**A) Datos (clientes, productos, historial):**
- Deja el Excel en la carpeta `datos` de Google Drive desde donde estés: el programa lo recoge solo cada 15 minutos y aplica solo las diferencias; o
- Entra a la app de la empresa desde fuera con **Tailscale** (paso 7.1) y usa «Actualizar datos desde Excel».

**B) Programa (mejoras nuevas):** actualización automática cada 10 minutos.
1. `instalar-tareas.bat` (una vez, como administrador) ya crea la tarea «VM Actualizar». Si instalaste antes, ejecuta una vez:
```
schtasks /Create /TN "VM Actualizar" /TR "C:\vm\bot\bot-whatsapp\deploy\windows\actualizar-auto.bat" /SC MINUTE /MO 10 /RU SYSTEM /F
```
2. Cada 10 minutos mira GitHub (rama de trabajo). Si no hay nada nuevo, no hace nada. Si hay cambios: los descarga, **pasa las pruebas**, reinicia el programa y **comprueba que responde** en los puertos 3000 y 3001. Si las pruebas fallan o el programa no arranca, vuelve solo a la versión anterior, lo deja anotado en `C:\vm\logs\actualizar.log` y no reintenta esa misma versión hasta que haya otra más nueva.
3. La última comprobación se ve en `C:\vm\logs\actualizar.ultima` y en la app de la empresa: pestaña «Datos y Excel» → «Versión del programa», con el botón **«Actualizar ahora»** (lanza la comprobación al momento, sin esperar a los 10 minutos).
4. Las bases de datos y la configuración (`C:\vm\datos`, `C:\vm\config`) no se tocan nunca.
5. Los pedidos que lleguen justo mientras se reinicia (unos segundos) pueden dar un error de conexión al cliente; vuelve a intentarlo y funciona.

**7.1 Entrar a la app de la empresa desde fuera, sin publicarla:** instala **Tailscale** en el ordenador de la oficina y en tu móvil/portátil (misma cuenta). La app de la empresa escucha solo en el propio ordenador (`HOST=127.0.0.1`), así que hay que ofrecerla **solo a tus dispositivos** con `tailscale serve` (NO `funnel`; `funnel` es público y solo se usa con el puerto 3000). Una vez, en un `cmd` como administrador en el ordenador de la oficina:
```
tailscale serve --bg --https=8443 http://127.0.0.1:3001
```
Desde tus dispositivos con Tailscale abre `https://NOMBRE-DEL-PC.TU-RED.ts.net:8443/empresa` (la misma dirección que la pública, con `:8443` y `/empresa`) y entra con tu clave. Para comprobar que NO es público: `tailscale funnel status` no debe mostrar el 8443. Quitarlo: `tailscale serve --https=8443 off`.

## Que no se pierdan los datos
- Todo está en `C:\vm\datos`. **Haz copia de esa carpeta** (o activa `BACKUP_DIR` en una carpeta de Drive).
- El programa hace solo una **copia diaria de las cuatro bases** (pedidos, cuentas con sus PIN, clientes y catálogo) a las 03:00, y guarda las 14 últimas.
- Si el servidor se apaga, al arrancar vuelve a levantarse solo.
- Clientes, productos e historial se recuperan solos desde Drive; lo que no se puede reconstruir son los pedidos y las cuentas con PIN personal, que es lo que protegen las copias.
