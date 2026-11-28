# Branded Windows Setup

This is a separate, interactive Windows setup front end for Dexerion. It uses the
existing logo, bespoke window chrome, and custom controls for the welcome,
install choices, folder picker, progress, and completion screens. Windows still
owns system-level prompts such as administrator approval and SmartScreen.

## Build and review

From `code/build`, on x64 Windows with Node and .NET Framework 4.8:

```powershell
npm ci
npm run dist:win:branded -- --preview-only
npm run dist:win:branded
```

Each invocation prints the path and checksum for its uniquely named temporary
build output. The first is a **payload-free** walkthrough and cannot install
Dexerion. The second builds the normal NSIS installer with publishing disabled,
then embeds that exact installer in a second **Dexerion-Setup-Branded.exe**.
The stock installer remains available in that output. To walkthrough the real
branded artifact without installing, start it with `--preview`.

This does not replace `dist:win`, change any installer resources or template on
the stock route, or change release automation. Both local preview packages are
unsigned unless a separate signing process is configured for them.

## Install compatibility

The branded wizard does not implement file copies, shortcuts, associations,
upgrades, or uninstallation. Those remain in the stock NSIS payload. The
wizard passes the selected scope and an explicit path override only if needed.
For unchanged destinations the stock engine resolves its own defaults. The
wizard stops first if Dexerion is running; unlike an ordinary silent setup, it
does not intentionally ask NSIS to terminate an open browser. After NSIS
exits, the wizard verifies the registry location and the installed executable
before offering to launch it. Argument-driven invocations forward the raw
argument tail to stock NSIS, preserving the special last, unquoted `/D=`
argument used by deployment tools.

The visual preview has no install side effects. Before making the branded
artifact the default release, run the following on a disposable Windows
account or VM, not against a live Dexerion profile:

- Fresh per-user and all-users installs, including a destination with spaces,
  one canceled elevation request, and both choices of the launch checkbox.
- Reinstall or update an existing per-user install and an all-users install,
  verify profile data survives, then uninstall through Windows Settings.
- Confirm desktop and Start menu shortcut and file-association behavior is the
  same as the stock engine, and check at 100%, 125% and 150% display scaling.
