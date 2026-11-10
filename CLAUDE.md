# Distribuciones Valentín Martín · programa de pedidos (instrucciones para Claude)

Idioma: **español** en todo lo que se escriba para la empresa. La persona que lo usa no es programadora: explica en claro, sin jerga, y di siempre qué has cambiado y cómo comprobarlo.

## Qué es
Sistema de pedidos automático de Distribuciones Valentín Martín (Medina del Campo), sin dependencias externas (Node 22, `node:sqlite`, `node --test`). Dos aplicaciones sobre las mismas bases de datos:
- **Cliente** (`APP_MODE=cliente`, puerto 3000, pública): acceso con los 6 primeros dígitos del DNI/CIF, chat, catálogo, pedido, repetir/añadir, histórico. `bot-whatsapp/cliente.html`, `pedido.html`, `bot.js`.
- **Empresa** (`APP_MODE=empresa`, puerto 3001, **solo interna**): pedidos, exportación a Excel para a3ERP, altas, cuentas, clientes, historial, productos, «Actualizar datos desde Excel». `bot-whatsapp/empresa.html`, `admin.js`.
Código en `bot-whatsapp/`. Documentación en `docs/` (empieza por `docs/PLAN_DOMINGO.md`, `docs/INSTALACION_WINDOWS.md`, `docs/VIGILANCIA.md`, `docs/CATALOGO_TRABAJO_PROGRESO.md`).

## En el ordenador de la oficina (Windows)
- Programa: `C:\vm\bot` (clon de GitHub; el código está en `C:\vm\bot\bot-whatsapp`).
- Configuración y claves: `C:\vm\config` · Datos reales: `C:\vm\datos` · Registros: `C:\vm\logs`.
- Arranque: tareas programadas **«VM Cliente»** y **«VM Empresa»**. Reiniciar:
  `schtasks /End /TN "VM Cliente"` · `schtasks /End /TN "VM Empresa"` y luego `schtasks /Run /TN "VM Cliente"` · `schtasks /Run /TN "VM Empresa"`.
- Comprobar que vive: `http://localhost:3000/health` y `http://localhost:3001/health` → `{"ok":true}`. Estado y problemas: `/api/admin/estado` (con la clave de la empresa).
- Rama de trabajo: `claude/eager-hamilton-gknalq` (la actualización automática nocturna `deploy/windows/actualizar-auto.bat` sigue esa rama).

## Cómo hacer un cambio (siempre así)
1. `git pull` antes de empezar (puede haber cambios hechos desde otro sitio).
2. Cambia lo mínimo necesario. Si añades comportamiento, añade su prueba.
3. Pruebas: `cd bot-whatsapp && npm test` → **todas deben pasar** (hoy: 247). Si fallan, arréglalo; nunca borres ni desactives una prueba para que pase.
4. Reinicia las dos tareas y comprueba `/health`.
5. Prueba el cambio de verdad (navegador, o el flujo afectado). Si no lo has podido probar, dilo.
6. `git commit` con un mensaje claro en español y `git push` a la rama de trabajo.
7. Cuenta a la persona qué has hecho en 3-5 líneas.
Si algo sale mal tras reiniciar: `git log -3`, vuelve al commit anterior (`git reset --hard <commit>`, solo con permiso expreso) y reinicia.

## Reglas que NO se saltan
- **Nunca** tocar, borrar ni subir a GitHub: `C:\vm\datos`, `C:\vm\config`, claves (`ADMIN_TOKEN`, `NIF_PEPPER`, `LINK_SECRET`, `SMTP_PASS`, credenciales de Google), ni Excel reales de clientes/tarifa. No pegues claves ni datos de clientes en mensajes, commits ni informes.
- **Nunca** cambiar `NIF_PEPPER` (nadie podría entrar con su código hasta reimportar los clientes).
- **Nunca** publicar el puerto 3001 (empresa) en internet. Solo el 3000.
- Antes de borrar o sobrescribir datos: mira qué hay, haz copia (`BACKUP_DIR`) y pide confirmación.
- La app del cliente no debe mostrar nada de la administración ni datos de otros clientes. Hay pruebas que lo comprueban: no las debilites.
- Los datos reales no se usan en pruebas: usa datos ficticios (`ejemplo/`, `buildWorkbook` en las pruebas).
- No hagas commits con ficheros `*.sqlite`, `*.bak`, `.env` ni Excel (`.gitignore` los cubre; comprueba `git status` antes de `git add`).

## Reglas de negocio importantes
- Acceso del cliente: **primeros 6 dígitos** del DNI/CIF (letras se saltan); además un código personal si lo elige. Huellas con `NIF_PEPPER`; el NIF no se guarda.
- **Historial del cliente = sus 10 últimos pedidos** (los de a3ERP y los hechos por la aplicación o el chat, juntos): al hacer el 11.º se va el más antiguo del historial. Los pedidos de la empresa (exportaciones) se guardan siempre completos; solo se limita lo que ve el cliente (`HISTORIAL_MAX` en `weborder.js`).
- Un cliente solo ve y pide lo suyo. Altas nuevas: «te contactaremos en 24-48 h»; sus pedidos quedan retenidos hasta que la empresa los revise.
- Totales como en a3ERP. **Impuestos confirmados por la gestoría**: tres tipos de IVA (4 %, 10 % y 21 %); el código «SRE» de a3ERP es el superreducido = **4 %**. Recargo de equivalencia (clientes con R.E.): 0,5 % sobre el 4 %, 1,4 % sobre el 10 % y 5,2 % sobre el 21 %. **El IVA y el R.E. se calculan sobre la misma base y no se acumulan** (10 € de base al 21 % = 10 + 2,10 de IVA + 0,52 de R.E. = 12,62 €). Exportación a Excel selectiva para a3ERP.
- Actualizar datos: siempre **vista previa y solo diferencias** (pestaña «Actualizar datos desde Excel» o Excel en la carpeta `datos` de Drive). Un Excel con menos de la mitad de lo que hay se rechaza.
- Si el cliente escribe algo que no es pedido/histórico/repetir, el bot responde que no está diseñado para eso y ofrece «Hacer pedido».

## Vigilancia
El programa envía correos `[VM vigilancia]` (avisos) y `[VM informe]` (diario, 08:30). Si te piden «mira cómo va todo»: lee `/api/admin/estado`, `C:\vm\logs\*.log` y `C:\vm\logs\actualizar.log`, y resume problemas y qué hacer.

## Demo (artefacto de Claude)
Es una copia de pruebas con datos ficticios/privados; **no es el programa real**. Se reconstruye con `node demo-web/build.mjs` (los JSON privados NO están en GitHub; ver `docs/CONTINUAR_CON_OTRA_CUENTA.md`). Antes de republicarla, lee la versión publicada actual.
