# Tester measurement tooling (TESTER-BRIEF.md req 3 / plan C2): per-process GPU
# sampling. Samples
#   \GPU Engine(*)\Utilization Percentage   (per engine instance, %)
#   \GPU Process Memory(*)\Local Usage      (bytes)
# groups them by pid parsed from the instance name (pid_<n>_luid_...), and
# optionally restricts to a browser process tree passed as -TreePids so the
# run stays cheap and the attribution is exact.
#
# Utilisation note: per-engine percentages are summed per pid, so the value is
# "percentage points across engines" (can exceed 100 when several engines are
# busy); the per-interval and peak values are reported so nothing is hidden.
# Runs as a background process alongside the RAPL power sampler; its own CPU
# cost is identical for both browsers, so paired comparisons stay fair.

param(
  [int]$DurationSec = 14,
  [double]$IntervalSec = 2,
  [string]$TreePids = '',
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Continue'

$tree = New-Object System.Collections.Generic.List[int]
if ($TreePids) {
  foreach ($t in $TreePids.Split(',')) {
    $v = 0
    if ([int]::TryParse($t.Trim(), [ref]$v)) { $tree.Add($v) }
  }
}

$perPid = @{}
$intervalCount = 0
$errors = New-Object System.Collections.Generic.List[string]
$effectiveIntervals = New-Object System.Collections.Generic.List[double]
$swTotal = [System.Diagnostics.Stopwatch]::StartNew()

function Get-ByPid($counters, $tree, [bool]$isUtil) {
  $byPid = @{}
  foreach ($s in $counters.CounterSamples) {
    if ($s.InstanceName -notmatch 'pid_(\d+)') { continue }
    $p = [int]$Matches[1]
    if ($tree.Count -gt 0 -and -not $tree.Contains($p)) { continue }
    if (-not $byPid.ContainsKey($p)) { $byPid[$p] = 0.0 }
    $byPid[$p] += [double]$s.CookedValue
  }
  return $byPid
}

while ($swTotal.Elapsed.TotalSeconds -lt $DurationSec) {
  $t0 = Get-Date
  try {
    $util = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop
    $utilByPid = Get-ByPid $util $tree $true
    $memByPid = @{}
    try {
      $mem = Get-Counter '\GPU Process Memory(*)\Local Usage' -ErrorAction Stop
      $memByPid = Get-ByPid $mem $tree $false
    } catch {
      $errors.Add(('mem: ' + $_.Exception.Message))
    }
    $intervalCount += 1
    $pids = New-Object System.Collections.Generic.List[int]
    foreach ($k in $utilByPid.Keys) { if (-not $pids.Contains($k)) { $pids.Add($k) } }
    foreach ($k in $memByPid.Keys) { if (-not $pids.Contains($k)) { $pids.Add($k) } }
    foreach ($p in $pids) {
      if (-not $perPid.ContainsKey($p)) {
        $perPid[$p] = [ordered]@{
          utilPoints = New-Object System.Collections.Generic.List[double]
          memBytes   = New-Object System.Collections.Generic.List[double]
        }
      }
      if ($utilByPid.ContainsKey($p)) { $perPid[$p].utilPoints.Add([math]::Round($utilByPid[$p], 3)) }
      if ($memByPid.ContainsKey($p))  { $perPid[$p].memBytes.Add([math]::Round($memByPid[$p], 0)) }
    }
  } catch {
    $errors.Add(('util: ' + $_.Exception.Message))
  }
  $elapsed = ((Get-Date) - $t0).TotalSeconds
  $effectiveIntervals.Add([math]::Round($elapsed, 2))
  $wait = $IntervalSec - $elapsed
  if ($wait -gt 0) { Start-Sleep -Seconds $wait }
}

# Aggregate per pid.
$agg = New-Object System.Collections.Generic.List[object]
foreach ($p in $perPid.Keys) {
  $u = @($perPid[$p].utilPoints)
  $m = @($perPid[$p].memBytes)
  $uMean = 0.0; $uPeak = 0.0
  if ($u.Count -gt 0) {
    foreach ($v in $u) { $uMean += $v; if ($v -gt $uPeak) { $uPeak = $v } }
    $uMean = $uMean / $u.Count
  }
  $mMean = 0.0; $mPeak = 0.0
  if ($m.Count -gt 0) {
    foreach ($v in $m) { $mMean += $v; if ($v -gt $mPeak) { $mPeak = $v } }
    $mMean = $mMean / $m.Count
  }
  $agg.Add([ordered]@{
    pid            = $p
    intervals      = $u.Count
    utilPointsMean = [math]::Round($uMean, 3)
    utilPointsPeak = [math]::Round($uPeak, 3)
    memBytesMean   = [math]::Round($mMean, 0)
    memBytesPeak   = [math]::Round($mPeak, 0)
    utilSamples    = $u
  })
}

$avgInterval = 0.0
if ($effectiveIntervals.Count -gt 0) {
  foreach ($v in $effectiveIntervals) { $avgInterval += $v }
  $avgInterval = $avgInterval / $effectiveIntervals.Count
}

$result = [ordered]@{
  capturedAt            = (Get-Date).ToUniversalTime().ToString('o')
  requestedDurationSec  = $DurationSec
  actualDurationSec     = [math]::Round($swTotal.Elapsed.TotalSeconds, 2)
  requestedIntervalSec  = $IntervalSec
  effectiveIntervalSec  = [math]::Round($avgInterval, 2)
  intervalCount         = $intervalCount
  treePids              = $tree
  unit                  = 'utilPoints=percentage-points summed across engines per pid; memBytes=bytes'
  perPid                = $agg
  errors                = $errors
}

$json = $result | ConvertTo-Json -Depth 4 -Compress
if ($OutFile) {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
}
Write-Output $json
