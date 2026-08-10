param(
  [string]$TaskName = 'Paper Trading Bot',
  [string]$NodePath,
  [string]$GitPath,
  [switch]$SkipPull,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$healthUrl = 'http://127.0.0.1:5173/api/paper-bot/state'

function Resolve-Executable {
  param(
    [string]$Path,
    [string]$CommandName,
    [string]$Label
  )

  if ($Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label was not found at $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "$Label was not found. Pass the explicit path with -$($Label -replace '[^A-Za-z0-9]', '')Path or add it to PATH."
}

$gitExe = Resolve-Executable -Path $GitPath -CommandName 'git.exe' -Label 'Git'
$nodeExe = Resolve-Executable -Path $NodePath -CommandName 'node.exe' -Label 'Node'
$npmCmd = Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd -PathType Leaf)) {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) { throw 'npm.cmd was not found next to Node or in PATH.' }
  $npmCmd = $npmCommand.Source
}

function Assert-SafeToStop {
  try {
    $state = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 20
  }
  catch {
    if ($Force) {
      Write-Warning "Could not read bot state; continuing because -Force was supplied: $($_.Exception.Message)"
      return
    }
    throw 'Could not verify that the bot is flat. Restore its health or rerun with -Force only after checking the broker directly.'
  }

  # The dashboard intentionally returns recent order history (`status=all`),
  # not only working orders. Count every non-terminal status conservatively.
  $terminalStatuses = @('filled', 'canceled', 'cancelled', 'expired', 'rejected', 'replaced', 'done_for_day')
  $positions = @($state.positions).Count
  $openOrders = @($state.orders | Where-Object {
    $status = ([string]$_.status).Trim().ToLowerInvariant()
    $status -and $terminalStatuses -notcontains $status
  }).Count
  if (($positions -gt 0 -or $openOrders -gt 0) -and -not $Force) {
    throw "Update refused: broker state has $positions position(s) and $openOrders open order(s). Update while flat, or use -Force only after accepting unmanaged-position risk."
  }
}

Assert-SafeToStop
& (Join-Path $PSScriptRoot 'backup-paper-bot.ps1')

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($task.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
}

Push-Location $root
try {
  $dirty = @(& $gitExe status --porcelain --untracked-files=no)
  if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
  if ($dirty.Count -gt 0) { throw 'Server checkout has tracked local changes. Resolve them before updating.' }

  if (-not $SkipPull) {
    & $gitExe pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed.' }
  }

  & $npmCmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  & $npmCmd test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed; server task remains stopped.' }
  & $npmCmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed; server task remains stopped.' }
  & $npmCmd run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed; server task remains stopped.' }
}
finally {
  Pop-Location
}

Start-ScheduledTask -TaskName $TaskName
for ($attempt = 1; $attempt -le 12; $attempt++) {
  Start-Sleep -Seconds 5
  & (Join-Path $PSScriptRoot 'server-health.ps1') -RequireRunning
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Server update completed and passed its health check.'
    exit 0
  }
}

throw 'Updated task started but did not become healthy within 60 seconds. Check logs\bot-server.log.'
