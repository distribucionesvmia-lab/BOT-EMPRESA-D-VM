@echo off
rem Ejecutar UNA VEZ con el usuario que tiene abierto Google Drive para escritorio (la carpeta de Drive es de su sesión).
rem Crea la tarea «VM Exportar a3ERP»: cada hora, mientras ese usuario tenga la sesión iniciada.
schtasks /Create /TN "VM Exportar a3ERP" /TR "C:\vm\bot\bot-whatsapp\deploy\windows\exportar-a3erp.bat" /SC HOURLY /MO 1 /ST 06:00 /RL LIMITED /F
schtasks /Run /TN "VM Exportar a3ERP"
echo Listo. En un minuto mira C:\vm\logs\a3erp.log: debe poner clientes, productos e historial-ventas con su numero de filas.
