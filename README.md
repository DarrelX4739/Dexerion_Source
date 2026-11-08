# Dexerion V1 — standalone Chromium desktop browser (Windows)

Real, functional browser built from scratch on embedded Chromium (Electron).
Owns its windows, tabs (`WebContentsView` per tab), profile, and extension
engine. No external Chrome/Edge involved.

## Run (dev)

```powershell
npm install
npm start
```

## Self-test (automated, needs a display + network)

```powershell
node scripts/smoke.js
npx electron . --no-sandbox --run-selftest
```

Covers: unpacked MV3 load, background SW, content-script injection,
`storage`, navigation, history, bookmarks, session persistence,
disable/re-enable/reload/remove.

## Package (Windows)

```powershell
npm run dist:win
```

Produces `dist\win-unpacked\Dexerion.exe` and `dist\Dexerion-Setup-1.0.0.exe`
(NSIS installer: Start Menu entry, desktop shortcut, taskbar-pinnable,
per-user install, clean uninstall). Icon + new-tab branding use the supplied
`assets/logo.png` (see `src/main/branding.js` for the reskin point).

## Profile data

`%APPDATA%\Dexerion\` — settings, bookmarks, history, downloads, tabs, focus,
closed tabs, extensions. Restored on launch.

## Modes (focus)

Open `dexerion://modes` (toolbar lock button, or the overflow menu). Create a
**mode**: a name, a site list that either **allows only** those sites or
**blocks** them, and how it runs — either a **timer** (its own on/off switch, and
optionally a duration or “until turned off”) or a **time frame** (a daily from→to
window that repeats on the weekdays you pick, or just today). There is no `.ics`
import and no default mode: nothing is enforced until you create a mode. While a
mode is on, Dexerion enforces it across all tabs and accounts and shows a branded
`dexerion://blocked` page. Everything persists in `focus.json`.

## Docs

- `ARCHITECTURE.md` — tech evaluation + module map + future-AI hook point
- `EXTENSIONS.md` — extension support, Web Store flow, honest limitations
- `TESTLOG.md` — V1 verification record

Copyright (c) 2026 sc-simpledev. All Rights Reserved.

This software and its source code are proprietary. No part of it may be copied,
modified, distributed, sublicensed or used to build other works without prior
written permission from the copyright holder.

Third-party components bundled with this software, including the Xray core, remain
under their own licences.
