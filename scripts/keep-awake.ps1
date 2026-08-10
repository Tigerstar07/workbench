Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SleepBlocker {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern UInt32 SetThreadExecutionState(UInt32 esFlags);
}
"@

$ES_CONTINUOUS = [UInt32]::Parse("80000000", [Globalization.NumberStyles]::HexNumber)
$ES_SYSTEM_REQUIRED = [UInt32]::Parse("00000001", [Globalization.NumberStyles]::HexNumber)
$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED

Write-Host "[keep-awake] preventing system sleep while the bot supervisor is running. The display may still turn off."

try {
  while ($true) {
    [void][SleepBlocker]::SetThreadExecutionState($flags)
    Start-Sleep -Seconds 30
  }
}
finally {
  [void][SleepBlocker]::SetThreadExecutionState($ES_CONTINUOUS)
}
