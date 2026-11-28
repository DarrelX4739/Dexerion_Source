# Tester measurement tooling (TESTER-BRIEF.md req 2/3/C3): one full-process
# snapshot for whole-tree attribution. Emits every process with
#   - UserModeTime + KernelModeTime (100 ns units) for CPU-time deltas,
#   - WorkingSetSize (bytes), private commit, and private resident working set,
#   - CommandLine + ParentProcessId so the driver can seed the browser tree
#     by --user-data-dir and expand it along parent links (renderers, GPU,
#     utility, crashpad), and classify process roles.
# Read-only: this script never kills or alters anything.

param(
  [string]$OutFile = '',
  [switch]$IncludePrivateWorkingSet
)

$ErrorActionPreference = 'Stop'

$procs = Get-CimInstance Win32_Process -ErrorAction Stop
$capturedAt = (Get-Date).ToUniversalTime().ToString('o')
$privateByPid = @{}
foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
  try {
    $bytes = $process.PrivateMemorySize64
    if ($null -ne $bytes) { $privateByPid[[int]$process.Id] = [uint64]$bytes }
  } catch {}
}

$privateWsByPid = @{}
if ($IncludePrivateWorkingSet) {
  try {
    $counterRows = Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Property IDProcess,WorkingSetPrivate -ErrorAction Stop
    foreach ($row in $counterRows) {
      if ($row.IDProcess -gt 0 -and $null -ne $row.WorkingSetPrivate) {
        $privateWsByPid[[int]$row.IDProcess] = [uint64]$row.WorkingSetPrivate
      }
    }
  } catch {
    # The virtual host may not expose the counter. Preserve null, not zero.
  }
}

$list = New-Object System.Collections.Generic.List[object]
foreach ($p in $procs) {
  $user = 0
  $kernel = 0
  $ws = $null
  if ($null -ne $p.UserModeTime) { $user = [int64]$p.UserModeTime }
  if ($null -ne $p.KernelModeTime) { $kernel = [int64]$p.KernelModeTime }
  if ($null -ne $p.WorkingSetSize) { $ws = [uint64]$p.WorkingSetSize }
  $list.Add([ordered]@{
    pid       = [int]$p.ProcessId
    ppid      = [int]$p.ParentProcessId
    name      = $p.Name
    cpu100ns  = ($user + $kernel)
    wsBytes   = $ws
    privateBytes = $privateByPid[[int]$p.ProcessId]
    privateWsBytes = $privateWsByPid[[int]$p.ProcessId]
    cmdline   = $p.CommandLine
  })
}

$result = [ordered]@{
  capturedAt = $capturedAt
  unit       = 'cpu100ns=100ns, wsBytes=bytes, privateBytes=bytes, privateWsBytes=bytes'
  count      = $list.Count
  processes  = $list
}

$json = $result | ConvertTo-Json -Depth 4 -Compress
if ($OutFile) {
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
}
Write-Output $json
