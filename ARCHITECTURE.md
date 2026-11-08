# Dexerion V1 — Architecture

## Technology decision

| Option | Verdict |
|---|---|
| **Electron (chosen)** | Embedded Chromium — full modern rendering, `WebContentsView` tabs, `session.loadExtension` for MV3/MV2, `electron-builder` NSIS `.exe` + installer, mature Windows support. Dexerion owns windows, tabs, profile, extension engine. |
| Tauri / WRY (system WebView) | Rejected: uses Edge WebView2 on Windows — not an owned Chromium build, no Chrome-extension engine. |
| Raw CEF / custom Chromium fork | Rejected for V1: months of native build work for marginal gain over Electron's Chromium. |
| NW.js | Viable but smaller ecosystem/packaging story than Electron. |
| Qt WebEngine | Chromium-based but weak extension-API surface. |

Dexerion is NOT: launching/controlling external Chrome, embedding an external
Chrome window, or a website pretending to be a browser. Every window is a
Dexerion `BrowserWindow`; every tab is a Dexerion-owned `WebContentsView`
running in Dexerion's Chromium session.

## Layout

```
main.js                  bootstrap (profile → session → extensions → browser)
src/main/branding.js     Dexerion brand (logo, names) — reskin here
src/main/profile.js      JSON profile store (settings, bookmarks, history, …)
src/main/browser.js      windows + tabs + nav + history + downloads + menus + IPC
src/main/extensions.js   unpacked load, enable/disable/reload/remove, store CRX
src/main/menu.js         accelerators (Ctrl+T/W/N/L/R, Ctrl+Tab, Ctrl+1-9…)
src/main/permissions.js  deny-by-default capability registry for future AI
src/main/site-policy.js  blocklist host matching (host/subdomain) — pure
src/main/pomodoro.js     Focus Timer engine: work/break state machine + tick
preload.js               contextIsolated bridge (window.dexerion.*)
src/renderer/shell.*     vertical rail (tabs over timer) + toolbar + omnibox
src/renderer/pages/      dexerion://newtab|settings|history|bookmarks|downloads|extensions|accounts|blocked
```

## Layout notes

Dexerion is vertical-tabs only (`body.vertical` always; the setting migrates
once and the toggle is gone). The rail is split: tabs on top (scroll past
half), the Focus Timer fixed on the bottom half.

## Focus Timer (Pomodoro)

Work/break sessions with ambient sound and work-phase site blocking. One
engine (`src/main/pomodoro.js`) serves all windows: a 500ms tick, persisted
settings (`pomoWorkMin/BreakMin/Sound/Volume/Blocklist`), phase-end OS
notifications. Shells render it in the rail (`#rail-timer`) and synthesize
audio (white/rain/brown/pad, WebAudio, no files) only for the most recently
focused window; ticks travel over a cheap `dex:pomodoro` channel while full
`dex:state` pushes carry `pomodoro` + `pomoAudio`.

Blocking reuses the old session-level machinery: `webRequest.onBeforeRequest`
on every partition rejects blocklisted main-frame navigations during a work
phase and redirects to `dexerion://blocked?tone=work` ("Get back to work",
auto-restores when work ends). Modes/schedules are gone: `focus.js`,
`modes.html`, the Modes menu, and the banner are removed; legacy `focus.json`
is preserved on disk but unread.

## Tabs and groups

Each tab is a Dexerion-owned `WebContentsView`; the tabstrip is renderer chrome
that only speaks `dex:*` IPC. Group membership lives on the tab (`tab.groupId`)
and the colour list on the window, so both persist in `tabs.json` and survive a
restart or a duplicate.

## Memory footprint (staying under 1GB)

Process model, set once in `main.js`: renderer cap (6), same-site process
sharing, in-process GPU, 512MB V8 heap cap per process, and no Translate /
MediaRouter / OptimizationHints background services. Sandboxing and site
isolation are untouched — single-process mode is deliberately off the table.

Beyond processes: session restore is lazy (only the active tab loads; the
rest load on first activation, including background `window.open` tabs),
tabs idle 5 minutes (not visible, audible, or loading) have their renderer
torn down and show a `zzz` mark until clicked awake, AI chats keep image
bytes only on the most recent messages, history is capped
at 5000 entries, and a single figure (`dex:memory`, summed via
`app.getAppMetrics()`) is shown on Settings → About and logged at boot.
and the colour list on the window, so both persist in `tabs.json` and survive a
restart or a duplicate.

Moving a tab is owned by the **main process**: the renderer reports a drop as
`dex:tab-drop(dragId, targetId, where)` with `where` = `before` / `after` /
`center` (join the target's group). `moveTab` keeps a group **one contiguous
run** — a drop inside a run reorders within it, an ungrouped tab dropped strictly
inside a run snaps to the nearer edge, and a grouped tab dropped outside its run
is ungrouped, leaving the run intact. Dropping a grouped tab beside its own run
is a no-op. A drop on the **empty strip** (null target) parks the tab at the end
and always takes it out of its group, so there is a dependable way to pull a tab
out even when the group is the last run on the strip. The older IPC
(`dex:reorder-tab`, `dex:tab-group`, `dex:group-add`, `dex:tab-ungroup`) still
serves the menus. The strip paints the insertion bar on the edge you are dropping
against, in the axis the strip runs (left/right, or top/bottom in vertical mode).

## Accent selection

Text selection is the user's accent everywhere, not Chromium's stock blue. Every
tab gets `::selection` injected as a **user-origin** stylesheet
(`webContents.insertCSS(css, { cssOrigin: 'user' })`, re-applied per document on
`dom-ready`), so it covers real sites, internal pages, and pages that ship their
own selection styling. The declarations are `!important` on purpose: plain user
declarations rank *below* author ones in the cascade, so without it a site that
styles its own `::selection` would keep its colour. Subframes cannot be reached
by `insertCSS`, so they get the same sheet through `adoptedStyleSheets` (also
outside the page's CSP). Changing the accent re-applies to every open tab, and
the mix is a 45% accent wash over whatever the page paints, matching
`assets/page-theme.css` and `src/renderer/shell.css` so the chrome, internal
pages, and websites all select in one colour.

## Chrome skins (design review)

The chrome is one stylesheet, `src/renderer/shell.css`, and a skin is a file that
loads *after* it. `?skin=<name>` on a shell window loads
`src/renderer/skins/<name>.css`, pins `data-theme` to that direction's mode, puts
the direction in the window title, and adds a `#skin-tag` badge naming the file.
With no query param there is no skin at all: the shipped look is `shell.css`
alone.

`--preview-skins` opens every direction in `SKIN_DIRECTIONS`
(`src/main/browser.js`) as its own window, tiled over the work area on one shared
tab set — five tabs, two of them grouped — so the interface is the only thing that
varies on screen. `--capture-skins` writes a PNG per direction (plus a chrome
crop) and exits, for reviewing renders without a human in the loop. Preview
windows are marked `st.preview` and excluded from `persistAll()`, so they never
reach the saved session; launch them with a throwaway `--user-data-dir`.

Four directions exist as review material: **Machined** (instrument panel),
**Vellum** (paper and serif), **Halo** (depth and glow), **Riso** (two-colour
print). Each styles both colour modes and both strip orientations.

They are also a **setting**. `settings.skin` holds `dexerion` (the shipped look,
the default — no skin file is loaded at all) or one of the four names, and
Settings → Theme offers them as five miniatures drawn with each theme's own
palette and tab geometry. The shell applies the value from its state on every
render (swapping the `<link>` in place), so choosing a theme changes every open
window immediately and persists in the profile; the `?skin=` query is now only
for the design-preview windows, which also pin a colour mode and show a badge.

Two rules keep a skin from breaking the browser:

- **No `:root` prefix on rule selectors.** A skin writes
  `[data-skin="x"] .tab`, not `:root[data-skin="x"] .tab`. That places it above
  shell.css's shipped rules but *below* shell.css's `body.vertical …` rules, so
  vertical tabs keep their own geometry and a skin refines the rail rather than
  replacing it. The first cut used `:root` and out-specified the vertical block,
  which collapsed the rail into a 36px strip with the tab list squeezed out of
  sight; the `skins` self-test now measures the rail in every direction.
- **Measure, don't assume.** The shell reports its chrome height
  (`dex:chrome-h`) and its rail width (`dex:rail-w`); `layout()` uses both, so
  the page starts exactly where the chrome ends whatever the CSS decides. The
  rail width used to be a constant (238) that disagreed with the stylesheet
  (204), leaving a 34px dead column in every vertical-tabs window.

## Inspector

Right-click → **Inspect element** (also F12, or View → Inspector) opens Chromium's
own DevTools, framed by Dexerion. The panel docks: the shell draws its header bar
in the current theme, and the DevTools surface is Chromium's `devtools://` frontend
hosted in a frameless child window of the Dexerion window. That hosting is what
makes the framing possible — `setDevToolsWebContents` then
`openDevTools({ mode: 'detach' })` is the only way to decide where the frontend
lives; without it Electron spawns its own detached window with no chrome of ours.

Geometry belongs to the main process (`inspectorRect`): header, body and the
page's remaining area, for both docks (bottom and right), published to the shell
so the bar covers exactly the seam. `inspectElement(x, y)` is called with the
right-click position, so the Elements panel opens on the node that was clicked.
Opening the inspector closes the AI sidebar (both want the right edge), the panel
closes with its tab, and the entry motion is opacity-only: this bar's rectangle
frames another surface, so it must never depend on an animation that a throttled
renderer can pin at its first frame.

Two things keep the panel from being an empty rectangle, which is what a first
cut produced:

- **Force the surface to lay out.** Chromium's DevTools draws its panels when its
  document counts as visible, so a freshly shown *unfocused* child window painted
  the tab strip with empty panes. `openInspector` now invalidates the surface and
  nudges its bounds (once on open, once after `did-finish-load`); content appears
  in about a second instead of never.
- **Never leave it blank.** If the frontend fails to load, or nothing has loaded
  within the watchdog, the panel is replaced by `dexerion://inspector`
  (`inspector-fallback.html`): Dexerion's own page, in the user's theme, saying
  what went wrong and offering "Try again", which re-opens the inspector for the
  same tab. That page is the one non-DevTools surface allowed to use IPC
  (`chromeSender` recognises the inspector windows it opened) — the DevTools host
  window is deliberately not privileged.

## Offline handling

Chromium's own error page cannot say whether the *network* is down or that one
site is, so Dexerion answers the question itself. A main-frame failure is judged
by `offlineVerdict(code, { isMainFrame, url, online })` — one pure function, the
only place the decision lives:

- `-106` / `-21` / `-20` (disconnected, network changed, IO suspended) are the
  wire: wait.
- `-109` / `-104` / `-118` / `-105` (unreachable, failed, timed out, no name) are
  ambiguous: wait only if `net.isOnline()` is false **and** a known-good 204 probe
  also fails, so a typed-wrong domain while online is never mistaken for an
  outage.
- Everything else is the site's problem and is left completely alone, as is any
  subresource, any `file:`, `dexerion:` or other non-http(s) URL, and anything the
  focus guard already claimed.

When it does wait, `dexerion://connecting` holds the tab: four bars bounce while
`Retrying n/10` counts up one a second, and the main process re-probes the real
target on that same beat **from the main process, not the page**, because a
background tab has its renderer timers throttled and the wait must end on time
regardless. Two details make the count honest. It is derived from the clock
rather than from how long the last probe took, since an offline target answers by
timing out and the count would otherwise creep to nearly two seconds a step. And
the ten seconds start when the waiting page is actually *up*, not when the tab is
redirected: on a loaded machine the document can take longer than the whole wait,
and the count would be spent before anyone saw it (a page that never arrives
starts the clock anyway after six seconds, so a tab can never wedge). The page
itself never decides anything: main pushes `dex:net-progress`
(`{state, attempt, of, host}`) and the page only draws it. The count reaches
`10/10`, stands for its own second, and then the tab is handed to
`dexerion://offline`. A probe that succeeds instead turns the bars upright and
green, sets the title to "Connected", holds that for 1.2s so it registers, and
then opens the target.

The offline page carries **a sign, not an animation**: a globe with one stroke
through it, drawn in hairlines, with the stroke drawn twice (once in the page
colour at a heavier weight to cut the globe open, once in ink on top) so it reads
as a mark through the object. An earlier version animated a router whose signal
died halfway; that told a story in a loop, which is the wrong register for a page
already delivering news nobody chose. On recovery the stroke lifts and the globe
takes the theme's success green.

Under the sign is a game, because the one thing an offline page can still
usefully offer is something to do that needs no network: Snake, drawn in the
page's own materials (hairline grid, ink wire, accent food, mono score, a
hairline rule instead of a card), played with the arrow keys or WASD, with the
best score kept in local storage. It runs only while the page has the window's
attention, so a game left mid-run cannot walk into a wall while you read
elsewhere, and it is one small `<canvas>` with no assets and no requests behind
it, so it cannot be the thing that fails when the network is down.

The page also carries "Try again" and "Start page", and it keeps polling the
target every 2s (every 5s after half a minute) so that nobody has to click
anything: the moment the network is back the sign goes green and the page it was
waiting for opens by itself. Auto-recovery is capped at 3 per target, after which
the page keeps offering the buttons but reports `looping: true`; the count resets
when a real page loads. "Try again" deliberately starts a **fresh** budget, since
spending the same budget was why a manual retry used to bounce straight back to
this page. Any navigation the user makes clears the wait.

## Start page (New Tab)

The start page is the one surface in the browser that is genuinely about *now*,
so its room is tied to the clock. `src/renderer/pages/newtab.html` carries two
additions, both built from the page's own tokens so they follow the user's
light/dark choice and never compete with the accent (the accent stays a signal
here, as it does everywhere else):

- **A light field.** Three wide pools drift on different, very slow cycles (104s,
  148s, 191s, alternating), and a fourth layer carries the *phase* — low and warm
  at dawn, high and wide through the day, sinking through dusk into night — which
  crossfades when the clock crosses a boundary, because a gradient cannot be
  interpolated. Light mode is a high-key paper field (white and a warm
  off-white); dark mode is a cool night lift with a faint ember, kept low enough
  not to touch text contrast. A 4% noise layer removes the banding that large
  soft gradients otherwise show on 8-bit panels.
- **The day, in the corner.** A fixed top-left block: the time (tabular figures,
  locale format), the weekday and date, then the day's quote in the display serif
  with its attribution. No card, no label, no uppercase — one hairline separates
  the clock from the sentence because they are different kinds of thing. Below
  900px it joins the column above the wordmark and drops the quote, and it is
  hidden in the AI view.

**The quote is fixed for the whole local day** and advances by one at local
midnight. Its index comes from the calendar date alone
(`Date.UTC(y, m, d) / 86400000`), never from the clock or a random seed, so the
same sentence survives reloads, tabs and time zones. `assets/quotes.js` holds one
hundred of them, in a deliberate reading order, with a stated attribution policy:
documented quotes only, traditional lines labelled as proverbs, and the famous
misattributions deliberately left out (Durant's Aristotle line appears under
Durant). The `newtabDaylight` self-test recomputes today's index independently and
asserts the page agrees, so the scheme cannot drift.

## Profile integrity

Two ways the saved profile could be destroyed, both now closed:

- **A lock-losing launch.** Only the process that wins
  `app.requestSingleInstanceLock()` runs `startup()`, but `before-quit` fires in
  every process — so a second launch flushed a ProfileStore that had never been
  loaded, i.e. defaults, over the real settings and session (which is what wiped
  tabs and reset theme/accent/vertical-tabs). `flushOnQuit()` now returns unless
  the process is the primary instance *and* the profile actually loaded.
- **A byte-order mark.** `JSON.parse` rejects a BOM, and profile JSON written by
  another tool (PowerShell's `-Encoding UTF8`, some editors) then silently loaded
  as defaults. `readJson()` strips the mark before parsing.

Session writes stay where they belong: each window persists on close while it is
still registered, `flushOnQuit()` only persists while windows remain, and preview
windows never persist at all.

Each mutation handler persists through `saveAcc(accountId)`. The bookmark,
history and login handlers called `saveA(st)` — a function that does not exist —
so those writes threw *after* mutating memory: the star flipped, the row vanished,
and nothing reached disk. The `starButton` self-test now reads `bookmarks.json`
from the profile, so an optimistic UI can no longer hide a write that never
happened.

## Future AI hook point

Assist / Agent / Vision / Research / Memory / Focus will call
`window.dexerion.ai.request(permission)` → main-process `DexPermissions`
check → controlled browser capability APIs (open/navigate/read page, …).
No direct UI-state manipulation. Nothing in V1 grants these.

## Dexerion Assistant (NVIDIA NIM + persistent memory)

The AI sidebar (`src/renderer/ai-sidebar.js`, `shell.html#ai-sidebar`)
and the new-tab chat (`newtab.html#chat`) both speak the same `dex:ai-*`
IPC surface; `src/main/ai.js` owns the NIM transport. The user's NIM key
is encrypted with the OS keychain and every request is made from the
main process, so a page can never read it.

- Setup is guided, in three places with the same flow: paste a free
  `nvapi-` key → it is validated with a real 1-token completion
  (`dex:ai-test`) → the model picker is built from the live catalogue
  (`dex:ai-models-refresh`), never a hard-coded list. Retired models
  fall back automatically (`resolveModel`).
- Identity: every send carries the Dexerion Assistant system instruction,
  which forbids claiming to be any other assistant or model.
- Memory is per-account, persisted to `memory.json`, capped at 50 facts
  of 500 chars. It fills two ways: explicit chat commands (`remember …`,
  `forget …`, `what do you remember?`, answered locally with no model
  spend) and automatic learning — after every model reply the main process
  runs a small extraction pass over the exchange (new facts + `FORGET:`
  corrections, deduped, capped) without blocking the response. Every
  mutation broadcasts `dex:ai-memory-updated` so open panels refresh live;
  `dex:ai-memory-list/add/delete/clear` back the sidebar panel and the
  Settings count/clear row.
- Navigation races: `openChat`/`createChat` carry an epoch so out-of-order
  responses never paint a stale conversation (this was the "new chat shows
  old messages" bug — the create broadcast usually beat its own response).
  `dex:ai-chats-updated` only refreshes the list in place, syncing the open
  title and closing the view if its chat was deleted elsewhere.
- Snip-to-chat reuses the snip overlay: the composer ✂ button opens it in
  attach mode (`dex:snip-open {attach:true}`), the overlay gains
  Attach-to-chat actions, and `dex:snip-attach` forwards the PNG to the
  shell as a `dex:ai-attach-image` chat attachment (same downscale pipeline
  as file/paste attaches). A thinking-dot indicator plays in the reply
  bubble until the first streamed chunk replaces it.
- `npm run test:ai` covers the provider, memory and the agent runner with
  stubbed network and keychain (116 checks); `npm run test:ai-live` needs
  `NIM_TEST_KEY` and spends real quota.

## Agent, browser-wide research and missions

The agent loop (`src/main/ai-agent.js`), tool catalogue
(`src/main/ai-tools.js`), page scripts (`src/main/ai-page.js`) and the pure
research helpers (`src/main/ai-research.js`) extend the assistant from
single-tab actions into browser-wide work. Everything privileged still lives
in the main process; the sidebar only renders `dex:agent-event` and answers
confirmations.

- Tools: `snapshot`/`click`/`type`/… act on the run's tab; `list_tabs`,
  `search_tabs` (title/URL ranking plus optional bounded content scans with
  snippets), `read_tab` (any window; wakes a slept tab in the background
  without covering the active one), `switch_tab`, `open_tab`, `close_tab`
  (tier 3) work across every window — tab ids are unique across windows.
  `inspect_tabs` runs the shared all-tabs sweep (below) in one call.
  `update_plan` keeps a goal + ordered steps (statuses, dependencies);
  `open_project` (tier 3 — the ask shows the exact title and goal) and
  `note_finding` file research into per-account projects.
- All-tabs inspection — one workflow, two entry points: the `inspect_tabs`
  agent tool and the composer's Read button (eye). `browser.js inspectAllTabs`
  drives `research.inspectTabs` with adapters: `allTabsSnapshot()` lists every
  tab (all windows, tab order, stable ids) and each tab is read individually
  through the same `readTabById` reader `read_tab` uses (sleeping/lazy tabs
  woken in place, allowlist revalidated after settle and before extraction,
  ids re-resolved at read time, never substituted). Closed, loading,
  unreadable or non-allowed tabs are recorded as failures with a reason and
  the sweep continues; a 40-tab cap and a 2-minute deadline mark leftovers
  instead of stalling. The report carries counts (discovered / inspected /
  failed / skipped), one line per tab with title, URL and an actual-content
  summary (description + headings + extracted excerpt — never generated),
  and confirmed duplicates by normalised URL. The button streams
  `dex:ai-inspect-progress` per tab, paints one step row per tab, and saves
  the report to the chat (so it survives reload and feeds later questions);
  `dex:ai-read-page` remains the single active-tab context read used by the
  page-context toggle on send. No tab is ever closed, navigated or modified
  by the sweep; inspection is single-flight per window and refused while an
  agent run is live in that window.
- Revalidation: immediately before executing, the dispatcher re-resolves the
  tab, re-checks readability and the allowed-sites list against the *current*
  URL, and refuses ref-based actions when the page no longer matches the URL
  the last snapshot recorded. Per-run budgets cap new tabs (5) and page reads
  (40); the step ceiling and repeat detector bound the loop as before.
- Trust: page text is framed as `<page_data>` everywhere; the agent prompt
  states pages cannot grant permissions, open projects or change the rules.
  A finding may only cite a URL the run actually read, and a quote must occur
  in the captured page text — unsupported citations are rejected by the
  dispatcher, so the model sees the refusal, not a silent acceptance.
- Missions (`missions.json` per account): one record per model-driven run —
  goal, plan (with dependencies), steps, approvals, result, status. Live
  events mirror into it; `dex:ai-missions-list/get/delete/clear` back the
  Missions sheet. A run left `running`/`paused` at exit reads as
  `interrupted` on the next look. Pause/resume (`dex:ai-agent-pause/resume`)
  parks the loop between actions while the sidebar lease still guards a
  frozen panel; stop halts the in-flight action and drops the queue.
- Research projects (`projects.json` per account, separate from
  `memory.json`): user-approved title/goal, sources (auto-recorded from the
  pages a run reads), findings with exact quotes or paraphrases, decisions
  and open questions. The Projects sheet inspects and deletes them.
- The sidebar adds runbar Pause/Resume, a live plan checklist (persisted with
  the chat message), and the Missions/Projects sheets. Settings → Acting on
  pages gains the cross-tab reading toggle; the allowed-sites list still
  gates where reads and acts happen.
- Coverage: `smoke.js` holds the pure research/citation checks and the
  all-tabs inspection workflow (ids, order, failures, duplicates, report);
  `test:ai` drives the runner headlessly (plan verification, pause/resume,
  cancellation, outage retry, budgets, ref freshness, `inspect_tabs` report +
  budget); `test:sidebar` covers the sheets, pause wiring and the Read
  button's full sweep (progress rows, saved report).
