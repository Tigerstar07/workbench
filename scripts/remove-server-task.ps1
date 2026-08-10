param([string]$TaskName = 'Paper Trading Bot')

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "Task '$TaskName' is not installed."
  exit 0
}

if ($task.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $TaskName
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed Windows startup task: $TaskName"
Write-Host 'Power settings were left unchanged; adjust them manually if desired.'
