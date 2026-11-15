@echo off
rem Saca clientes, productos e historial de a3ERP (SOLO LECTURA) a la carpeta de Drive. Solo reescribe un Excel si ha cambiado.
rem Registro en C:\vm\logs\a3erp.log. Lo lanza la tarea «VM Exportar a3ERP» cada hora; también se puede ejecutar a mano.
cd /d C:\vm\bot\bot-whatsapp
if not exist C:\vm\logs mkdir C:\vm\logs
echo === %date% %time% >> C:\vm\logs\a3erp.log
node --env-file=C:\vm\config\a3erp.env extraer-a3erp.js >> C:\vm\logs\a3erp.log 2>&1
if errorlevel 1 echo ERROR: la exportacion ha fallado, mira C:\vm\logs\a3erp.log
