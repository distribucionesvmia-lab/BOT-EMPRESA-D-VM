@echo off
rem Ejecutar UNA VEZ como administrador: registra las dos aplicaciones para que arranquen solas con el servidor.
schtasks /Create /TN "VM Cliente" /TR "C:\vm\bot\bot-whatsapp\deploy\windows\iniciar-cliente.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Create /TN "VM Empresa" /TR "C:\vm\bot\bot-whatsapp\deploy\windows\iniciar-empresa.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "VM Cliente"
schtasks /Run /TN "VM Empresa"
echo Listo. Comprueba en http://localhost:3000/health y http://localhost:3001/health
