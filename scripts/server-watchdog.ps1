param(
  [string]$TaskName = 'Paper Trading Bot',
  [string]$Url = 'http://127.0.0.1:5173/api/paper-bot/state',
  [ValidateRange(1, 60)]
  [int]$MaxTickAgeMinutes = 5,
  [ValidateRange(15, 300)]
  [int]$WarmupSeconds = 90,
  [switch]$KillStaleOnFailure
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $root 'logs'
$logPath = Join-Path $logDir 'bot-watchdog.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-WatchdogLog {
  param([string]$Message)
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'
  $line = "[$stamp] $Message"
  $line | Tee-Object -FilePath $logPath -Append
}

function Convert-ToUtcDateTime {
  param([object]$Value)
  if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
  return [DateTimeOffset]::Parse(
    [string]$Value,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::RoundtripKind
  ).UtcDateTime
}

function Test-BotHealth {
  try {
    $state = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 20
    if (-not $state.ok) {
      return [pscustomobject]@{ Healthy = $false; Reason = "API reported error: $($state.error)" }
    }
    if (-not $state.configured) {
      return [pscustomobject]@{ Healthy = $false; Reason = "bot is not configured: $($state.lastError)" }
    }
    if (-not $state.running) {
      return [pscustomobject]@{ Healthy = $false; Reason = 'bot API is up but trading is stopped' }
    }
    if (-not $state.lastTickAt) {
      return [pscustomobject]@{ Healthy = $false; Reason = 'bot is running but has no completed tick' }
    }

    $lastTickUtc = Convert-ToUtcDateTime $state.lastTickAt
    $tickAge = (Get-Date).ToUniversalTime() - $lastTickUtc
    if ($tickAge.TotalMinutes -gt $MaxTickAgeMinutes) {
      return [pscustomobject]@{
        Healthy = $false
        Reason = "last completed tick is $([math]::Round($tickAge.TotalMinutes, 1)) minutes old"
      }
    }

    return [pscustomobject]@{
      Healthy = $true
      Reason = "running=$($state.running) mode=$($state.mode) lastTick=$($state.lastTickAt)"
    }
  }
  catch {
    return [pscustomobject]@{ Healthy = $false; Reason = $_.Exception.Message }
  }
}

function Stop-BotProcessTree {
  $markers = @(
    '\scripts\server-launch.ps1',
    '\scripts\dev-forever.mjs',
    '\scripts\keep-awake.ps1',
    '\scripts\analyze-paper-bot-trades.mjs',
    '\node_modules\vite\bin\vite.js'
  )

  $botProcesses = foreach ($candidate in Get-CimInstance Win32_Process) {
    if ($candidate.ProcessId -eq $PID) { continue }
    if ($candidate.Name -notmatch '^(node|powershell)\.exe$') { continue }
    $commandLine = [string]$candidate.CommandLine
    $matched = $false
    foreach ($marker in $markers) {
      if ($commandLine -like "*$root*$marker*") {
        $matched = $true
        break
      }
    }
    if ($matched) { $candidate }
  }

  foreach ($process in $botProcesses) {
    Write-WatchdogLog "Stopping stale bot process PID $($process.ProcessId): $($process.Name)"
    & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
  }
}

function Start-BotTask {
  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  catch {
    Write-WatchdogLog "Stop-ScheduledTask warning: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 3
  Start-ScheduledTask -TaskName $TaskName
}

function Wait-ForRecovery {
  $deadline = (Get-Date).AddSeconds($WarmupSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $health = Test-BotHealth
    if ($health.Healthy) { return $health }
  }
  return Test-BotHealth
}

$health = Test-BotHealth
if ($health.Healthy) { exit 0 }

Write-WatchdogLog "UNHEALTHY: $($health.Reason); restarting scheduled task '$TaskName'."
Start-BotTask
$recovered = Wait-ForRecovery
if ($recovered.Healthy) {
  Write-WatchdogLog "RECOVERED: $($recovered.Reason)"
  exit 0
}

Write-WatchdogLog "First restart did not recover: $($recovered.Reason)"
if ($KillStaleOnFailure) {
  Stop-BotProcessTree
  Start-BotTask
  $recovered = Wait-ForRecovery
  if ($recovered.Healthy) {
    Write-WatchdogLog "RECOVERED after stale-process cleanup: $($recovered.Reason)"
    exit 0
  }
}

Write-WatchdogLog "FAILED to recover: $($recovered.Reason)"
exit 1
