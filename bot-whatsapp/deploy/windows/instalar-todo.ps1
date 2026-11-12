# Instalacion guiada: crea carpetas, genera las claves solas, registra el arranque automatico y arranca el programa.
# Se puede ejecutar varias veces: NUNCA cambia unas claves que ya existen (si se cambia NIF_PEPPER nadie podria entrar).
$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($d in "C:\vm\config", "C:\vm\datos", "C:\vm\logs") { New-Item -ItemType Directory -Force -Path $d | Out-Null }

function ClaveAleatoria($n) {
  $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  (([Convert]::ToBase64String($b)) -replace '[^A-Za-z0-9]', '').Substring(0, [Math]::Min($n, 40))
}

$cli = "C:\vm\config\cliente.env"; $emp = "C:\vm\config\empresa.env"
if ((Test-Path $cli) -or (Test-Path $emp)) {
  Write-Host "Ya existen los ficheros de configuracion en C:\vm\config: NO se tocan (asi no se pierden tus claves)."
  $claveNueva = $false
} else {
  $link = ClaveAleatoria 48; $pepper = ClaveAleatoria 48; $admin = ClaveAleatoria 32
  $c = Get-Content "$aqui\cliente.env.example" -Raw
  $c = $c -replace 'LINK_SECRET=.*', "LINK_SECRET=$link" -replace 'NIF_PEPPER=.*', "NIF_PEPPER=$pepper"
  $e = Get-Content "$aqui\empresa.env.example" -Raw
  $e = $e -replace 'ADMIN_TOKEN=.*', "ADMIN_TOKEN=$admin" -replace 'LINK_SECRET=.*', "LINK_SECRET=$link" -replace 'NIF_PEPPER=.*', "NIF_PEPPER=$pepper"
  Set-Content -Path $cli -Value $c -Encoding ASCII
  Set-Content -Path $emp -Value $e -Encoding ASCII
  $claveNueva = $true
}

# Carga inicial (solo hace falta la primera vez): si existe C:\vm\inicial con los archivos del paquete de datos iniciales, se cargan
# los clientes, productos, descuentos, historial y fotos; asi el programa nace con todo y despues solo se suben actualizaciones.
if (Test-Path "C:\vm\inicial") {
  Write-Host "Cargando los datos iniciales desde C:\vm\inicial ..."
  Push-Location (Split-Path -Parent $aqui)
  & node --env-file=C:\vm\config\empresa.env cargar-inicial.js C:\vm\inicial
  Pop-Location
} else { Write-Host "No hay carpeta C:\vm\inicial: se instala sin datos (se pueden cargar despues con cargar-inicial.bat)." }

# Arranque automatico al encender el ordenador
schtasks /Create /TN "VM Cliente" /TR "$aqui\iniciar-cliente.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks /Create /TN "VM Empresa" /TR "$aqui\iniciar-empresa.bat" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks /End /TN "VM Cliente" 2>$null | Out-Null; schtasks /End /TN "VM Empresa" 2>$null | Out-Null
Start-Sleep -Seconds 2
schtasks /Run /TN "VM Cliente" | Out-Null; schtasks /Run /TN "VM Empresa" | Out-Null
Start-Sleep -Seconds 6

Write-Host ""
foreach ($p in 3000, 3001) {
  try { $r = Invoke-WebRequest -UseBasicParsing "http://localhost:$p/health" -TimeoutSec 8; Write-Host "Puerto ${p}: FUNCIONA ($($r.Content))" }
  catch { Write-Host "Puerto ${p}: NO responde todavia. Mira C:\vm\logs\ si tarda mas de un minuto." }
}
Write-Host ""
Write-Host "Aplicacion de la empresa (solo en este ordenador): http://localhost:3001/empresa"
if ($claveNueva) {
  Write-Host ""
  Write-Host "TU CLAVE DE LA EMPRESA ES:  $admin"
  Write-Host "Apuntala en un sitio seguro (tambien esta en C:\vm\config\empresa.env, linea ADMIN_TOKEN)."
}
Write-Host ""
Write-Host "Falta (cuando quieras): correo de avisos (SMTP_*, MAIL_TO), carpeta de Drive (DRIVE_FOLDER_ID) y PUBLIC_URL de cliente.env."
