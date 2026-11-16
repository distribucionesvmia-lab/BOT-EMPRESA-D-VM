@echo off
rem EXTRAER LOS EXCEL DE a3ERP: lee la base de a3ERP (SOLO LECTURA, nada se cambia en a3ERP) y deja los Excel de
rem clientes, articulos e historial de compras en sus carpetas de C:\vm:  BASE-CLIENTES, BASE-ARTICULOS y BASE-HISTORICO PEDIDOS.
rem Cada vez crea archivos NUEVOS con la fecha en el nombre (no pisa los anteriores). El programa los recoge solo (a los 2 minutos) y se actualiza.
rem
rem ANTES DE USARLO (una sola vez), mira estas tres lineas:
set "SERVIDOR=."
rem   SERVIDOR = el servidor de SQL Server. «.» es este mismo ordenador. Si tiene nombre de instancia, por ejemplo .\A3ERP
set "BASE=VALENTIN"
rem   BASE = el nombre de la base de datos de la empresa en a3ERP
set "MESES=12"
rem   MESES = cuantos meses de historial de compras se sacan (el programa guarda los de los ultimos 6 meses y, como minimo, 10 pedidos por cliente)
rem
rem Se usa la cuenta de Windows con la que lo ejecutas (conexion de confianza). Si te pide usuario y clave de SQL Server, avisa y se cambia.

cd /d C:\vm\bot\bot-whatsapp
if not exist C:\vm\logs mkdir C:\vm\logs
set "SQLCMD_JSON=["sqlcmd","-S","%SERVIDOR%","-E","-C"]"

echo Sacando los Excel de a3ERP (base %BASE%)... puede tardar unos minutos.
node extraer-a3erp.js --db %BASE% --bases C:\vm --meses %MESES% >> C:\vm\logs\extraer-excels.log 2>&1
if errorlevel 1 (
  echo.
  echo *** HA FALLADO. Mira el final de C:\vm\logs\extraer-excels.log para ver el motivo. ***
  echo.
  powershell -NoProfile -Command "Get-Content C:\vm\logs\extraer-excels.log -Tail 12"
  pause
  exit /b 1
)
echo.
echo LISTO. Los Excel estan en las carpetas BASE-... de C:\vm. En un par de minutos el programa los aplica solo.
echo (Si algo necesita que lo confirmes, lo veras en el panel, en Datos y Excel.)
echo.
rem Si lo lanzas desde una tarea programada no hace falta esta pausa:
if "%1"=="" pause
