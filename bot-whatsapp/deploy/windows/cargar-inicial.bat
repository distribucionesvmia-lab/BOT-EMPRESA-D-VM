@echo off
rem CARGA INICIAL: carga en el programa los clientes, productos, descuentos, historial y fotos que hay en C:\vm\inicial.
rem Se puede repetir sin miedo: lo que ya esta igual no se toca. Despues, solo hay que subir actualizaciones desde el panel («Datos y Excel»).
cd /d C:\vm\bot\bot-whatsapp
node --env-file=C:\vm\config\empresa.env cargar-inicial.js C:\vm\inicial
echo.
pause
