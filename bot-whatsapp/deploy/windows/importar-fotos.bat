@echo off
rem IMPORTAR FOTOS: pone en los articulos las fotos de la carpeta C:\vm\fotos-nuevas (emparejadas por nombre).
rem Primero ENSENA que haria (no cambia nada). Para hacerlo de verdad, ejecuta:  importar-fotos.bat aplicar
rem Solo cambia una foto si la nueva es MAS GRANDE; la anterior se guarda en la carpeta "anteriores".
cd /d C:\vm\bot\bot-whatsapp
if /i "%1"=="aplicar" (
  node --env-file=C:\vm\config\empresa.env importar-fotos.js C:\vm\fotos-nuevas --aplicar --informe C:\vm\fotos-nuevas\informe.csv
) else (
  node --env-file=C:\vm\config\empresa.env importar-fotos.js C:\vm\fotos-nuevas --informe C:\vm\fotos-nuevas\informe.csv
)
echo.
pause
