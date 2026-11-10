@echo off
rem Actualiza el programa desde GitHub SOLO si hay cambios nuevos y las pruebas pasan; si fallan, vuelve a la versión anterior.
rem Se ejecuta solo cada noche (ver docs/INSTALACION_WINDOWS.md, paso 7). Registro: C:\vm\logs\actualizar.log
cd /d C:\vm\bot || exit /b 1
set LOG=C:\vm\logs\actualizar.log
echo ===== %date% %time% >> %LOG%
for /f %%i in ('git rev-parse HEAD') do set ANTES=%%i
git fetch origin claude/eager-hamilton-gknalq >> %LOG% 2>&1 || (echo No se pudo consultar GitHub >> %LOG% & exit /b 1)
for /f %%i in ('git rev-parse FETCH_HEAD') do set NUEVO=%%i
if "%ANTES%"=="%NUEVO%" (echo Sin cambios >> %LOG% & exit /b 0)
git merge --ff-only FETCH_HEAD >> %LOG% 2>&1 || (echo No se pudo actualizar sin conflictos >> %LOG% & exit /b 1)
cd bot-whatsapp
set VM_TEST=1
node --test >> %LOG% 2>&1
if errorlevel 1 (
  echo LAS PRUEBAS FALLAN: se vuelve a la version anterior %ANTES% >> %LOG%
  cd /d C:\vm\bot & git reset --hard %ANTES% >> %LOG% 2>&1
  exit /b 1
)
schtasks /End /TN "VM Cliente" >> %LOG% 2>&1
schtasks /End /TN "VM Empresa" >> %LOG% 2>&1
timeout /t 3 /nobreak >nul
schtasks /Run /TN "VM Cliente" >> %LOG% 2>&1
schtasks /Run /TN "VM Empresa" >> %LOG% 2>&1
echo Actualizado de %ANTES% a %NUEVO% >> %LOG%
