# Ejecuta UNA consulta SELECT (la lee de la entrada estándar) contra SQL Server y escribe las filas separadas por tabuladores.
# Lo usa extraer-a3erp.js en el servidor de la oficina: PowerShell ya viene con Windows, no hay que instalar sqlcmd ni controladores.
# Solo lectura: abre la conexión con intención de solo lectura y el extractor pone la consulta en READ UNCOMMITTED (no bloquea a a3ERP).
#   -Servidor  p. ej. SRVVALENTIN\A3ERP        -Base  p. ej. VALENTIN
#   -Usuario / -Clave  solo si no se usa la cuenta de Windows (Seguridad integrada)
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [Parameter(Mandatory = $true)][string]$Base,
  [string]$Usuario = "",
  [string]$Clave = ""
)
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$sql = (New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)).ReadToEnd()
$auth = if ($Usuario) { "User Id=$Usuario;Password=$Clave" } else { "Integrated Security=True" }
$cn = New-Object System.Data.SqlClient.SqlConnection("Server=$Servidor;Database=$Base;$auth;TrustServerCertificate=True;ApplicationIntent=ReadOnly;Application Name=VM-exportar-a3erp")
$cn.Open()
try {
  $cmd = $cn.CreateCommand()
  $cmd.CommandText = $sql
  $cmd.CommandTimeout = 900
  $rd = $cmd.ExecuteReader()
  $out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
  while ($rd.Read()) {
    $vals = New-Object string[] $rd.FieldCount
    for ($i = 0; $i -lt $rd.FieldCount; $i++) { $vals[$i] = if ($rd.IsDBNull($i)) { "" } else { [string]$rd.GetValue($i) } }
    $out.Write(($vals -join "`t") + "`n")
  }
  $out.Flush()
} finally {
  $cn.Close()
}
