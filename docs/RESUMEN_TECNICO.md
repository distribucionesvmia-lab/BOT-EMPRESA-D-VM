# Resumen técnico del proyecto (para un programador)

Sistema de pedidos de **Distribuciones Valentín Martín** (distribuidor de bebidas y alimentación, Medina del Campo). Los clientes (bares, restaurantes, tiendas) hacen el pedido desde el móvil; la empresa lo recibe, lo revisa y lo pasa a su ERP (**a3ERP**) con un Excel.

## 1. Cómo está hecho

- **Node.js 22 puro, sin dependencias.** `package.json` no tiene ni una librería: HTTP con `node:http`, base de datos con **`node:sqlite`** (SQLite integrado), pruebas con **`node --test`**. Nada de `npm install` → no hay cadena de suministro que vigilar. ~21.000 líneas de JS en `bot-whatsapp/` y ~770 pruebas automáticas (97 ficheros `*.test.js`).
- **Dos aplicaciones con el mismo código** (`APP_MODE`): **cliente** (puerto 3000, pública) y **empresa** (puerto 3001, solo interna). Comparten 4 bases SQLite: pedidos, cuentas, clientes y catálogo.
- **Front sin framework:** páginas HTML de un solo fichero con CSS/JS propio (`cliente.html` = acceso, chat e inicio; `pedido.html` = catálogo, carrito y resumen; `empresa.html` = panel). Es una **PWA**: se instala en el móvil, service worker (abre sin red; el pedido se guarda en el móvil si no hay cobertura), manifest e iconos. **Avisos push** (Web Push con claves VAPID) implementados a mano, sin librerías. El servidor saca el CSS/JS a ficheros con huella (cache de un año) y los minimiza.
- **Chat/asistente sin IA externa:** reglas, sinónimos y búsqueda sobre el catálogo (`bot.js`, `asistente.js`, `pedidolibre.js`); entiende pedidos escritos («2 cajas de coca cola zero y 3 de agua»).
- **Dinero en céntimos** (enteros), IVA 4/10/21 % y recargo de equivalencia como en a3ERP (`pricing.js`); el navegador y el servidor calculan igual y una prueba lo comprueba.
- **Integración con a3ERP por Excel** (a3ERP no se toca):
  - Entrada: clientes, artículos/tarifa, historial de compras y fotos, con **vista previa de solo diferencias** y protecciones (rechaza un Excel con menos de la mitad de datos, pide confirmar saltos de precio > 25 %).
  - Salida: Excel (.xlsx escrito a mano, sin librería) con una hoja por pedido, formato A4 imprimible, ordenado por familia/subfamilia/artículo de a3ERP, con marcas de ALBARÁN/FACTURA, casillas y recuadro de peso para artículos «KG».
  - **Carpetas `BASE-ARTÍCULOS`, `BASE-CLIENTES`, `BASE-HISTORICO PEDIDOS`:** lo que se deja ahí se **actualiza solo** (copia de seguridad antes, mismas protecciones). Hay un extractor (`extraer-a3erp.js`, `sqlcmd` en solo lectura) que las llena desde SQL Server.
- **Otros módulos:** estadísticas y patrones de compra, pedido fijo semanal, avisos programados, correos (confirmación de pedido con PDF, promociones con baja), enlaces de acceso de un solo uso, registro de errores de la app, actividad del panel, copias diarias de las 4 bases (más segunda carpeta opcional).

## 2. Cómo se despliega

- **Código en GitHub** (rama `claude/eager-hamilton-gknalq`). Todo el desarrollo se hace con Claude Code y se sube con `git push`.
- **En producción corre en un ordenador Windows de la oficina** (`C:\vm`): tareas programadas «VM Cliente» y «VM Empresa» (reinician el proceso si cae), `config` (claves, fuera del repositorio), `datos` (SQLite reales), `logs`.
- **Actualización continua:** la tarea «VM Actualizar» (cada 10 min) hace `git pull`, **pasa toda la batería de pruebas en la propia máquina** y, si fallan o el programa no arranca, **vuelve atrás sola**. Además el programa se reinicia solo si detecta que corre código antiguo. `/health` publica versión, commit y estado.
- **Vigilancia:** el programa manda por correo avisos de problemas (`[VM vigilancia]`) e informe diario (copias viejas, pedidos sin exportar, actualización automática atascada, intentos sospechosos…).
- **Alternativas preparadas** (no es lo que se usa hoy): `Dockerfile` + `docker-compose` con **Caddy** (HTTPS automático), `render.yaml` (Render con disco persistente) y script para una VM de Google Cloud.

## 3. Cómo sale a internet

- **Solo se publica la app del cliente (puerto 3000).** El panel de la empresa (3001) no se expone nunca: solo accesible desde red local/Tailscale.
- Forma prevista/recomendada de publicarla desde la oficina: **Cloudflare Tunnel** (`cloudflared` hace una conexión *saliente* a Cloudflare y apunta el dominio a `localhost:3000`): **sin abrir puertos en el router**, HTTPS gestionado por Cloudflare, protección DDoS/bots y bloqueo por países. Con túnel se activan `TRUST_PROXY=1` (IP real del cliente por `CF-Connecting-IP`) y `HSTS=1`. *(Confirmar con Pablo qué está activo ahora mismo en la oficina.)*
- Alternativa clásica: Caddy delante, dominio propio y HTTPS automático (Let's Encrypt).

## 4. Seguridad

- **Acceso del cliente:** NIF (solo una huella con `NIF_PEPPER`; el NIF no se guarda) y/o código personal (**scrypt** con sal, nunca en claro). Entrada por **NIF + correo + código de un solo uso** enviado al correo (10 min, 5 intentos). Sesiones por cookie `HttpOnly`, `SameSite=Strict`, `Secure` con HTTPS. Un cliente solo ve lo suyo (la sesión decide, nunca un parámetro).
- **Anti-bots y abusos:** límites de intentos por dirección y por cuenta, bloqueo progresivo, campo trampa en el alta, **Cloudflare Turnstile** opcional, escudo general (tope de peticiones, bloqueo a quien pide rutas de escáner), límite de pedidos por hora, tiempos máximos y tope de conexiones, protección CSRF por `Origin`/`Sec-Fetch-Site`.
- **Navegador:** CSP estricta con **hash por script en línea** (sin `unsafe-inline` para scripts), `X-Frame-Options`, `nosniff`, `Permissions-Policy`, COOP/CORP, HSTS.
- **Panel:** clave larga (`ADMIN_TOKEN`, comparación en tiempo constante, bloqueo tras fallos, aviso si es débil), **solo desde red privada/Tailscale** (desde fuera responde 404), registro de actividad (quién/cuándo cambia precios, borra pedidos…), texto siempre escapado.
- **Archivos subidos:** revisión antivirus propia de .xlsx/.zip (rechaza ejecutables, macros, rutas con `..`, bombas ZIP), rutas de archivo validadas.
- **Datos y secretos:** nada de claves ni datos reales en GitHub (`.gitignore` reforzado + **escáner de secretos en el pre-commit** + prueba que revisa el repositorio), copias diarias con comprobación, restauración probada, avisos de acceso nuevo al cliente.
- **Calidad:** pruebas de integración que levantan el servidor real, prueba de que no hay dependencias, comprobación de saltos de línea de Windows, y la actualización automática en la oficina solo acepta una versión si pasa las pruebas allí.

## 5. Límites honestos

- Una sola máquina y SQLite (suficiente para esta carga; sin alta disponibilidad; la copia diaria es la red de seguridad).
- Muchas piezas están probadas con datos de prueba y Chromium, **no** con la oficina real, un móvil real ni el Excel real de a3ERP (se indica en `CLAUDE.md`).
- Seguridad: revisión propia, **no** una auditoría externa; Turnstile y Cloudflare son pasos de configuración pendientes de hacer en la cuenta de la empresa.
- El extractor de a3ERP saca clientes, artículos e historial; faltan por añadir columnas (familia, modo de venta, modelo de pedido) cuyos nombres en la base de a3ERP no están documentados.

Documentación detallada: `CLAUDE.md` (reglas de negocio y decisiones, una sección por cambio), `docs/SEGURIDAD.md`, `docs/INSTALACION_WINDOWS.md`, `docs/VIGILANCIA.md`, `docs/DESPLIEGUE.md`.
