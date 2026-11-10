@echo off
rem Instalacion guiada. Clic derecho -> "Ejecutar como administrador".
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-todo.ps1"
echo.
pause
