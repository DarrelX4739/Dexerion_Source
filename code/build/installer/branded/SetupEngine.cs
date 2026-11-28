using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32;

internal sealed class SetupEngine
{
    private readonly Assembly assembly = typeof(SetupEngine).Assembly;
    private readonly string registryKey, executable, applicationDirectory, expectedHash, payloadHash;
    private readonly bool allowElevation, preferMachine;
    private readonly bool hasPayload;

    internal SetupEngine()
    {
        using (var reader = new StreamReader(assembly.GetManifestResourceStream("Dexerion.PayloadInfo")))
        {
            registryKey = @"Software\" + reader.ReadLine();
            executable = reader.ReadLine();
            applicationDirectory = reader.ReadLine();
            expectedHash = reader.ReadLine();
            allowElevation = reader.ReadLine() == "yes";
            preferMachine = reader.ReadLine() == "yes";
            payloadHash = reader.ReadLine();
        }
        using (var payload = assembly.GetManifestResourceStream("Dexerion.Nsis")) hasPayload = payload != null;
    }

    internal bool HasPayload { get { return hasPayload; } }

    internal bool CanInstallForAll
    {
        get { return allowElevation || IsAdministrator(); }
    }

    internal bool DefaultAllUsers
    {
        get
        {
            bool user = Installation(false) != null, machine = Installation(true) != null;
            return CanInstallForAll && ((machine && !user) || ((user == machine) && preferMachine));
        }
    }

    private static bool IsAdministrator()
    {
        using (var identity = WindowsIdentity.GetCurrent())
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid folderId,
        uint flags, IntPtr token, out IntPtr path);

    private static string UserProgramFiles()
    {
        IntPtr pointer = IntPtr.Zero;
        try
        {
            var id = new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB");
            // Unlike NSIS at install time, querying the preview must not create the directory.
            if (SHGetKnownFolderPath(id, 0x4000, IntPtr.Zero, out pointer) == 0)
                return Marshal.PtrToStringUni(pointer);
        }
        finally { if (pointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pointer); }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
    }

    internal string Installation(bool machine)
    {
        using (var hive = RegistryKey.OpenBaseKey(machine ? RegistryHive.LocalMachine : RegistryHive.CurrentUser, RegistryView.Registry64))
        using (var key = hive.OpenSubKey(registryKey))
        {
            var location = key == null ? null : key.GetValue("InstallLocation") as string;
            return String.IsNullOrWhiteSpace(location) ? null : location;
        }
    }

    internal string Destination(bool machine)
    {
        return Installation(machine) ?? Path.Combine(machine
            ? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) : UserProgramFiles(), applicationDirectory);
    }

    internal string NormalizeDestination(string text, string original)
    {
        var path = (text ?? "").Trim();
        if (path.Length < 3 || !Char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\')
            throw new ArgumentException("Enter a full local drive path, such as C:\\Apps\\Dexerion.");
        // The stock process check interpolates its directory into a single-quoted PowerShell
        // literal. Do not pass text that can break that literal, nor quotes/newlines rejected
        // by NSIS's special unquoted /D= parsing.
        if (path.IndexOfAny(new[]{ '\'', '"', '\r', '\n', '\0', '*', '?', '<', '>', '|', '/' }) >= 0
            || path.IndexOf(':', 2) >= 0)
            throw new ArgumentException("The installation folder contains unsupported characters.");
        path = Path.GetFullPath(path);
        var root = Path.GetPathRoot(path);
        foreach (string component in path.Substring(root.Length).Split('\\'))
        {
            if (component.Length == 0) continue;
            var name = component.Split('.')[0].ToUpperInvariant();
            if (component.EndsWith(".") || component.EndsWith(" ") ||
                name == "CON" || name == "PRN" || name == "AUX" || name == "NUL" ||
                (name.Length == 4 && (name.StartsWith("COM") || name.StartsWith("LPT")) && name[3] >= '1' && name[3] <= '9'))
                throw new ArgumentException("Choose a folder without reserved Windows names or trailing periods or spaces.");
        }
        var canonical = path.TrimEnd('\\');
        // Stock assisted Setup gives a custom folder its own app subdirectory. For a default
        // or registry-backed install, respect the engine's current choice without an override.
        if (!SamePath(path, original) && !String.Equals(Path.GetFileName(canonical), applicationDirectory, StringComparison.OrdinalIgnoreCase))
            canonical = Path.Combine(path, applicationDirectory);
        if (canonical.Length >= 230 || SamePath(canonical, root))
            throw new ArgumentException("Choose a shorter installation folder, not the drive root.");
        return canonical;
    }

    internal static bool SamePath(string left, string right)
    {
        if (left == null || right == null) return false;
        try
        {
            return String.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException) { return false; }
        catch (NotSupportedException) { return false; }
    }

    internal bool AppIsRunning()
    {
        var processes = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable));
        try { return processes.Length != 0; }
        finally { foreach (Process process in processes) process.Dispose(); }
    }

    internal string Install(bool machine, string path, string displayedDefault)
    {
        if (machine && !CanInstallForAll) throw new InvalidOperationException("This account cannot install for everyone.");
        if (AppIsRunning()) throw new InvalidOperationException("Close all Dexerion windows, then try again.");
        var original = Destination(machine);
        if (!SamePath(original, displayedDefault))
            throw new InvalidOperationException("The existing installation location changed. Go back and reopen Install options.");
        var args = "/S " + (machine ? "/allusers" : "/currentuser");
        if (!SamePath(path, original)) args += " /D=" + path;
        // Elevate here so there is only one install process to wait for and a declined
        // system prompt cannot be confused with an old successful installation.
        int exit = RunPayload(args, machine && !IsAdministrator(), true);
        if (exit != 0)
            throw new InvalidOperationException("The installation engine returned exit code " + exit.ToString(CultureInfo.InvariantCulture) + ".");
        string installed = Installation(machine);
        if (!SamePath(installed, path))
            throw new InvalidOperationException("Setup could not verify the installation folder.");
        string binary = Path.Combine(installed, executable);
        if (!File.Exists(binary) || !String.Equals(Hash(binary), expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Setup could not verify the new Dexerion executable.");
        return binary;
    }

    internal int Forward(string args)
    {
        return RunPayload(args, false, false);
    }

    private int RunPayload(string args, bool elevate, bool checkBrowser)
    {
        if (!hasPayload) throw new InvalidOperationException("This preview-only executable has no installation payload.");
        var scratch = Path.Combine(Path.GetTempPath(), "Dexerion-Setup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(scratch);
        var path = Path.Combine(scratch, "Dexerion-NSIS.exe");
        try
        {
            using (var source = assembly.GetManifestResourceStream("Dexerion.Nsis"))
            using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                source.CopyTo(file);
            // Verify after opening the read lock and keep it through execution. This
            // prevents the temporary payload being modified or swapped before elevation.
            using (var lockedPayload = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (!String.Equals(Hash(lockedPayload), payloadHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Setup could not verify the installation package.");
                if (checkBrowser && AppIsRunning())
                    throw new InvalidOperationException("Close all Dexerion windows, then try again.");
                var info = new ProcessStartInfo(path, args)
                {
                    UseShellExecute = elevate,
                    WorkingDirectory = checkBrowser ? scratch : Environment.CurrentDirectory
                };
                if (elevate) info.Verb = "runas";
                try
                {
                    using (Process child = Process.Start(info))
                    {
                        child.WaitForExit();
                        return child.ExitCode;
                    }
                }
                catch (Win32Exception ex)
                {
                    if (ex.NativeErrorCode == 1223)
                        throw new InvalidOperationException("Windows administrator approval was canceled. No installation started.", ex);
                    throw;
                }
            }
        }
        finally
        {
            try { File.Delete(path); Directory.Delete(scratch); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    internal static string Hash(string path)
    {
        using (var stream = File.OpenRead(path)) return Hash(stream);
    }

    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
    }
}
