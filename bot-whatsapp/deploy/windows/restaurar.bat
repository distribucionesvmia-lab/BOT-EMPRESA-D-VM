@echo off
rem Restaurar las bases de datos desde las copias de seguridad. Clic derecho -> "Ejecutar como administrador".
rem Comprueba cada copia, guarda lo que hay ahora y solo entonces restaura. Registro de lo que se hace en pantalla.
cd /d C:\vm\bot\bot-whatsapp
echo ---- Copias disponibles (no se cambia nada todavia) ----
node --env-file=C:\vm\config\empresa.env restaurar.js --ver
echo.
set /p OK="Escribe SI para restaurar la copia mas reciente (el programa se para unos segundos): "
if /i not "%OK%"=="SI" (echo Cancelado. No se ha tocado nada. & pause & exit /b 0)
schtasks /End /TN "VM Cliente" >nul 2>&1
schtasks /End /TN "VM Empresa" >nul 2>&1
timeout /t 4 /nobreak >nul
node --env-file=C:\vm\config\empresa.env restaurar.js --restaurar
schtasks /Run /TN "VM Cliente" >nul 2>&1
schtasks /Run /TN "VM Empresa" >nul 2>&1
echo.
echo Programa arrancado de nuevo. Comprueba http://localhost:3001/empresa
pause
