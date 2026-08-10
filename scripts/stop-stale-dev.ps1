param(
  [int]$Port = 5173,
  [string]$Workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
  exit 0
}

$workspaceLower = $Workspace.ToLowerInvariant()
$owners = $connections | Select-Object -ExpandProperty OwningProcess -Unique
$stopped = @{}

foreach ($procId in $owners) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
  if (-not $proc) {
    continue
  }

  $commandLine = [string]$proc.CommandLine
  $isThisWorkspace = $commandLine.ToLowerInvariant().Contains($workspaceLower)
  $isVite = $commandLine -match "vite"

  if ($isThisWorkspace -and $isVite) {
    Write-Host "[dev-forever] stopping stale project dev server PID $procId on port $Port"
    taskkill /PID $procId /T /F | Out-Null
    $stopped[$procId] = $true
  }
  else {
    Write-Host "[dev-forever] port $Port is already used by PID $procId; not stopping it because it is not this project's Vite server."
  }
}

$projectViteProcesses = Get-CimInstance Win32_Process |
  Where-Object {
    $cmd = [string]$_.CommandLine
    $_.Name -match "node" -and
      $cmd.ToLowerInvariant().Contains($workspaceLower) -and
      $cmd -match "vite"
  }

foreach ($proc in $projectViteProcesses) {
  if ($stopped.ContainsKey($proc.ProcessId)) {
    continue
  }

  Write-Host "[dev-forever] stopping stale project dev server PID $($proc.ProcessId)"
  taskkill /PID $proc.ProcessId /T /F | Out-Null
}
