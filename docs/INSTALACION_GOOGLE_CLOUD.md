# Instalar el bot en un servidor gratuito de Google Cloud

Máquina virtual **e2-micro** (capa gratuita permanente de Google Cloud) con Ubuntu, Docker y HTTPS automático con tu dominio. Nada se instala en el servidor de a3.

## Antes de empezar: lo que hay que saber
- **Pide tarjeta** para activar la facturación, aunque dentro de los límites gratuitos no se cobra. Crea una **alerta de presupuesto** de 1 € para enterarte si algo se cobrara.
- **La capa gratuita solo vale en 3 regiones de EE. UU.**: `us-west1` (Oregón), `us-central1` (Iowa) y `us-east1` (Carolina del Sur). Funciona bien desde España (algo más lento, ~120 ms). Los datos de tus clientes quedarían en servidores de EE. UU.: tenlo en cuenta para la protección de datos.
- **La IP pública puede cobrarse** (unos 3 $/mes desde 2024, según Google). Comprueba en *Facturación → Informes* el primer mes. Si te parece caro, pásate a un VPS de pago pequeño.
- Las condiciones de la capa gratuita cambian: confírmalas en https://cloud.google.com/free antes de crear la máquina.

## 1. Crear la máquina
1. Consola → *Compute Engine → Instancias de VM → Crear instancia* (te pedirá activar facturación la primera vez).
2. Nombre `bot-vm`. Región **us-central1**. Serie **E2**, tipo de máquina **e2-micro**.
3. Disco de arranque → *Cambiar*: **Ubuntu 24.04 LTS**, tipo **Disco persistente estándar**, **30 GB**.
4. Firewall: marca **Permitir tráfico HTTP** y **Permitir tráfico HTTPS**. Nada más.
5. Crear. Anota la **IP externa** que sale en la lista.

## 2. Apuntar tu dominio (IONOS)
En IONOS → Dominios → `distribucionesvm.es` → DNS → *Añadir registro*: tipo **A**, nombre **pedidos**, valor la **IP externa**. No toques los registros MX (el correo). Cuando propague (minutos), `pedidos.distribucionesvm.es` apuntará a la máquina.
> Mejor reservar la IP como estática (*Red de VPC → Direcciones IP → Reservar dirección estática* y asignarla a la máquina) para que no cambie si la máquina se reinicia.

## 3. Instalar el bot
1. En la lista de instancias pulsa **SSH**: se abre un terminal en el navegador.
2. Pega y ejecuta:
```
curl -fsSL https://raw.githubusercontent.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM/claude/eager-hamilton-gknalq/bot-whatsapp/deploy/gcp/preparar-vm.sh -o preparar-vm.sh && bash preparar-vm.sh
```
   (Si el repositorio es privado, ese comando no podrá descargar el script: usa `git clone` con tus credenciales y ejecuta `bash bot-whatsapp/deploy/gcp/preparar-vm.sh`.)
3. Te pregunta el dominio y crea las claves solas. **Apunta la clave de administrador que muestra.**
4. Cierra y vuelve a abrir el SSH (por Docker) y arranca:
```
cd ~/bot/bot-whatsapp && docker compose --profile https up -d --build
```
5. Comprueba `https://pedidos.distribucionesvm.es/health` → `{"ok":true}`.

## 4. Drive (clientes, productos e historial)
1. Sube el JSON de la cuenta de servicio a la máquina: en la ventana SSH, botón *Subir archivo*, y luego `mkdir -p ~/bot/bot-whatsapp/secretos && mv ~/google.json ~/bot/bot-whatsapp/secretos/`.
2. Edita `~/bot/bot-whatsapp/.env`: `DRIVE_FOLDER_ID=…` y `GOOGLE_SERVICE_ACCOUNT_FILE=/run/google.json`. Añade al servicio `empresa` del `docker-compose.yml` el volumen `./secretos/google.json:/run/google.json:ro`.
3. `docker compose --profile https up -d` para recargar.

## 5. Entrar a la vista de empresa (solo tú)
No está publicada. Desde tu ordenador abre un túnel:
```
gcloud compute ssh bot-vm --zone us-central1-a -- -L 3001:127.0.0.1:3001
```
y entra en `http://localhost:3001/empresa` con tu clave de administrador.

## Que no se pierdan los datos
- Las bases están en un volumen de Docker en el disco persistente de 30 GB y sobreviven a reinicios y actualizaciones.
- Copia diaria de las cuatro bases a las 03:00 (14 últimas) dentro del mismo volumen. Haz además una **instantánea del disco** (*Compute Engine → Instantáneas → Programar*, gratis hasta 5 GB) para tener una copia fuera de la máquina.
- Actualizar el programa: `cd ~/bot && git pull && cd bot-whatsapp && docker compose --profile https up -d --build`.
