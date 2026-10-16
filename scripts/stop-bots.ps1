# Detiene los bots de forma ordenada: deja data\detener.flag, el programa lo ve (cada 2 s), las chicas se despiden y
# se cierra; run-bots.cmd ve el archivo y no reinicia. Si no se cierran a tiempo, se cierran a la fuerza.
#   powershell -File scripts\stop-bots.ps1 [-Timeout 15] [-Reiniciar]
# Lo usan el icono de la bandeja, `npm run detener` y el script de cierre de sesion de Windows (apagar el PC).
param([int]$Timeout = 15, [switch]$Reiniciar)
$root = Split-Path -Parent $PSScriptRoot
$flag = Join-Path $root "data\detener.flag"

function Get-Bots {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*run-bots.cmd*") -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*src/main.ts*")
  }
}

if (Get-Bots | Where-Object { $_.Name -eq "node.exe" }) {
  New-Item -ItemType File -Path $flag -Force | Out-Null
  $deadline = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $deadline -and (Get-Bots | Where-Object { $_.Name -eq "node.exe" })) { Start-Sleep -Milliseconds 500 }
}
# Lo que quede (no alcanzo a cerrarse, o el bucle de reinicio) se cierra a la fuerza.
Get-Bots | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item $flag -Force -ErrorAction SilentlyContinue

if ($Reiniciar) {
  try { Start-ScheduledTask -TaskName "Papus Discord" -ErrorAction Stop }
  catch { Start-Process -FilePath "wscript.exe" -ArgumentList "`"$root\scripts\run-bots-hidden.vbs`"" -WorkingDirectory $root }
}
