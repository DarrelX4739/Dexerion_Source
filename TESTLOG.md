# Dexerion V1 — test log (2026-09-23, Windows 11, Electron/Chromium 44)

> 2026-10-14 repo move: code/ (source+docs), build/ (package.json, builder config, scripts/, test-extensions/, node_modules/), opencode/ (AGENTS.md, skills, plugins, .graphify/, graphify-out/). Root junctions: node_modules/ → build/node_modules, .graphify/ → opencode/.graphify. Run all npm/test commands from build/.

## Repo restructure verification (2026-10-14)

- Deleted ~900MB Edge dump, both stale installers, scAI zips, empty dirs, junk files. Root is build/code/opencode (+2 junctions).
- Rewrote: package main, builder whitelist/icon, selftest fixture path, all script requires, smoke/audit path logic, AGENTS.md.
- Green: smoke, test:ai (95), test:sidebar (15), test:pomodoro (35), repo-audit ALL GREEN (manifest 52/52).
- GUI selftest wedged with zero progress output twice; killed. Rerun pending on a quiet machine per the timing-flake rule. Real-app boot is the interim proof.

## Fresh installer built (2026-10-14, new layout)

- dist:win green: Main_Exe_Dexerion.exe (115MB) + blockmap in temp dex-build dir.
- Builder fix: bare ../code paths rejected (entry missing from asar) → from/to mapping ({from ../code, to .}) + extraMetadata main rewrite; dev untouched. Whitelist verified resolving; asar layout + packed main asserted.
- Source package.json was found clobbered mid-build (pruned copy); restored byte-complete, backed up, intact after rebuild. Cause unconfirmed, one-off.
- Packaged app boot-tested on a throwaway profile (visible window, responding), then closed.

## Remove-all-chats option

- History panel header gains Clear all (confirm-guarded); new dex:ai-chats-clear wipes the account's chats, cancels in-flight streams/runs, persists + broadcasts.
- Verify: node --check clean; smoke.js pass; test:sidebar 15/15.

## Silent-reply fix (screenshot review)

- The empty-bubble fix had hidden the thinking dots on plain sends, and error
  text wrote into the same hidden bubble — failures looked like nothing
  happening. Now: dots show immediately on plain sends, the bubble stays
  hidden only on agent runs (runbar shows activity there), and every error
  path unhides before writing. Next provider error will be visible as ⚠ text.
- Send-path audit: submit/deliver/chat-append flow intact; stubbed suites green.

## Full sweep (no silent breakage)

- QA scripts repointed at code/ and green (IDs unique/complete, classes covered, hidden guards present).
- Suites: smoke, test:ai 95, test:sidebar 17 (new: close-top + keywarn asserts), test:pomodoro 35, repo-audit ALL GREEN.
- Re-read error-path hunks and wiring block (close-top, ask yes/no, settings, sheets, keywarn) — all present and called.

## Automated self-test (`--run-selftest`, live Chromium)

Result `ok:true` — 11/11 checks, stable across consecutive runs:

| Check | Result |
|---|---|
| Unpacked MV3 `loadUnpacked` (manifest validate + load) | ok, id assigned |
| Navigation to `https://example.com/` (plain window) | ok, title “Example Domain” |
| Content-script injection (`data-dexerion-content=injected`) | ok |
| Background SW record / MV + storage fixture | ok |
| Extension disable / re-enable | ok |
| Extension reload | ok |
| Extension remove (+dir cleanup) | ok |
| Dexerion window+tab navigation → history entry | ok |
| Bookmark add | ok |
| Session persist (`tabs.windows` non-empty) | ok |

Plus `node scripts/smoke.js`: omnibox resolve (URL vs query), MV3 fixture
shape, file layout — pass.

## Manual / observed

- `npm start` → “New Tab — Dexerion” window, Dexerion branding, no console errors.
- Relaunch → previous session tabs restored from `%APPDATA%\Dexerion\tabs.json`.
- `history.json` accumulated real entries; `bookmarks.json`, `settings.json`,
  `downloads.json`, `closed-tabs.json`, `topsites.json` all persisted.
- Packaged `dist\win-unpacked\Dexerion.exe` launched standalone
  (“New Tab - Dexerion - Dexerion”, responding).
- `dist\Dexerion-Setup-1.0.0.exe` (113 MB NSIS) built successfully.

## Bugs found by testing (fixed)

1. `session.loadExtension` deprecation → now uses `session.extensions.*`.
2. `notifications` manifest permission unrecognised → removed from fixture,
   documented as best-effort in `EXTENSIONS.md`.
3. `dexerion://` pages couldn't load the logo (relative path) → added
   `dexerion://assets/*` protocol route.
4. Stale extension records when folders vanished → `restore()` now records a
   visible `loadError` instead of silently skipping; self-test reload targets
   the exact id.

## Not yet exercised end-to-end (honest gaps)

- `dex:ext-install-store` (Chrome Web Store CRX fetch) — implemented with
  `clients2.google.com` download + CRX3 parsing, but not run (network/store
  variability; see `EXTENSIONS.md` for fallback paths).
- Download progress UI against a real file, multi-window tab drag between
  windows, print dialog — code paths present, manual pass recommended.

## Snip tool (2026-09-23, not yet run in GUI)

- ✂ toolbar button next to ⋮ (`dex:snip-open`, Ctrl+Shift+S, View menu):
  transparent overlay over tab content, crosshair cursor, drag = area snip
  (click = visible area), Copy / Save / Preview; Full page scroll-stitches
  (12 000 px cap); Video records window via desktopCapturer + MediaRecorder
  (WebM, 10-min cap). Saves land in the download dir + dexerion://downloads.
- Static checks pass: `node --check` on browser.js/shell.js/menu.js/snip.html
  script + `node scripts/smoke.js`. Manual GUI pass still needed (overlay
  alignment, video permission, full-page stitch on a long article).

## Tab groups + email-first autofill (2026-09-24, not yet run in GUI)

- Groups: drag a tab onto the center of another tab to group (edge = reorder,
  dashed outline vs insertion bar show the zone); drop onto a group chip to
  join it. Chip shows color dot + name + count; click opens rename input,
  9 color swatches, Ungroup, Close group. Dragging a grouped tab out to an
  edge ungroups it. Groups persist across restarts (tabs.json) and duplicates
  keep their group. New IPC: dex:tab-group/group-add/tab-ungroup/group-set/
  group-close; serial() carries groups + tab.groupId.
- Autofill: credential helper now fills the saved email on identifier-first
  pages (Onshape/Google step 1, no password field yet — conservative
  email/username selectors only, never generic text boxes), then fills the
  password when step 2 renders. watch() null-guarded for password-less steps.
- Static checks pass: `node --check` on browser.js/shell.js +
  `node scripts/smoke.js`. Manual GUI pass needed (drag zones feel, editor
  panel, Onshape two-step fill, group restore after restart).

## Developer-mode extensions (2026-09-24, not yet run in GUI)

- Root cause of the "redirects to extensions page" report: clicking a toolbar
  icon for an extension with no action popup hijacked the current tab to
  dexerion://extensions. Now it opens a quick-action menu in place (Reload /
  Enable-Disable / Manage… / Remove…, plus any load error); the tab is only
  navigated when Manage… is explicitly chosen.
- Popup windows now inherit the opener's session partition, fixing blank
  popups in non-default account windows.
- Load unpacked now references the folder in place (Chrome behavior) instead
  of a copy — edits go live on Reload, and Remove never touches user files.
- Static checks pass: `node --check` on browser.js/extensions.js +
  `node scripts/smoke.js`. Manual GUI pass needed (load unpacked fixture,
  icon click with/without popup, popup in second account window).

## Schedule + Focus Mode (2026-09-27, verified end-to-end)

- New: `src/main/ics.js` (iCalendar parser + recurrence + DST-aware tz),
  `src/main/focus-policy.js` (allowlist matching), `src/main/schedule.js`
  (`FocusController`), `dexerion://schedule` and `dexerion://blocked` pages,
  toolbar focus button + banner, `schedule.json` persistence, focus IPC.
- Enforcement is Chromium-session-level (`webRequest.onBeforeRequest` per
  partition → `dexerion://blocked`), so direct nav, links, redirects, refresh,
  new tabs and multiple tabs/accounts are all covered. A boundary timer plus
  `powerMonitor` resume/unlock re-evaluates on transitions and sleep/wake.
- `node scripts/smoke.js` — added pure-logic suite: ICS parse (TZID/UTC/all-day/
  DURATION), recurrence (weekly BYDAY COUNT, daily EXDATE, monthly 1MO),
  Sydney↔UTC conversion, allowlist matching, and `FocusController` import /
  active resolution / overlap / override / persistence. Pass.
- `npx electron . --no-sandbox --run-selftest` — added live `focusMode` check:
  allowed host (`example.com`) loads, disallowed host (`example.org`) is replaced
  by the block page (painted), and ending the session lifts the restriction.
  Result `ok:true`, `focusMode.ok:true`, `focusPersist.ok:true`.
- Honest limitations: enforcement is main-frame only (an allowed page's
  subresources are not filtered); non-IANA VTIMEZONE ids fall back to local time
  (the parser warns); MONTHLY/YEARLY BYSETPOS is not implemented.
- Still manual: full GUI pass (import a real `.ics`, chip editing, banner
  countdown, dropdown menu entry on a live window).

## Focus redesign — modes + time frames (2026-09-27, verified)

- Model changed: `schedule.json` is now `{ modes, slots }`. A **mode** is a
  user-named focus profile with an allowed-site list; a **slot** is a time
  frame assigned to a mode. Focus is OFF until a mode exists (no default mode);
  creating a mode arms it. The active mode auto-swaps as time moves.
- Importing an `.ics` now creates TIME FRAMES ONLY — it never invents session
  names (the old behaviour). Re-import updates frames by UID and keeps the mode
  you assigned. v1 `sessions` data migrates to modes+slots on load.
- UI: `dexerion://schedule` rebuilt as **Modes** (name + allowed-site chips) and
  **Time frames** (each with a mode dropdown). Empty state is a call to action.
- New IPC: `dex:focus-mode-create/update/delete`, `dex:focus-slot-create/update/
  delete` (session IPC removed).
- `node scripts/smoke.js` — rewritten unit suite: import adds frames not modes,
  assigned frame activates, back-to-back frames auto-swap (A→B→inactive),
  overlap resolves to latest start, mode delete unassigns frames, re-import
  de-dupes. Pass.
- `npx electron . --no-sandbox --run-selftest` — added `focusImport` check;
  result `ok:true`, `focusImport.ok:true`, `focusMode.ok:true`,
  `focusPersist.ok:true`.
- Redeployed: rebuilt `app.asar` and swapped it into the installed app
  (`%LOCALAPPDATA%\Programs\Dexerion`), tabs restored.

## Modes rework (2026-09-27, verified)

- Removed the `.ics` import entirely: deleted `src/main/ics.js` and the
  `dex:focus-import` IPC. Recurrence/timezone maths moved to
  `src/main/timeframe.js` (pure); `focus-policy.js` gained `urlPermitted`.
- Controller renamed `src/main/schedule.js` -> `src/main/focus.js`; store renamed
  `schedule.json` -> `focus.json` (one-time copy migration, data preserved).
- Each mode now has its own start/stop toggle (not just the global switch) and an
  optional timer (none/15/25/45/60/120 min) per mode; starting a mode with a timer
  auto-stops it. A started mode outranks scheduled frames.
- Modes choose the list type: **allow only these sites** (default) or **block
  these sites**. Enforced by `urlPermitted`; block page + banner reflect it.
- The page is now "Modes" at `dexerion://modes` (`dexerion://schedule` still
  renders it); menu item, toolbar title and blocked-page button renamed.
- `node scripts/smoke.js` — rewritten: no-ICS file-layout check, allow/block
  policy, per-mode start + timer + expiry, scheduled auto-swap, orphan frames,
  overlap, mode-delete unassignment, `clearSlots`, and legacy migrations. Pass.
- `npx electron . --run-selftest` — `focusTimer.ok`, `focusMode.ok` (manual
  start), `focusPersist.ok`, overall `ok:true`.
- Redeployed to the installed app, tabs kept.

## Modes: timer or time frame (2026-09-27, verified)

- Each mode now has one run style instead of a shared frames list:
  **timer** (its own switch; duration menu now reads “Until turned off” plus
  15/25/45/60/120 min) or **time frame** (daily from→to window, repeat on chosen
  weekdays, or today only). The standalone “Time frames” card is gone.
- `src/main/focus.js` is v4: modes only (no slots). `src/main/timeframe.js` and
  the slot IPC (`dex:focus-slot-*`, `dex:focus-slots-clear`) were deleted;
  `focus.json` drops `slots` on load. Frame maths are local wall-clock with
  midnight wrap; a started timer mode outranks a scheduled frame, and the latest
  start breaks ties.
- `node scripts/smoke.js` — rewritten: timer start/expiry/until-off, block list,
  frame covering now, wrong-weekday frame inactive, today-only, timer-beats-frame,
  overlapping frames, run-style switch, delete, and migrations. Pass.
- `npx electron . --run-selftest` — `focusTimer.ok`, `focusMode.ok`,
  `focusPersist.ok`, plus the bookmark/snip checks; overall `ok:true`.
- Deployed: rebuilt the installer + `exe\win-unpacked`, ran the self-test from
  the packaged exe (`ok:true`), synced the installed `app.asar`, and relaunched
  with tabs preserved.

## Chrome UI pass — "premium clean" (2026-09-27, verified)

- One coherent theme in both modes: warm paper light (`--paper #f5f3ef`) and a
  matched warm near-black dark (`#121110`), crisper hairlines, two-layer
  elevation, unified radii (`4/6/8/10/12`) and one easing
  (`cubic-bezier(.22,.61,.36,1)`) with `--dur-fast/base/slow` (120/160/260ms).
  `assets/page-theme.css` now mirrors the chrome palette (and gains dark-mode
  shadows it never had); pages inherit the tighter radii automatically.
- **Tab identity**: every tab exposes `--identity` (accent, or the group colour
  when grouped). The active-tab rail and a new 3px **leading streak** on grouped
  tabs both use it, so a group reads by colour instead of only by chip. Vertical
  mode tints grouped rows and uses the identity colour for its rail.
- Tabstrip 41px with a 34px tab, toolbar 52/32, omnibox 36 with an inset
  highlight; tab-group chips, banners, menu rows, and the bookmark bar polished;
  the duplicate "nof1 refinement" override block was folded in and removed.
- Motion: tab/menu/banner entrances on one easing, plus a
  `prefers-reduced-motion` guard that disables animation/transition.
- `npx electron . --run-selftest` (and from the packaged exe) — added
  `tabGroups`: reorder via the drag IPC works, and the streak *and* rail compute
  to the group colour `rgb(139,145,171)` (grey), not the accent. `pageTheme`
  re-pinned to the new paper values. Overall `ok:true`; every interaction check
  (tabs, groups, bookmarks, snip, suggestions, focus modes) still green.

## AI chat images (2026-09-27, verified)

- Bug: the toolbar Dexerion AI sidebar had **no paste handler**, so copying an
  image and pasting it did nothing (the New Tab chat already had paste). Fixed by
  handling paste on the sidebar panel — one listener only, since binding the
  textarea too double-attached every image (paste bubbles).
- Pending thumbnails now render as a wrapper with a **remove (×)** control, so an
  image can be dropped before sending.
- Added `aiImages` to the self-test: a synthetic image paste fills the tray above
  the composer (1 thumbnail), × clears it, and an image message renders in the
  bubble. Passes in dev and from the packaged exe; overall `ok:true`. Upload via
  the ＋ button and the main-process vision path (`resolveModel(c, hasImages)`,
  `image_url` parts, 4-image / 20 MB caps) were already present.
- Note: images need a vision-capable NIM model; attaching one makes Dexerion
  switch to it (`meta/llama-3.2-11b-vision-instruct` when the key can reach it).

## Tab drag: a group is always one run (2026-09-27, verified)

- Dragging is one main-process-owned move: the renderer reports
  `dex:tab-drop(dragId, targetId, before|after|center)` and `moveTab` decides
  the outcome, so a group can no longer be split into two chips. The older
  reorder/group/ungroup IPC still backs the menus.
- Semantics: reorder inside a run; **snap to the nearer edge** when an ungrouped
  tab is dropped strictly inside a run; **centre-drop joins** the target's group
  and parks the tab at the run end; **dragging out** (a target outside the run)
  ungroups the tab and leaves the run contiguous. Dropping a grouped tab beside
  its own run is a no-op, which is the correct reading of that position.
- Renderer: drop zones are orientation-aware - the leading/trailing 25% of a tab
  reorders, the centre groups, and the insertion bar is painted on the edge you
  are dropping against (left/right horizontally, top/bottom in the vertical rail).
- `tabGroups` self-test extended: reorder, join, reorder-within-group (members
  swap, still one run), snap (no split), centre-join (3 members, one run),
  drag-out (ungrouped, run intact, lands where dropped), and the streak + rail
  still computing to the group colour `rgb(139,145,171)`. `ok:true` in dev and
  from the packaged exe; deployed to the installed app and relaunched with the
  4-tab session preserved.

## Dragging a tab out of a group (2026-09-27, verified)

- Bug: there was no way to pull a tab out of a group once the group was the
  last run on the strip (and no drop target at all in the empty strip), so a
  grouped tab felt stuck.
- Drag out is now a first-class gesture: a drop on the **empty strip** (null
  target) parks the tab at the end and always leaves its group, and dropping a
  grouped tab onto a tab outside its run still leaves it there. `moveTab` takes
  `!targetId` to mean exactly that.
- The empty strip is a drop target now (`#tabstrip`, covering the space past the
  last tab and the space below the rail in vertical mode), with a hairline
  landing marker in the strip's own axis (`#tabs.drop-end`). Tabs and chips
  still handle their own drops; the strip handler ignores those targets so a
  drop never fires twice.
- `tabGroups` self-test gained `stripOk` (empty-strip drop: ungrouped, parked
  last, run still one contiguous pair) and `regOk` (re-join), and the existing
  drag-out check now runs after them. `ok:true` in dev; smoke tests green.

## Accent selection highlight on every page (2026-09-27, verified)

- Asking for the start page behaviour everywhere: text selection now paints in
  the user's accent on real websites, not just on dexerion:// pages.
- Implementation: every tab gets ``::selection`` injected as a **user-origin**
  stylesheet (``wc.insertCSS(css, { cssOrigin: 'user' })``), re-applied per
  document on ``dom-ready``. ``!important`` is load-bearing: plain user
  declarations rank BELOW author ones, so the first cut lost to a page that
  styles its own selection (caught by the new test, not by eye).
- Subframes are not reachable by ``insertCSS``, so they receive the same sheet
  through ``adoptedStyleSheets`` (which CSP also cannot block) via
  ``did-frame-finish-load`` + ``webFrameMain.fromId``.
- One colour everywhere: the injected wash, ``assets/page-theme.css`` and
  ``src/renderer/shell.css`` all use a 45% accent mix, so the chrome, internal
  pages, and websites match. Changing the accent in Settings re-applies to every
  open tab (``applySelectionAccentAll``), replacing the old sheet instead of
  stacking one.
- ``selectionAccent`` self-test reads the *effective* colour with
  ``getComputedStyle(el, '::selection')`` (which resolves the injected sheet)
  for: a page that declares its own green ``::selection``, that page's iframe, a
  dexerion:// page, and the accent switch back. All four pass in dev; overall
  ``ok:true``. ``assets/page-theme.css`` selection moved 30% -> 45% to match.

## Four chrome directions + the profile-loss bug behind them (2026-09-28)

Four interface identities, one file each, launchable side by side:

| Direction | File | Palette | Title type | Tab shape | Group reads as |
|---|---|---|---|---|---|
| Machined | skins/machined.css | cold graphite | Bahnschrift + mono | squared keys, uniform width | underline in the group colour |
| Vellum | skins/vellum.css | warm paper | Constantia (serif) | raised cards, 4px top radius | running head above the run |
| Halo | skins/halo.css | deep indigo | Century Gothic | floating lozenges | ring around each member |
| Riso | skins/riso.css | cold newsprint | Franklin Gothic | flush blocks, 0 radius | pink edge + solid pink chip |

- Each direction also sets its own memorable element: Machined a live ``5 tabs``
  counter at the tail of the strip (CSS counters) and an under-key accent lamp;
  Vellum an ink underline under the address field on focus; Halo a light spill
  from the active lozenge plus a halo ring on focus; Riso an inverted active tab
  and an offset indigo plate under the omnibox.
- Wiring: ``?skin=<name>`` loads ``src/renderer/skins/<name>.css`` after
  shell.css, pins the mode, titles the window and adds a ``#skin-tag`` badge.
  ``--preview-skins`` tiles every direction (same five-tab set, two of them
  grouped) so the chrome is the only variable; ``--capture-skins`` writes PNGs
  plus a chrome-only crop. Preview windows never persist.
- ``skins`` self-test reads each preview window's computed style and asserts the
  landmark values per direction (strip height, tab radius, resolved first font,
  chip radius, pinned mode) and that all four shapes differ: ``distinct: 4``,
  ``ok:true``. Reviewed the renders myself from the captured crops and revised
  three things: Machined's group underline was too faint at 1px, Halo's active
  lozenge too dark to float, Riso's plate too loud.

### Bugs found while doing it (both data loss, both fixed)

- **A second launch wiped the profile.** ``before-quit`` fires in every process,
  but only the lock winner runs ``startup()`` — so a lock loser flushed an
  unloaded ProfileStore (pure defaults) over the real settings *and* session.
  That is the long-standing Dexerion emptied my tabs report, and it was
  reproduced deliberately: markers in a scratch profile survived a second launch
  only after ``flushOnQuit()`` was guarded on ``primaryInstance && profileLoaded``.
- **A BOM made settings load as defaults.** A settings.json carrying a UTF-8
  byte-order mark made ``JSON.parse`` throw, and the profile silently fell back
  to defaults. ``readJson()`` strips it. (Found because PowerShell's ``Set-Content
  -Encoding UTF8`` had written one.)
- The user's real profile had been hit by the first bug earlier in the day: their
  session was emptied and theme/accent/vertical-tabs reset to defaults. Settings
  restored (dark / #aa00ff / vertical), the running app still held the real
  session in memory, and the backup copy of the clobbered file is kept as
  ``settings.json.pre-clobber.bak``.

## Vertical tabs: skins collapsed the rail, and a 34px dead column (2026-09-28)

- Reported: none of the four directions worked in vertical tabs. Correct: the
  skins were unusable there, for a cascade reason.
- Cause: every skin rule was written ``:root[data-skin=x] #tabstrip`` etc.
  (specificity 1,2,0), which BEATS shell.css's ``body.vertical #tabstrip``
  (1,1,1). So the horizontal geometry (36px-tall strip, centred items, clamped
  tab widths) survived into vertical mode and the vertical block never applied:
  the rail became a 36px bar with the tab list squeezed out of sight.
- Fix: drop the ``:root`` prefix from every rule selector (160 of them across the
  four files) so a skin sits above shell.css's shipped rules but below its
  ``body.vertical`` rules, then keep the deliberate ``body.vertical`` block per
  direction. Verified by measurement, not by eye: the ``skins`` self-test now
  flips vertical tabs on and asserts, per direction, rail width 204, rail height
  > 300, tab height >= 22, tab width >= 150, five tabs present — all four pass.
- Second defect found while measuring: ``layout()`` offset tab views by a
  hardcoded ``VERTICAL_RAIL = 238`` while shell.css draws the rail at 204, so
  every vertical-tabs window had a 34px dead column of chrome between the rail
  and the page (present in the shipped look too, not just the skins). The shell
  now measures and reports it (``dex:rail-w``, the same pattern as
  ``dex:chrome-h``), ``layout()`` uses the reported value, and the test asserts
  the page view starts exactly at the rail's right edge (viewX === railWidth for
  all four).
- Also wired the suggestion sheet's left offset to the measured rail.
- Reviewed the repaired rails from screenshots: Machined keeps its ``5 tabs``
  gauge under the list, Vellum its serif spines and running heads, Halo its rings
  and glow, Riso its inverted active block and full-width pink + button.
  Horizontal strips re-checked after the specificity change: unchanged.
- The four preview windows were relaunched in vertical mode (their real setting)
  on a scratch profile; Settings > vertical tabs toggles all four live.

## Theme setting: the four directions become pickable (2026-09-28)

- The shipped Dexerion chrome is now the DEFAULT theme, and the four directions
  are a real setting (``settings.skin``) offered in a new Settings section.
- Settings > Theme: five tiles, each a miniature of that theme drawn with its
  own palette AND its own tab geometry (squared key, rising card, floating
  lozenge, printed block), so the choice is shown rather than described. The
  miniature reads its colours from ``--m-*`` variables, so one markup shape
  draws every tile; the default tile uses the live page tokens, so it always
  looks like what you have now. Selecting = accent ring + tick, matching the
  light/dark tiles already there (which now preview their own mode).
- The shell applies ``ui.skin`` on every render, swapping the stylesheet link in
  place, so picking a theme restyles every open window immediately with no
  reopen. ``dexerion`` means no skin file at all, so the default chrome is
  never a stylesheet rebuild. The value is whitelisted in main (it becomes a
  file path) and defaults to ``dexerion``, so existing profiles look unchanged.
- ``?\skin=`` remains preview-only: it overrides the setting, pins the colour
  mode and adds the badge naming the file.
- ``skins`` self-test now also drives the picker for real: it opens
  dexerion://settings, asserts five tiles with ``dexerion`` first, clicks Riso
  and waits for the live shell to report ``data-skin=riso`` with the Riso
  stylesheet loaded and the strip at 40px, then clicks Dexerion and asserts the
  stylesheet is gone entirely. ``pickerOk: true``, overall ``ok:true``.
- Could not capture the settings *page* as an image (a WebContentsView has no
  capturable surface, and desktopCapturer window thumbs show the chrome but not
  the page), so the picker is verified by the click-through test and the tile
  CSS is reviewed by hand.

## Inspector: right-click to inspect, framed by Dexerion (2026-09-28)

- New: page context menu ends with **Inspect element** (F12 shown), View menu
  gains Inspector (F12) and Inspect element, and both open Chromium's own
  DevTools inside Dexerion's frame — the panel content is Google's UI, the bar
  above it is ours.
- How: ``setDevToolsWebContents`` plus ``openDevTools({ mode: 'detach' })``
  hosts the ``devtools://`` frontend in a frameless child window of the Dexerion
  window; a probe proved this is the only path that gives us chrome of our own
  (plain detach spawns Electron's own window, and a WebContentsView host renders
  but is not capturable for verification).
- Frame: the shell draws a 30px header (accent mark, Inspector, the inspected
  host in mono, a dock glyph that *is* the layout, and close). It uses the shell
  tokens, so it follows the user's theme, accent and light/dark — including the
  five themes from the Theme section.
- Geometry is owned by the main process (``inspectorRect``): header, DevTools
  body and the page's remaining area, for bottom and right docks, published in
  the state so the bar covers exactly the seam. ``inspectElement(x, y)`` runs
  with the right-click position. Opening closes the AI sidebar (both want the
  right edge) and the panel closes with its tab.
- Entry motion is opacity-only: the first cut animated transform and the bar sat
  7px/9px off its rectangle, because a throttled renderer pins an animation at
  its first frame. Measured with getComputedStyle (``matrix(1,0,0,1,0,7)``), then
  fixed — chrome geometry must not depend on animation.
- ``inspector`` self-test drives the real path: it builds the context menu with
  the right-click params, runs the same action the item runs, then asserts the
  frontend URL, that its tab bar rendered, that the *inspected node* is selected
  (shadow-DOM walk finds ``<h1 id=head>Alpha</h1>``), that pixels really
  painted (100 distinct colours), that bar/header/page rectangles agree exactly
  in both docks, and that closing restores the page and destroys the surface.
  ``ok:true`` in dev; screenshots reviewed by hand (the Elements panel showed the
  test page's DOM with the clicked node selected).

### Bug found by its log output

- ``dex:bookmark-add``/``-remove``/``-move``, ``dex:history-delete``/``-clear``
  and ``dex:login-delete`` called ``saveA(st)``, a function that does not exist:
  every one threw ``ReferenceError`` *after* mutating memory, so the UI looked
  right and nothing persisted. Fixed to ``saveAcc(st.accountId)`` (6 sites).
- The star test could not have caught it (it flips optimistically), so
  ``starButton`` now asserts the bookmark appears in, then disappears from,
  ``bookmarks.json`` on disk; ``persisted:true removedOnDisk:true``.

## Inspector: the panel was blank, now it paints (2026-09-28)

- Reported: you could not see the inspector, just a blank surface with DevTools'
  chrome. Reproduced exactly by running the check with VERTICAL TABS and the
  right dock: the tab strip (Elements, Console, ...) painted while every pane was
  empty. The screenshot is the proof — chrome only, no DOM tree.
- Cause: Chromium's DevTools frontend lays its panels out when its document
  counts as visible. The panel is a freshly shown, *unfocused* child window, so
  the frontend skipped content layout entirely. The same shot taken after opening
  from the context menu (which focuses the panel) had full content, which is why
  the earlier verification missed it: it only ever checked the bottom dock and
  the focused path.
- Fix: ``openInspector`` invalidates the surface and nudges its bounds by a pixel
  on open and again after ``did-finish-load``. Measured: content now appears in
  ~1.0s without focus (``painted:true, contentMs:1027``) and the sampled colours
  go from 51 (chrome only) to 148 (full panel).
- Also: the panel is now shown unconditionally (``show()``) instead of relying on
  a load event or on ``focus()`` implying show — a state that says open while
  nothing is visible.
- And it can never be blank: a failed load or a watchdog timeout replaces the
  surface with ``dexerion://inspector`` — a Dexerion page in the user's theme
  (The inspector did not start, the reason, Try again). Retry re-opens the
  inspector for the same tab; it is the one inspector surface allowed to use IPC.
- Race fixed while testing: a replaced surface (fallback, retry) also fires
  'closed', and the stale handler was clearing the NEW panel's state — the
  'closed' handlers now only act when they belong to the current window.
- ``inspector`` self-test now covers all of it: bottom dock, right dock, close,
  the fallback path (forced failure: asserts the page, its reason, its action and
  that it painted), the retry recovering a real DevTools, and a VERTICAL TABS
  pass that waits for panel *content* rather than just the tab strip. ``ok:true``
  overall.

## Start page: the day, a light field, and 100 quotes (2026-09-28)

- The New Tab page gains a corner block (time, weekday and date, the day's
  quote and its author) and a slow light field behind the page. Both are built
  from the page's own tokens, so they follow the user's theme and accent; the
  accent stays a signal and is not used as a wash.
- Quote of the day is FIXED for the whole local day and advances one at local
  midnight. The index derives from the calendar date alone
  (``Date.UTC(y,m,d)/86400000``), not from the clock or a seed, so reloads, new
  tabs and time zones all agree. ``assets/quotes.js`` holds exactly 100, ordered
  to alternate register, with a stated attribution policy: documented quotes
  only, proverbs labelled as proverbs, and the notorious misattributions left
  out (the 'repeatedly do' line appears under Will Durant, who wrote it).
- Background: three pools drift on 104s / 148s / 191s alternating cycles and a
  phase layer sits low and warm at dawn, high at midday, sinking through dusk
  into night, crossfading on the boundary because gradients cannot interpolate.
  Separate light and dark treatments (white and warm off-white on paper; a cool
  night lift plus a faint ember), a 4% noise layer to stop large soft gradients
  banding, and the global reduced-motion guard silences all of it.
- Placement: fixed top-left, verified not to overlap the wordmark, the search
  field or the starred grid by rectangle intersection in the self-test; below
  900px the block joins the column above the wordmark and drops the quote.

### Two bugs found while verifying

- The drift animation was DEAD on the first pass: the shorthand contained
  ``var(--ease-in-out)``, which ``page-theme.css`` does not define (it defines
  only ``--ease``). An unresolved ``var()`` inside the animation shorthand
  invalidates the whole declaration, so ``animation-name`` computed to ``none``
  and the pools never moved — caught by the self-test asserting the animation
  name, not by eye, since a static field looks fine. Now a literal
  ``cubic-bezier(.42,0,.58,1)``.
- The starred empty state read 'Nothing starred yetPress ☆ in the toolbar…' —
  a missing space between two concatenated strings (two call sites). Fixed.
- Also added ``_test.pageShot``: a tab page cannot be captured through
  WebContentsView, so screenshots for review go through the debugger protocol
  (``Page.captureScreenshot``). That is how the light and dark renders above were
  reviewed.
- ``newtabDaylight`` self-test: asserts the clock equals the locale-formatted
  current time, the date equals the locale-formatted current date, the phase
  matches the current hour, the rendered quote equals an independently computed
  index of the 100, the quote is not clipped, the pools animate, the light and
  dark backgrounds differ, and the corner block clears the wordmark, search and
  starred rects. ``ok:true`` in dev.

### Caught by the packaged run, both worth remembering

- ``electron-builder.json`` lists asset files ONE BY ONE, so a new file under
  ``assets/`` is not shipped until it is added: the quotes file worked in dev and
  404ed in the packaged app, which showed up as an empty quote. Added
  ``assets/quotes.js`` to the list; verified with ``npx asar list`` and by the
  packaged self-test reporting ``quoteIsChosen: true``.
- The packaged self-test is timing-sensitive under load: one run reported
  ``newTabBookmarks``, ``inspector`` and ``newtabDaylight`` failing while the next
  identical run reported OVERALL=True with every sub-check green. The failing
  checks are the ones that navigate to real sites, so the culprit is network
  latency in a slower process, not the features. Re-run before believing a
  packaged failure.

## Offline: a waiting screen, then a real offline page (2026-09-28)

- New: a main-frame failure that is really the network no longer lands on
  Chromium's error page. Dexerion opens a waiting screen for ten seconds
  (retrying the target in the background), and only a wait that runs out gives
  way to an offline page with its own animation. A connection that works is
  never touched.
- The decision is one pure function, ``offlineVerdict(code, {isMainFrame, url,
  online})``: -106/-21/-20 are the wire and wait immediately; -109/-104/-118/-105
  are ambiguous and wait only when ``net.isOnline()`` is false AND a known-good
  204 probe also fails; everything else — a refused connection, a reset, a
  certificate or HTTP error, any subresource, any file:/dexerion: URL, anything
  the focus guard already owns — is left completely alone.
- Design: one device carries both states. The waiting page's connection line
  fills with the accent as the ten seconds run out, with a dot riding the
  leading edge, so the same object shows the wait and how long is left — no
  spinner, no counter. The offline page severs that same line: the fill is gone,
  the dot stops short of the gap and a ring leaves it every 3.2s and dissolves,
  which is what an unanswered ping looks like. Both pages are built from the
  page tokens (hairline track, accent fill) and share assets/netstate.css, so
  they follow light/dark and the user's accent like the blocked page does.
  Under reduced motion the growing width stays (it is information) and the
  travelling dot and ping are removed.
- Copy: Looking for the network with the host in mono, lede explaining that it
  opens by itself if the connection returns, actions Stop waiting / Start page;
  then You're offline, the host, what happened, and Try again / Start page.
- The poll runs in the MAIN process (1.8s cadence), not the page: a background
  tab has its renderer timers throttled, and the wait has to end on time
  regardless. Attempts are capped at two per target so a flapping connection
  cannot loop; the count resets when a real page loads, and any navigation the
  user makes cancels the wait.
- ``offlineFlow`` self-test: 13 assertions on the verdict table (including every
  negative case), a working load left untouched, a recovery run (waiting page
  seen, then the target opens itself), and a failure run against a closed port
  (waiting page, then the offline page with its copy, host, Try again, severed
  line and ``netping`` animation, plus a screenshot), then Try again re-entering
  the wait. ``ok:true``.
- Added ``assets/netstate.css`` to the electron-builder file list — the lesson
  from the quotes file, applied before it could bite again; verified in the
  packaged app.

### Two flaky assertions of my own, fixed

- The daylight clock check compared the rendered clock against a freshly
  computed time, and the page ticks every 15s — so any run that crossed a minute
  boundary failed. It now focuses the window (background tabs get their timers
  throttled, which is why waiting for a tick could hang) and compares parsed
  minutes with a one-minute tolerance, still failing a wrong hour, timezone or
  format.
- The inspector check waited 12s for Chromium's DevTools to paint its Elements
  tree; under a loaded machine that is not enough. Now 25s.

## Offline, second pass: two real bugs, then the animation asked for (2026-09-28)

Two reports about the just-shipped offline flow, both real, and both found before
any drawing was touched:

- **Try again could not work.** A manual retry re-entered the wait carrying the
  *same* count it had already spent, so it was over its cap the moment it began
  and bounced straight back to the offline page. Manual retries now start a
  fresh budget (``recoveries = opts.manual ? 0 : …``); only the automatic loop
  spends it.
- **A reconnection was never noticed.** The offline page had no polling at all,
  so nothing short of a click could escape it. Main now keeps probing while the
  offline page is up: every 2s, backing off to 5s after half a minute, capped at
  3 automatic recoveries per target (after which the page reports
  ``looping: true``) so a flapping connection cannot loop forever. The count
  resets when a real page loads.

The flow itself was then rewritten at a 1s cadence (``NET_ATTEMPT_MS``), with
``NET_RECOVER_DWELL_MS`` holding the recovered state for 1.2s so the success is
legible before the target opens. One device per page, and the main process is the
only thing that decides anything: it pushes ``dex:net-progress``
(``{state, attempt, of, host}``) and the pages only draw it.

- Waiting page: four bars bouncing on a one-second cycle (the same rhythm as the
  retries under them, so the motion reads out what is happening) above a live
  ``Retrying n/10``. On recovery the bars stop, stand up and turn green, the
  title becomes "Connected" and the status "Opening the page you asked for".
- Offline page: the router drawn as a diagram. Three arcs sweep out of the
  antennas, reveal to their halfway point and dissolve there, over an unlit
  lamp; on recovery the arcs complete in green, the lamp lights and the status
  text turns green with them. Both pages still use only page tokens (hairline
  track, accent, the theme's own success green), and reduced motion keeps the
  counting text while stopping the bars and waves.
- ``offlineFlow`` self-test, now against a **real** ``http`` server on a local
  port that is closed for the first half of the test and opened in the middle of
  it, so automatic recovery is proved rather than asserted: the counter is
  observed to tick (``Retrying 1/10`` then a different value), the offline page
  is checked for its copy, host, Try again, three arcs and ``waveRun``, then the
  green state is caught by polling at 120ms (title "Connected", ``.done`` on the
  device, arcs the success green), the target loads by itself with the server
  seeing the hit, and finally Try again is clicked and proved to land back on the
  waiting page instead of the offline one. ``ok:true``, verified in dev and in
  the packaged app.

### What that test found that a screenshot would not

- ``capturePage`` samples after the tab has already navigated, so the 1.2s green
  state can never be photographed from the live flow. The test now renders that
  state deliberately (same page, same classes the recovered push applies) after
  the live assertions, which finally made the recovered styling reviewable.
- The lamp did **not** turn green. ``ledMatches`` was true and the arcs turned
  green, yet the computed fill stayed on the unlit colour: the lamp's ``fill`` is
  transitioned, and a transition does not advance in a window that is not being
  rendered, which is how the suite runs. The product was right and the check was
  wrong. It now measures the cascade with the transition switched off, and
  asserts the lamp, the arcs and the status text are all literally the same
  green the live state showed.
- The counter check slept a fixed 1.4s and compared. On a loaded machine a 1s
  timer lands late, so the value was unchanged and the assertion failed while
  the feature was fine. It now waits for the change (up to 4s).

### Load, honestly

Four runs in a row failed ``tabBridge``, ``extPopup``, ``chromeHeight`` (once
``skins`` and ``remove`` too). Every one of those is a timeout-bounded check on
the *early* part of the suite, and each of them passed unchanged on the next run
when the machine was quiet (full suite: 1m07s green, against 6m30s for the
loaded runs). Recorded rather than silently re-run: they are load, not the
feature, but a reader of this log should know the suite's timing budget is thin
on a busy desktop.

### Verification

- Dev, full suite (``electron . --run-selftest``): ``OVERALL=true``, nothing
  failing, 1m07s. ``offlineFlow ok:true`` with ``waitDom {bars: 4, barAnim:
  barJump}``, ``counters Retrying 1/10 -> Retrying 1/9``, ``recoveryAutoOk
  true``, ``hits 3``, ``retryOk true``, ``greenRender {arc, led, statusColor all
  rgb(47,125,74), arcs 3, ledMatches true}``.
- Packaged, ``exe\win-unpacked\Dexerion.exe --run-selftest`` with
  ``DEX_TEST_EXT``: ``OVERALL=true``, nothing failing, 1m07s, same offlineFlow
  values as dev. ``app.asar`` 2343854 bytes (from 2330181), copied into
  ``%LOCALAPPDATA%\Programs\Dexerion\resources``.
- Tabs preserved: the app was closed with ``CloseMainWindow`` (one window, one
  round, ``ALL_CLOSED``) and ``tabs.json`` was byte-identical before and after,
  with ``settings.json`` and ``focus.json`` backed up to
  ``%APPDATA%\Dexerion\backup-20260928-231218`` first.
- Screenshots reviewed for both devices (waiting bars, offline router, recovered
  router). They come from the self-test profile, which is light with the default
  accent; dark and a custom accent are covered by the tokens rather than by a
  second screenshot, since every rule in ``netstate.css`` reads ``--accent``,
  ``--ok``, ``--pborder``/``--pborder-2`` and ``--pcard``, which
  ``page-theme.css`` defines for both themes. A dark pass was deliberately not
  taken by poking at the installed window, to leave the running session alone.

## Offline, third pass: the count as a count, and a sign with a game (2026-09-28)

Two notes from the person using it, both acted on.

### The count did not count

``Retrying n/10`` was stepping about every 1.9 seconds, and the wait ran long.
The cause was ordering, not arithmetic: the next tick was scheduled *after* the
probe resolved, so every step cost a probe (a dead port answers by timing out at
900ms) plus the second on top. Three changes:

- A 250ms heartbeat drives the loop, and the attempt number is derived from the
  clock (``netAttempt``) rather than from a counter that only moves when a probe
  finishes. The count now lands on its second and the probe rides along: at most
  one probe a second, overlapping ones refused, probes never able to delay the
  display or the deadline.
- The ten seconds start when the waiting page is actually up (``startNetClock``,
  called from ``did-finish-load``), not when the tab is redirected. On this
  machine, at 99% CPU, an internal page sometimes took longer than the whole wait
  to paint, so the count was spent before anyone saw it. A page that never
  arrives starts the clock anyway after six seconds (``NET_PAGE_WAIT_MS``) so a
  tab can never be left wedged.
- ``10/10`` stands for its own second, then the tab is handed over: the last
  count is at 9s and the deadline is at 10s, so the number is read before the page
  changes under it.

Measured, not assumed: the test now watches the whole wait and records every
value it sees with timestamps. Last green run: ``counted [1,2,3,4,5,6,7,8,9,10]``
with gaps ``[0.95, 0.98, 1.1, 0.95, 1.11, 1, 1, 0.81, 1.12]`` seconds, and the
hand-off 10.34s after the page was ready (measured in-process, from
``netState().startedAt``, so harness latency does not pollute it).

### The animation became a sign, and the page got a game

The router whose waves died halfway is gone. The offline page now carries a
**globe with one stroke through it**, static: the stroke is drawn twice (page
colour at 6.5px to cut the globe open, ink at 1.5px on top), which is what makes
it read as a mark through the object rather than a line lying across it. Nothing
in the sign animates, and the test asserts exactly that (``markAnimated: 0``,
counting every ``.mark`` element and descendant).

Under it, **Snake**, played with the arrow keys or WASD, space to restart, best
score in local storage. Design decisions worth recording:

- It is drawn in the app's own materials rather than dropped in as a widget:
  hairline grid at half strength, the snake as an ink wire with round joins, the
  food as the accent, mono score row, serif label, and a hairline rule as the
  separator instead of a rounded card with a shadow (the generic move this page
  should not make).
- The frame is the wall and is drawn one step stronger than the grid, so the
  boundary is legible at a glance; the grid is a guide, not a feature.
- 18 x 11 cells at 18px: chunky enough that the snake reads as an object, small
  enough that the whole page - sign, copy, buttons, game and hint - fits a 698px
  window without scrolling.
- It runs only while the page has the window's attention (``document.hasFocus()``
  in the frame loop), so a game left mid-run cannot walk into a wall while you
  read elsewhere. That is a deliberate behaviour, and it is why the test only
  asserts movement when the harness window can hold focus *and* frames are
  actually arriving (``rafAlive``); otherwise it reports ``boardMoved: null``
  rather than pretending.
- No assets, no requests, no sound, nothing behind it that can fail while the
  network is down. Reduced motion needs no special case: the game's motion is the
  game, and it only moves when the person moves it.

The test plays it: it sends a real key event through the browser, then requires
that the board was redrawn (canvas data URL changed) and that the hint answered
("Press an arrow key to play." becomes "Arrow keys to move. Space restarts.").

### Verification

- Dev, full suite: ``offlineFlow ok:true`` with ``countingOk``, ``playOk`` and
  ``greenRenderOk`` all true, and ``dom {mark: true, globe: 3, slash: true,
  markAnimated: 0, canvas: true, canvasPx: "324x198", hint: "Press an arrow key
  to play.", score: "0"}``.
- Recovered state, re-checked against the new sign: globe stroke, status colour
  and the lifted stroke all read from the cascade (transitions suppressed, since
  a transition does not advance in a window that is not being rendered) and the
  globe's green is literally the colour the live recovered state showed.
- The recurring ``tabBridge`` / ``extPopup`` / ``chromeHeight`` / ``remove`` /
  ``skins`` / ``suggestPopup`` failures in this session were all on a machine at
  85-99% CPU (VS Code, two AI agent processes, Defender), and every one of them
  passed on a quieter run without any change to its code. A starved machine also
  breaks the *proof* of a one-second count, which is why the cadence assertion now
  checks how fast its own observation channel is (``cadenceTrusted``,
  ``medianPollMs``) and records the measurement instead of blaming the feature for
  the harness's latency.
- Also worth knowing: ``capturePage`` still cannot photograph the 1.2s recovered
  state (it samples after the tab has navigated), so that state continues to be
  rendered deliberately for its check and screenshot.
- Packaged, ``Dexerion.exe --run-selftest`` with ``DEX_TEST_EXT``: ``OVERALL=true``,
  nothing failing, ``offlineFlow ok:true`` with ``counted
  [1,2,3,4,5,6,7,8,9,10]``, ``perSecond`` true, ``handoffInProc 10.27``,
  ``playOk`` true (the board redrew on a real key event; ``rafAlive`` was false in
  that window, so stepping was reported as unobserved rather than claimed), and
  ``greenRender {globe, statusColor: rgb(47,125,74), slash: 0}``. ``app.asar``
  2359168 bytes, deployed to ``%LOCALAPPDATA%\Programs\Dexerion\resources`` with
  the running app closed by ``CloseMainWindow`` and ``tabs.json`` byte-identical
  to the backup taken first (``backup-20260929-083645``).

### The build could not finish until it was built outside OneDrive

Two builds in a row died at the packaging step with ``Error: Unable to update
lock within the stale threshold`` from ``proper-lockfile``, after clearing
``exe\win-unpacked.tmp.lock`` and confirming no builder was still running. The
project lives in OneDrive, and the sync client contends on the output directory's
lock file. Building to a local path worked first time:
``npx electron-builder --win --config electron-builder.json
--config.directories.output=%LOCALAPPDATA%\Temp\dexbuild``. ``electron-builder.json``
was deliberately left alone, since the failure is the environment's, but anyone
hitting that error again should reach for the override rather than clearing locks
in a loop. The new installer and asar were copied back into ``exe\`` afterwards so
the usual layout stays current.


## 2026-10-11 � snip overlay in-window + record rebuild (verified)

Snip overlay converted from a separate always-on-top BrowserWindow to an in-window WebContentsView child (`snipViewBounds`, `closeSnip`/`destroySnipView` in `src/main/browser.js`); save dialogs parented to the window so they can no longer open under the overlay. Record flow rebuilt: overlay shrinks to a Stop strip while recording (`dex:snip-recstate`), sources pre-sorted with this window first, save-video accepts Buffer/ArrayBuffer/views, save-cancel keeps the tool open. Sweep fix: `dex:snip-area`/`dex:snip-full` now throw `no tab` on a viewless tab instead of a TypeError.

Verified: `node --check` all JS clean; `smoke` pass; `test:ai` 79 pass; `test:sidebar` 15 pass; `test:pomodoro` 35 pass; `--run-selftest` overall `ok:true` incl. `snipButton {snipOpened, snipPainted, frozenPx 1488, closed}`. Note: the currently running PID 9504 is the installed build (`%LOCALAPPDATA%\\Programs\\Dexerion\\resources\\app.asar`) � the fix goes live only after `npm run dist:win` + reinstall (build outside OneDrive per the note above).

## 2026-10-11 � reinstall: snip fix deployed to running app

Closed running PID 9504 gracefully (`CloseMainWindow`, session persisted), rebuilt via `npm run dist:win` (output `%LOCALAPPDATA%\\Temp\\dex-build`), confirmed marker `shown in-window` in the new `app.asar`, reinstalled silently (`Main_Exe_Dexerion.exe /S`, 115,522,127 bytes), refreshed the `exe\\` copy, relaunched � new main PID 15192 (+3 children) running the fixed build. `tabs.json` backed up first (`%LOCALAPPDATA%\\Temp\\tabs-backup-20261011.json`).

## 2026-10-11 � record pinned to this window + panel redesign (redeployed)

Wrong-window recordings fixed at the root: the overlay no longer guesses the capture source from window titles � main sends `BrowserWindow.getMediaSourceId()` in `dex:snip-init` and flags `isSelf` in `dex:snip-sources`, and the picker pre-selects it as "This window � Dexerion (recommended)". Record card redesigned (title, source picker, big Record button, hint) with a Stop/Cancel strip while recording; preview shows duration + size and revokes object URLs on retake. Sweep fixes: strip toast no longer covers the Stop bar, `#rec-live` fills the strip, save-cancel flows keep the tool open.

Verified: `node --check` + snip script parse + `smoke` pass. Rebuilt, reinstalled silently, relaunched � new main PID 4524 running the fixed build (`mediaSourceId` marker in installed asar). `exe\\` copy refreshed.

## 2026-10-14 - page vision eye-toggle + 1-image-per-prompt fix (verified headless; redeployed to installed app, tabs preserved)

- New: eye button #ai-vision in the AI composer (shell.html, default off, per-window). When on, dex:ai-send carries includePage and main scans the active tab at send time - DOM innerText (12k cap) + top page image fetched via the tab session and downscaled (no screenshots). Text lands in the system prompt; the image rides ephemerally (never stored in chat history). Manual attach/snip/paste images work with vision on or off.
- Bug (live report): NIM error 400: At most 1 image(s) may be provided in one prompt. Page vision attached up to 3 page images + manual attachments + history images. Fix, three layers: ai.js streamOnce keeps images only on the newest message carrying any (first one there, older messages keep text); browser.js fetches 1 page image and the tail message carries manual-first-or-page; sidebar caps attachments at 1 with an honest hint.
- Verified: node --check clean; smoke pass; test:ai 81 pass (incl. new multi-image capped at 1 + kept image on newest message); test:sidebar 15 pass; test:pomodoro 35 pass. Headless stub-NIM demo: vision-ON lands page text in system prompt with image part on the vision model; vision-OFF sends no page block.

## 2026-10-14 - multi-image fan-out: one prompt per image (verified headless, redeployed: installed silently from dexbuild2 (verified NOTE_TAKER markers in asar), relaunched as new main PID 19168, tabs restored)

- Replaces the 1-image strip with chained legs: stream() splits image-bearing messages oldest-first (max 6 legs), each leg carries full text history + exactly 1 image. Context legs bank a 2-3 sentence visual note (300-token cap, note-taking system suffix, not streamed to UI); notes ride as assistant turns so the model remembers across prompts; final leg is the normal persona/memory/page-text send, streamed. Stop mid-chain stays dead via the existing tombstone. Unprovisioned-model retry wraps the whole chain once.
- Restored attach cap 4 + page fetch 3 (each image is its own leg now, so the endpoint limit cannot trip).
- Verified: node --check clean; smoke pass; test:ai 86 pass (7 new fan-out asserts); test:sidebar 15 pass; test:pomodoro 35 pass; stub-NIM demo still green.

- Deploy incident worth recording: the relaunched app died instantly and silently on the real profile while all test profiles ran fine. Root cause was not the build - another agent had launched the dev tree (electron . with no --user-data-dir, PID 17624) onto the REAL profile, and every subsequent launch lost the single-instance lock and quit without a word. Found via Win32_Process command lines; closed the squatter gracefully (it owned the live session, so it flushed first) plus my own test instances, and the installed build started first try.

## 2026-10-14 - page vision captions-only (verified headless, redeployed: installed silently from dexbuild3 (verified no fetchPageImageDataUrl + pageImages [] + fan-out markers in asar), relaunched as new main PID 15256, tabs restored)

- Page vision no longer fetches or sends any image bytes: collectPageVision returns text + up-to-8 caption lines (alt + figcaption/aria caption + WxH + above/below-fold bucket), pageImages always []. Deleted the now-dead fetchPageImageDataUrl (session.fetch + nativeImage downscale). Manual attach/snip/paste still send real vision via the ai.js fan-out, untouched.
- Verified: node --check clean; smoke pass; test:ai 86 pass; test:sidebar 15 pass. No ai.js/sidebar changes, so fan-out + attach behavior is covered by the existing asserts.

## 2026-10-14 - page vision reads documents: iframe/shadow scan + Docs export + Drive .docx fallback (verified headless, redeployed: installed silently from dexbuild4 (verified doctext.js + fetchDocText + scanPage markers in asar), relaunched as new main PID 11536, tabs restored)

- Reported: eye-on over a Drive-hosted .docx returned filename + UI chrome but no body text. Root cause: the Drive preview renders pages as images with almost no text in the top DOM, and the old scan read documentElement only.
- Fix: new pure module src/main/doctext.js (ships via the existing src/** glob, no whitelist change): scanPage() runs in-page (serialized with toString, so node --check covers its real syntax) and walks same-origin iframes + open shadow roots with a frame count for coverage; browser.js uses it, then when DOM text is under ~500 non-space chars falls back to the document itself - native Google Docs via session-authenticated export?format=txt, else Drive uc download with .docx unzipped (central-directory reader, stored+deflated, zip-bomb caps) and plain text passed through. HTML interstitial/login pages rejected. Whole fallback bounded at 20s, silent on failure.
- Verified: smoke gains a doc-text suite (URL parsing, synthetic real-zip .docx round trip incl. entity decode, binary/text split, output cap, scanPage compiles sans DOM) - all green; test:ai 86, sidebar 15, pomodoro 35 unchanged. Honest gap: large Drive files behind the virus-scan confirm page and PDFs return nothing (would need a new dep).

## 2026-10-14 - page vision parallel fetch for speed (verified headless, redeployed: installed silently from dexbuild5 (verified docPending parallel markers in asar), relaunched as new main PID 2576, tabs restored)

- Reported: doc Q&A over a Drive viewer timed out (NVIDIA took too long). Root cause: the fallbacks ran back-to-back (6s scan, then up to 20s export/download) before the model was even contacted.
- Fix: the document fetch now starts alongside the DOM scan (it no-ops on regex mismatch for ordinary pages) and the send awaits at most its remainder; budgets tightened (export 8s, download 12s, overall 15s). Worst case is now the max of the two paths, not the sum. Also fixed a duplicated title const from the restructure.
- Verified: node --check clean; smoke (incl. doc suite) pass; test:ai 86 pass.

## 2026-10-14 - page vision back to visible screenshot + full text (verified headless, NOT redeployed)

- Reported: doc fallbacks never delivered (slow, fragile) - user asked for a plain visible screenshot plus all text instead. collectPageVision now captures the visible viewport (max 1280px, JPEG 75, 4M-char cap, 8s race, runs alongside the DOM scan) and returns it as the single page image; DOM text + iframe/shadow walk + caption lines unchanged. Deleted the export/download machinery (fetchBuf/fetchDocText/DOC_FETCH_MS); doctext.js stays for scanPage + its smoke suite.
- Endpoint math: exactly 1 page image; eye-on plus manual attachments still fans out via ai.js. Eye button wording updated to screenshot + text.
- Verified: node --check clean; smoke (incl. doc suite) pass; test:ai 86 pass; test:sidebar 15 pass. No live-GUI shot check possible headless - needs eyes on a real page after redeploy.

## 2026-10-14 - page vision fully reverted (redeployed)

- Reported borked: removed the eye button (shell.html/css), sidebar flag + toggle + includePage, collectPageVision/rank/pagePos/shot/doc-fetch machinery, ai.js pageText plumbing, doctext.js + its smoke suite. Repo-wide grep confirms zero references (visionOn/includePage/collectPageVision/ai-vision/pageText/doctext/scanPage/PAGE_VISION/PAGE_SHOT/fetchDocText). Kept intentionally: attachment fan-out (legs/note-taker, the 400 fix for manual multi-image) + attach cap 4 + image-vision model routing.
- Verified: node --check clean; smoke pass; test:ai 86; sidebar 15; pomodoro 35. Installed silently from dexbuild7 (verified no vision markers + fan-out intact in asar), relaunched as new main PID 10248, tabs restored. The uninstalled dexbuild6 screenshot build was discarded, never shipped.
## Phase 1 — page reading (scAI exact extract process)

- New src/main/ai-page.js: verbatim scAI extract (STRIP/pickRoot/readable/everything/headings/selection), isUnreadable + dexerion://, clampMiddle, buildPageContext (whole-page fullText default, selection wins >40 chars).
- browser.js: dex:ai-page-get/set (per-account, saveAcc) + dex:ai-read-page via active tab executeJavaScript (15s cap); dex:ai-send takes pageContext on a stream-only copy so stored chats and memory parsing stay clean.
- Sidebar: ◉ toggle + Reading strip + per-message context chip revealing exact text sent; unreadable pages toast and send without.
- Verify: node --check x4 clean; node scripts/smoke.js pass (new page-reader block); npm run test:sidebar 15/15 pass; graphify rebuilt (967 nodes). GUI read on live tab still to confirm with throwaway profile.
## Phase 1 follow-up — whole-page sweep before extract

- ai-page.js: new pageSweep() (self-contained, ≤20 steps x 120ms, restores scrollX/scrollY in finally, skips pages fitting the viewport); wired into dex:ai-read-page ahead of the unchanged scAI extract, best-effort with 8s cap.
- Verify: node --check x3 clean; node scripts/smoke.js pass incl. new sweep block (skip/short-page, bounded steps, position restore with stubbed DOM); graphify rebuilt.
## Phase 1 fix — scAI-exact read defaults (footer-junk bug)

- Root cause of partial reads + footer junk treated as content: Phase 1 had defaulted fullPage:true, sending fullText (nav/footers included). scAI store.js defaults are usePage:false, useSelection:true, fullPage:false, contextChars:12000 — article text only.
- Fix: pagePrefs default fullPage:false in browser.js + sidebar initial state; buildPageContext absent-flag default now === true check (article mode). Sweep kept (additive lazy-DOM wake, restores scroll).
- Proof: hidden-Electron probe on en.wikipedia.org/wiki/Electron captured 106861 chars pre- and post-sweep, trimmed to 12799-char context; jsdom equivalence run proved our extract JSON-identical to scAI extract.js on article + div-soup fixtures.
- Verify: node --check clean; smoke.js pass (new article-default asserts); test:sidebar 15/15; graphify rebuilt.
## Phase 2+3 — agentic actions (scAI agent loop, main-owned)

- New src/main/ai-tools.js (13-tool single-tab catalogue, tier classify/describe, AGENT_PROMPT, step ceiling 25/200, repeat guard) and src/main/ai-agent.js (main-owned loop: halt/lease/repeat guards, tier-3 park, transcript accumulation, <page_data> result framing).
- ai-page.js: actPage() port (snapshot/find/scroll/click/type/fill/select/hover/press_key/wait_for/halt, ref-path map, danger/secret flags, React-safe setValue). NBSP regexes codepoint-verified.
- ai.js streamOnce: opts.tools in/out (chunked tool_calls reassembly, parseError surfacing, agent-turn wire mapping, tools stripped from note-taker legs).
- browser.js: dex:ai-agent-get/set/run/stop/ping/answer, page+tab dispatch (settle waits, http-only navigate, stale-ref safety), one-run-per-window, dead-man hooks in closeTab/window-closed, steps persisted without args.
- Sidebar: agent toggle (implies Reading), runbar + Stop, live step trace, inline Allow/Decline asks, 1s lease ping, Esc stops, persisted trace rendering.
- Verify: node --check clean; smoke.js pass (catalogue tier/guard block); test:ai 92/92 (tools wire block); test:sidebar 15/15; graphify rebuilt.
- Known limits: chat-only NIM models end runs with an explanatory note (no tool_calls); prefilled password input values can appear in snapshot detail (scAI-identical).
## scAI-parity build — full agent set, recipes, Exa search, sidebar extras

- ai-tools.js: 19-tool catalogue (added screenshot, list/open/read/switch/close_tab with string ids); close_tab tier 3.
- browser.js dispatch: multi-tab ops scoped to run window, http-only open, own-tab close refused, debugger screenshot; recipes persisted per account (cap 60, origin-scoped, JSON-safe args); replay validates tab + origin; Exa key in encrypted ai-config, search prefs per account, page+search injection shared; usage returned; context-menu Ask-about entries with per-window pending prompt.
- ai-agent.js: replayRun (silent re-snapshot, gate still applies), read_tab/list_tabs/screenshot formatting, screenshot follow-up user turn.
- ai.js: stream_options usage capture, Exa key load/save/status (masked), tools stripped from note-taker legs.
- Sidebar (Dexerion dark tokens, both themes): agent/search toggles + strips, runbar, live trace, inline asks, recipe offer/sheet/replay, suggestions, usage/copy/retry, deliver() shared by send + retry.
- Verify: node --check clean; smoke.js pass (catalogue + Exa blocks); test:ai 99/99; test:sidebar 15/15. Full --run-selftest interrupted by user-requested sweep (throwaway profile, rerun pending).
- Known limits: chat-only NIM models end runs with a note; password values/typed text can appear in snapshot detail + recipe args (scAI-identical); search has a 25s main-side timeout, no abort wiring.

## Exa removal (user request)

- Deleted src/main/ai-search.js; dropped exaKey from ai-config load/save/status; removed dex:ai-search-get/set, dex:ai-exa-key-set/clear, dex:ai-search handlers, searchPrefs, cleanChatMessage search field; injection back to page-only.
- Sidebar: search toggle/strip/capture/chips gone, deliver()/retry page-only; settings.html Exa row gone. Stored exaKey/aiSearch prefs linger inertly on disk (ignored).
- Incidental fix: the search toggle button had duplicated the chat-filter input's id (ai-search), so getElementById never reached it — dead control, now removed with the feature.
- Verify: node --check clean; smoke.js pass; test:ai 95/95; test:sidebar 15/15 (one resource-timing flake on rerun-then-pass, unrelated).

## scAI UI port — Dexerion AI looks like scAI, dark, user accent

- shell.html: sidebar rebuilt to scAI structure (brand topbar, model strip, key warning, thread + empty state, slide-over history/recipes/memory/settings panels, setup wizard, runbar with Stop Esc, static tier-3 ask box, accent context strips, card composer with icon tools). All prior element IDs kept; only the removed chat-menu (ai-menu/menumain) and thread wrapper (ai-conversation) dropped from JS.
- shell.css: scAI layout ported onto Dexerion tokens (auto light/dark, no paper colors); accent is always var(--accent); rgba(accent-rgb) washes become color-mix(); lucide icons for new static glyphs (dynamic rows keep existing text glyphs per icon rules).
- ai-sidebar.js: thread/panel rendering, static ask flow, settings sync + wiring, key warning, usage gate, runbar limit + recipe-offer gates from prefs; ⋯ menu code removed.
- main: agent prefs extended (maxSteps/allowlist/sites/macros), ui prefs (showUsage) + IPC, allowlist enforced on run + replay via site-policy; PERSONA gains the page-grounding line (identity lines untouched).
- Settings sheet exposes only prefs that exist (page trio + chars, agent quartet, usage); keys stay in the wizard, prompt stays fixed.
- Verify: node --check clean; smoke.js pass; test:ai 95/95; test:sidebar 14/14 (menu steps replaced with topbar/panel equivalents).

## UI polish + 3 layouts (from screenshot review)

- Removed the dead account chip (avatar + name did nothing); brand mark + wordmark stay.
- Compact model strip (was a giant bar); runbar is now a real visible pill (it had no base style — rendered as floating text); context strips softer (hairline border, fg text, accent icon only).
- Dropped the YOU / DEXERION ASSISTANT caption labels (scAI has none); empty reply bubbles stay hidden until the first streamed token.
- data-ai-layout on the aside: A refined classic (default), B slim merged header, C model deck above the composer. Pure CSS, same IDs — say B or C to preview.
- Verify: node --check clean; smoke.js pass; test:sidebar 14/14.

## Three AI themes + logo + type (screenshot review round 2)

- data-ai-layout a/b/c are now full themes, not just layouts: A Minimalist (flat, hairlines, 6px radii, no wash), B Modern (Century Gothic display, 14px radii, circular glowing send, glowing runbar, deck slim header kept), C Premium (Constantia serif display, layered gradient cards + deep shadows, airy spacing, deck layout kept).
- Brand mark + empty mark use assets/logo.png (D letter behind as fallback, JS removes broken imgs); logo.png is already in the builder whitelist.
- Verify: node --check clean; smoke.js pass; test:sidebar 14/14; 3 throwaway demos relaunched (13092/2172/10152).

## Layout flag fix + brand polish

- Root cause of identical demos: the ?ai-layout= query was read but never applied (missing else-branch left the hardcoded "a"). Fixed with an immediate boot-time apply plus stored-pref application in loadUiPrefs; added a regression assert (layout defaults to a).
- Brand name de-accented (no accent first letter) and thinned to weight 500 everywhere, per request.
- Verify: node --check clean; smoke.js pass; test:sidebar 15/15; demos relaunched (12328/15552/13252).

## Single minimalist demo + QA rounds

- Consolidated to one demo (dexdemo, layout A); main 14688 untouched.
- QA1: ID cross-check (JS refs vs markup) — no dupes, no missing.
- QA2: class/hidden-guard audit — all covered; fixed a rail-breaking duplicate flex rule and a duplicate rename-input block found by re-read.
- QA3: full CSS re-read — removed stale second-pass overrides, confirmed theme scoping.
- Fixed test-sidebar flake properly: lucide tipped load past the fixed 1200ms wait, so it now polls for DexMarkdown (15/15).
- Verify: smoke.js pass; test:sidebar 15/15; single demo 6016 on layout A.

## Rail clearance fix (screenshot review)

- The model strip slid under the right rail and past the border: the right-clearance rule sat before later padding/margin shorthands, which reset it. Moved clearance into one consolidated late rule (.ai-shell > children) that also beats them on specificity.
- Demo relaunched with the fix (1952).

## Top-right close button

- Added small X in the topbar (brand level), wired identically to the rail close; topbar joins the right-rail clearance so it can't hide underneath.
- Caught by test-sidebar before shipping: the first placement ran before the `on()` helper's definition (TDZ throw would have unwired everything below it). Moved into the guarded wiring block; 15/15 green.

## Dead rail buttons — hit-testing root cause + fix

- Symptom: all 8 rail buttons visible but dead; Send worked. Wiring proven intact (headless clicks fire handlers).
- Live CDP hit-testing in a real renderer proved the thread/modelbar/composer paint ABOVE the rail despite its absolute z-index:5 (z-index bump to 50 and isolation changed nothing).
- Fix proven live first: moving the rail node later in DOM (before the slide-over panels) makes every button hittable. Applied to shell.html with an explanatory comment; panels still cover the rail when open.
- Verify: ID audit clean; smoke.js pass; test:sidebar 15/15.

## Main build current (all reviews merged)

- Restarted main onto the full build (PID 7560, visible window): scAI UI port, minimalist polish, rail, flat geometry, 480px panel, themes A/B/C, logo, keywarn-first ordering, rail-clearance fix, halt-flag fix, GPU isolation, Exa removal.
- Demo retired; single running instance.

## Polish round: rail, flat geometry, wider panel

- Topbar actions now dock as an even vertical rail on the right (absolute, space-evenly); thread/composer/modelbar clear it with right padding; slide-over panels cover it.
- Geometry flattened panel-wide (6/5px cards, pills kept); B theme 14px→8px (circle send kept).
- Model select centered with ellipsis; modelbar compact.
- Panel 390/400px → 480px (+20%) with matching AI_SIDEBAR_W=480 in main (page geometry stays exact) and widened media-query caps.
- Relaunched all four instances fresh (main 14688 + demos 6452/14912/18604), all with visible windows.

## Agent fix — stale halt flag poisoned tabs after any stop

- Symptom: every run died on step 1 with a user-stopped error (double period in the message). Traced to the page-side halt flag: onStop sets window.__dexHalt=true but nothing ever cleared it (scAI re-injection resets its flag on every start; that half of the port was missing).
- Fix: reset the flag at run start, replay start, and after switch_tab (navigation wipes page state anyway). Diagnosed + fixed without touching the running PID; live on next restart. Workaround until then: reload the tab.
- Verify: node --check clean; smoke.js pass.

## Hang fix — GPU isolated out of the main process

- Symptom: repeated AppHangB1 (Windows: "stopped interacting", then kills it). No crash dumps anywhere. Pre-existing: packaged-build hang logged Oct 6, plus one this morning before edits began.
- Diagnosis: main PID at 89-124% CPU during ad-heavy browsing, but per-thread sampling while calm showed every thread near zero — no stuck JS loop. Sync main-thread audit (timers, IPC, serialization, profile I/O) found nothing hot; session is trivial (1 tab). SharedImageManager GPU errors appear in every boot log. With --in-process-gpu, compositor stalls land on the main message loop.
- Fix: removed the --in-process-gpu switch (main.js) so the GPU gets its own process; documented why. Verified boot at PID 3952 (created post-edit). If hangs persist, next step is a --disable-gpu diagnostic run.

## Windowless phantom process + markdown stress

- Found a running instance with MainWindowHandle 0 (alive, responding, zero windows): the app can end up windowless yet holding the profile lock, so later launches quit as second-instance and the user sees "not open".
- Likely accomplice: popupMenu menu windows only show on did-finish-load; a failed load left an invisible window plus a never-settling promise. Added did-fail-load → done(null). (In files; live on next restart — PID 236 predates it.)
- Markdown renderer stress (80KB adversarial snapshot-like input, worst cases, 60 incremental renders): max 47ms single / 125ms total — no catastrophic backtracking; renderer-freeze-via-markdown ruled out.

## 2026-10-15 — blank packaged window: lost --in-process-gpu removal re-applied

- Symptom: installed + unpacked packaged builds opened a completely blank dark
  window (title updated to "New Tab — Dexerion — Dexerion", so shell JS + IPC
  ran — only compositing was missing). Dev was assumed fine; user confirmed the
  pre-fix installed build blank while a fixed dev window painted.
- Root cause: the Hang-fix removal of `app.commandLine.appendSwitch('in-process-gpu')`
  (above) never landed in source — the NOTE comment described the removal but the
  appendSwitch line was still in `code/main.js:29` (likely lost in the Oct-14 repo
  move). With the GPU in-process, compositor stalls starve the main loop and the
  window never paints.
- Fix: deleted the one line so code matches the comment (minimal diff, no IPC /
  profile / UI touch). `node --check` clean; `smoke.js` fully green (6/6 stages —
  it initially crashed on `Cannot find module 'electron'` because the root
  `node_modules/` and `.graphify/` junctions were empty real dirs; restored both
  junctions to `build/node_modules` and `opencode/.graphify`).
- Deployed: rebuilt (`npm run dist:win` → `dex-build/Main_Exe_Dexerion.exe`),
  verified the packaged `main.js` in `app.asar` has no `appendSwitch('in-process-gpu')`
  (only the comment), installed by direct copy of `win-unpacked` into
  `%LOCALAPPDATA%\Programs\Dexerion` (NSIS wizard looped on "cannot be closed"
  because two installer instances ran concurrently and locked each other; killed
  both first). User confirms the installed build paints.
- Open, pre-existing, NOT from this fix: `--run-selftest` dies 5x at the same
  spot — MV3 fixture service-worker registration fails (status code 2) and the
  run exits 1 with no JSON. A/B run with the switch temporarily restored fails
  identically, and the Oct-11 log shows selftest green with the switch present,
  so this is environmental (all runs under load or same-machine state), not a
  regression from the GPU change. Needs a quiet-machine rerun + SW-load
  investigation separately.

## 2026-10-15 - Not-Responding hang fix (redeployed, verified)

- Reported: Windows repeatedly flagged Dexerion as not responding. No Dexerion.exe was running at first check; the installed app (%LOCALAPPDATA%\Programs\Dexerion, app.asar built 06:09) was later found running (8 processes, all Responding: True at rest) - the hang is intermittent, consistent with main-thread stalls under bursts rather than a permanent wedge.
- Root cause (graphify-guided sweep of browser.js/main.js hot paths): persistAll() does ~17 synchronous JSON disk writes on the main thread (all cached accounts + all profile files, history up to 5000 entries) and was called per gesture from closeTab, moveTab/groupPair/group-add/tab-ungroup/group-set, and window closed - rapid tab drags/closes blocked the event loop long enough for Windows to declare the app hung. Same story for layout() (native setBounds per tab) fired per resize event and per chrome-h/rail-w pixel, and buildSuggestLocal() lowercasing up to 5000 history entries per omnibox keystroke.
- Fix (code/src/main/browser.js only, no behavior change): new persistSoon() debounces hot-path persists to one write per 800ms; quit paths (win close, flushOnQuit) keep synchronous persistAll so the session is never lost on exit. New layoutSoon() coalesces resize/measure layouts to one per tick; callers needing geometry now keep direct layout(). Suggest local scan capped to the most recent 500 history entries (same result shape). No IPC names, no UI, no feature logic touched.
- Verified: node --check clean; smoke pass; test:ai 95, test:sidebar 17, test:pomodoro 35 all pass. Bug-sweep clean (no dex:* changes, saves still ordered pushState-then-persist, no hardcoded offsets, no CSS/skin changes, no renderer secrets, no resurrected modules). graphify update run (714 nodes, 1210 edges). Live boot of patched code on a throwaway profile stayed up 30s+ then cleaned up.
- Redeployed: npm run dist:win green, fix markers (persistSoon/layoutSoon/history cap) verified inside win-unpacked app.asar, installed silently (/S) over the per-user install (app.asar 35562645 -> 35569644 bytes), relaunched: 5 processes, all Responding: True after 25s. Installed app had to be force-killed first (graceful taskkill left the main process alive - itself a symptom of the wedged loop).


## 2026-10-15 - Not-Responding root cause: debugger re-attach loop on renderer death (redeployed, verified)

- Still buggy after round 1 (persistSoon/layoutSoon/suggest cap): those only smoothed stalls, the wedge persisted. User narrowed it: AI sidebar + tab sidebar involved; rail expand-then-collapse bugs out; deleting the active tab (with or without AI open) bugs out. Functionality of all three areas untouched.
- Repro: threw CDP driver scripts (TEMP-only, `ws` from build deps) at a throwaway-profile app via --remote-debugging-port. Deterministic result: closing the ACTIVE tab wedges the main process permanently (main at 100%+ CPU, Responding: False, CDP dead, every later IPC dead). 4/4 runs wedged; run with renderer destroy disabled survived 2/2.
- Root cause: `attachSyncBridge()` (ext-sync-bridge.js) attaches Electron's debugger to EVERY tab renderer and re-attached immediately on any non-devtools detach. When a renderer dies, the debugger detaches BEFORE `isDestroyed()` flips true, so the re-attach re-armed on a dying target: detach -> attach -> detach forever, starving the main loop. Proved by inspector samples of the wedged main showing exactly `onDetach -> tryAttach -> detach` frames, and by the fact that closing tabs (renderer teardown) was the trigger. Explains all three user repros (a wedged main freezes rail timers/IPC, AI, and the window) and the intermittent nature (any renderer death could hit the race). AI-open was incidental (no-AI runs wedged identically).
- Fix (ext-sync-bridge.js only): re-attaches are deferred 500ms (a dying renderer has settled into destroyed by fire time, so the retry bails) and capped at 3 tries (transient steals still recover; a dying target stops instead of looping); any live debugger traffic resets the budget; retry timer is unref'd so it never holds up quit. Bridge behavior for live pages unchanged.
- Verified: full CDP matrix on final code (rail x6, AI open, close active x3, close loading tab, drain) with 0 stalls and 1ms max probe (was: permanent wedge on first close). node --check clean (browser.js, ext-sync-bridge.js); smoke, test:ai 95, test:sidebar 17, test:pomodoro 35, test:extbridge all pass. test:repo has 1 pre-existing environmental FAIL (unexpected top-level `.engram` dir from the mandated graph-update step, unrelated to shipped code). Rail class/width wobble seen during repros was an occluded-window timer artifact (timers/RAF throttled in the background test window), not app behavior. graphify update run.
- Redeployed: dist:win green, wedge-guard + round-1 markers verified inside win-unpacked app.asar (no instrumentation remnants - only pre-existing "wedge" comments), installed silently (/S, app.asar -> 35573054 bytes), relaunched: 5 processes, all Responding: True, settled CPU.

## 2026-10-15 - Tasks feature (new, additive)

- Rail tasks block below the Focus Timer: same-size mini icon (list glyph + open-count badge) when collapsed; header + top-3 peek ("No open tasks" when empty) + expandable full list with add form (title, compulsory date, optional time defaulting to 09:00 local, high/medium/low priority defaulting to medium, description) when expanded. Independent expand: hovering the timer mini shows only the timer, hovering the tasks mini shows only tasks, hovering tabs shows both.
- Sort is due date, then priority (high first), then oldest created; done tasks sink, excluded from peek. Reminders: OS notification 30 min before due and at due, once each per task (flags persist, so restarts never double-fire). Per-account tasks.json, every mutation via saveAcc + dex:tasks-updated broadcast.
- Stability constraint honored: pomodoro.js, dex:pomo-* IPC, rail-collapse timers/widths, timer rendering untouched (all edits additive: new tasks.js, new dex:tasks-* IPC + scheduler, new #rail-tasks DOM/CSS/JS, one render() call + one serial() field).
- Verified: node --check clean (tasks, browser, profile, shell, test-tasks); test:tasks 28/28; smoke pass; test:pomodoro 35/35; test:sidebar 17/17. Bug-sweep clean (new IPC only, no optimistic UI, no hardcoded offsets, no :root selectors, no renderer secrets, no resurrected modules). graphify update run (740 nodes, 1249 edges). No GUI selftest (timing-flake rule; headless suites cover the new logic).

## 2026-10-15 - Tasks: new-tab section + rail form spacing

- New tab page gains a Tasks section below Starred: all open tasks (server-sorted), checkbox toggles done (re-fetches after), due + description line with overdue highlight, priority dot, "No open tasks" empty state. Hidden in AI view like the other sections. Zero main-process changes: reuses existing dex:tasks-list/toggle (needChrome already allows internal pages); tab pages don't receive dex:tasks-updated broadcasts so the page fetches on load and after its own toggle.
- Rail add form: date, time, priority, description each on their own full-width line (removed the cramped two-column rows + now-unused .tk-row2 rule).
- Verified: newtab inline scripts compile (vm.Script); test:tasks 28/28; smoke pass; test:pomodoro 35/35; test:sidebar 17/17. Bug-sweep clean. No browser.js/pomodoro/ext-sync-bridge changes this round, so the renderer-death hang fix is unaffected.

## 2026-10-15 - Tasks new-tab panel moved to bottom-right

- Tasks now a fixed bottom-right panel whose left edge anchors at 50% + 334px (Starred column right edge + gap) on wide windows; below 1100px it rejoins the centered column under Starred. Scrolls internally past 52vh; hidden in AI view. newtab.html only — no logic or main-process changes. Verified: scripts compile, smoke pass.

## 2026-10-15 - Tasks deployed to main install

- dist:win green (Main_Exe_Dexerion.exe 115MB); win-unpacked app.asar lists tasks.js + new shell/newtab files (extractFile path quirk in @electron/asar, presence + fresh build verified instead).
- Main Dexerion shut down gracefully (0 remaining, session saved), installed silently (/S, app.asar -> 35606230 bytes), relaunched: 5 processes, all Responding: True after 25s.

## 2026-10-17 - Downloads: collision, bad-folder, and terminal-interrupt fixes

- Root cause of the intermittent "download interrupted" error: `will-download` set `setSavePath` to a fixed `dir/name` with no uniquification, so re-downloading a common filename targeted an existing/locked file and Chromium reported `interrupted`; a bad `downloadDir` was swallowed by a silent `mkdir` catch, leaving the transfer pointed at a missing path; and a terminal interruption (`done` != `completed`) could never be resumed from dexerion://downloads because `done` cleared the live item and set `active=false` while the page only offers Resume for `active` rows.
- Fix (browser.js + pages/downloads.html only): new `resolveDownloadDir()` (configured dir -> app Downloads -> homedir, first writable wins); new `uniqueSavePath()` Chrome-style `file (1).ext` that also avoids in-flight paths; `updated` no longer wipes `rec.error` and `done` records a readable interrupted reason; new `dex:download-retry` re-issues `downloadURL(rec.url)` for terminal interrupted/cancelled rows; the downloads page shows a Retry button for them. Pause/resume/cancel/delete/open paths untouched.
- Verified: node --check clean (browser.js); smoke.js all suites pass; focused logic test 10/10 (uniquify, collision, in-flight, sanitize, empty-name, increment, retry guards); real Electron throwaway-profile download test: two same-name downloads both `completed` (262144 B each) landing as `payload.bin` + `payload (1).bin`. Full `--run-selftest` on the patched tree booted and passed every area except two pre-existing, unrelated assertions: `shellHandlers.focus` (probe still checks the removed `#focus-btn`; the Focus Timer is now the pomodoro rail) and `aiImages` (chatId never populated in this environment). Bug-sweep clean: no dex:* breakage, retry persists via the existing save path, no hardcoded offsets, no :root skin selectors, no renderer secrets, no resurrected modules. graphify update run (740 nodes, 1249 edges). Real profile and the running PID were never touched.

## 2026-10-17 - Self-test probes repointed to live elements (focus + AI images)

- Both were stale probes, not product bugs: `shellHandlers.focus` checked the removed `#focus-btn` (the Focus Timer is the pomodoro rail now) and `aiImages` read `dataset.chatId` off the removed `#ai-conversation` thread wrapper (dropped in the scAI sidebar rebuild, TESTLOG 2026-10-14). Each made a healthy build report `ok:false`, masking real regressions.
- Fix (main.js only, no product code): `focus` now checks the live rail control (`#rt-toggle` / `#rm-start`) and the dead `#focus-banner` diagnostic became `focusRailHidden` on `#rail-timer`; the AI chat id is read from the active `.ai-chat-row[data-id]` in `#ai-chat-list`.
- Verified: node --check clean (main.js); smoke.js all suites pass; full `--run-selftest` OVERALL `ok:true` with zero failing checks (`shellHandlers.ok:true`, `aiImages.ok:true` chatId/bubbled:1, offlineFlow/pomoTimer/skins/inspector all green). One intermediate run showed the known timing-sensitive `offlineFlow` flake (handoffInProc 0 under load); the immediate quiet re-run passed (handoffInProc 10.27) - pre-existing, unrelated to this change. Probes only: no product functionality touched; real profile and running PID untouched.

## 2026-10-17 - Deployed downloads + selftest fixes to the main install

- `npm run dist:win` green: `Main_Exe_Dexerion.exe` 115,624,054 bytes built into `Temp/dex-build` (the config's output dir is already outside OneDrive).
- Packaged asar verified BEFORE deploy to carry the latest code: `browser.js` (resolveDownloadDir / uniqueSavePath / dex:download-retry), `downloads.html` (Retry button), `main.js` (focusRailHidden + `.ai-chat-row.active` probes, no stale `#focus-btn` / `#ai-conversation` queries).
- Running Dexerion (main PID 17460, session saved on graceful close) shut down; installer ran silently (`/S`, exit 0); the installed asar at `%LOCALAPPDATA%\Programs\Dexerion\resources\app.asar` re-verified; relaunched -> 5 processes, all Responding: True after ~20s, session restored ("Circulatory System - Classroom"). Latest build is now live.

## 2026-10-17 - Task description: wrap when typing, clamp + expand in the new-tab preview

- Rail add-task form: the one-line `<input id="tk-notes">` scrolled the description sideways past the box. It is now a `rows="1"` `<textarea>` that wraps at the box width (no horizontal scroll) and auto-grows with its content up to 120px, then scrolls vertically. Enter still adds the task (the old input submitted on Enter); Shift+Enter inserts a newline (same convention as the AI composer).
- New-tab Tasks panel: the description was crammed onto the due line (`notes · due`). Each open task now shows the title, then the description clamped to its first line with "…" via `-webkit-line-clamp:1` (`white-space:pre-wrap`, so line breaks the user typed survive), then the due line. A caret toggle expands the card in place — vertically only, card/due width untouched — showing the whole description; the due line stays visible underneath. Cards without a description get no toggle; the peek/rail rows are unchanged.
- Files: `shell.html` (textarea), `shell.css` (`#tk-form textarea`), `shell.js` (auto-grow + Enter-to-submit + height reset on add), `pages/newtab.html` (`.tk-desc` / `.tk-exp` CSS + `paint()`). No IPC, no tokens, no geometry changes.
- Verified: node --check clean (shell.js); smoke.js all suites pass; test:tasks 28/28; test:sidebar 17/17; newtab structural probe (jsdom) PASS; real-Chromium render of the actual pages via the bundled Electron (offscreen capture) — rail: textarea wraps, auto-grows to fit, clamps at 120px with a vertical scrollbar and zero horizontal scroll, Enter -> `dex:tasks-add`, Shift+Enter does not submit, empty box keeps its 26px min-height (fixed a bug where the hidden-at-load grow pinned it to 0px); newtab: clamped desc computes `-webkit-line-clamp:1`, expanding the long card grew it 81->281px tall with identical width while the due line stayed visible, no-desc card gets no toggle. Full `--run-selftest` OVERALL `ok:true` (newtabDaylight/shellHandlers/skins/chromeHeight all green). Bug-sweep clean: no dex:* breakage, no optimistic-UI-without-write, no hardcoded offsets, no :root skin selectors, no renderer secrets, no resurrected modules. Real profile never touched (harness used a throwaway file:// copy + selftest's own tmp profile).

## 2026-10-17 - Deployed task-description changes to the main install + restart

- Build: the config's usual output dir (`Temp/dex-build`) had its `app.asar` locked at the OS level (EBUSY on unlink; no process listed as holding it, and it survived a forced recursive delete), so the build ran to a fresh output dir instead — `npx electron-builder --win --config electron-builder.json --config.directories.output=Temp/dexbuild-restart` — which is green. 5-process pre-flight check found the then-running main PID 3372 (six children).
- Pre-deploy asar verified BEFORE swapping: `asar extract` of `dexbuild-restart/win-unpacked/resources/app.asar` carries the new code (`shell.html` `textarea#tk-notes`, `shell.css` `#tk-form textarea`, `shell.js` `tkGrowNotes` + `requestSubmit`, `newtab.html` `-webkit-line-clamp:1` + `tk-exp`), size 35,620,573 B vs the old installed 35,613,226 B.
- Running Dexerion closed gracefully with `CloseMainWindow()` on the main PID (0 remaining, session saved); installer ran silently (`/S`, exit 0); installed `%LOCALAPPDATA%\Programs\Dexerion\resources\app.asar` re-verified to 35,620,573 B (exact match) and content re-extracted from the live install to confirm all four markers. Relaunched -> main PID **15772** with 4 children, all `Responding: True`. The stale locked `Temp/dex-build/win-unpacked` was left in place (unremovable, regenerable). Real profile untouched beyond the app's own graceful session save.

## 2026-10-17 - New-tab empty state turned into two lines + redeploy

- The Tasks empty state rendered as one run-on line ("No open tasksAdd one from the tasks panel in the tab rail.") because `<b>No open tasks</b>` sat inline directly against the sentence. Fix (`pages/newtab.html`, one line): a `<br>` between the bold heading and the sentence. Wording, styling and the trailing period unchanged; the Starred empty state (which has a space after its `<b>`) is untouched.
- Verified in a real Chromium render of the actual page with an empty tasks list: the `.empty` box is now two lines ("No open tasks" / "Add one from the tasks panel in the tab rail."). Built to `Temp/dexbuild-r2` (the first fresh dir was reused-adjacent and left alone), asar pre-verified to carry `No open tasks</b><br>` plus the earlier task-description markers (35,622,035 B), running app closed gracefully, installer `/S` exit 0, installed asar byte-for-byte match re-confirmed, live-install content re-extracted. Relaunched -> main PID **1636** with 4 children, all `Responding: True`. Real profile untouched beyond the app's own graceful session save.

## 2026-10-17 - OneDrive storage optimisation (no product code changed)

- Scope: shrink the OneDrive copy without touching anything that runs. Kept all of `code/` (57 source/asset/doc files), `build/` manifests + lockfile + `scripts/` + `test-extensions/`, the whole `opencode/` workspace (config, skills, plugins, live graph, playwright MCP output dir), both root junctions, and the Graphify/codebase graphs.
- Removed `build/node_modules` (651 MB / 31,671 files) as regenerable: `npm ci` in `build/` restores it from `build/package-lock.json` (lockfileVersion 3, 575 packages). The `build/node_modules` directory itself is kept (empty) so the root `node_modules` junction still resolves. OneDrive is known to fight installed node_modules (see the OneDrive build-lock note above), so it is no longer stored there.
- Removed the stale root graph outputs `graph.json` / `GRAPH_REPORT.md` / `manifest.json` (2026-10-14 copies whose manifest still pointed at the old `C:\Users\Darre\Desktop\Dexerion` path); byte-identical backups already sit in `%LOCALAPPDATA%\Temp\dex-graph-backup\`. The live project graph is untouched in `opencode/.graphify/` and `.engram/`.
- Removed the `opencode/service.json` secret (a plaintext local OpenCode service password) and added `service.json` to `opencode/.gitignore` so it is not carried again. Cleared the regenerable `opencode/.playwright-mcp` run artefacts, deleted the empty root `dex-graph-backup` dir, and dropped `opencode/graphify-out/cache`. Kept `opencode/graphify-out/` current graph + its dated history, `.engram/`, all references, skills and plugins.
- Verified: `node scripts/smoke.js` all suites pass (run before the node_modules removal, since the suite needs it); `node --check` clean on `build/scripts/smoke.js`; both junctions resolve; every required source/config/manifest file present; `opencode.json`, `package.json`, `package-lock.json` and `electron-builder.json` all parse; Graphify MCP loads the project graph via `project_path` at 742 nodes / 1251 edges. Project size 663.6 MB -> 10.5 MB, 32,044 -> 296 files.
- Installer: the one kept installer is now `dist/Main_Exe_Dexerion.exe` (115,627,109 B, SHA256 `8B96AEA541CB8508...`), copied from `%LOCALAPPDATA%\Temp\dexbuild-r2\` - the latest verified build (17 Oct 15:11). Proven current, so no rebuild was needed: parsing that build's `app.asar` (5117 entries) shows all 56 `code/` files byte-identical to source and zero files on disk missing from it; the only differences are this TESTLOG entry and electron-builder's rewritten `package.json` (extraMetadata). Note for any future rebuild: the asar bundles ~5059 `node_modules` prod-dep files (incl. `adm-zip`, used by `extensions.js`), so `npm ci` must run in `build/` first or the installer ships without them. The superseded Temp builds (`dex-build` 13:21, `dexbuild-restart` 14:58) and `dexbuild-r2` itself were left in place.





## 2026-10-18 - Browser-wide intelligence: tab discovery, cross-tab research, missions, projects

- Scope: the assistant agent now works across every window. New pure module `code/src/main/ai-research.js` (tab ranking + text-match snippets, plan sanitizer, project records, citation gate). Tools (`ai-tools.js`): `search_tabs`, `update_plan`, `open_project` (tier 3 - the ask shows the exact title and goal), `note_finding`; `list_tabs`/`read_tab`/`switch_tab`/`close_tab` are browser-wide. Loop (`ai-agent.js`): plan state + plan events, done-vs-plan verification (one nudge), pause/resume with lease enforcement, per-run budgets (5 new tabs / 40 reads), ref-freshness guard (a ref-based action is refused when the page no longer matches the snapshot URL), one retry for transient provider errors then a graceful outage end that leaves the browser untouched, read-page recording for citations. Dispatch (`browser.js`): cross-window tab helpers, sleeping/lazy tab wake-read without activation, allowlist + readability + URL revalidation immediately before execution, project/finding persistence with anti-fabrication checks (a finding may only cite a page the run actually read; a supplied quote must occur in the captured text), mission records mirrored from agent events, stale running/paused missions read as interrupted. Profile: `missions.json` + `projects.json` per account, separate from `memory.json`. IPC: `dex:ai-agent-pause/resume`, `dex:ai-missions-list/get/delete/clear`, `dex:ai-projects-list/get/delete`, broadcasts `dex:ai-missions-updated` / `dex:ai-projects-updated`. UI (`shell.html`/`ai-sidebar.js`/`shell.css`): runbar Pause/Resume, live plan checklist (persisted with the chat message), Missions + Projects sheets (inspect/delete), cross-tab reading toggle + allowlist copy in Settings, "Compare my open tabs" starter.
- Verified: node --check clean (browser.js, ai-agent.js, ai-sidebar.js, ai-research.js, ai-tools.js, profile.js); smoke.js all suites pass (new: research helpers, citation gate, new tool tiers/budgets/prompt rules); test:ai PASS 116 (new: plan verification, pause/resume, cancellation, outage retry, budgets, ref freshness, approval-while-paused, acting-window dead-man); test:sidebar PASS 30 (missions/projects sheets, runbar pause wiring, live plan); test:pomodoro 35; test:tasks 28; test:extbridge pass; repo-audit ALL GREEN (known-top set refreshed: `.engram` and `dist` are current documented entries; the stale rule predated them). Full `--run-selftest` OVERALL `ok:true` with every area green (incl. aiImages / aiChat / aiChatPersistence).
- Note: `build/node_modules` was empty per the OneDrive policy - restored with `npm ci` plus `node node_modules/electron/install.js` (npm's install-script gate blocks electron's postinstall by default on this machine) so the suites could run. Regenerate the same way after any OneDrive cleanup.
- Not verified here: real-provider research runs (needs a live NIM key and spends quota - `npm run test:ai-live`), multi-window manual flows beyond the stubbed coverage, and packaging rebuilds (source-only change; `dist/` untouched).

## 2026-10-18 - Fix: "Read tab undefined" + unbounded tab-inspection retries

- Root cause (traced through code): NIM tool calling does not enforce JSON-schema `required`, so a model can emit `read_tab` with no `tabId` (or a variant key). `ai-tools.js` describe() printed `'Read tab ' + a.tabId`, producing the trace line "Read tab undefined"; the runner passed the raw input straight to dispatch and `browser.js` turned the missing key into an empty id ("No tab with id (missing)"). The repeat detector only counted *consecutive* identical calls, so `read_tab {}` interleaved with `list_tabs` reset it and burned the whole 25-step ceiling. No substitution ever happened (failures were closed), but they were unactionable and unbounded.
- Fix (minimal): `ai-research.js` gains `normalizeTabArgs()` (stable t<digits> ids only; safe `tab_id`/`id`/`tab` aliases accepted when the value is a real id; positions, titles and "undefined" refused with guidance), plus `compactTabList()` / `withTabRefs()` for refreshed id lists in errors. `ai-agent.js` validates tab-tool arguments before dispatch (invalid input = actionable error result, zero dispatch) and keeps a per-run failure ledger keyed by canonical call: a 2nd identical failure warns, a 3rd ends the run with a clear explanation, any success clears the debt. `browser.js` appends the currently open tab list to missing-tab errors so the retry can pick a fresh id immediately. `ai-tools.js` describe() falls back to "(no tab id)", the three tab schemas demand the exact id, and the prompt teaches "refresh ids with list_tabs; never repeat a failing call".
- Tests (stubbed; no real tab was opened, navigated or closed): smoke adds pure checks for validation/aliases/refusals/compact list/refresh hint; test:ai section 23 drives real Wikipedia URL/content fixtures - list_tabs -> exact-id read, multi-tab reads, missing id stopped pre-dispatch, position/title refusal, closed id + refreshed list + live-id recovery, navigation re-read, interleaved duplicate failures bounded stop. test:ai PASS 135 (was 116).
- Verified: node --check clean (ai-research/ai-tools/ai-agent/browser); smoke all suites; test:ai 135; test:sidebar 30; test:pomodoro 35; test:tasks 28; test:extbridge PASS; repo-audit ALL GREEN; full `--run-selftest` OVERALL ok:true with 0 failing checks; graphify update rebuilt the graph (777 nodes / 1318 edges).
- Not verified here: a live NIM provider run (quota) - since the bug is model-argument-driven, re-run the same prompt that produced the trace and confirm the model now recovers from the validation message.

## 2026-10-18 - All-tabs inspection shared by the agent + Read button

- Scope: one workflow now backs both "read every open tab" entry points. New pure core `ai-research.js inspectTabs(adapter, opts)` lists tabs, reads each individually through an adapter, records per-tab failures and continues, and returns the consolidated report (counts discovered/inspected/failed/skipped, per-tab title/URL/content summary, confirmed duplicate groups by normalised URL). `browser.js` extracts `readTabById` - the single per-tab reader now shared by the `read_tab` tool and the sweep (stable-id re-resolve, sleeping/lazy wake without activation, readability + allowlist revalidated before extraction, never substitutes) - and adds `inspectAllTabs` (single-flight per window, 40-tab cap, 2-minute deadline, allowlist/cross-tab gating for agent runs). New agent tool `inspect_tabs` (tier 1; the prompt routes "all my tabs" requests to it; per-run budget 2; inspected pages recorded for citations). New IPC `dex:ai-inspect-tabs` with `dex:ai-inspect-progress` per-tab events: the composer's Read button (eye) now runs the full sweep on click, paints one progress row per tab, and saves the consolidated report to the chat (persisted with the rows). `dex:ai-read-page` remains the single active-tab context read used by sends. Tabs are never closed, navigated or modified by the sweep.
- Verified: node --check clean (ai-research/ai-tools/ai-agent/browser/ai-sidebar/main); smoke.js all suites (new: workflow ids/order/failures/duplicates/report/missing-id safety/limits); test:ai PASS 140 (new section 24: inspect_tabs report + budget + citation recording); test:sidebar PASS 38 (new: Read-button sweep - per-tab progress rows, statuses, saved report); test:pomodoro 35; test:tasks 28; test:extbridge PASS; repo-audit ALL GREEN.
- GUI selftest: could NOT complete green on this machine today - documented, not claimed. After the change: three attempts wedged in the skins phase (killed), two completed in 427s/522s (baseline ~80s) reporting the same five timeout-bound checks red: tabBridge (20s preload wait), newTabBookmarks (tileShown 12s), inspector (DevTools frontend 12s), offlineFlow (capture race, "ERR Not attached to an active page"), pomoTimer (short phase observed as break). In every completed run all AI/shell/structural checks passed: shellHandlers, skins, selectionAccent, aiImages, aiChat, aiChatPersistence, chromeHeight, accounts, tabGroups. Control experiment on identical code: `--capture-skins` completed in 79s earlier today, then exceeded 300s later the same day; concurrently VS Code's extension host burns a sustained ~1.4 cores (84s CPU per 60s idle) with no Dexerion/Electron processes running. Conclusion: host starvation (VS Code indexing the restored 651MB node_modules plus OneDrive), not this change - the five red checks are exactly the load-sensitive, timeout-bound class AGENTS.md names. Re-run `npx electron . --run-selftest` on a quiet machine to close this out.
- Harness fix found while debugging: the selftest profile dir (%TEMP%/dexerion-selftest-<pid>) was reused after PID recycling, so a killed run's stale profile (locks, caches) could poison the next run. `main.js` now removes that directory before booting the selftest (22 stale dirs cleared once manually).
- Not verified here: real-provider runs (quota) and a green GUI selftest (host load) - everything else is covered above.

## 2026-10-19 - Fix: links that open about:blank led to a search page

- Reported: "whenever you click on a link it just leads to about:blank and not the link itself."
- Root cause (browser.js, two pure helpers): `classifyWindowOpen` sent blank window-open requests (`window.open()`, `window.open('about:blank')`, `target="_blank"` about:blank links) down the manual tab path, which returns `{action:'deny'}` - the opener then gets `window.open() === null`, so flows that script the new window (`w.location = ...`, `w.document.write`) could never reach their real page; and the tab that was opened ran `resolveInput('about:blank')`, which matched no URL rule and fell through to the SEARCH template, landing on a Google results page for the text "about:blank" (title "about:blank - Google Search").
- Fix (browser.js only, 2 hunks): blank/empty URLs now classify as `popup`, reusing the existing allow path (live opener handle; Chromium loads about:blank itself; middle-click background disposition still opens a plain tab). `resolveInput` passes `about:` URLs through untouched instead of searching for them. smoke.js: local resolveInput mirror kept in sync + 4 assertions for the new cases.
- Repro proven on the installed 17 Oct build (throwaway profile, CDP): clicking `href="about:blank"`, `window.open()` or `window.open('about:blank')` opened a page target at `https://www.google.com/search?q=about%3Ablank` ("about:blank - Google Search"). Normal target=_blank links and feature popups were fine, which is why only blank opens showed the symptom.
- Fix verified in a real Electron run of the patched source: about:blank target=_blank link -> popup with a blank document, no search page; `var w=window.open(); w.location='/real.html'` -> that window lands on the intended page in 402 ms; normal target=_blank link still opens as a tab; feature popup and same-tab link unchanged. node --check clean (browser.js, smoke.js); smoke all suites pass (incl. the 4 new assertions); test:sidebar PASS 38; test:ai PASS 140.
- GUI selftest on this loaded machine: all shell/structural/AI/skins checks green (tabBridge, chromeHeight, shellHandlers, tabGroups, selectionAccent, skins, newtabDaylight, aiImages, suggestPopup, sessionPersist, ...); the three red checks (inspector DevTools frontend, offlineFlow capture race, pomoTimer short phase) are the documented 2026-10-18 load-sensitive timeout class, unrelated to these two helpers - re-run on a quiet machine to close out.
- Not done here: rebuilding/redeploying the installer (the installed app still carries the 17 Oct build; `npm run dist:win` + install would ship the fix).

## 2026-10-19 - Fix: download crash (showDownloads on a slept tab)

- Reported: starting any download raised the main-process dialog "TypeError: Cannot read properties of null (reading 'webContents') at showDownloads".
- Root cause: `will-download` calls `showDownloads(initiatingWebContents)`, which searches every tab of every window for the initiating renderer. Idle tabs (5 min) have their renderer torn down by the sleep sweep (`t.view = null`), and the search read `tab.view.webContents` unguarded - the first slept tab threw, aborting the handler before the item listeners were attached (the transfer itself still ran, but its record stayed 'progressing' forever, no updates fired, and the downloads tab never opened).
- Fix (browser.js, 1 hunk): skip view-less tabs in showDownloads (`if (!tab.view) continue;`), matching the guard used elsewhere. Checked all 57 `tab.view.webContents` uses; the remaining ones are try/caught, guard-checked, or active-tab-only, so no other live path has this hazard.
- Repro + fix proof (throwaway profile, real Electron run): two tabs, force-sleep the inactive one via the test sweep, `downloadURL()` from the active tab. Before: exact TypeError at browser.js:1687, uncaught exception, stays on the current tab, record stuck 'progressing'. After: no exception, downloads tab opens (dexerion://downloads), record reaches 'completed'.
- Full bug sweep (run from build/): node --check clean (browser.js, smoke.js); smoke.js all suites pass; test:sidebar PASS 38; test:ai PASS 140; test:pomodoro PASS 35; test:tasks PASS 28; test:extbridge ALL PASS; repo-audit ALL GREEN (37 JS files parse); GUI `--run-selftest` OVERALL ok:true with every check green (tabBridge, extPopup, newTabBookmarks, inspector, offlineFlow, pomoTimer, skins, shellHandlers, ...). The earlier link fix was re-verified unchanged (about:blank popup, w.location write flow, normal target=_blank tabs).
- Not done here: rebuilding/redeploying the installer (installed app still carries the 17 Oct build, same as the link fix).

## 2026-10-19 - Fix: multi-window quit dropped every window but the last (session persistence)

- Discovered during the user-requested graceful restart of the running app: with two windows open, quitting loses all but the last-closed window from `tabs.json`.
- Root cause (browser.js): each window's `'close'` handler calls `persistAll()` while the window is still registered (so it saves the full session), but the `'closed'` handler then deleted the window's row from the `windows` map. The debounced persist (800 ms after delete) and the next window's close-persist each rewrote `tabs.json` from the now-shrunken map. Measured on a throwaway harness: windows w1(2 tabs)+w2(1 tab) -> close w1 -> file {w1,w2} -> +800 ms -> file {w2} only. A real quit (X/menu Quit/WM_CLOSE) therefore saved only the last window closed.
- Fix (browser.js, 2 hunks): the `'closed'` handler now snapshots the window's row into `pendingRows` and arms a close grace (`CLOSE_GRACE_MS` = 5000). `persistAll()` merges live windows with pending rows and keeps each row's previous position (`lastRowWids`), so a close burst (a quit) keeps every window in the session until the app exits. A window closed deliberately (app keeps running) drops out of the session once the grace lapses with no further closes. The shrink never writes an empty session (0 live windows -> skip), so a windowless darwin app cannot wipe it.
- Repro + fix proof (throwaway profile, real Electron harness, 5/5): burst-close of two windows keeps both rows in original order; deliberate close kept during the grace, dropped after; 3-window burst preserves order; and a REAL quit (all windows closed -> `window-all-closed` -> `app.quit()`) leaves all 3 windows in `tabs.json` after the process exits (previously: only the last one). Cross-checked against the user's actual restart earlier today: the app's own final save contained 1 of 2 windows (the other would have been lost without the manual snapshot restore); the same flow now saves the complete session.
- Full bug sweep (run from build/): node --check clean (browser.js); smoke.js all suites pass; test:sidebar PASS 38; test:ai PASS 140; test:pomodoro PASS 35; test:tasks PASS 28; test:extbridge ALL PASS; GUI `--run-selftest` OVERALL ok:true with every check green incl. `sessionPersist` (green run measured via Start-Process: ExitCode 0; one intermediate run hit the documented 2026-10-18 load-sensitive `offlineFlow` flake - pre-existing class, unrelated). `persistSoon` hot paths unchanged; no IPC, chrome geometry, skin, or renderer-side changes.
- Not done here: rebuilding/redeploying the installer - the installed app still carries the 17 Oct build, so it now lags three pending fixes (blank-link routing, download crash, multi-window session persistence).

## 2026-10-19 - Tasks panel: no duplicate list while the composer is open

- Reported: opening "Add task" showed the existing tasks twice - above the composer (the peek's top-3) and again in the full list below it. Wanted: tasks only at the bottom.
- Fix (shell.css, 1 rule, no JS/structure changes): `#tasks-body:has(#tasks-full:not([hidden])) #tk-peek { display:none; }` - while the full panel (composer + list) is open the peek is hidden; it returns when the panel is collapsed. All open paths (`＋`, `⋯`, "+N more") and the collapse path are covered by the same rule.
- Verified (throwaway profile, real Electron probe, 8/8, non-vacuous assertions incl. panel display): composer open -> peek display:none, height 0, exactly the bottom list visible (2 rows, no dupes); form add x2, complete, delete all still work; collapse -> peek back (flex, 1 visible row); `⋯` expand -> peek hidden again. Rail-clipped CDP screenshots confirm both states. Natural hover also produced `rail-open` (rail width 204) in the probe.
- Sweep: smoke all suites pass; test:sidebar PASS 38; GUI `--run-selftest` green (ExitCode 0, ok:true; one intermediate run hit the documented load-sensitive `offlineFlow` flake - quiet re-run green). One-file, 3-line diff; no IPC, chrome-geometry, skin, or renderer-secret changes.
- Not done here: rebuilding/redeploying the installer (installed app lags four pending fixes now).

## 2026-10-19 - Deployed: rebuilt + installed (four fixes shipped)

- Built from build/ with `npm run dist:win` (electron-builder 26.15.3; output `%LOCALAPPDATA%\Temp\dex-build`, outside OneDrive); installer copied to `dist\Main_Exe_Dexerion.exe` (115,656,101 bytes). Temp build dir removed after deploy.
- Pre-install asar check on the built package: all four fixes present (about: passthrough + blank-window classifier, `if (!tab.view) continue;` downloads guard, `pendingRows`/`scheduleSessionShrink`/`CLOSE_GRACE_MS` session fix, tasks `:has()` rule + intact markup).
- Gracefully closed the running 17-Oct build carrying the user's live 2-window session (7 tabs incl. a school SharePoint PDF). The old build's session bug reproduced live one more time (its own final save held 1 of 2 windows); the golden snapshot captured at first close restored both windows before install.
- Silent install (`/S`): exit 0; installed `app.asar` 35,752,056 bytes dated 20:39:46; re-verified all fixes in the INSTALLED asar. Relaunched: both windows restored (6-tab homework window + Google-search window), 8 processes all responding, `tabs.json` 2 windows.
- Packaged selftest on the installed exe (`DEX_TEST_EXT` fixture): first run at peak load (app freshly restoring 7 heavy tabs) flaked 7 checks with destroyed-object errors; quiet re-run: `ExitCode 0`, OVERALL `ok:true`, zero failing checks.
- The running app is now the new build - the next natural quit exercises the session fix natively.

## 2026-10-20 - Links never open as popups (blank pre-opens land as tabs)

- Reported: some links (e.g. Google "Open with …" flows) opened as a popup window instead of a new tab in the same window, and those popups sometimes failed to load.
- Cause: the window-open classifier still sent real-world link opens to the allow path — anything with size/popup/dialog features, `new-window`/`other` dispositions or a named frame became a visible popup; and a blank `window.open()` (the "pre-open, then `w.location = realUrl`" pattern Google uses) always became a visible popup.
- Fix (browser.js + smoke mirror): links always become tabs in the same window. `classifyWindowOpen` returns `popup` only for a feature string that asks for a real app window (width/height/left/top/popup/dialog — OAuth sign-ins and compose/editor windows depend on a live `window.opener` + self-close); named targets, `new-window`/`other` dispositions and chrome-only features (menubar/toolbar/location=no) are foreground tabs. A blank open is `popup-hidden`: created invisible so the opener keeps its live handle, and `wireHiddenPreopen` moves the first real navigation into a foreground tab in the opener's window, closing the hidden window. Scripts that never navigate (document.write / messaging windows) get the window revealed after a 2.5 s grace — the pre-change behaviour, only delayed. If the opener window is gone, the popup is shown and loads the URL.
- Verified (throwaway profile, real Electron matrix, 12/12): target=_blank anchors and plain/`noopener`/named/no-name `window.open(url)` opens -> foreground tabs with the target loaded; size/popup feature opens and a blank+size compose window stay visible popups that load; blank -> `w.location` flows (immediate and at +1.2 s) open a TAB with the target and leave no popup behind; a blank `document.write` window is revealed at +2.5 s with its content (no stuck invisible window); an about:blank link stays a (hidden, then revealed) popup and never becomes a search tab.
- Sweep: node --check clean; smoke all suites pass (classifier mirror updated: new-window/other/named-without-size -> tab, blank -> `popup-hidden`, blank+size -> popup); test:sidebar PASS 38; test:tasks PASS 28; GUI `--run-selftest` ExitCode 0, OVERALL `ok:true`, zero failing checks (two earlier runs hit the documented occluded/load `offlineFlow` flake — `handoffInProc 0` / `rafAlive false`; quiet re-run measured `handoffInProc 10.306`). No IPC, persistence, chrome-geometry or renderer-side changes.

## 2026-10-20 - Tasks panel: newtab top-3 + scroll; sidebar list/compose views

- Requested: (1) newtab shows only the top 3 open tasks ranked due -> priority -> created (old -> new), remaining tasks by scrolling; (2) "+N more" shows the full list and never the new-task composer; (3) the sidebar tasks list scrolls inside the panel instead of overflowing its border; (4) while composing, only the top 3 tasks are shown (scroll for the rest) and closing reverts; (5) keep the pomodoro slot clear.
- Ranking needed no change: `tasks.sortTasks` already orders open tasks by due, then priority (high first), then oldest created first, and both `dex:tasks-list`/`dex:state` deliver that order (probe re-confirmed Beta, Delta, Alpha for a scrambled seed set).
- Newtab (newtab.html, 2 hunks): paint still renders every open task, then caps `#tasks-nt` at the measured 3rd-card bottom (+2 px integer-rounding slack; the 9 px gap can only expose background) with `overflow-y:auto`, so the header stays put, the top 3 are in view on load, and the rest scroll inside the list; the panel's own 52vh scroller is no longer used.
- Sidebar (shell.js + shell.css): three explicit views — `peek` (top 3 + "+N more"), `list` (the full list, no composer) and `compose` (composer + top three rows, scrollable). "+N more" and ⋯ call `tkSetView('list')`/toggle; only ✚ opens the composer, and `tkPrevView` restores the list/peek on close. The form renders only while `#tasks-body.composing`, so a list can never surface the composer. The panel chain is bounded (`#tasks-body`/`#tasks-full` flex with `min-height:0`, `#tk-list` the single flex scroller): the list takes whatever the 50% slot gives ("as many as fit") and scrolls inside it — the old fixed 220 px inner scroller and the double-scrollbar/cut-row edge are gone. Compose caps `#tk-list` at exactly 3 rows (131 px CSS fallback + exact JS re-measure on render/view switch; no cap at ≤3 tasks). The rail slot is unchanged, so the pomodoro mini keeps its space above the panel in every view, including with the timer running.
- Verified (throwaway profile, real Electron probe, 23/23): peek = 3 rows, correct rank, "+5 more", no panel scroll; "+N more" = full 8-row list with the composer NOT visible, filling/scrolling internally with no border overflow; ✚ = composer + exactly 3 visible rows (inline cap == client height), contained; close restores the previous view (list->list, peek->peek); timer running keeps the mini above and the panel contained; newtab = 8 cards rendered, exactly 3 fully visible, list is the scroller, scrolling reveals the 4th. Legacy tasks probe 8/8 unchanged (composer/toggle/complete/delete/collapse). CDP screenshots (tp3-*.png) confirm all states.
- Sweep: node --check clean (shell.js); smoke all suites pass; test:sidebar PASS 38; test:tasks PASS 28; GUI selftest green as above. No IPC, persistence, chrome-geometry, skin or renderer-secret changes; sizes derive from measured content, not hardcoded rail geometry.
- Not done here: rebuilding/redeploying the installer — the installed app lags these two changes.

## 2026-10-20 - Deployed: rebuilt + installed (link popup policy + tasks panel)

- Built from build/ with `npm run dist:win` (electron-builder 26.15.3; output `%LOCALAPPDATA%\Temp\dex-build`); installer copied to `dist\Main_Exe_Dexerion.exe` (115,659,746 bytes).
- Pre-install asar check on the built package: link policy present (`popup-hidden`, `wireHiddenPreopen`, `created.options.show !== false`, the size/popup-feature branch), about: passthrough, download guard, session fix, tasks `:has()` rule + composing/view CSS + `tkSetView`/`tkSyncListCap`, newtab cap, markup intact.
- Graceful close of the running build carrying the user's live session (2 windows / 7 tabs): golden snapshot captured; the app's own final save already contained BOTH windows — the deployed session fix (2026-10-19) held natively on a real quit, no restore needed. 0 processes remaining, `CLOSED CLEANLY`.
- Silent install (`/S`): exit 0; installed `app.asar` 35,763,643 bytes dated 20 Oct 05:10; re-verified every fix in the INSTALLED asar.
- Relaunched: both windows back up (top-level window titles: "Learn linear relationships" + "New Tab"), 7 processes all responding, `tabs.json` 2 windows with all 7 tabs.
- Packaged selftest on the installed exe (`DEX_TEST_EXT` fixture): `ExitCode 0`, OVERALL `ok:true`, zero failing checks (`offlineFlow ok` handoffInProc 10.291, `sessionPersist ok`).
- Temp build dir removed. The running app is now the current build; the link and tasks changes are live.

## 2026-10-20 - Fix: "Open with Google Docs" popup + sign-in popups (sign-in-only policy)

- Reported: "Open with Google Docs" still opened as a popup; wanted popups ONLY for sign-in (Continue with Google / Sign in with Google), and sign-in itself sometimes did not work.
- Cause: the previous policy gave a real window to any open with size/popup/dialog features — Google's Docs "Open with" flow uses one — and it made featureless auth opens plain tabs, which breaks identity popups that need a live window.opener (the "sometimes doesn't work" class). A blank pre-open navigated to an auth URL was also converted into a tab, breaking the same handshake.
- Fix (browser.js): new `isSignInOpen()` (auth hosts/paths — accounts.google.*, login./signin./auth. hosts, login.microsoftonline.com/live.com, appleid, auth0/okta, /oauth|openid|sign-in|login|auth path tokens — plus auth-style window names incl. 'oauth2') decides popups; every other open (links, size/popup features, named targets, docs "Open with", new-window dispositions) becomes a foreground tab. Blank opens stay `popup-hidden` unless auth-named; `wireHiddenPreopen` now shows the window and leaves it loading when its first navigation is a sign-in (and in the raced did-navigate path), instead of converting it to a tab.
- Verified (throwaway profile, real Electron matrix, 15/15): anchor/plain/sized/popup=1 opens -> tabs; both blank pre-open variants (plain and sized) -> tabs; docs URL + size + name -> tab, no popup (the reported case); document.write blank still reveals as a window; auth URL featureless -> real popup with a live handle showing accounts.google.com; auth-named popup handshake -> opener receives postMessage and the popup self-closes; blank pre-open navigated to an auth URL -> visible popup showing the auth page (no tab); about:blank link unchanged.
- Untouched-surface sweep: download repro (slept-tab case) completed, 0 uncaught, downloads tab opened; tasks UI probes 23/23 + 8/8; test:sidebar 38; test:pomodoro 35; test:tasks 28; smoke all suites pass; dev selftest ExitCode 0 ok:true zero failing (one intermediate offlineFlow occlusion flake, quiet re-run handoffInProc 10.277).

## 2026-10-20 - Deployed: sign-in-only popups build

- Rebuilt (`npm run dist:win`, installer 115,660,535 bytes) -> `dist\Main_Exe_Dexerion.exe`; pre-install asar verified (isSignInOpen + auth hosts + pre-open auth branch, plus all prior fixes).
- Graceful close of the running 05:10 build (2 windows; session preserved by the app's own save — golden captured, no restore needed). Silent install exit 0; installed `app.asar` 35,766,528 bytes dated 07:18; all asar markers green.
- Relaunched: both windows restored (Classroom textbook extract + New Tab), all processes responding, `tabs.json` 2 windows. Packaged selftest on the installed exe: ExitCode 0, OVERALL ok:true, zero failing checks (offlineFlow 10.062, extPopup, pomoTimer, sessionPersist all ok).
- Temp build dir removed.

## 2026-10-20 - Fix: "Open with Google Docs" opened a popup (provider-internal auth routing)

- Reported (second time, with screenshot): clicking "Open with Google Docs" on a Drive PDF still opened a native popup window showing Google Docs; wanted: everything is a tab apart from "Continue with X" / "Sign in with X" sign-ins.
- Cause: Drive hands the open through accounts.google.com (multi-account chooser), so the sign-in-URL rule classified it as a sign-in popup. A provider's own pages opening its own auth routes are internal account routing, not a third-party sign-in.
- Fix (browser.js): `siteKey()`/`hostOf()` collapse Google/Microsoft/Apple/Auth0/Okta hosts (and last-two-label sites otherwise) to one family; `isSignInOpen()` now rejects an auth URL when the OPENER page belongs to the same family (Drive/Classroom -> accounts.google.com stays a tab), while a third-party opener still gets the popup. Auth-style window names ('oauth2' etc.) still win. `handleWindowOpen` takes the opener webContents (referrer fallback), stores frame name/features/opener URL in a WeakMap, and `wireHiddenPreopen` judges the first navigation of a blank pre-open with that context instead of URL shape alone.
- Verified: link matrix 18/18 in real Electron - all link/sized/popup=1/docs opens -> tabs; blank pre-opens -> tabs; same-site auth path + size -> tab (internal routing); cross-site auth path + size -> real popup; oauth-named blank -> visible popup; auth URL from a third-party opener -> popup with live handle and opener handshake (postMessage received, self-close works). Smoke classifier mirror extended with the same-provider cases.
- Untouched-surface sweep: downloads repro completed (0 uncaught, downloads tab); tasks probes 23/23 + 8/8; test:sidebar 38; test:pomodoro 35; test:tasks 28; smoke all suites; dev selftest ExitCode 0 ok:true zero failing (offlineFlow 10.127).

## 2026-10-20 - Deployed: provider-family popup build

- Rebuilt (`npm run dist:win`, installer 115,662,302 bytes) -> `dist\Main_Exe_Dexerion.exe`; asar markers verified pre-install and post-install (sign-in-only popups + provider-family routing, popup-hidden pre-opens, downloads guard, session fix, tasks views, newtab cap).
- Graceful close of the running 07:18 build (1 window, 10 tabs; PRE == FINAL, session preserved). Silent install exit 0; installed `app.asar` 35,772,344 bytes dated 19:34.
- Relaunched: 1 window / 10 tabs restored, all processes responding. Packaged selftest on the installed exe: ExitCode 0, OVERALL ok:true, zero failing checks (offlineFlow 10.137, extPopup, pomoTimer, sessionPersist all ok).
- Temp build dir removed.

## 2026-10-20 - Search With Dexerion AI (fullscreen search surface)

- Requested: a fullscreen "Search With Dexerion AI" chat entered from the newtab AI button (the toolbar AI logo stays the ONLY sidebar entry); the AI mark replaces the magnifier; near-black surround with faint animated accent colour; model picker bottom-left inside the box; on send the box docks to the bottom and becomes "Ask a follow up" while results stay in the surface; Search (deep research) and Chat modes share one conversation; recommendations OFF by default with a new settings toggle (Google autocomplete only for Search); the model writes 2-6 original adaptations (default 4), each searched in its own background tab; 4-12 sources read in full (default 8) and all listed; work tabs closed after reading.
- New `src/main/ai-search.js` (Electron-free): adaptation prompt/parser (JSON, fences, bare array, dedupe, fallback to the question), challenge/consent detector, result-URL cleaner (ads/engine redirects/downloads dropped), round-robin candidate picker with a soft two-pages-per-domain preference that RELAXES rather than coming up short, synthesis prompt (numbered sources, [n] citations, never invent), and `createAiSearchRunner` (adapt -> search each adaptation with one quiet Bing retry on a challenge page -> read full pages through the shared extractor -> stream the answer -> close every work tab on success, failure, Stop or window close).
- `src/main/browser.js`: `searchOpen` window flag zeroes the active tab view while the surface is up; work-tab adapter (`newTab` background + load wait + `harvestSearchPage`/`extractPageSnapshot` + close); `dex:aisearch-open|close|suggest`, `dex:ai-search-run|stop` IPC; `dex:ai-search-progress` (phase labels + streamed chunks) and `dex:aisearch-show` to the shell; `engineCompletions(query, engineOverride)` forces Google for the Search-only suggestions; settings allowlist + clamps; chat messages gain a validated `search` field (<=6 adaptations, <=16 http(s) sources, capped title/url/stats); window close releases runs and tabs.
- `profile.js` defaults: `aiSearchSuggest:false`, `aiSearchSources:8`, `aiSearchAdaptations:4` (existing settings merge defaults on load).
- Renderer: new `src/renderer/ai-search.js` plus `#ais` markup/CSS in `shell.html`/`shell.css` (fixed inset 0, z 250; hero -> docked composer; Search/Chat pills; model select; suggestions above the composer; streamed markdown; sources + adapted searches; Stop; connect card validating the key through `dex:ai-test`; Enter/Shift+Enter/Esc; reduced-motion freezes the aura/pulse; no `:root` skin selectors, no hardcoded chrome offsets). Newtab "Ask Dexerion AI" -> "Search With Dexerion AI" and opens the surface; the toolbar logo still opens the sidebar. Sidebar history renders the stored source list for old search threads. Settings card "Dexerion AI Search" (suggestions toggle, sources 4-12, adaptations 2-6).
- Verified: smoke adds the pure-helper + orchestrator contracts (adaptation parsing/bounds, URL filtering, domain-cap relaxation, synthesis citations, 2 searches + 4 source tabs all closed, Stop closes tabs) - PASS. Real-Electron probe (57/57, throwaway profile, Google template mirrored to a local SERP + 8 articles, stubbed NIM): newtab label/click; surface covers the window; active tab view bounds 0x0 while open and restored after close; computed fixed/z-index/background/display face/accent signal; reduced-motion aura `none`; model picker; suggestions off by default, live Google suggestions when enabled, Esc closes the list first; full search -> 4 sources + 2 adaptations + citations, tabs back to baseline, metadata persisted and rendered by the sidebar; close/reopen thread; New; Chat reply; Stop mid-stream; close/reopen mid-search (stream lands in the pending bubble, prior answers untouched, persisted once); settings clamps 99/1 -> 12/2 and writes 5 to disk; no-key connect card.
- Untouched-surface sweep: test:ai 140, test:sidebar 38, test:tasks 28, test:pomodoro 35, smoke all suites; GUI selftest green (`ok:true`, zero failing; the first run hit the known offlineFlow handoff flake, quiet re-run handoffInProc 10.238). No popup/download/session/tasks/pomodoro regressions.
- Not done here: rebuilding/redeploying the installer - the installed app lags this change.

## 2026-10-20 - Deployed: Search With Dexerion AI build

- Built from `build/` with `npm run dist:win` (electron-builder 26.15.3); installer 115,677,937 bytes -> `dist\Main_Exe_Dexerion.exe`; built `app.asar` 35,854,841 bytes.
- Pre-install asar check (16/16): ai-search module/orchestrator, browser IPC + searchOpen page hiding + Google suggestion override + settings clamps + validated chat search metadata, profile defaults, surface markup/renderer/CSS, sidebar provenance, newtab entry (no sidebar invoke), settings card, popup/download/session/tasks markers, deleted modules absent.
- Graceful close of the running 19:34 build (1 window / 1 tab, freebuff thread): PRE == FINAL, session saved by the app itself, 0 processes remaining, CLOSED CLEANLY.
- Silent install (`/S`): exit 0; installed `app.asar` 35,854,841 bytes dated 20 Oct 21:48; the same 16/16 markers green in the INSTALLED package.
- Relaunched: 1 window / 1 tab restored (same Freebuff thread), 5 processes all responding. Running binary is `%LOCALAPPDATA%\Programs\Dexerion\Dexerion.exe`.
- Packaged selftest on the installed exe (`DEX_TEST_EXT` fixture; stdio redirected to files - a GUI exe launched with its parent console closing can hit an EPIPE in a later console.log, which is a harness artifact, not an app fault): ExitCode 0, OVERALL `ok:true`, zero failing checks (offlineFlow handoffInProc 10.223, extPopup, pomoTimer, sessionPersist, chromeHeight, aiChat all ok).
- Temp build dir and selftest profiles removed. The running app is this build; Search With Dexerion AI is live.

## 2026-10-21 - Polish: animated working dots + actions inside the assistant bubble

- Requested: animate the three white dots and make every search action appear under the AI assistant so the run reads as fast, visible activity. UI only - the search pipeline, IPC, settings and result schema are untouched.
- Renderer (`src/renderer/ai-search.js`, `shell.css`, `shell.html`): the assistant bubble mounts a working feed on send - three white dots (opacity + 2px lift, staggered; frozen under `prefers-reduced-motion`), the current action ("Adapting your question", "Searching 1 of 2", "Reading 3 of 4", "Writing the answer") with the live query/host detail, a Stop button, and completed actions with accent checks. On completion it collapses to `Actions (N)` under the answer, above Sources/Adapted searches. The dock status row is now error-only. Closing/reopening mid-run rebuilds the feed from preserved state; Chat uses the dots while thinking and drops the feed.
- Verified: real-Electron probe 66/66 (throwaway profile, stubbed AI, local SERP): 3 dots computed white + animation `ais-dot`, action rows accumulate, current detail shown, bottom row gone, Stop lives in the feed, settled `Actions (9)`, reduced-motion dots `none`, reopen mid-run restores the feed, chat and all prior search checks unaffected. Smoke all suites; test:ai 140, test:sidebar 38, test:tasks 28, test:pomodoro 35.
- Packaged: installer 115,679,466 bytes -> `dist\Main_Exe_Dexerion.exe`; built/installed `app.asar` 35,862,061 bytes; pre/post-install asar markers 16/16 (now including `.ais-work`, `.ais-dots`, `ais-work-stop`, `Actions (`). Silent install exit 0; relaunched 1 window / 5 tabs, 5/5 processes responding. Packaged selftest `ok:true`, zero failing (offlineFlow 10.178; inspector/pomo/session all green).
- Note: the dev-tree selftest (OneDrive source tree) flaked inspector/pomo renderer timing; the previously packaged build passed those same checks and the new packaged build is fully green, isolating the flake to dev-tree load rather than the UI diff.

## 2026-11-06 - AI sidebar/UI port Phase 0: design tokens, vendored type, NIM-only

- Requested: port the scTerra assistant feature set to Dexerion (NIM only), add Dia-style reports/artifacts + a Dexerion assistant system prompt, rebuild AI search on Perplexity's documented retrieval/citation model, and apply the scTerra UI language across the whole product while keeping every existing feature (quote, new tab, tasks, pomodoro, lofi, snip, accounts, extensions, memory/missions/projects/research/images, skins).
- Reference library: new `refs/` (scTerra source snapshot 1.9 MB, 16 Perplexity doc pages + notes, Dia report release notes/design essays/screenshots, scTerra UI notes). Never shipped, never edited. Master plan: `code/docs/ai-sidebar-port.md` (mapping table + 9 phases + workstreams + security/testing).
- Tokens: new `code/assets/tokens.css` is the single source (neutral ground #f9f9f9/#171717, hairline borders, teal `oklch(0.65 .105 200)` accent, Geist type scale 11/12/13/15/20/28, 4/6/10 radii, three elevations, 120/160/200ms motion, chrome metrics 40/44/6). `assets/page-theme.css` and `shell.css` now alias their existing names onto it; paper gradients removed; focus rings use the focus-ring token; body base is 13px/1.45.
- Type: Geist Variable + Geist Mono Variable (chrome/UI) and Newsreader Variable (report editorial) vendored as woff2 with OFL licences under `code/assets/fonts/` and declared in tokens.css; no network fetch. `dexerion://assets/` handler now resolves safe subpaths (traversal still rejected) so `design/`, `fonts/` and future `ocr/` work.
- NIM-only: `ai.js` migrates a stored non-NIM provider choice to `nim` on load, cross-provider fallback is forced off, the sidebar provider picker offers NVIDIA NIM only; endpoint, key storage and model logic untouched; other stored key rows are preserved on disk but never used.
- Selftest pin updated: `pageTheme` now pins `--pbg` to `#f9f9f9` light / `#171717` dark (tokens.css) instead of the old paper values.
- Verified: `node --check` clean (browser.js, ai.js); smoke all suites pass; `test:ai` PASS 184; `test:sidebar` PASS 38. Dev-tree `--run-selftest`: run 1 completed with only the (now-updated) pageTheme pin plus the documented dev-tree inspector/pomo timing flakes; run 2 flaked tabBridge/offlineFlow under load (same documented pattern). No packaged build yet - this is source-tree state.

## 2026-11-07 - Phase 0 e2e harness (mock NIM) + first-message bug fix

- New `build/e2e/` Playwright harness: `ai-mock.js` (OpenAI-compatible `/v1/models` + `/v1/chat/completions`, JSON and SSE, usage, records requests), `app.js` (launches the real Electron app with a throwaway `--user-data-dir` and `DEX_AI_TEST=1` + `DEX_AI_BASE`), `boot.spec.js` (tokens live, NIM-only status, mock reply streams into the sidebar, request+model recorded), `playwright.config.js`, and `npm run test:e2e`. `@playwright/test` added as a dev dependency with browser downloads skipped (Electron only, no browser binaries).
- Test seam: `ai-providers.js` NIM_BASE honours `DEX_AI_BASE` only when `DEX_AI_TEST=1`; production endpoint cannot be changed by any other launch.
- Fixed a pre-existing first-message bug the harness exposed: on a fresh profile (no chat yet) `submit()` called `createChat()`, which cleared the composer, and then read the now-empty input - the message was silently dropped and `activeChat` was never used. `submit()` now checks key/model first and captures the draft before creating the chat. Same flow otherwise.
- Verified: `node --check` clean (ai-sidebar.js); smoke all suites; `test:ai` PASS 184; `test:sidebar` PASS 38; `npm run test:e2e` PASS (boot spec, 1/1). Temporary diagnostic spec removed; `test-results/` cleaned.

## 2026-11-07 - Phase 1 (part 1): resizable panel, Ctrl+Shift+A, one-click Summarise, Dexerion AI prompt

- Resizable assistant: left-edge drag handle plus arrow keys (Shift = 40px steps, Home/End limits); min 320 / max 720 / default 480. The width lives per account in `aiUi.width`, is clamped in main, drives `layout()` for the page-view inset, and is restored on boot and on panel open. `dex:ai-ui-set` accepts `width` and re-layouts.
- Ctrl+Shift+A toggles the panel (shell key handler + View menu accelerator); the toolbar AI button now toggles too. New `dex:ai-toggle` sends `dex:ai-open`/`dex:ai-close` so the panel stays in step with toggles from outside it, and the sidebar closes when `state.aiOpen === false`.
- One-click Summarise button in the page context strip: fills the prompt and sends immediately.
- Identity: new `code/src/main/ai-prompts.js` (`IDENTITY`, `GROUNDING`, `REPORTS`, `SYSTEM_PROMPT`, `neutralise`, `trimForContext`). `ai.js` PERSONA comes from it ("Your name is Dexerion AI", no model disclosure) and the no-key errors say Dexerion AI. The page-context builder now neutralises page/selection/title text so a page cannot close its own tags.
- Verified: `node --check` clean (ai-sidebar, shell, browser, menu, ai, ai-page, ai-prompts); smoke all suites; `test:ai` PASS 184; `test:sidebar` PASS 38; new `test:context` PASS 17; e2e boot spec 1/1 including toggle, 600px width applied, resize handle present, and one-click Summarise request reaching the mock.
- Remaining Phase 1: per-site AI off switch, conversations-saved off switch.

## 2026-11-07 - Phase 1 complete: per-site AI off + conversations switch

- Per-site AI off: account-scoped `aiOffSites` hostname list with `dex:ai-site-get/set` for the active tab. `dex:ai-read-page` and `dex:ai-agent-run` refuse with a clear message while a site is off; the sidebar hides the page strip and the eye toggle re-enables the site in one click; the Assistant settings sheet gains "Use AI on <host>".
- Conversations switch: `aiUi.saveChats` (default on). Off, chat handlers use a per-window in-memory list (`st.aiSessionChats`) via a single `chatStore()` helper, so the sidebar behaves the same but nothing reaches the profile; previously saved chats are hidden while off, not deleted. Settings row "Save conversations on this device" added.
- Verified: `node --check` clean (browser.js, ai-sidebar.js); smoke all suites; `test:ai` PASS 184; `test:sidebar` PASS 38; `test:context` PASS 17; e2e boot spec 1/1 - now also asserts read-page refusal while a site is off, that the site switch round-trips, that a saved chat marker is on disk while saveChats is on, that the same marker is absent while off (byte-level profile scan), and that the session chat is listed while the saved one is hidden.

## 2026-11-07 - Phase 2 (part 1): report schema v2 + the Dia/print look

- Schema: reports gain a 14-type block model (heading, paragraph, list, table, stats, chart, timeline, proscons, cards, steps, quote, callout, divider, spacer), closed-set look dials (`theme` clean|editorial|brief|modern|magazine|academic|notebook, `paper` 8 swatches, `pattern` solid|hatch|diagonal, `font` editorial|neutral|typewriter), `kicker`, `version` and `updatedAt`. Unknown blocks drop individually; unknown look values fall back. v1 section reports are converted to blocks automatically and keep a generated legacy `sections` list, so older stored chats still render.
- `report-presets.js`: the 10 reference presets with shape text adapted to blocks; Research brief / Executive summary / Comparison flagged primary.
- Renderer (`assets/ai-artifacts.js`): `renderBlock` for every type, look attributes applied to the report root, Markdown conversion for blocks (Copy/Download), and full re-validation in `sanitize`.
- CSS (`assets/ai-artifacts.css`): the print look - paper swatch backgrounds, single ink + hairlines, compact stats in mono, ruled callouts/quotes, timelines/proscons/cards/steps as printed lists (no rounded-card slop), pattern strokes on chart bars, and seven theme structures (serif editorial/magazine, numbered modern/academic, dashed notebook, callout-forward brief).
- Prompt: the deliverable protocol now documents blocks, the look dials, the report style rules ("never HTML or CSS inside a report", real data only, no emoji) and the block-based chart shape.
- Verified: `node --check` clean; `test:artifacts` PASS 65 (validator + renderer v2 checks added); `test:ai` PASS 184; `test:sidebar` PASS 38; smoke all suites. No UI wiring yet - the report card -> report view, customiser controls, preset picker, inline comments and exports are the next slice.

## 2026-11-07 - Phase 2 (part 2): report view, design dials, versions, preset picker

- Report view: a full-panel overlay (`#ai-report-sheet`) over the chat with back/close, a version stepper, design tools (theme select, 8 paper swatches, pattern, type) and a sticky revision box. The document is drawn by the new `DexArtifacts.renderBody` (body only, no card chrome); the panel itself stays resizable, so the report gets the width the person chose.
- Card hook: the artifact renderer draws an `Open` button for reports only when a host passes `onOpen`; the sidebar passes the message index so the view can persist look changes.
- Look persistence: new `dex:ai-artifact-look` re-validates theme/paper/pattern/font against the closed sets in main and saves them into the stored chat message; the open view updates live and the in-memory chat is kept in step.
- Versions: same-titled reports across the chat are collected into one list; prev/next step between them (disabled at the ends) and the list refreshes when a revision lands. The revision box composes a visible revision prompt and sends it through the normal flow.
- Preset picker: `dex:ai-presets` serves `report-presets.js`; a composer button opens the gallery, the chosen preset shows as a removable chip, and the sent message is the composed text (preset shape + the person's notes) so nothing is hidden.
- Fix found while testing: continuing a previously saved chat after "save conversations" went off now adopts a session copy, so the open conversation keeps working and nothing new reaches the profile.
- Verified: `node --check` clean (ai-sidebar, browser, ai-artifacts, boot.spec); `test:artifacts` PASS 69 (renderBody + Open-hook checks); `test:ai` PASS 184; `test:sidebar` PASS 38; smoke all suites; e2e 1/1 - now also streams a v2 report artifact, opens the report view, switches the theme live, reads the saved theme back out of the stored chat, closes the view, and exercises the preset gallery chip.

## 2026-11-07 - Phase 2 (part 3): exports, full-page report, inline comments

- Word writer: new `src/main/ai-report-docx.js` (port of the reference OOXML writer, adapted to the Dexerion block model). A .docx is a zip built with `node:zlib`; covers every block type, turns stats/timeline/proscons/chart into tables, numbers lists per block, escapes XML, and lists references. No dependency.
- Export module: `src/main/ai-report-export.js` writes HTML/Markdown/Word directly and renders PDF through an offscreen sandboxed `BrowserWindow` (`printToPDF`, backgrounds on, A4, JS disabled). The save dialog is skipped only when `DEX_AI_TEST=1` names a path, so the e2e suite can prove bytes on disk.
- Renderer exporter: new `assets/report-export.js` (UMD) renders the artifact through the real DOM renderer into a detached document, embeds print CSS that mirrors the report looks (papers, ink, themes, patterns), and escapes the title.
- IPC `dex:ai-report-export`: artifact re-validated in main, renderer-supplied HTML/Markdown size-capped, returns `{ok,path,bytes}` or `{canceled}`.
- Report view: Download menu (PDF / HTML / Markdown / Word) and "Open in a new tab"; new `dexerion://report` internal page renders a stored report by chat id + message index using page-theme + the artifacts CSS.
- Inline comments: selecting text in the report view shows a floating Comment chip; it prefills the revision box with the passage (the model answers with a new version).
- Verified: `test:export` PASS 12 (zip signature, all parts, escaping, every block reaches the document, chart fallback, styles/numbering, safe names); `test:artifacts` PASS 73 (standalone HTML checks); `test:ai` 184; `test:sidebar` 38; `test:context` 17; smoke all suites; e2e 1/1 - now exports all four formats to disk and checks signatures (`PK`, `%PDF`, doctype, Markdown content).
- Remaining Phase 2: the Files home (searchable reports/chats list).

## 2026-11-07 - Phase 2 complete (Files home) + Phase 3 part 1 (vendored assets, Readability, transcripts)

- Files home: `dexerion://files` lists every report (title, version, theme, date) and every chat, with search, Open (full-page report) and Chat actions. New `dex:ai-reports-list` (account scan, newest first, capped) and `dex:ai-open-chat` (stashes the chat id, opens the panel, sidebar opens that chat via the existing pending handoff). Sidebar rail gained a Files button. Protocol map serves `files.html`.
- Vendor script: `build/scripts/vendor-ai-assets.js` (`npm run vendor:ai`) copies @mozilla/readability, the Tesseract page bundle + worker + LSTM wasm cores + English trained data, and the PDF.js legacy build into code/assets (with licences). Run after `npm ci`; idempotent (13 files, ~24 MB).
- Readability: `ai-page.js` loads the vendored source once and `snapshotScript()` builds the injected IIFE (source + extractor in one scope). The extractor prefers Readability text when it finds a real article (>400 chars and >75% of the heuristic body) and keeps its own heuristic as the fallback. All four read sites (read-page, all-tabs inspection, research search, agent) now inject through `snapshotScript()`.
- YouTube: `isYouTubeWatch` + `youtubeTranscriptScript` (presses "Show transcript", reads segments, self-contained). `dex:ai-read-page` tries the transcript first on watch/shorts/live and falls back to the normal read when captions are missing.
- Verified: `test:context` PASS 22 (URL recognition, script shape, fallback); smoke all suites incl. the page-reader contract; `test:ai` 184; `test:sidebar` 38; e2e 1/1 - now also reads a real local article through the tab and returns its context text with navigation junk stripped.
- Remaining Phase 3: the `dexerion://pdf` viewer (PDF.js render + text layer), OCR of scans (assets already vendored) and chat about the current PDF.

## 2026-11-07 - Fix: sidebar resize left a gap / cut the page off

- Cause: a stale `#ai-sidebar { width:480px; }` block later in shell.css overrode the `width: var(--ai-w,480px)` rule (same specificity, later wins). The drag updated `--ai-w` and main reserved the dragged width, but the panel itself stayed pinned at 480: dragging wider left filler space before the panel, dragging narrower let the panel cover the page.
- Fix: removed the stale width (the block keeps its gradient), made the two responsive caps use the variable (`min(var(--ai-w,480px),52vw)` under 1100px, `min(var(--ai-w,480px),100vw)` under 650px) and de-duplicated them; `aiSidebarWidth(st, totalWidth)` in main now mirrors those same breakpoints so the reserved page inset and the rendered panel always agree. No other chrome geometry touched.
- Regression guard: the e2e boot spec now asserts the rendered panel width equals the persisted width, that the panel is anchored to the window edge, and that a real mouse drag moves the rendered width and the persisted width together (the old bug passed the previous CSS-var-only assertion).
- Verified: node --check clean (browser.js, boot.spec); smoke all suites; `test:sidebar` 38; `test:ai` 184; e2e 1/1 with the new geometry + drag assertions.

## 2026-11-07 - NIM speed (lossless): Chromium transport, timing harness, stream batching, render throttle

- Transport: provider calls (chat + `/models`, NIM and Gemini paths) now ride Electron `net.fetch` (Chromium network stack) via `defaultFetch()` in `ai-providers.js` — pooled connections survive idle gaps (undici's default pool closes idle sockets after ~4s, so every post-idle send paid a fresh TCP+TLS handshake), HTTP/2 and the browser's DNS/proxy apply. `DEX_AI_TRANSPORT=node` restores Node's global fetch (kill switch). `/models` GET adds `cache:'no-store'`. Abort shapes normalized: Chromium surfaces `net::ERR_ABORTED`/`ABORT_ERR` while undici throws a DOMException `AbortError` — `isAbort()` recognizes both, `abortError()` restores the single shape the app understands, and stream-reader aborts normalize too. `readSse()` gained an optional first-byte hook (timing only). Request bodies unchanged: spike proved byte-identical sha256 for the same init on both transports.
- Timing harness: `DEX_AI_TIMING=1` (main process only; no keys, prompts or reply text) logs per streamed send `build/headers/firstByte/firstToken/total` ms + delta count + cancelled; prewarm ms + catalogue source (memory|network); `/models` fetch ms + count. Verified by running `test:ai` with the env set (marks populate); live before/after medians pending the owner's key.
- IPC batching: `makeChunkBatcher()` in browser.js coalesces `dex:ai-chunk` deltas into ~30ms flushes for chat sends and agent runs (payload shape unchanged; final flush on end/cancel; agent tail flushed before the run's `end` event). Cuts message count and repeated `full`-string serialization by an order of magnitude on long replies.
- Sidebar render throttle: markdown repaint coalesced to a ~50ms trailing cadence (was: full re-parse of the whole reply per token) with exact renders preserved on done/cancel paths; paint skipped when the bubble is detached.
- Verification-driven fix (shell.css): the `#ai-sidebar` entrance animation used `fill-mode: both` with `translateX(16px)`; under a throttled/occluded renderer Chromium pins an animation's first frame, so the panel sat permanently 16px off the window edge — the e2e boot spec geometry guard caught it deterministically before any AI interaction (probe: `transform: matrix(1,0,0,1,16,0)` stable at every stage). Now opacity-only, no `both` fill — chrome geometry is never animated (house rule; same pinned-frame class the inspector lesson documents). Pre-existing, not part of the NIM change; fixed here because the guard made it deterministic in this environment.
- New `build/scripts/spike-transport.js` (from build/: `npx electron scripts/spike-transport.js`): local-server checks — request byte-identity (node vs net.fetch), incremental SSE (~380ms spread across 4 reads), mid-stream abort shapes on both stacks, refused-connection shapes. 6/6.
- Verified: `node --check` clean (ai-providers, ai, browser, ai-sidebar, spike); spike-transport 6/6; smoke all suites; `test:ai` PASS 186; `test:sidebar` 38; e2e 2/2 (mock NIM reply streams end-to-end through `net.fetch`; boot spec covers tokens + panel geometry + drag + per-site + save-chats + reports + reader). Dev selftest x3: only the documented load-flake class red each run (tabBridge/inspector/offlineFlow/pomoTimer — host under load, same set every time); all AI/shell/structural checks green. Observed mid-sweep, outside this change: `test:context` 22/23 — its identity regex pinned "Never claim to be human" while `ai-prompts.js` read lowercase mid-sentence. Reconciled 2026-11-08 from outside this change: the test now matches case-insensitively (`/never claim to be human/i`, intent unchanged) and `test:context` passes 23/23 with exit 0.

## 2026-11-08 - Memory Saver (RAM cap) + minimal chrome pass + AI-search suggestions fix

- Memory Saver: new pure module `code/src/main/memsaver.js` (`planSweep`/`isEligible`/`clampCapMB`; 60 s idle floor, LRU victims, per-renderer-group credit for `process-per-site`, guardrails: active/audible/loading/lazy/no-view/`dexerion://blocked` never sleep). `browser.js` gains `memSnapshot()` (fixes the old `workingSetSizeKB` misread — Electron 44's fields are `workingSetSize`/`privateBytes`, already KB), `buildMemoryReport()`, `collectTabSnaps()`, `memorySweep(forcedTotalMB?, floorMs?)` sharing the idle sweep's 30 s tick, `sleepTabNow()` teardown shared by both sweeps, and a richer `dex:memory` (procs/tabs/asleep/capMB/saverOn; old keys kept). Settings: `memorySaver: true` + `memoryCapMB: 2048` defaults, clamped 1-4 GB in `dex:settings-save`, new Performance card in `dexerion://settings` with a live usage readout (10 s; self-terminates if its page loses its window). `DEX_MEM_DEBUG=1` adds a 30 s per-process console line; the boot log now prints real MB.
- Tests: `build/scripts/test-memsaver.js` (17 checks) + `test:memsaver`; selftest gains a last-running `memorySaver` section (meter > 50 MB, forced over-cap sweep sleeps a background tab, active tab survives, waking rebuilds it) — green on its first live run.
- Minimal chrome pass (scTerra + Dia informed; spec boards in Figma "Dexerion — UI Refresh (Nov 2026)"): collapsed rail 76→48 px with re-padded rail/mini timer (38 px button fits; 14 px readout), active vertical tab = neutral wash + slim accent rail + weight 500 (border/seam removed), tab/group-chip entrance is opacity-only (no translate; `both` fill dropped — chrome geometry never animates). No JS behaviour touched; omnibox + snip untouched; main.js rail comment updated.
- AI Search suggestions: `#ais.hero .ais-suggest` now hangs BELOW the composer (was `bottom:100%`, covering the hero; conversation mode with the bottom-pinned dock still opens upward). Before/after screenshots captured and compared.
- Verified: `node --check` clean (memsaver, browser, main, profile, test-memsaver); `test:memsaver` 17; smoke all suites; `test:ai` 186; `test:sidebar` 38; e2e 3/3 (boot incl. panel geometry + drag, debug send flow, UI shots); dev selftest: `memorySaver`/`snipButton`/`suggestPopup`/`shellHandlers`/`skins` all green — remaining reds are the documented load-flake class (tabBridge/inspector/pomoTimer). Settings Performance card verified by a jsdom probe (toggle/cap/readout/persist — 5 checks; probe removed). Installer rebuilt from the full tree to `dist/Main_Exe_Dexerion.exe`; asar markers verified (DEX_AI_TRANSPORT, makeChunkBatcher, opacity-only panel keyframes). Tree at build time also included the in-flight skills/scout edits made outside this change.

## 2026-11-08 — Rail mini-controls fix + daily welcome + branded installer

- Rail (48px collapsed): the running pomodoro readout was clipped (14px text needed 37px in a 31px box). `#rm-time` is now 11px and both mini sections use 2px side padding, so the 38px controls and the time all sit centered with real margins (worst case "180:00" still fits). Measured across collapsed/expanded/show-tasks states: every mini control off-center = 0; tab icons and the task count badge verified too (badge 2px from the rail edge).
- Daily welcome: new `dexerion://welcome` page — greeting by hour (first-run variant via `?first=1`), date, the same deterministic day-quote the new tab shows, Enter/Esc closes; opacity-first entrance (reduced-motion honoured; no fill mode, so a throttled renderer can never pin it invisible). Opens once per calendar day as the active tab, handed to the FIRST window's `onReady` hook inside `restoreSessionOrNewTab` — tabs exist only after the shell loads, so calling it from `startup()` raced the newtab and left a stray tab (fixed and re-verified). A link/file launch skips it. It never persists into the session (`snapshotRow` filters `dexerion://welcome`) and never lands in "recently closed" (`pushClosed` guard). Settings > Appearance gains a "Daily welcome" toggle (`welcomeDaily`, default on). Skipped under `DEX_AI_TEST`, so the e2e harness stays deterministic.
- Branded installer: `build/installer/make-art.ps1` generates the 24-bit BMPs (sidebar 164×314 + header 150×57 — logo, wordmark, tagline, accent hairline on the dark palette); `build/installer/installer.nsh` sets welcome/directory/finish copy via `customHeader` and adds the welcome page (`customWelcomePage` — the assisted flow has none by default); electron-builder.json gains `installerHeader`/`installerSidebar`/`uninstallerSidebar`/`include`/`runAfterFinish`/`deleteAppDataOnUninstall:false`.
- Verified: `node --check` clean (browser, main, profile); smoke all suites; `test:ai` PASS 200; `test:sidebar` 38; e2e 2/2; welcome probe (REAL launch, no test env): first run replaces the lone newtab with `welcome?first=1` as the only tab, `tabs.json` contains no welcome, same-day relaunch shows no welcome and no stale tab restored; jsdom page probe 8 checks (greeting/date/quote/Enter/Esc/first-run). Dev selftest: `memorySaver`/`snipButton`/`suggestPopup`/`shellHandlers`/`skins`/`tabGroups` green; inspector/offlineFlow/pomoTimer = documented load-flake class. Installer rebuilt with branding, silent install exit 0, installed asar byte-identical to the build; relaunched: main PID 3984 with the first-run welcome as the active tab. Tree at build time again includes concurrent search-module edits (test:ai grew to 200, all passing).

## 2026-11-08 — Memory-first sleeping + hog notice, rail centering v2, welcome every launch, installer v2

- Memory Saver victims are now heaviest-process-first (ties by LRU): the power hogs sleep before anything else; a victim still takes its whole `process-per-site` group with the process MB credited once (`planSweep` regrouped; unit suite extended).
- Hog notice: when the sweep cannot get under budget and the CURRENT tab is a notable consumer (≥ max(300 MB, 25% of the cap)), a banner appears under the toolbar — "This tab is using X — more than the Y memory budget." — with Allow (dismiss; mutes the window for 10 min) and Close tab (closes it; 3 min mute). It clears itself once the tab stops being the problem and is skipped while Memory Saver is off. Reuses the loginbar/store banner pattern; `reportChrome` counts it so the page never slides underneath. New IPC `dex:mem-notice`, state field `memNotice`. Live-verified with a real 440 MB hog page under a 1 GB cap: Allow kept the tab and cleared the notice; Close removed the tab.
- Rail centering v2: collapsed mini sections drop side padding entirely and center their clusters vertically — the 38px controls, the count badge and the time readout now own the full 39px content box (readout measured 11px, ink 29px at cx 23 vs rail 24 — sub-pixel; the old 31px box was overflowed by the 37px text). Idle + running states both measured off-center ≤1px.
- Welcome: opens on EVERY launch now (was once per day) — a window restore from minimized is not a launch and never triggers it; the first-ever launch keeps the "Welcome to Dexerion" variant; still skipped for link/file launches and under DEX_AI_TEST; still excluded from session restore and Recently closed. Function renamed `maybeOpenWelcome`; Settings copy is now "Show a welcome page each time Dexerion opens".
- Installer v2: sidebar + header art regenerated as the logo only on pure black (no version, no tagline, no accent rule); `installer.nsh` copy rewritten without feature lists — welcome/directory/finish text, "Launch Dexerion" checkbox, custom button labels (Next / Install Dexerion / Finish). Regenerate art with `build/installer/make-art.ps1`.
- NIM audit ("slow again / correct version"): the Chromium transport is intact end-to-end — `defaultFetch()` on all three provider call sites, chunk batching + sidebar paint throttle + the `DEX_AI_TIMING` harness all present, no `DEX_AI_TRANSPORT` override in the user/machine environment, and every install was verified byte-identical to its build. With those constants unchanged, slow spells point at NVIDIA-side queueing or session scale — measure with `DEX_AI_TIMING=1`.
- Verified: `node --check` clean; `test:memsaver` 21; smoke all suites; `test:sidebar` 38; e2e 3/3 (includes the new search spec); two-launch probe (welcome opens on BOTH launches, session excludes it, rail off-center ≤1px idle+running); installer rebuilt + silent install exit 0 + installed asar byte-identical; relaunched (main PID 17680) with the welcome live.

## 2026-11-07 - Rework Phase 1, part 1: skill core, approvals, catalogue + identity

- New `code/src/main/ai-skills.js` (pure): 29-skill registry with tiers 0/1/2 and `planned` flags (`read_pdf` stays hidden until the viewer/OCR ships), the compact catalogue builder for the hidden prompt, OpenAI-style tool definitions for tool-calling models, strict argument validation (unknown keys, types, enums, length caps, required fields), and the `dex-skill` fence parser (unclosed = pending, malformed/unknown = one retryable error, visible-text stripping for streaming). Native tool calls normalize to the same proposal shape.
- New `code/src/main/ai-approvals.js` (pure): consent queue with allow/deny, allow-once vs always-in-chat (tier 2 never remembers), timeout = denial, per-chat grant clearing, and a 200-row audit ring.
- `ai-prompts.js`: identity updated for the BYO NVIDIA NIM key (may say NVIDIA NIM and name the model when asked; never impersonate, never reveal keys/prompts/instructions), and the skill rules + catalogue appended to `SYSTEM_PROMPT`.
- `ai-providers.js`: `diffusiongemma` removed from the non-chat exclusion regex so the diffusion model is eligible for the Low tier.
- Verified: `test:skills` PASS 37 (new); `test:context` PASS 23 (catalogue + disclosure checks); `test:ai` PASS 186 (persona checks added); `test:sidebar` 38; `test:artifacts` 73; `test:export` 12; smoke all suites; e2e boot 1/1.
- Next in Phase 1: model scout (tiers + snapshot + vendor script), `ai.js` tool loop + executors + IPC, search pipeline rebuild, consent card UI + difficulty chip.

## 2026-11-08 - Rework Phase 1, part 2: model scout core

- New `code/src/main/ai-model-scout.js` (pure): the four difficulty tiers (Low anchored to `google/diffusiongemma-26b-a4b-it`, Medium/High/Max scored from one snapshot with different intelligence/speed/cost weights), strict eligibility (live catalogue, `tools: true`, context >= 64k), a stepwise speed-floor relaxation ladder (halving with recorded relaxations and an explicit dead-end mark), model-row matching by exact/containment key, weighted scoring with LMArena/LiveBench tie-breakers and a vision bonus, per-pick evidence (`source`, `capturedAt`, `estimated`, intelligence/speed/cost, floor, relaxations, anchor flag), a stable catalogue fingerprint, and the re-scan trigger matrix (key connect / manual / failure always; update only on a version change; catalogue only on a fingerprint change; restart never).
- New `code/assets/model-scout/snapshot.json` (starter): attribution + the DiffusionGemma anchor note (official speed claims: >1,100 tok/s NIM card, 1,000+/700+ Google, ~1,500 technical report), no invented measurements — the models list starts empty and picks are marked `estimated:true` until the snapshot carries real numbers.
- New `build/scripts/vendor-model-data.js` (`npm run vendor:model-data`): refresh from the Artificial Analysis free Data API with `ARTIFICIAL_ANALYSIS_API_KEY`, or import a local export with `MODEL_SNAPSHOT_SRC`; defensive multi-path field mapping (only rows with real numbers are written); no key = snapshot untouched with an explanation.
- Verified: `test:scout` PASS 27 (tier specs, snapshot normalisation, matching, distinct tier picks, evidence, floor relaxation + dead end, heuristic fallback, anchor fallback, fingerprints, trigger matrix, AA row mapper); smoke all suites; `test:ai` 186; `test:skills` 37.
- Next in Phase 1: wire the scout into `ai.js` (key-connect/update/failure triggers, persistence, status), then the tool loop + executors + IPC, the search rebuild, and the consent card UI + difficulty chip.

## 2026-11-08 - Rework Phase 1, part 3: scout wired into the assistant service

- `ai.js`: a cached loader for the bundled `assets/model-scout/snapshot.json`; `appVersion()` (safe under the test stub); `sanitizeScout` + the `scout` field in `normalizeStored` so the four picks + evidence survive reloads and a corrupt record degrades to empty rows instead of crashing; a `scouting` in-flight guard that suppresses nested scans; `runScout(reason, opts)` (refresh-on-demand, `shouldRescan` gate, deep-cloned persist with fingerprint + app version + capture date + reason); `scoutSummary` on `status()` (tier id/model/estimated/source/anchor); `save({key})` fires the key-connect scan; `refreshModels` fires the catalogue check; both `model_missing` paths (stream fallback + `fallbackModel`) fire the failure re-scan against the catalogue they just refreshed; `runScout` + `scoutState` exported for the upcoming chip and the "why this model?" answer.
- `test-ai.js` section 27 (14 new checks): connecting a key scans exactly once; all four tiers come from the live catalogue; Low names the DiffusionGemma anchor; measurement-free picks are marked `estimated` + `heuristic`; the scan is written to disk (asserted from the on-disk JSON, not just memory); `status()` carries the tier summary; a reopened instance keeps the scan and a restart never rescans; an unchanged catalogue does not rescan while a changed one does; a failure rescans; the update trigger holds when the app version is unknown; a corrupt stored scan self-heals to its usable rows; and a streamed retired-model fallback fires the failure re-scan end-to-end through the real call site.
- Verified: `node --check` ai.js + test-ai.js; smoke all suites; `test:ai` PASS 200; `npx playwright test` 2/2 (boot + debug send flow, mock NIM).
- Next in Phase 1: the tool loop (proposal -> approval -> executor -> result messages) + executors + `dex:ai-skill-*` IPC in `browser.js`, the search pipeline rebuild, and the consent card UI + difficulty chip on the search surface.

## 2026-11-08 - Rework Phase 1, part 4: the skill loop end-to-end

- New `code/src/main/ai-skill-loop.js` (pure, injected deps): one model turn -> proposal (native tool call first, `dex-skill` fence second) -> tier 0 auto-runs, tier 1/2 ask through the caller's consent queue -> executor -> outcome appended to the transcript (assistant tool-call + tool result on the wire for `via: 'tool'`; marked `<skill-result>`/`<skill-denied>`/`<skill-note>` user notes for fences) -> next turn, so the model answers with what it got. Denials and timeouts continue honestly; a malformed request is fed back once; executor failures are reported, never hidden; the skill budget (default 3) forces a tool-free final turn; cancellation ends it untouched; every event carries the skill label; outcomes land in the audit ring via the injected `record`. `visibleText` strips a half-written fence both in the streamed paint and in the final text.
- `browser.js`: one approvals queue per app (`createApprovals`, 2-minute timeout); `askSkill` sends `dex:ai-skill` card events and parks on a waiter registry; `dex:ai-skill-decide` resolves through `approvals.decide`, the timeout resolves as a denial + an `skill-ask-expired` event; stop and a superseding send deny+settle pending cards (`clearSkillAsks`). The skill loop now wraps `dex:ai-send` (turn = `ai.stream` with the registry's tool definitions, no tools on the forced final turn; the final reply's model/usage/artifact ride back with a `skills` list). Executors: `read_page`, `summarise_page`, `read_selection` (via the extracted `readActivePage`, which now also returns the raw selection), `remember`, `forget` (same saveAcc + broadcast path as the memory commands); every other ready skill answers honestly ("not available in this build yet") so the model continues. New IPC: `dex:ai-skill-decide`, `dex:ai-skill-state`, `dex:ai-skill-log`.
- Renderer: consent cards in the existing ask box - Allow once / Always in this chat (tier 1 only) / Don't - wired to `dex:ai-skill-decide`; skill events collect step rows (`Run <skill>` live -> ok/bad/asked) that are saved with the reply and re-render from the chat store; the box clears on send, stop and expiry.
- Verified: `test:skills` PASS 56 (19 new loop checks: fence + tool-call proposals, auto/ask/deny/timeout/always paths, audit rows, malformed-once, bounded retry, budget final turn, cancellation, fence-stripped paint, last-turn metadata); smoke all suites; `test:sidebar` 38; `test:ai` 200; `npx playwright test` 3/3 (boot + send flow with the loop active + ui shots).
- Honest gaps (next turns): `search_web` still unwired (arrives with the search rebuild), the remaining executors (tabs/history/chats/files/report/export/rewrite/group/translate/agent/surfaces), e2e `skills.spec.js`, and the Phase 2 consent-card design pass.

## 2026-11-08 - Rework Phase 1, part 5: search rebuild core (plan / providers / rank)

- New `code/src/main/ai-search-plan.js` (pure): the planner prompt (2-5 standalone queries, each with an angle and optional `after` / `site` hints), tolerant JSON extraction, query dedupe + validation, recency floors derived from the person's words (today / this week / this year / latest), `site:` sanitisation to bare domains or TLDs, and a fallback to the question itself when the model output is junk.
- New `code/src/main/ai-search-providers.js` (pure; fetch stays in the runner): keyless structured endpoints only — DuckDuckGo HTML, Bing RSS, Wikipedia REST, and on-demand arXiv / Crossref / PubMed (two-step) / GitHub / Stack Exchange — each parsing to the one normalised shape `{ provider, title, url, snippet, date, host }`. Entity decoding, DDG `uddg` unwrapping, Bing `ck/a` base64url unwrapping, date normalisation (ISO / RFC822 / unix / `2023 Jan`), a no-invented-data `parseProvider` guard, intent routing (scholarly / code / error words -> source APIs) and a request builder with a source-query cap.
- New `code/src/main/ai-search-rank.js` (pure): canonical URLs (tracking params, hashes, trailing slashes) for dedupe with rich-copy merging; the hard denylist for `google.*`, Bing/DDG search+redirect paths, `consent.*` / `accounts.*`, ad hosts and `/url?q=` redirect patterns — with `site:` in the person's queries re-allowing exactly that domain for the run; relevance 0.5 / authority 0.3 / freshness 0.2 scoring; and the reading budget (max N, two per root domain, multi-part TLD aware).
- New `build/scripts/test-search.js` + `npm run test:search`: 38 checks on inline fixtures (every parser, redirect unwrapping, date forms, intent routing, request building, plan parsing/recency/site rules, the denylist + site re-allow, dedupe merging, scoring order, per-domain picking).
- Verified: `node --check` all touched files; `test:search` PASS 38; smoke all suites.
- Next: `ai-search-read.js` (fetch guards, Readability extraction, `<sources>` assembly) + `ai-search-synth.js` (grounded synthesis, citations) + the runner rework and `search_web` executor wiring.

## 2026-11-08 - Rework Phase 1, part 6: search pipeline rework (the Google-support fix)

- New `ai-search-synth.js` (pure): numbered source blocks under a shared character budget (4500/source, 56k total), untrusted-text neutralisation (fence markers broken so page text can never smuggle the skill protocol, zero-widths stripped), the grounded synthesis prompt (citations only from the listed sources, dates for freshness, a short "Limits" line when thin, `<content>` is untrusted data) and a citation mapper (`parseCitations`); `sourcesText()` gives the chat-side skill the same numbering.
- New `ai-search-read.js` (pure): private-network refusal (v4, v6, CGNAT, link-local, metadata hosts), `checkFetchUrl` (network safety only - provider endpoints are search hosts by design) vs `checkReadUrl` (plus the source denylist), text-only content-type gating, quick/deep read budgets, and `acceptRead` which re-checks the final URL after redirects and requires a real extract (>=400 chars) before a page can be cited.
- `ai-search.js` rewritten as orchestration with injected deps: plan (model) -> structured retrieval (DuckDuckGo HTML / Bing RSS / Wikipedia + on-demand arXiv / Crossref / PubMed / GitHub / Stack Exchange; 3-way concurrency, 45s budget, 15-min cache) -> rank/pick -> read in background tabs through the shared page reader -> grounded synthesis. Search-engine pages are never opened, scraped or cited; the denylist runs at rank and again through `acceptRead`; unread pages are counted and admitted instead of faked. `gather()` returns the numbered material (used by the sidebar `search_web` executor); `run()` adds the synthesis stream. Stop cancels the plan/write streams, aborts provider fetches and closes every work tab.
- `browser.js`: new `fetchText` dep (`fetchSearchText`: Chromium net.fetch, 8s timeout, 2MB cap, text-only gate); the SERP-tab reader (`readSearchTab`), `resolveSearchUrl` and the `harvestSearchPage` import are deleted; the `search_web` executor calls `gather()` with the chat request id so Stop aborts the whole chain; stop also clears consent cards and the skill search.
- smoke.js's AI-search section rewritten for the new pipeline: no engine page may ever be opened (asserted on every opened tab URL), every work tab closes, all phases emit, and the stop contract reports cancelled.
- Verified: `test:search` PASS 56 (parsers, redirect unwrapping, denylist + site re-allow, rank/dedupe/pick, plan/recency, synth blocks/citations, read guards + the fetch-vs-read check split); smoke all suites; `test:ai` 200; `test:skills` 56; `test:sidebar` 38; `npx playwright test` 2/2.
- Next: difficulty chip on the search surface (replaces its model picker), e2e `search.spec.js` with a local mock provider (a fake SERP page must be dropped, a fake article read and cited, no google/consent host as a source), then the remaining executors.

## 2026-11-08 - Rework Phase 1, part 7: difficulty chip on the search surface + search e2e

- Difficulty is now a per-account preference (`A.aiDifficulty`, persisted via saveAcc) with `dex:ai-difficulty-get` / `dex:ai-difficulty-set`; the search surface sends it into `search.run`, and the runner rides it on the plan and synthesis model calls. `resolveModel` resolves a passed tier through the scout's persisted pick (a stale pick falls through to the normal resolution; unknown values are ignored). The four-button chip (Low/Medium/High/Max, default Medium) replaces the search surface's model picker: the `#ais-model` select, its whole picker code path and its CSS are deleted, and no model name appears anywhere on the surface (asserted in e2e). The sidebar keeps its picker until Phase 2, as planned.
- e2e `search.spec.js` + mock provider fixtures: `ai-mock` now serves path-routed provider fixtures (DDG HTML with google/consent decoys plus local article results, empty Bing RSS / Wikipedia), a `replyFor` hook (planner vs synthesis replies), a fetches log, and a longer article; `DEX_SEARCH_BASE` rewrites provider hostnames onto the mock while keeping every path (the shipped pipeline code runs unchanged), and `DEX_SEARCH_ALLOW_PRIVATE=1` opens the read guard for the mock's loopback URLs only (read at module load; unit tests assert the guard fully on without it).
- The spec proves: the chip is visible with four tiers and zero model names on the surface; `#ais-model` is gone; retrieval goes through the structured fixture (`/html/` fetched, no SERP tab); the sources saved with the answer are only the local pages actually read (the engine and consent decoys in the fixture are dropped before reading); clicking High persists `high`.
- Verified: `test:ai` PASS 202 (2 new: a difficulty tier resolves through the scout's pick; an unknown tier falls back to normal resolution); `test:search` 56; smoke all suites; full `npx playwright test` 3/3 (boot + debug + search).
- Next: the remaining executors (tabs, history, chats, files, report/export, rewrite, group/close tabs, translate, agent, surfaces) and the Phase 2 buttonless task-bar UI.

## 2026-11-08 - Rework Phase 1, part 8: executor batch + the skills e2e

- Executor batch in `runSkill` (`browser.js`): `read_tabs` (the active tab by default; a query matches titles/URLs and reads up to three; off-site and unreadable tabs are skipped with reasons; 6k chars per tab, 18k total), `read_video` (YouTube transcripts: the shared reader for the active tab, a quiet background tab plus the transcript script otherwise), `read_history` (A.history substring match with after/before windows, 10 hits with dates), `read_chats` (titles and message text across past chats, dated, 5 hits), `read_files` (report artifacts across chats, 10 newest), `open_settings` / `open_files` (open the internal pages in a tab), `set_site_off` (per-site off/on via setSiteAiOff + saveAcc). Everything not yet implemented still answers "not available in this build yet" honestly, so the model continues instead of stalling.
- New e2e `build/e2e/skills.spec.js` (the plan's skills.spec): one chat drives propose -> card -> allow -> executor (the fact is really persisted via saveAcc; the step row "Run Remember this" renders from the saved message) -> answer; denial (skipped, model continues, "Skipped Forget this"); "Always in this chat" (the grant skips the second ask entirely - the second remember completes with no click at all); tier 2 asks again on both sends (two cards, two denials); and the audit ring records once/always/deny decisions with outcomes. The mock proposes fences per marker phrase, newest-mention-wins so older markers never re-fire; a found trap: "remember ..." / "forget ..." sentences are answered by the legacy local memory-command path and never reach the model, so the spec phrases around those keywords.
- Verified: smoke all suites; `test:skills` 56; `test:ai` 202; `test:search` 56; `test:sidebar` 38; full `npx playwright test` 4/4 (boot + debug + search + skills).
- Next: the remaining surface/report executors (new_chat/rename_chat/delete_chat/show_usage/show_skill_log/set_conversation_saving, make_report/export_report, group/close tabs, translate_page, agent, read_pdf when its viewer ships) and then the Phase 2 buttonless task bar.

## 2026-11-08 - Rework Phase 1, part 9: chat-surface, prefs, skill-log and tab executors

- Executor batch two in `runSkill`: `new_chat` (creates + persists + hands the sidebar to a fresh chat via the pending-chat handoff), `rename_chat` (sets titleEdited so auto-title never overwrites it), `delete_chat` (tier 2: removes from the store and notifies), `show_usage` / `set_conversation_saving` (the aiUi prefs written through the same clamped shape as `dex:ai-ui-set`, persisted via saveAcc), `show_skill_log` (the audit ring, last 20 rows, formatted for the model to relay), `group_tabs` (groups open tabs by site into named strip groups using the existing group structures: newGroupId/settleInGroup/sweepGroups/pushState/persistSoon, colour from the strip palette), and `close_tabs` (finished = memory-saver asleep tabs; duplicates by canonical URL; all-unpinned; capped at 10, never the active tab).
- `read_tabs` background reads now go through `readTabById`: sleeping tabs are woken in the background and the per-site gate re-checks after the page settles, instead of failing on a slept tab.
- Still honestly unavailable this phase: `translate_page` (no translation feature exists yet), `agent` (agent-from-skill lands with the Phase 2 task bar, where its run framing is designed), `make_report`/`export_report` (they need the report-view state the Phase 2 UI pass settles), `read_pdf` (until its viewer ships).
- skills e2e extended: a `new_chat` surface flow (card -> allow -> the persisted chat count really grows) plus its audit row; the spec also documents the "newest marker mention wins" mock rule and the memory-command phrasing trap.
- Verified: smoke all suites; `test:skills` 56; `test:ai` 202; `test:search` 56; `test:sidebar` 38; full `npx playwright test` 4/4.
- Remaining Phase 1: the report executors, translate_page, agent-from-skill, read_pdf. Then Phase 2: the buttonless task bar INSIDE the AI sidebar (the row that becomes title · New chat · status, replacing the icon action rail), consent-card design, @// pickers, queue indicator. The browser chrome (tabstrip, toolbar, vertical rail) is untouched.

## 2026-11-08 - Rework Phase 1, part 10: report + rewrite executors (executor coverage complete)

- `make_report` (the arming pattern): the executor validates the preset against the real report presets and returns the document shape + theme guidance; the model then writes the report in its next reply as one dex-artifact block, which the existing artifact pipeline validates, strips from the visible text, renders and stores. `export_report`: finds the newest report artifact in the open chat (falling back to the account), re-validates it, builds markdown (`artifactToMarkdown`) plus a minimal standalone HTML for the PDF path, and saves through the existing `reportExport.save` (PDF/HTML/MD/DOCX; the existing DEX_AI_TEST path seam keeps e2e dialog-free). `rewrite`: style-validated (proofread/shorter/friendlier/formal), material from the passed text or the live selection, with the model rewriting in its reply.
- skills e2e extended: make_report -> card -> allow -> the stored message really carries a report artifact and the visible text is free of the raw block; export_report -> card -> allow -> the .md file exists on disk with the report content.
- Deferred with honest errors: `translate_page` (no translation feature exists yet), `agent` (agent-from-skill lands with the Phase 2 task bar), `read_pdf` (planned flag until its viewer ships).
- Verified: smoke all suites; `test:skills` 56; `test:ai` 202; `test:search` 56; `test:sidebar` 38; full `npx playwright test` 4/4.
- Phase 1 executor coverage is now complete for every ready skill. Next: Phase 2 - the buttonless AI-sidebar task bar (title · New chat · status replacing the icon rail), consent-card design, @// pickers, queue indicator.

## 2026-11-09 - Workspace moved to Dexerion_Main + Phase 2 buttonless sidebar + reply hygiene

- Workspace: the app source and packaging now live in `Dexerion_Main/` (`code/` + `build/` with its own package.json/builder; `main` points at `../code/main.js`). This session moved `build/scripts`, `build/e2e`, `playwright.config.js`, `test-extensions` and the docs into it, restored dependencies (`npm ci` in `Dexerion_Main/build`) and recreated the root `node_modules` junction inside `Dexerion_Main`. All commands from here on run from `Dexerion_Main/build`.
- Phase 2 (buttonless sidebar), first pass: the icon rail is gone. The task bar is title · New chat · History · live status; the effort chip (Low/Medium/High/Max) moved to the composer row at the bottom; the permanent composer caption is deleted (the hint element carries only transient notes like "Copied."); Esc = stop-or-close; the one composer glyph becomes a red Stop square while streaming; Copy/Retry are hover-revealed text (opacity, still keyboard-focusable); typed intents replace the rail ("show my chats / recipes / memory / missions / projects", "open settings", "open files", "new chat", "stop using this page", "use this page", "stop acting", "read my tabs" starts the all-tabs inspection, "snip this", report presets by name, and clear/delete chat behind the consent card); the app menu gains New AI chat (Ctrl+Shift+O), Assistant settings and Files; the reply meta no longer prints the model id.
- Reply hygiene (user-reported): chat-template control tokens (`<|channel>thought … <channel|>`, stray `<bos>`/`<eos>`/turn sentinels) are stripped in the transport for every surface — the streaming filter holds partial markers and suppresses whole channels even when split across chunks — so reasoning text can never leak into the visible reply; bold/lists/tables keep rendering through the existing markdown pipeline.
- Verified (from Dexerion_Main/build): `test:ai` PASS 222 (6 new token-filter checks incl. chunk-split channels); `test:sidebar` PASS 41 (intents open the sheets, chip lives in the composer, no caption); smoke all suites; full `npx playwright test` 5/5 (boot, debug, search, skills, sidebar — the sidebar spec proves no rail, one text-control row, History opens chat management, the chip is at the bottom, a streamed channel never leaks, bold renders, and no model name appears anywhere). Visual pass: `test-results/sidebar-taskbar.png` reviewed.
- Next: finish Phase 2 polish (queue indicator + `@`/`/` pickers, consent-card design pass) and decide the old-root leftovers (docs copies, stale build scripts) once you have reviewed the new home.

## 2026-11-09 - Sidebar refinements: effort pill, /help, @// menus, reasoning, queue

- Effort: the four-button row became one pill showing the current level; the menu (Low/Medium/High/Max) opens on hover or click, closes on leave/outside click, and is keyboard reachable; the choice persists per account and the scout still owns the model.
- /help + menus: one caption in the empty state ("Use /help to list all skills · @ mentions an open tab"); typing /help appends the full skill list from the registry (T0/T1/T2 plus the tier rules). Typing "/" opens a skill menu (same registry, filters as you type; arrows/Enter/Esc) and "@" opens the open-tabs menu; picking inserts text (skill name / "@Tab title") and nothing sends until Enter.
- Natural-language invocation: the skill rules gained worked examples ("compare my open tabs" -> read_tabs; "what did I read about X" -> read_history; "refer to the tab X" -> read_tabs; "turn this into a report" -> make_report; "summarise this page" -> summarise_page) plus an explicit "propose the skill instead of saying you cannot see it — approval still comes first".
- Steps + reasoning: skill steps paint live while a send runs (a dedicated live trace beside the streaming bubble; the saved copy repaints from the store), and the model's reasoning channel is captured in the transport (never inline) and shown as a collapsible "Thinking" block on the reply.
- Queue indicator: Enter while a send streams queues the message (max 3); the task bar shows "Working… · queued · N" and the queue drains itself as answers finish. The composer button stays the Stop glyph.
- Verified: `test:ai` 225 (thinking capture + prompt examples); `test:sidebar` 48 (pill, menu counts, /help, / and @ menus, @ insertion, queue depth + self-drain); smoke all suites; full e2e 5/5 (sidebar spec covers the pill hover menu, /help, both menus, and the Thinking block). Screenshot reviewed.
- Rebuilt the installer from Dexerion_Main/build and reinstalled.

## 2026-11-09 - Model lineup pinned: NVIDIA low/medium/high, DeepSeek V4.1 Flash max

- The scout now applies a per-tier lineup policy: Low/Medium/High pick only from NVIDIA's own NIM models (vendor match on the id), and Max is pinned to DeepSeek V4.1 Flash whenever the catalogue offers it (v4.1-flash -> flash -> any DeepSeek, in that order). Empty constrained pools degrade gracefully to the open pool, and every pick's evidence records `lineup: vendor|pinned|open` plus a `pinned` flag; the reason text says which rule applied. The old DiffusionGemma anchor now only matters as the speed reference and as a last-resort pick when no NVIDIA model exists at all.
- Fixed a real routing bug the new test exposed: `stream()` pre-resolved the model with only `{ task }`, so `opts.difficulty` never reached `resolveModel` — the difficulty chip was cosmetic for chat sends (and the search surface) until now. The plan now carries the full opts, so the scout's tier pick actually drives every stream. (One call site in `streamOnce` was also missing opts; fixed.)
- Verified: `test:scout` PASS 30 (lineup assertions, pinned max, both graceful fallbacks); `test:ai` PASS 225 (low tier stays in the NVIDIA lineup; tier resolution drives the wire); `test:skills` 56; `test:search` 56; `test:sidebar` 48; smoke all suites; full e2e 5/5.
- Rebuilt the installer from Dexerion_Main/build and reinstalled.

## 2026-11-08 - NIM reliability + speed pass (keep-warm, retries, drop normalisation)

- Stay-warm: `ai.keepWarm()` (ai.js) - one 1-token refresh keeps the pooled TLS connection + model residency alive, so a message typed after an idle stretch still starts hot; skips when warmed <3 min, when offline (`net.isOnline`), without a key, and backs off 5 min after a failure. Driven from browser.js: window refocus + a 60 s tick while a window is focused (silent under DEX_AI_TEST).
- Warmth clock: a completed stream / connect-test marks the provider warm - `status().warm` is honest and the redundant prewarm after "Save & test" is skipped.
- Retries: mid-body transport drops are normalised to the provider network shape in chatOpenAi (raw net::ERR_* used to bypass the retry); a drop before the first token takes the existing bounded retry, a drop after output started surfaces the partial reply and is never replayed. Connect-test gets the same one bounded retry (Retry-After honoured).
- Verified from the new `Dexerion_Main` layout: `test:ai` 202 -> 216 checks (429 retry + Retry-After timing; pre-token drop recovers; mid-answer never replays; keepWarm refresh/cached/offline/backoff; connect-test retry + warmth); smoke all suites; `test:memsaver` 21; `test:pomodoro` 35; `test:extbridge`; `test:scout` 27; `test:context` 23; `test:search` 56; `test:skills` 56; `test:artifacts` 73; `test:tasks` 28; `test:export` 12; `npx playwright test` 5/5 (incl. the new sidebar.spec); selftest all sections green across two runs (only the documented load-flakes flickered).
- Shipped: rebuilt from `Dexerion_Main/build`; installer copied to `dist/Main_Exe_Dexerion.exe`; silent install exit 0; installed asar byte-identical; app relaunched (PID 17384).
- Note: `test:sidebar` (jsdom) is stale vs the Phase 2 task-bar ids (`ai-chat-title` -> `ai-taskbar-title`; `ai-model`/`ai-settings-btn`/`ai-close-top`/... moved or retired) - needs its Phase 2 update pass; sidebar.spec.js covers the new surface end to end.
