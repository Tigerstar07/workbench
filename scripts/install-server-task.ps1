param(
  [string]$TaskName = 'Paper Trading Bot',
  [string]$WatchdogTaskName = 'Paper Trading Bot Watchdog',
  [string]$NodePath,
  [switch]$ApplyAlwaysOnPowerSettings,
  [switch]$StartNow,
  [switch]$NoWatchdog
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $root 'scripts\server-launch.ps1'
$watchdog = Join-Path $root 'scripts\server-watchdog.ps1'
$envFile = Join-Path $root '.env.local'
$viteRuntime = Join-Path $root 'node_modules\vite\bin\vite.js'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw 'Run PowerShell as Administrator, then run this installer again.'
}

if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    $NodePath = $nodeCommand.Source
  }
  else {
    $portableNode = Join-Path $root '..\work\tools\node-v24.17.0-win-x64\node.exe'
    if (Test-Path -LiteralPath $portableNode -PathType Leaf) {
      $NodePath = $portableNode
    }
    else {
      throw 'Node.js was not found. Install Node.js LTS first or pass -NodePath.'
    }
  }
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing $envFile. Configure paper credentials first with scripts\setup-paper-bot-env.ps1."
}
if (-not (Test-Path -LiteralPath $viteRuntime -PathType Leaf)) {
  throw "Dependencies are missing. Run npm ci in $root before installing the task."
}
if (-not $NoWatchdog -and -not (Test-Path -LiteralPath $watchdog -PathType Leaf)) {
  throw "Missing $watchdog. The watchdog task cannot be installed."
}

$powerShell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powerShell)) {
  $powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
}
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -NodePath `"$NodePath`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Starts and supervises the local paper-trading bot at Windows boot. Project: $root" `
  -Action $action `
  -Trigger $trigger `
  -Principal $taskPrincipal `
  -Settings $settings `
  -Force | Out-Null

if (-not $NoWatchdog) {
  $watchdogArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$watchdog`" -TaskName `"$TaskName`" -KillStaleOnFailure"
  $watchdogAction = New-ScheduledTaskAction -Execute $powerShell -Argument $watchdogArguments -WorkingDirectory $root
  $watchdogStartupTrigger = New-ScheduledTaskTrigger -AtStartup
  $watchdogIntervalTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $watchdogSettings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

  Register-ScheduledTask `
    -TaskName $WatchdogTaskName `
    -Description "Checks the local paper-trading bot health endpoint and restarts $TaskName if it is down or stale. Project: $root" `
    -Action $watchdogAction `
    -Trigger @($watchdogStartupTrigger, $watchdogIntervalTrigger) `
    -Principal $taskPrincipal `
    -Settings $watchdogSettings `
    -Force | Out-Null
}

if ($ApplyAlwaysOnPowerSettings) {
  powercfg.exe /change standby-timeout-ac 0 | Out-Null
  powercfg.exe /hibernate off | Out-Null
  Write-Host 'AC sleep is set to Never; hibernation/Fast Startup are disabled. Display timeout was not changed.'
}

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Installed Windows startup task: $TaskName"
if (-not $NoWatchdog) { Write-Host "Installed Windows watchdog task: $WatchdogTaskName" }
Write-Host "Runtime log: $(Join-Path $root 'logs\bot-server.log')"
if (-not $NoWatchdog) { Write-Host "Watchdog log: $(Join-Path $root 'logs\bot-watchdog.log')" }
Write-Host 'The dashboard remains localhost-only; no firewall port was opened.'
if (-not $StartNow) { Write-Host "Start it with: Start-ScheduledTask -TaskName '$TaskName'" }
