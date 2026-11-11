# Script de cierre de sesion de Windows (directiva local de grupo, Windows Pro): al apagar el PC o cerrar sesion,
# Windows ejecuta scripts\stop-bots.ps1 antes de cerrar todo, y las chicas alcanzan a despedirse.
#   npm run despedida-al-apagar             -> lo instala (necesita la terminal como administrador)
#   npm run despedida-al-apagar -- quitar   -> lo quita y deja la directiva como estaba
# Respaldo del archivo original: data\gpt.ini.bak
param([string]$accion = "instalar")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$gp = "$env:windir\System32\GroupPolicy"
$gpt = "$gp\gpt.ini"
$dir = "$gp\User\Scripts"
$ini = "$dir\scripts.ini"
$ext = "[{42B5FAAE-6536-11D2-AE5A-0000F87571E3}{40B66650-4972-11D1-A7CA-0000F87571E3}]"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Hay que correrlo como administrador (la directiva local de Windows lo exige)." }

function Read-Gpt {
  if (Test-Path $gpt) { Get-Content $gpt } else { @("[General]", "Version=0") }
}

function Write-Gpt([string[]]$lines, [int]$userBump) {
  $out = @()
  $hasUser = $false
  foreach ($l in $lines) {
    if ($l -match "^Version=(\d+)") {
      $v = [int64]$Matches[1]
      $user = [int64][math]::Floor($v / 65536) + $userBump
      $machine = $v % 65536
      $out += "Version=$($user * 65536 + $machine)"
    } elseif ($l -match "^gPCUserExtensionNames=") {
      $hasUser = $true
      if ($accion -eq "quitar") { $rest = $l.Replace($ext, ""); if ($rest -ne "gPCUserExtensionNames=") { $out += $rest } }
      elseif ($l -notlike "*$ext*") { $out += $l + $ext } else { $out += $l }
    } else { $out += $l }
  }
  if (-not $hasUser -and $accion -ne "quitar") { $out = @($out[0], "gPCUserExtensionNames=$ext") + $out[1..($out.Length - 1)] }
  Set-Content -Path $gpt -Value $out -Encoding ASCII
}

if ($accion -eq "quitar") {
  Remove-Item $ini -Force -ErrorAction SilentlyContinue
  Write-Gpt (Read-Gpt) 1
  gpupdate /target:user /force | Out-Null
  "Listo: Windows ya no avisa a los bots al apagar."
  exit
}

if (Test-Path $ini) {
  $current = Get-Content $ini -Raw
  if ($current -notlike "*stop-bots.ps1*") { throw "Ya hay scripts de cierre de sesion configurados ($ini). No lo piso: revisalo a mano con gpedit.msc." }
}
New-Item -ItemType Directory -Force -Path "$dir\Logoff", "$dir\Logon" | Out-Null
if (Test-Path $gpt) { Copy-Item $gpt (Join-Path $root "data\gpt.ini.bak") -Force }
$content = "`r`n[Logoff]`r`n0CmdLine=powershell.exe`r`n0Parameters=-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\stop-bots.ps1`" -Timeout 8`r`n"
# Windows exige scripts.ini en UTF-16 LE.
[System.IO.File]::WriteAllText($ini, $content, [System.Text.Encoding]::Unicode)
Write-Gpt (Read-Gpt) 1
gpupdate /target:user /force | Out-Null
"Listo: al apagar el PC o cerrar sesion, las chicas se despiden antes de irse."
