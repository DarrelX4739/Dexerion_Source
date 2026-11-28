[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][uint32]$RootProcess,
  [Parameter(Mandatory=$true)][string]$ProfileDir,
  [Parameter(Mandatory=$true)][ValidateSet('msedge.exe','dexerion.exe')][string]$ImageName
)

$ErrorActionPreference = 'Stop'
if (-not $env:GITHUB_ACTIONS -or $env:GITHUB_REF -ne 'refs/heads/dev-V') { throw 'hosted dev-V only' }
if ((Split-Path $ProfileDir -Leaf) -notmatch '^dex-native-(edge|dexerion)-[\w-]+$') { throw 'not a known disposable native profile' }
if (-not [System.Diagnostics.Stopwatch]::IsHighResolution) { throw 'high resolution QPC not available' }
Add-Type -Path (Join-Path $PSScriptRoot 'OwnedWorkingSetInventory.cs')
$freq = [System.Diagnostics.Stopwatch]::Frequency
$rootForbidden = '(?i)(?:^|\s)--(?:no-sandbox|disable-web-security|disable-site-isolation-trials)(?:[=\s]|$)'
$childForbidden = '(?i)(?:^|\s)--(?:disable-web-security|disable-site-isolation-trials)(?:[=\s]|$)'

function Write-Message($Message) {
  [Console]::WriteLine((ConvertTo-Json -InputObject $Message -Depth 7 -Compress))
}

function Get-VerifiedSample($Id) {
  $beforeInventoryAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $before = @([OwnedWorkingSetInventory]::Read($RootProcess))
  if ($before[0].ImageName -ine $ImageName) { throw 'owned root executable identity mismatch' }
  $byId = @{}
  foreach ($p in $before) { $byId[[uint32]$p.Id] = $p }
  # Only verified owned IDs appear in either query. No unrelated counter,
  # command line or identity is written to stdout, disk, or the artifact.
  $perfFilter = (($before | ForEach-Object { 'IDProcess = ' + $_.Id }) -join ' OR ')
  $cmdFilter = (($before | ForEach-Object { 'ProcessId = ' + $_.Id }) -join ' OR ')
  $acquireBeginUtcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $low = [System.Diagnostics.Stopwatch]::GetTimestamp()
  $measure = @(Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Filter $perfFilter -Property IDProcess,WorkingSetPrivate,Timestamp_PerfTime,Frequency_PerfTime -OperationTimeoutSec 4)
  $high = [System.Diagnostics.Stopwatch]::GetTimestamp()
  $acquireEndUtcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $after = @([OwnedWorkingSetInventory]::Read($RootProcess))
  $afterInventoryAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($before.Count -ne $after.Count -or $before.Count -ne $measure.Count) { throw 'owned/native/PerfProc counts disagree' }
  foreach ($p in $after) {
    $known = $byId[[uint32]$p.Id]
    if ($null -eq $known -or $p.BirthFileTime -ne $known.BirthFileTime -or $p.Parent -ne $known.Parent -or $p.ImageName -ine $known.ImageName) {
      throw 'owned PID generation or ancestry changed across provider collection'
    }
  }

  # Read only the already proved process IDs' actual command lines so there
  # is no relaxation of the previous launch and child override gates.
  $identities = @(Get-CimInstance -ClassName Win32_Process -Filter $cmdFilter -Property ProcessId,ParentProcessId,CreationDate,Name,CommandLine -OperationTimeoutSec 4)
  if ($identities.Count -ne $before.Count) { throw 'owned command-line proof incomplete' }
  $cmdSeen = @{}
  foreach ($p in $identities) {
    $known = $byId[[uint32]$p.ProcessId]
    if ($null -eq $known -or $cmdSeen.ContainsKey([uint32]$p.ProcessId) -or $p.Name -ine $known.ImageName -or $p.ParentProcessId -ne $known.Parent -or
        $null -eq $p.CreationDate -or
        [Math]::Abs(([DateTime]$p.CreationDate).ToFileTimeUtc() - $known.BirthFileTime) -gt 20000) {
      throw 'CIM/native command-line identity mismatch'
    }
    $cmdSeen[[uint32]$p.ProcessId] = $true
    if ($p.ProcessId -eq $RootProcess) {
      if (-not $p.CommandLine -or $p.CommandLine.IndexOf($ProfileDir, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $p.CommandLine -match $rootForbidden) {
        throw 'disposable root profile or launch command not proved'
      }
    } elseif ($p.CommandLine -match $childForbidden) { throw 'unexpected policy-disabling child switch' }
  }
  $counts = @()
  $metricSeen = @{}
  foreach ($m in $measure) {
    $mId = [uint32]$m.IDProcess
    if (-not $byId.ContainsKey($mId) -or $metricSeen.ContainsKey($mId) -or
        $null -eq $m.WorkingSetPrivate -or $null -eq $m.Timestamp_PerfTime -or
        $null -eq $m.Frequency_PerfTime) { throw 'missing or ambiguous scoped WorkingSetPrivate row' }
    $metricSeen[$mId] = $true
    $p = $byId[$mId]
    $counts += @{ pid=$p.Id; ppid=$p.Parent; birth=$p.BirthFileTime.ToString();
      privateWorkingSetBytes=[uint64]$m.WorkingSetPrivate;
      providerQpc=$m.Timestamp_PerfTime.ToString(); providerFreq=$m.Frequency_PerfTime.ToString() }
  }
  return @{ id=$Id; acquisition=@{
    beforeInventoryUtcMs=$beforeInventoryAt; afterInventoryUtcMs=$afterInventoryAt;
    beforeUtcMs=$acquireBeginUtcMs; afterUtcMs=$acquireEndUtcMs;
    lowQpc=$low.ToString(); highQpc=$high.ToString(); qpcFreq=$freq.ToString()
  }; rows=@($counts) }
}

Write-Message @{ready=$true}
while ($null -ne ($line=[Console]::ReadLine())) {
  $request = ConvertFrom-Json -InputObject $line
  if ($request.op -eq 'finish') { break }
  if ($request.op -ne 'sample' -or $request.id -lt 1) { throw 'unsupported working-set sampler input' }
  try { Write-Message (Get-VerifiedSample $request.id) }
  catch { Write-Message @{id=$request.id; error=$_.Exception.Message} }
}
