@echo off
rem Cierra el acceso a las carpetas con datos y claves (C:\vm\config, C:\vm\datos, C:\vm\respaldos) y pasa el antivirus de Windows.
rem Sin argumentos SOLO ENSEÑA quién puede entrar hoy y no cambia nada.  Con "aplicar" deja entrar solo a: tu usuario, el sistema y los administradores.
rem Hacer clic derecho -> "Ejecutar como administrador". Si las tareas "VM ..." se ejecutan con OTRO usuario de Windows, ese usuario tambien tiene que tener acceso:
rem   en ese caso ejecuta:  proteger-equipo.bat aplicar NOMBREDELUSUARIO
chcp 65001 >nul
setlocal
set "RAIZ=C:\vm"
set "EXTRA=%~3"
echo.
echo === QUIEN PUEDE ENTRAR HOY ===
for %%D in (config datos respaldos) do if exist "%RAIZ%\%%D" (echo. & echo --- %RAIZ%\%%D & icacls "%RAIZ%\%%D")
if /I not "%~1"=="aplicar" (
  echo.
  echo Esto es solo la lista. Para cerrar el acceso: proteger-equipo.bat aplicar
  goto fin
)
net session >nul 2>&1 || (echo. & echo Necesitas ejecutarlo como administrador. & goto fin)
echo.
echo === CERRANDO EL ACCESO ===
for %%D in (config datos respaldos) do if exist "%RAIZ%\%%D" (
  icacls "%RAIZ%\%%D" /inheritance:r >nul
  icacls "%RAIZ%\%%D" /grant:r "%USERNAME%:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" >nul
  if not "%EXTRA%"=="" icacls "%RAIZ%\%%D" /grant:r "%EXTRA%:(OI)(CI)F" >nul
  echo Protegida: %RAIZ%\%%D
)
echo.
echo === ANTIVIRUS DE WINDOWS (Defender): actualizar firmas y revisar C:\vm ===
powershell -NoProfile -Command "Update-MpSignature; Start-MpScan -ScanType CustomScan -ScanPath '%RAIZ%'; Get-MpThreatDetection | Select-Object -First 5 ThreatID,InitialDetectionTime,Resources | Format-List; Write-Host 'Revision terminada.'"
echo.
echo Despues de aplicar, comprueba que siguen vivos: http://localhost:3000/health y http://localhost:3001/health
:fin
echo.
pause
