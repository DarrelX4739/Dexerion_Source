param(
  [Parameter(Mandatory=$true)][string]$KnownPids
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Requires already installed PowerShell Core on Windows' }
$ids = @($KnownPids.Split(',') | ForEach-Object {
  if ($_ -cnotmatch '^[1-9][0-9]{0,9}$') { throw 'A positive exact PID is required' }
  [int]$_
})
if ($ids.Count -ne 2 -or $ids[0] -eq $ids[1]) { throw 'Exactly two distinct owned PIDs required' }

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public sealed class OwnedCpuHandle : IDisposable {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint wanted, bool inherit, int id);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryProcessCycleTime(IntPtr h, out ulong cycles);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
  static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder path, ref uint length);

  private IntPtr h;
  public int Id { get; private set; }
  public OwnedCpuHandle(int id) {
    Id=id;
    // QUERY_LIMITED_INFORMATION and SYNCHRONIZE only. No VM access.
    h=OpenProcess(0x00101000u,false,id);
    if(h==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"Open owned process");
  }
  public string Image() {
    StringBuilder b=new StringBuilder(32768);
    uint n=(uint)b.Capacity;
    if(!QueryFullProcessImageNameW(h,0,b,ref n))throw new Win32Exception(Marshal.GetLastWin32Error(),"Owned process path");
    return b.ToString();
  }
  public string[] Read() {
    if(WaitForSingleObject(h,0)!=258)throw new InvalidOperationException("Owned process exited or handle invalid");
    long started,exit,kernel,user;
    ulong cycles;
    if(!GetProcessTimes(h,out started,out exit,out kernel,out user))throw new Win32Exception(Marshal.GetLastWin32Error(),"GetProcessTimes");
    if(!QueryProcessCycleTime(h,out cycles))throw new Win32Exception(Marshal.GetLastWin32Error(),"QueryProcessCycleTime");
    return new[] { started.ToString(),kernel.ToString(),user.ToString(),cycles.ToString() };
  }
  public void Dispose() {
    if(h!=IntPtr.Zero){CloseHandle(h);h=IntPtr.Zero;}
  }
}
'@
$handles = @()
function Send([object]$value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Depth 6 -Compress))
}
try {
  foreach ($id in $ids) { $handles += [OwnedCpuHandle]::new($id) }
  $initial = @($handles | ForEach-Object {
    $v = $_.Read()
    @{ pid=$_.Id; image=$_.Image(); started=$v[0] }
  })
  Send @{ kind='ready'; frequency=([Diagnostics.Stopwatch]::Frequency).ToString(); rows=$initial }
  while ($null -ne ($command = [Console]::ReadLine())) {
    if ($command -ceq 'stop') { break }
    if ($command -cne 'sample') { throw 'Unknown meter command' }
    $start = [Diagnostics.Stopwatch]::GetTimestamp().ToString()
    $rows = @($handles | ForEach-Object {
      $v = $_.Read()
      @{ pid=$_.Id; started=$v[0]; kernel=$v[1]; user=$v[2]; cycles=$v[3] }
    })
    $end = [Diagnostics.Stopwatch]::GetTimestamp().ToString()
    Send @{ kind='sample'; start=$start; end=$end; rows=$rows }
  }
} finally {
  foreach ($h in $handles) { $h.Dispose() }
}
