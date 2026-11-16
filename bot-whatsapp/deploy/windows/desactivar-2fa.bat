@echo off
REM Quita el SEGUNDO FACTOR del panel de la empresa (por si se pierde el movil y los codigos de emergencia, o se cambia ADMIN_TOKEN).
REM Hay que ejecutarlo en el ordenador de la oficina. Despues se puede volver a activar desde el panel.
cd /d C:\vm\bot\bot-whatsapp
node --env-file=C:\vm\config\empresa.env desactivar-2fa.js
pause
