# Local GPU Engine data for the benchmark. Save individual physical engine
# samples with their timestamp; the controller trims to the same CPU interval
# and filters against browser PIDs from both snapshots before reporting.
param(
  [int]$DurationSec = 14,
  [double]$IntervalSec = 2,
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
$intervals = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[string]
$clock = [System.Diagnostics.Stopwatch]::StartNew()

while ($clock.Elapsed.TotalSeconds -lt $DurationSec) {
  $started = $clock.Elapsed.TotalSeconds
  try {
    $snapshot = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop
    $engines = New-Object System.Collections.Generic.List[object]
    foreach ($sample in $snapshot.CounterSamples) {
      if ($sample.InstanceName -notmatch '^pid_(\d+)_(.+)$') { continue }
      $pidValue = [int]$Matches[1]
      $engine = [string]$Matches[2]
      $util = [double]$sample.CookedValue
      if ($sample.Status -notin @(0, 1) -or $util -lt 0 -or [double]::IsNaN($util) -or [double]::IsInfinity($util)) { continue }
      $engines.Add([ordered]@{ pid = $pidValue; engine = $engine; utilPoints = $util })
    }
    # An empty engine counter result is unsupported, not a valid zero trial.
    if ($engines.Count -gt 0) {
      $intervals.Add([ordered]@{ trialTimestamp = $snapshot.Timestamp.ToUniversalTime().ToString('o'); engines = @($engines.ToArray()) })
    }
  } catch { if ($errors.Count -lt 3) { $errors.Add($_.Exception.Message) } }
  $remaining = $IntervalSec - ($clock.Elapsed.TotalSeconds - $started)
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]($remaining * 1000)) }
}

$result = [ordered]@{
  requestedIntervalSec = $IntervalSec
  samples = @($intervals.ToArray())
  unit = 'GPU Engine utilisation percentage by PID and physical engine'
  errors = @($errors.ToArray())
}
$json = $result | ConvertTo-Json -Depth 6 -Compress
if ($OutFile) {
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
} else { Write-Output $json }
