@echo off
rem Actualiza el programa desde GitHub SOLO si hay cambios nuevos, las pruebas pasan y el programa arranca bien.
rem Si algo falla, vuelve solo a la versión anterior. Se ejecuta cada 10 minutos (tarea «VM Actualizar», ver instalar-tareas.bat) y desde el botón
rem «Actualizar ahora» del panel de la empresa. Registro: C:\vm\logs\actualizar.log (solo cuando hay algo que contar) · última comprobación: actualizar.ultima
cd /d C:\vm\bot || exit /b 1
set LOG=C:\vm\logs\actualizar.log
set ULTIMA=C:\vm\logs\actualizar.ultima
set MALA=C:\vm\logs\actualizar.mala
if not exist C:\vm\logs mkdir C:\vm\logs
for /f %%i in ('git rev-parse HEAD') do set ANTES=%%i
git fetch origin claude/eager-hamilton-gknalq >nul 2>&1
if errorlevel 1 (
  echo %date% %time% - No se pudo consultar GitHub: sin internet? > %ULTIMA%
  exit /b 1
)
for /f %%i in ('git rev-parse FETCH_HEAD') do set NUEVO=%%i
echo %date% %time% - Comprobado: todo al dia > %ULTIMA%
if "%ANTES%"=="%NUEVO%" exit /b 0
rem Una version que ya fallo las pruebas o el arranque no se reintenta cada 10 minutos (se espera a que haya otra mas nueva)
if exist %MALA% call :ya_fallo
if defined SALTAR exit /b 1
echo ===== %date% %time% >> %LOG%
git merge --ff-only FETCH_HEAD >> %LOG% 2>&1 || (echo No se pudo actualizar sin conflictos >> %LOG% & exit /b 1)
cd bot-whatsapp
set VM_TEST=1
node --test >> %LOG% 2>&1
if errorlevel 1 (
  echo LAS PRUEBAS FALLAN: se vuelve a la version anterior %ANTES% >> %LOG%
  cd /d C:\vm\bot & git reset --hard %ANTES% >> %LOG% 2>&1
  echo %NUEVO%> %MALA%
  echo %date% %time% - La version nueva no paso las pruebas: se mantiene la anterior > %ULTIMA%
  exit /b 1
)
call :reiniciar
rem El programa tiene que responder en los dos puertos; si no, se vuelve a la version anterior
powershell -NoProfile -Command "$ok=$false; 1..25 | ForEach-Object { try { $a=Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 3; $b=Invoke-WebRequest -UseBasicParsing http://localhost:3001/health -TimeoutSec 3; if ($a.StatusCode -eq 200 -and $b.StatusCode -eq 200) { $ok=$true; break } } catch {}; Start-Sleep 2 }; if ($ok) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo EL PROGRAMA NO ARRANCA con la version nueva: se vuelve a la anterior %ANTES% >> %LOG%
  cd /d C:\vm\bot & git reset --hard %ANTES% >> %LOG% 2>&1
  echo %NUEVO%> %MALA%
  call :reiniciar
  echo %date% %time% - La version nueva no arrancaba: se mantiene la anterior > %ULTIMA%
  exit /b 1
)
if exist %MALA% del %MALA%
echo Actualizado de %ANTES% a %NUEVO% >> %LOG%
echo %date% %time% - Actualizado a una version nueva > %ULTIMA%
exit /b 0

:reiniciar
schtasks /End /TN "VM Cliente" >> %LOG% 2>&1
schtasks /End /TN "VM Empresa" >> %LOG% 2>&1
timeout /t 3 /nobreak >nul
schtasks /Run /TN "VM Cliente" >> %LOG% 2>&1
schtasks /Run /TN "VM Empresa" >> %LOG% 2>&1
exit /b 0

:ya_fallo
set /p MALAV=<%MALA%
if "%NUEVO%"=="%MALAV%" (
  set SALTAR=1
  echo %date% %time% - Hay una version nueva pero ya fallo antes; se espera a otra > %ULTIMA%
)
exit /b 0
