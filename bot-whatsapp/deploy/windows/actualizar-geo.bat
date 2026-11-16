@echo off
rem Renueva la lista de rangos de direcciones IP de ESPAÑA que usa el filtro por pais (solo descarga dos archivos de texto de ipdeny.com).
rem Conviene hacerlo cada 2-3 meses. Si falla, no cambia nada. El programa recoge la lista nueva solo (en unos minutos).
cd /d C:\vm\bot\bot-whatsapp
if not exist C:\vm\logs mkdir C:\vm\logs
node actualizar-geo.js >> C:\vm\logs\actualizar-geo.log 2>&1
if errorlevel 1 (
  echo *** HA FALLADO. Mira el final de C:\vm\logs\actualizar-geo.log ***
  powershell -NoProfile -Command "Get-Content C:\vm\logs\actualizar-geo.log -Tail 6"
) else (
  powershell -NoProfile -Command "Get-Content C:\vm\logs\actualizar-geo.log -Tail 3"
)
if "%1"=="" pause
