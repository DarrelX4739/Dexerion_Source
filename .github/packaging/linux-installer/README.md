# Dexerion Linux Setup

The Linux release job packages the stock Dexerion AppImage and its Linux Electron
runtime into one offline, executable graphical installer. The setup runtime only
loads the local files in this directory; the shipped browser payload retains
its existing ASAR and launcher. The install is for the current Linux account.
No administrator access or separate Electron installation is needed.

## Build, verify and preview

From the repository root on Linux, after the normal Electron Builder Linux
AppImage packaging step:

```sh
node --test .github/packaging/linux-installer/install.test.cjs
node .github/packaging/linux-installer/build.cjs \
  --runtime path/to/linux-unpacked \
  --payload path/to/Dexerion.AppImage \
  --output path/to/Dexerion-Setup-Linux-x64.run
./path/to/Dexerion-Setup-Linux-x64.run --verify
./path/to/Dexerion-Setup-Linux-x64.run --preview
xvfb-run -a ./path/to/Dexerion-Setup-Linux-x64.run --smoke-test
```

`--verify` verifies archive integrity and the embedded AppImage digest without
starting Electron. `--preview` runs the UI without installing anything.
`--smoke-test` runs a real Electron preview in a temporary home directory, checks
the logo and accent, exercises the folder chooser and install confirmation, and
verifies that the test home remains untouched. Run this on an ordinary non-root
desktop Linux account with a display session and the same desktop system libraries
and Chromium sandbox support that Electron typically requires. There is no
installer-side sandbox bypass.

Run the executable with no arguments to install. Temporary extraction requires
space for the setup runtime and bundled AppImage and a temporary directory that
allows execution. An Actions ZIP may not retain the executable mode; where
necessary, run `chmod +x Dexerion-Setup-Linux-x64.run` once after extraction.
The launcher uses the AppImage’s extract-and-run mode to avoid requiring FUSE.
Setup installs an application-menu shortcut and does not make Dexerion the default
browser or replace any existing browser profile. It will not write outside the
user’s home or overwrite an unrelated installation. The default install folder
is `~/.local/opt/Dexerion`; its setup-owned executable, PNG and marker plus
`$XDG_DATA_HOME/applications/com.dexerion.browser.desktop` (defaults to
`~/.local/share/applications`) may be removed independently of the browser profile.

## Edit the design

Linux uses `index.html`, `style.css` and `view.js`. They mirror Windows
`code/build/installer/branded/Setup.xaml` and `Setup.cs`: both display the
original artwork from `code/code/assets/logo.png`, 28 px header and 124 px
welcome marks, a 704 × 516 shell, the SC Teal (`#1F6F6B`) action, and no
decorative stripes. The Node test checks the matching brand tokens. Linux
font rasterization depends on the local desktop fonts; only current-account
installation is supported. If you change the look, update both sources and run
their previews before pinning the new installer source in Actions.
