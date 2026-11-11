# Arranque automatico de los bots con Windows (tarea "Papus Discord" del Programador de tareas).
#   npm run autostart            -> crea o actualiza la tarea (arranca 30 s despues de iniciar sesion, sin ventana)
#   npm run autostart -- quitar  -> la elimina
#   npm run detener              -> detiene los bots de forma ordenada (se despiden); npm run reiniciar los reinicia
#   npm run bandeja              -> abre el icono de la bandeja ahora
param([string]$accion = "instalar")
$ErrorActionPreference = "Stop"
$name = "Papus Discord"
$root = Split-Path -Parent $PSScriptRoot

function Stop-Bots {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*run-bots.cmd*") -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*src/main.ts*")
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction SilentlyContinue; "detenido $($_.Name) $($_.ProcessId)" }
}

switch ($accion) {
  "quitar" {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName "Papus Bandeja" -Confirm:$false -ErrorAction SilentlyContinue
    "Tareas eliminadas: los bots y el icono ya no arrancan solos."
  }
  "bandeja" {
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$root\scripts\tray-hidden.vbs`""
    "Icono de la bandeja abierto (junto al reloj; puede estar en la flecha de iconos ocultos)."
  }
  "detener" { & (Join-Path $PSScriptRoot "stop-bots.ps1") }
  default {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$root\scripts\run-bots-hidden.vbs`"" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $trigger.Delay = "PT30S"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Bots del Discord de los Papus (Teto, Miku, Luka y Neru). Reinicio automatico si fallan. Registro: data\bots.log" -Force | Out-Null
    # Icono de la bandeja (estado de los bots), al iniciar sesion.
    $trayAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$root\scripts\tray-hidden.vbs`"" -WorkingDirectory $root
    $trayTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    Register-ScheduledTask -TaskName "Papus Bandeja" -Action $trayAction -Trigger $trayTrigger -Settings $settings -Principal $principal -Description "Icono de los Papus en la bandeja: estado de los bots y menu para verlos, reiniciarlos o detenerlos." -Force | Out-Null
    "Tareas listas: los bots arrancan solos 30 s despues de iniciar sesion, y el icono de la bandeja tambien."
  }
}
