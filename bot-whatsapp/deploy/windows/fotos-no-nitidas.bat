@echo off
rem FOTOS NO NITIDAS: saca un listado (Excel/CSV) de los articulos cuya foto mide menos de 300 px (se ve borrosa).
rem Solo LEE: no cambia ni borra ninguna foto. Resultado: C:\vm\fotos-no-nitidas.csv
rem Para otro limite (por ejemplo 600 = tambien las "justas"):  fotos-no-nitidas.bat 600
cd /d C:\vm\bot\bot-whatsapp
set LIM=%1
if "%LIM%"=="" set LIM=300
node --env-file=C:\vm\config\empresa.env fotos-pequenas.js "" "" C:\vm\fotos-no-nitidas.csv %LIM%
echo.
echo Abre C:\vm\fotos-no-nitidas.csv con Excel.
pause
