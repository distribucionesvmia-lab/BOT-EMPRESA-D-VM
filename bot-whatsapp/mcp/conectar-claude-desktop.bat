@echo off
rem Conecta «vm-pedidos» en Claude Desktop (doble clic). Para quitarla: conectar-claude-desktop.bat --quitar
node "%~dp0conectar-claude-desktop.js" %*
echo.
pause
