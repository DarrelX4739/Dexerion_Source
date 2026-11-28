param(
  [int]$DurationSec = 12,
  [string]$OutFile = '',
  [string]$CounterInstance = 'rapl_package0_pkg'
)

$ErrorActionPreference = 'Stop'

# Windows RAPL counters report milliwatts. Sample the whole CPU package; the
# first Get-Counter sample is a warm-up zero on this machine, so drop it.
if ($CounterInstance -notmatch '^rapl_package[0-9]+_pkg$') {
  throw 'Expected an explicit CPU package RAPL meter'
}
$CounterInstance = $CounterInstance.ToLowerInvariant()

$path = '\Energy Meter(' + $CounterInstance + ')\Power'
$samples = Get-Counter -Counter $path -SampleInterval 1 -MaxSamples ($DurationSec + 1) -ErrorAction Stop
$rows = @($samples.CounterSamples)
if (-not $rows.Count -or @($rows | Where-Object { $_.InstanceName -ne $CounterInstance }).Count) {
  throw 'CPU package power meter missing or inconsistent: ' + $CounterInstance
}
$values = @($rows | ForEach-Object { [double]$_.CookedValue })
if ($values.Count -gt 1) { $values = $values[1..($values.Count - 1)] }
$values = @($values | Where-Object { $_ -gt 0 })
if ($values.Count -lt 3) { throw 'Fewer than three valid power samples for ' + $path }

$sorted = @($values | Sort-Object)
$sum = 0.0
foreach ($v in $values) { $sum += $v }
$mean = $sum / $values.Count
$median = $sorted[[int][math]::Floor($sorted.Count / 2)]
$p10 = $sorted[[int][math]::Floor(($sorted.Count - 1) * 0.10)]
$p90 = $sorted[[int][math]::Floor(($sorted.Count - 1) * 0.90)]

$result = [ordered]@{
  counter = $path
  instance = $CounterInstance
  unit = 'mW'
  seconds = $DurationSec
  sampleCount = $values.Count
  meanMW = [math]::Round($mean, 2)
  medianMW = [math]::Round($median, 2)
  p10MW = [math]::Round($p10, 2)
  p90MW = [math]::Round($p90, 2)
  samplesMW = @($values | ForEach-Object { [math]::Round($_, 2) })
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$json = $result | ConvertTo-Json -Depth 5
if ($OutFile) {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
}
Write-Output $json
