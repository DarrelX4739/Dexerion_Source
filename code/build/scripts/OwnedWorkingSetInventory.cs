using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

// Diagnostic-only adapter for the current hosted Windows browser's own
// process ancestry. No memory reads, process changes or other process outputs.
public static class OwnedWorkingSetInventory
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, Id;
        public UIntPtr DefaultHeap;
        public uint ModuleId, Threads, Parent;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ImageName;
    }

    public sealed class Owned
    {
        public uint Id, Parent;
        public string ImageName;
        public long BirthFileTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint process);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(IntPtr process, out long created, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process, out uint status);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);

    public static Owned[] Read(uint rootId)
    {
        if (rootId == 0) throw new ArgumentOutOfRangeException("rootId");
        var byId = new Dictionary<uint, ProcessEntry>();
        var handle = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
        if (handle == new IntPtr(-1)) throw new Win32Exception();
        try {
            var e = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (!Process32First(handle, ref e)) throw new Win32Exception();
            do {
                if (byId.ContainsKey(e.Id)) throw new InvalidOperationException("duplicate native PID");
                byId.Add(e.Id, e);
            } while (Process32Next(handle, ref e));
            const int ErrorNoMoreFiles = 18;
            if (Marshal.GetLastWin32Error() != ErrorNoMoreFiles) throw new Win32Exception();
        } finally { CloseHandle(handle); }

        ProcessEntry root;
        if (!byId.TryGetValue(rootId, out root)) throw new InvalidOperationException("browser root missing");
        var pending = new List<ProcessEntry> { root };
        var seen = new Dictionary<uint, long>();
        var output = new List<Owned>();
        for (int i = 0; i < pending.Count; i++) {
            if (pending.Count > 100) throw new InvalidOperationException("owned tree exceeds fixture bound");
            var e = pending[i];
            if (seen.ContainsKey(e.Id)) throw new InvalidOperationException("owned process ancestry cycle");
            var process = OpenProcess(0x1000, false, e.Id); // PROCESS_QUERY_LIMITED_INFORMATION
            if (process == IntPtr.Zero) throw new Win32Exception();
            long created, unusedExit, unusedKernel, unusedUser;
            uint exitStatus;
            try {
                if (!GetProcessTimes(process, out created, out unusedExit, out unusedKernel, out unusedUser) ||
                    !GetExitCodeProcess(process, out exitStatus)) throw new Win32Exception();
            } finally { CloseHandle(process); }
            // GetProcessTimes' exit FILETIME is undefined for live processes.
            if (created <= 0 || exitStatus != 259) throw new InvalidOperationException("owned process exited or creation missing");
            if (i != 0 && (!seen.ContainsKey(e.Parent) || created < seen[e.Parent]))
                throw new InvalidOperationException("stale parent PID or unknown creation");
            seen.Add(e.Id, created);
            output.Add(new Owned { Id = e.Id, Parent = e.Parent, ImageName = e.ImageName, BirthFileTime = created });
            foreach (var p in byId.Values) if (p.Id != e.Id && p.Parent == e.Id) pending.Add(p);
        }
        return output.ToArray();
    }
}
