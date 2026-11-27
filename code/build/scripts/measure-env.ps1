# Tester measurement tooling (TESTER-BRIEF.md req 6 / plan C1): per-trial
# environment record. Fast enough to call before every trial (~1 s):
#   - active Windows power plan (name + GUID)
#   - AC/battery state + charge %
#   - OS caption + build
#   - Edge version (registry BLBeacon, fallback to the exe's VersionInfo)
# Read-only. The driver adds the Electron version and co-tenant load itself.

param(
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Continue'

$result = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
}

# Active power plan.
try {
  $raw = powercfg /getactivescheme 2>&1 | Out-String
  $guid = ''
  if ($raw -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') { $guid = $Matches[1] }
  $name = ($raw -replace '^.*Power Scheme GUID:.*?\(.*?\)\s*', '').Trim()
  if (-not $name) { $name = $raw.Trim() }
  $result.powerPlan = $name
  $result.powerPlanGuid = $guid
} catch { $result.powerPlan = 'error: ' + $_.Exception.Message }

# AC / battery.
try {
  $bat = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
  if ($bat) {
    # BatteryStatus: 1 = discharging, 2 = on mains/AC (other values recorded raw).
    $result.batteryStatus = [int]$bat.BatteryStatus
    $result.onAc = ([int]$bat.BatteryStatus -eq 2)
    $result.chargePct = [int]$bat.EstimatedChargeRemaining
  } else {
    $result.onAc = $true
    $result.batteryStatus = 'none'
  }
} catch { $result.onAc = 'unknown'; $result.batteryStatus = 'error: ' + $_.Exception.Message }

# OS.
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $result.osCaption = $os.Caption
  $result.osBuild = $os.BuildNumber
  $result.osVersion = $os.Version
} catch { $result.osCaption = 'error: ' + $_.Exception.Message }

# Edge version.
$edgeVer = ''
try {
  $k = Get-ItemProperty 'HKCU:\Software\Microsoft\Edge\BLBeacon' -ErrorAction Stop
  $edgeVer = [string]$k.version
} catch {}
if (-not $edgeVer) {
  foreach ($p in @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")) {
    if ($p -and (Test-Path $p)) { $edgeVer = (Get-Item $p).VersionInfo.ProductVersion; break }
  }
}
$result.edgeVersion = if ($edgeVer) { $edgeVer } else { 'unknown' }

$json = $result | ConvertTo-Json -Depth 3 -Compress
if ($OutFile) {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
}
Write-Output $json
