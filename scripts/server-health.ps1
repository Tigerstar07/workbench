param(
  [string]$Url = 'http://127.0.0.1:5173/api/paper-bot/state',
  [ValidateRange(1, 120)]
  [int]$TimeoutSeconds = 20,
  [ValidateRange(1, 60)]
  [int]$MaxTickAgeMinutes = 5,
  [switch]$RequireRunning
)

$ErrorActionPreference = 'Stop'
try {
  $state = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec $TimeoutSeconds
  if (-not $state.ok) { throw "Bot API reported an error: $($state.error)" }
  if (-not $state.configured) { throw "Bot is not configured: $($state.lastError)" }
  if ($RequireRunning -and -not $state.running) { throw 'Bot API is healthy, but trading is stopped.' }

  if ($state.running) {
    if (-not $state.lastTickAt) { throw 'Bot says it is running but has no completed tick.' }
    # Windows PowerShell may deserialize an ISO JSON timestamp directly into a
    # DateTime and format it using the machine locale. Avoid converting that
    # value back through a culture-dependent string.
    if ($state.lastTickAt -is [DateTime]) {
      $lastTickUtc = $state.lastTickAt.ToUniversalTime()
    }
    else {
      $lastTickUtc = [DateTimeOffset]::Parse(
        [string]$state.lastTickAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
      ).UtcDateTime
    }
    $tickAge = (Get-Date).ToUniversalTime() - $lastTickUtc
    if ($tickAge.TotalMinutes -gt $MaxTickAgeMinutes) {
      throw "Last completed tick is $([math]::Round($tickAge.TotalMinutes, 1)) minutes old."
    }
  }

  $terminalStatuses = @('filled', 'canceled', 'cancelled', 'expired', 'rejected', 'replaced', 'done_for_day')
  $positionCount = @($state.positions).Count
  $openOrderCount = @($state.orders | Where-Object {
    $status = ([string]$_.status).Trim().ToLowerInvariant()
    $status -and $terminalStatuses -notcontains $status
  }).Count
  Write-Host "HEALTHY running=$($state.running) mode=$($state.mode) positions=$positionCount openOrders=$openOrderCount lastTick=$($state.lastTickAt)"
  exit 0
}
catch {
  # Keep this as a normal process result rather than a terminating PowerShell
  # error so update-server.ps1 can retry while the boot task is warming up.
  Write-Host "UNHEALTHY $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
