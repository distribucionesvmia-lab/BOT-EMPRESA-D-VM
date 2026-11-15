@echo off
rem Saca clientes, productos e historial de ventas de a3ERP a la carpeta de Google Drive para la web (SOLO LECTURA).
rem Mismo estilo que el script de copias: solo necesita sqlcmd (viene con SQL Server); no hay que instalar nada mas.
rem requisitos:
rem     1. poner el nombre del servidor y de la bd a leer
rem     2. poner la carpeta de Google Drive para escritorio donde dejar los ficheros (debe existir)
rem     3. crear en SQL Server el usuario de SOLO LECTURA (vm_lectura, ver consultas-a3erp.sql). NO usar el usuario sa.
rem        La clave, solo letras y numeros (los simbolos % ^ & rompen los .bat).
rem     4. dejar junto a este .bat la carpeta sql con las tres consultas (exportar-clientes.sql, exportar-productos.sql, exportar-historial.sql)
rem Se puede lanzar al final del script de copias (call exportar-datos-web.bat) o como tarea programada cada hora.

set servidor=srvvalentin\A3ERP
set db=VALENTIN
set usuario=vm_lectura
set clave=PON_AQUI_LA_CLAVE
set carpeta=G:\Mi unidad\DISTRIBUCIONES VM DATOS
set sqls=%~dp0sql

call :exportar clientes
call :exportar productos
call :exportar historial
exit /b

:exportar
rem sqlcmd escribe primero en un fichero temporal; solo si ha ido bien y ha cambiado algo se copia a Drive (Drive nunca ve un fichero a medias)
sqlcmd -b -S %servidor% -U %usuario% -P %clave% -d %db% -f 65001 -W -s"|" -h -1 -w 65535 -i "%sqls%\exportar-%1.sql" -o "%TEMP%\vm-%1.csv"
if errorlevel 1 (
  echo %date% %time% ERROR al exportar %1
  exit /b 1
)
fc /b "%TEMP%\vm-%1.csv" "%carpeta%\%1.csv" >nul 2>&1
if not errorlevel 1 (
  echo %1: sin cambios
  exit /b 0
)
copy /Y "%TEMP%\vm-%1.csv" "%carpeta%\%1.csv" >nul
echo %1: actualizado
exit /b 0
