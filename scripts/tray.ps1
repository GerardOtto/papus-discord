# Icono de los Papus en la bandeja de Windows (junto al reloj) y menu general del proyecto.
# - En linea: rota entre Teto, Miku, Luka y Neru con un punto verde; al pasar el mouse, desde que hora.
# - Detenidos: Neru en gris con punto rojo. Avisa con una notificacion cuando cambia el estado.
# - Clic derecho: bots (registro, reiniciar, detener, iniciar), pedidos, carpetas y enlaces del proyecto.
# Lo lanza la tarea "Papus Bandeja" al iniciar sesion (npm run bandeja para abrirlo ahora).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$trayDir = Join-Path $root "assets\bots\tray"
$log = Join-Path $root "data\bots.log"

# Una sola instancia.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "PapusDiscordBandeja", [ref]$created)
if (-not $created) { exit }

# Datos de .env (sin tokens): servidor de Discord y carpetas.
$envVars = @{}
if (Test-Path "$root\.env") {
  Get-Content "$root\.env" | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object { $envVars[$Matches[1]] = $Matches[2].Trim() }
}
$delivery = if ($envVars["DELIVERY_DIR"]) { $envVars["DELIVERY_DIR"].Replace("/", "\") } else { "$env:USERPROFILE\Desktop\Proyecto vocaloid" }
$engine = [System.IO.Path]::GetFullPath((Join-Path $root ($(if ($envVars["ENGINE_DIR"]) { $envVars["ENGINE_DIR"] } else { "..\Proyecto1" }))))
$guild = $envVars["DISCORD_GUILD_ID"]

$iconsOn = @("teto_on", "miku_on", "luka_on", "neru_on") | ForEach-Object { New-Object System.Drawing.Icon (Join-Path $trayDir "$_.ico") }
$iconOff = New-Object System.Drawing.Icon (Join-Path $trayDir "off.ico")

function Get-BotProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*src/main.ts*" } | Select-Object -First 1
}

# Acciones largas en segundo plano (el menu no se congela).
function Invoke-Hidden([string]$file, [string]$args2) {
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -WorkingDirectory $root -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$file`" $args2"
}
function Open-Path([string]$p) {
  if (Test-Path $p) { Start-Process explorer.exe "`"$p`"" }
  else { $tray.ShowBalloonTip(3000, "Papus", "No encuentro: $p", [System.Windows.Forms.ToolTipIcon]::Warning) }
}
function Add-Item($parent, [string]$text, [scriptblock]$action) {
  $item = $parent.DropDownItems.Add($text)
  $item.add_Click($action)
  return $item
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $iconOff
$tray.Text = "Papus: revisando…"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = $menu.Items.Add("Revisando…")
$itemStatus.Enabled = $false
[void]$menu.Items.Add("-")

# 🤖 Bots
$bots = New-Object System.Windows.Forms.ToolStripMenuItem("🤖 Bots")
[void]$menu.Items.Add($bots)
[void](Add-Item $bots "📜 Ver registro" { if (Test-Path $log) { Start-Process notepad.exe "`"$log`"" } })
[void](Add-Item $bots "🔄 Reiniciar (se despiden y vuelven)" {
  Invoke-Hidden "$root\scripts\stop-bots.ps1" "-Reiniciar"
  $tray.ShowBalloonTip(3000, "Papus", "Reiniciando a las chicas…", [System.Windows.Forms.ToolTipIcon]::Info)
})
$itemStop = Add-Item $bots "⏹ Detener (se despiden)" {
  Invoke-Hidden "$root\scripts\stop-bots.ps1" ""
  $tray.ShowBalloonTip(3000, "Papus", "Las chicas se están despidiendo…", [System.Windows.Forms.ToolTipIcon]::Info)
}
$itemStart = Add-Item $bots "▶ Iniciar" {
  try { Start-ScheduledTask -TaskName "Papus Discord" -ErrorAction Stop }
  catch { Start-Process -FilePath "wscript.exe" -ArgumentList "`"$root\scripts\run-bots-hidden.vbs`"" -WorkingDirectory $root }
}

# 🎁 Pedidos
$orders = New-Object System.Windows.Forms.ToolStripMenuItem("🎁 Pedidos")
[void]$menu.Items.Add($orders)
[void](Add-Item $orders "📋 Ver lista de pedidos" {
  Start-Process -FilePath "cmd.exe" -WindowStyle Hidden -WorkingDirectory $root -ArgumentList "/c npm run -s pedidos"
  $tray.ShowBalloonTip(2500, "Papus", "Armando la lista de pedidos…", [System.Windows.Forms.ToolTipIcon]::Info)
})

# 📊 Consumo de APIs (lo escribe el programa de los bots cada minuto en data\estado.json)
$usageMenu = New-Object System.Windows.Forms.ToolStripMenuItem("📊 Consumo de APIs (hoy)")
[void]$menu.Items.Add($usageMenu)
[void]$usageMenu.DropDownItems.Add("Revisando…")
$usageMenu.add_DropDownOpening({
  $usageMenu.DropDownItems.Clear()
  $file = Join-Path $root "data\estado.json"
  if (-not (Test-Path $file)) { [void]$usageMenu.DropDownItems.Add("Sin datos (¿los bots están detenidos?)"); return }
  $st = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $names = @{ local = "💻 Local (tu PC)"; groq = "Groq"; gemini = "Gemini"; openrouter = "OpenRouter"; cloudflare = "Cloudflare" }
  foreach ($a in $st.apis) {
    $label = if ($names[$a.nombre]) { $names[$a.nombre] } else { $a.nombre }
    $text = if ($null -ne $a.limite) {
      $dot = if ($a.porcentaje -ge 80) { "🔴" } elseif ($a.porcentaje -ge 50) { "🟡" } else { "🟢" }
      "$dot $label`t$($a.porcentaje) %  ($($a.hoy) de $($a.limite))"
    } else { "🟢 $label`t$($a.hoy) respuestas (sin límite)" }
    $it = $usageMenu.DropDownItems.Add($text)
  }
  [void]$usageMenu.DropDownItems.Add("-")
  $when = ([datetime]$st.actualizado).ToLocalTime().ToString("HH:mm")
  $it = $usageMenu.DropDownItems.Add("Actualizado a las $when · se reinicia a medianoche")
  $it.Enabled = $false
})

# 📂 Carpetas
$folders = New-Object System.Windows.Forms.ToolStripMenuItem("📂 Carpetas")
[void]$menu.Items.Add($folders)
[void](Add-Item $folders "🎬 Proyecto Vocaloid" { Open-Path $delivery })
[void](Add-Item $folders "✅ 1. Videos finales" { Open-Path (Join-Path $delivery "1. Videos finales") })
[void](Add-Item $folders "🔎 2. Episodios en revisión" { Open-Path (Join-Path $delivery "2. Episodios en revisión") })
[void](Add-Item $folders "📤 5. Subidos" { Open-Path (Join-Path $delivery "5. Subidos") })
[void]$folders.DropDownItems.Add("-")
[void](Add-Item $folders "⚙️ Motor de videos (Proyecto1)" { Open-Path $engine })
[void](Add-Item $folders "🤖 Bots (papus-discord)" { Open-Path $root })

# 🌐 Enlaces
$links = New-Object System.Windows.Forms.ToolStripMenuItem("🌐 Enlaces")
[void]$menu.Items.Add($links)
if ($guild) { [void](Add-Item $links "💬 Servidor de Discord" { Start-Process "discord://-/channels/$guild" }) }
[void](Add-Item $links "📸 Instagram (@tetociencia)" { Start-Process "https://www.instagram.com/tetociencia/" })
[void](Add-Item $links "💎 Ko-fi (niveles)" { Start-Process "https://ko-fi.com/tetociencia/tiers" })
[void](Add-Item $links "☁️ Cloudflare (Miku y Luka 24/7)" { Start-Process "https://dash.cloudflare.com/?to=/:account/workers/services/view/papus-bots/production" })

[void]$menu.Items.Add("-")
$menu.Items.Add("✖ Quitar este ícono (los bots siguen)").add_Click({
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ if (Test-Path $log) { Start-Process notepad.exe "`"$log`"" } })

$script:frame = 0
$script:wasOnline = $null

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 4000
$timer.add_Tick({
  $p = Get-BotProcess
  $online = [bool]$p
  if ($online) {
    $since = $p.CreationDate.ToString("HH:mm")
    $tray.Icon = $iconsOn[$script:frame % $iconsOn.Count]
    $script:frame++
    $tray.Text = "Papus: en línea desde las $since"
    $itemStatus.Text = "🟢 En línea desde las $since"
  } else {
    $tray.Icon = $iconOff
    $tray.Text = "Papus: detenidos"
    $itemStatus.Text = "🔴 Detenidos"
  }
  $itemStop.Enabled = $online
  $itemStart.Enabled = -not $online
  if ($null -ne $script:wasOnline -and $script:wasOnline -ne $online) {
    if ($online) { $tray.ShowBalloonTip(4000, "Papus", "¡Las chicas están en línea! ✨", [System.Windows.Forms.ToolTipIcon]::Info) }
    else { $tray.ShowBalloonTip(5000, "Papus", "Los bots se detuvieron. Si no fuiste tú, se reinician solos en unos segundos.", [System.Windows.Forms.ToolTipIcon]::Warning) }
  }
  $script:wasOnline = $online
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$timer.Stop()
$tray.Dispose()
$mutex.ReleaseMutex()
