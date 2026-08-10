param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [int64]$MaxLogBytes = 20971520,
  [ValidateRange(1, 20)]
  [int]$LogCopies = 5
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$supervisor = Join-Path $root 'scripts\dev-forever.mjs'
$envFile = Join-Path $root '.env.local'
$viteRuntime = Join-Path $root 'node_modules\vite\bin\vite.js'
$logDir = Join-Path $root 'logs'
$logPath = Join-Path $logDir 'bot-server.log'

function Rotate-Log {
  if (-not (Test-Path -LiteralPath $logPath)) { return }
  if ((Get-Item -LiteralPath $logPath).Length -lt $MaxLogBytes) { return }

  $oldest = "$logPath.$LogCopies"
  if (Test-Path -LiteralPath $oldest) { Remove-Item -LiteralPath $oldest -Force }
  for ($index = $LogCopies - 1; $index -ge 1; $index--) {
    $source = "$logPath.$index"
    if (Test-Path -LiteralPath $source) {
      Move-Item -LiteralPath $source -Destination "$logPath.$($index + 1)" -Force
    }
  }
  Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
}

if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "Node executable not found at $NodePath"
}
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing $envFile. Run scripts\setup-paper-bot-env.ps1 first."
}
if (-not (Test-Path -LiteralPath $viteRuntime -PathType Leaf)) {
  throw "Dependencies are missing. Run npm ci in $root first."
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Rotate-Log

$startedAt = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'
"[$startedAt] Windows server launcher starting with Node $NodePath" |
  Tee-Object -FilePath $logPath -Append

Push-Location $root
$previousErrorActionPreference = $ErrorActionPreference
try {
  # The Node bot writes recoverable runtime failures to stderr. Windows PowerShell
  # can promote redirected native stderr to NativeCommandError when EAP is Stop,
  # which kills this launcher even though the bot handled the failure.
  $ErrorActionPreference = 'Continue'
  & $NodePath $supervisor 2>&1 | Tee-Object -FilePath $logPath -Append
  $code = $LASTEXITCODE
}
catch {
  $_ | Out-String | Tee-Object -FilePath $logPath -Append
  $code = 1
}
finally {
  $ErrorActionPreference = $previousErrorActionPreference
  Pop-Location
}

if ($null -eq $code) { $code = 1 }
exit $code
