@echo off
rem Arranca la aplicación del CLIENTE y la vuelve a arrancar si se cae. Registro en C:\vm\logs\cliente.log
cd /d C:\vm\bot\bot-whatsapp
if not exist C:\vm\logs mkdir C:\vm\logs
:inicio
node --env-file=C:\vm\config\cliente.env server.js >> C:\vm\logs\cliente.log 2>&1
timeout /t 10 /nobreak >nul
goto inicio
