param(
  [string]$Destination,
  [ValidateRange(1, 3650)]
  [int]$KeepDays = 30
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Destination) { $Destination = Join-Path $root 'backups' }
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$runtimeFiles = @(
  'paper-bot-memory.json',
  'paper-bot-setup-memory.json',
  'paper-bot-trades.csv',
  'paper-bot-review.jsonl',
  'paper-bot-decisions.jsonl',
  'paper-bot-maker-shadow.jsonl',
  'paper-bot-equity.json',
  'stock-micro-bars.json'
)
$existingFiles = @($runtimeFiles | ForEach-Object {
  $path = Join-Path $root $_
  if (Test-Path -LiteralPath $path -PathType Leaf) { $path }
})
if ($existingFiles.Count -eq 0) {
  Write-Host 'No runtime data exists yet; nothing to back up.'
  exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $Destination "paper-bot-$stamp.zip"
Compress-Archive -LiteralPath $existingFiles -DestinationPath $archive -CompressionLevel Optimal

$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $Destination -Filter 'paper-bot-*.zip' -File |
  Where-Object LastWriteTime -lt $cutoff |
  Remove-Item -Force

Write-Host "Backup created: $archive"
Write-Host '.env.local was intentionally excluded because it contains secrets.'
