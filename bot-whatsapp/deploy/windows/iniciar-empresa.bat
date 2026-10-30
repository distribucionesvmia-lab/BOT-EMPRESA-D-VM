@echo off
rem Arranca la aplicación de la EMPRESA y la vuelve a arrancar si se cae. Registro en C:\vm\logs\empresa.log
cd /d C:\vm\bot\bot-whatsapp
if not exist C:\vm\logs mkdir C:\vm\logs
:inicio
node --env-file=C:\vm\config\empresa.env server.js >> C:\vm\logs\empresa.log 2>&1
timeout /t 10 /nobreak >nul
goto inicio
