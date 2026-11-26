param(
  [int]$DurationSec = 12,
  [string]$OutFile = '',
  [string]$CounterInstance = ''
)

$ErrorActionPreference = 'Stop'

# Windows RAPL counters report milliwatts. Sample the whole CPU package; the
# first Get-Counter sample is a warm-up zero on this machine, so drop it.
if (-not $CounterInstance) {
  $probe = Get-Counter '\Energy Meter(*)\Power' -ErrorAction Stop
  $pkg = $probe.CounterSamples | Where-Object {
    $_.InstanceName -match 'pkg$|package[0-9]*_pkg' -and $_.InstanceName -notmatch 'dram|pp0|pp1'
  } | Select-Object -First 1
  if (-not $pkg) {
    $pkg = $probe.CounterSamples | Where-Object {
      $_.InstanceName -and $_.InstanceName -ne '_total' -and $_.CookedValue -gt 0
    } | Select-Object -First 1
  }
  if (-not $pkg) { throw 'No non-zero RAPL Energy Meter Power instance found' }
  $CounterInstance = $pkg.InstanceName
}

$path = '\Energy Meter(' + $CounterInstance + ')\Power'
$samples = Get-Counter -Counter $path -SampleInterval 1 -MaxSamples ($DurationSec + 1) -ErrorAction Stop
$values = @($samples.CounterSamples | ForEach-Object { [double]$_.CookedValue })
if ($values.Count -gt 1) { $values = $values[1..($values.Count - 1)] }
$values = @($values | Where-Object { $_ -gt 0 })
if (-not $values.Count) { throw 'No valid power samples returned for ' + $path }

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
