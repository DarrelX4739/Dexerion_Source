# Dexerion — Full Product Audit

**Date:** 2026-11-18
**Build audited:** `site-v20` (commit `f5e3cd5`), Electron 44.4.5 / Chromium 144, Windows x64
**Scope:** the entire application — website generation, report generation/editing/preview, the AI
sidebar, all internal pages, settings, persistence, performance, accessibility, dependencies,
architecture, security and error handling.
**Method:** the real app was launched and driven (not mocked), every internal surface was visited
and screenshotted, the AI sidebar was driven through both the website and the report workflows
against a local NIM mock, and every finding was cross-checked against the source with Graphify,
static probes and targeted code reads. Audit probes live in `Dexerion_Main/build/scripts/audit-*.cjs`
and are re-runnable.

**Nothing was rewritten during the audit.** Every fix belongs to the Polish V1–V10 programme.

---

## Evidence index

| Probe | Command (from `Dexerion_Main/build/`) | Result |
|---|---|---|
| Real-app walkthrough | `node scripts/audit-walkthrough.cjs` | 17 surfaces visited, 14 screenshots, 72 console/request errors — **all one root cause** |
| IPC sender-guard scan | `node scripts/audit-ipc-guards.cjs` | 201 handlers scanned, 15 without a top-level guard call |
| Static security probe | `node scripts/audit-static-probe.cjs` | **0 / 15** internal pages carry a CSP; preload forwards every channel |
| Accessibility probe | `node scripts/audit-a11y-pages.cjs` | 18 unlabelled controls, 13 / 15 pages without `lang`, 1 page without `h1` |
| Hygiene sweep | `node scripts/audit-hygiene.cjs` | 434 empty catch blocks, 0 TODOs, 17 `console.log` (all dev-gated), 0 real `debugger` statements |
| Dependency audit | `npm audit --omit=dev` | 1 **HIGH** advisory (`adm-zip`), 0 moderate/low |
| Boot timing | `node scripts/audit-boot-timing.cjs` | cold shell DOM-ready **250 ms**, warm **253 ms** |
| Memory profile | `node scripts/perf.js` | 959 MB at boot, 996 MB with 5 tabs + assistant, +37 MB growth |
| Packaged build | `npx asar list …app.asar` | fonts, artefact modules and `assets/*` all shipped |

Screenshots: `Dexerion_Main/build/audit-shots/*.png`.
Machine-readable walkthrough record: `Dexerion_Main/build/test-results/audit-walkthrough.json`.

---

## 1. Findings, prioritised

### P0 — must be fixed first

#### F-01 · HIGH · Every web font fails to load on every internal page

**Evidence.** The real-app walkthrough visited 15 internal pages. **15 of 15 produced font errors**;
72 error lines were recorded and **all 72 trace to this single cause**:

```
console: Access to font at 'dexerion://assets/fonts/geist-latin-wght-normal.woff2'
        from origin 'null' has been blocked by CORS policy: Cross origin requests are only
        supported for protocol schemes: chrome, chrome-extension, chrome-untrusted, data,
        dexsite, http, https.
requestfailed: dexerion://assets/fonts/geist-latin-wght-normal.woff2 net::ERR_FAILED
```

Affected: Geist Variable, Geist Mono Variable, Newsreader Variable — i.e. the chrome face, the
monospace face and the report editorial face. `newtab`, `welcome`, `settings`, `history`,
`bookmarks`, `downloads`, `extensions`, `accounts`, `blocked`, `connecting`, `offline`,
`inspector`, `files`, `report` and `artifact` all fall back to the system stack. The app *looks*
right in a screenshot, which is exactly why this survived V1–V20: the fallback is silent.

**Root cause.** `code/src/main/browser.js:367-380` — the `dexerion://` protocol handler serves
assets with:

```js
return net.fetch('file://' + file.replace(/\\/g, '/'));
```

The response is returned verbatim. `@font-face` sources are **always** fetched in CORS mode, and
the handler never sets `Access-Control-Allow-Origin`. The internal pages have an opaque origin
(`null`), so every font fetch is rejected before the bytes are read.

**Why it matters.** The design system's entire type layer (tokens.css lines 17–55) is inert. The
report editorial face, the mono caption face and the chrome face are all missing on every page —
a product-wide visual regression that no unit test could see.

**Recommended fix.** Wrap the asset response and set `Access-Control-Allow-Origin: *` plus an
explicit `content-type` for the font extensions (`font/woff2`, `font/woff`, `font/ttf`,
`font/otf`); keep `x-content-type-options: nosniff` so the declared type is enforced.

**Resolved in `polish-v1` (commit `5f28cd0`), with one correction to the first attempt.** The
headers alone were not enough: Chromium refuses a CORS-mode request for a scheme that is not
`corsEnabled` at all ("Cross origin requests are only supported for protocol schemes: ..."). So
`code/main.js` now registers `dexerion` with `{ secure: true, supportFetchAPI: true, corsEnabled: true }`.
The first attempt also set `standard: true`, on the theory that a CORS check needs a real origin.
That was wrong, and it caused a worse regression than it fixed: `standard` gives every internal
page its own site instance, so each window hosting an internal page paid a cold renderer start —
measured 3–10 s on this machine against ~80 ms when the process is reused — which pushed the
inspector fallback panel and the network-wait page past their 6 s budgets and failed two GUI
selftest sections. With `corsEnabled` alone the fonts load (13/13 pages, `document.fonts`
reports `loaded`/`inUse=true`, 0 console errors) and pages keep sharing a renderer. The
header `access-control-allow-origin: *` satisfies the check for an opaque origin, which is why
`standard` was never needed.

---

#### F-02 · HIGH · `adm-zip` HIGH advisory on the extension extraction path

**Evidence.** `npm audit --omit=dev`:

```
vulnerabilities: {"high":1,"total":1}
adm-zip high:
  - Crafted ZIP file triggers 4GB memory allocation
  - adm-zip extraction follows destination symlinks, allowing arbitrary file overwrite
  - Uncontrolled memory allocation via the declared uncompressed size (DoS)
  - Decompression-bomb protection can be bypassed by declaring uncompressed size as 0
  - adm-zip extraction preserves SUID/SGID bits from untrusted ZIPs
  - Duplicate ZIP entry names: getEntry() and extractAllTo() resolve to different content
  - getDataAsync() bypasses the maxOutputLength size guard
  - Unhandled error event in async DEFLATE decompression crashes Node.js (DoS)
```

`code/src/main/extensions.js:287` and `:315` call `extractAllTo(dest, true)` on a **downloaded
extension package** — attacker-influenced content.

**Root cause.** The extension installer trusts the archive's own path and size metadata. There is
no validation of entry names (absolute paths, `..` segments, symlinks), no total-uncompressed-size
cap, and no duplicate-entry rejection.

**Recommended fix.** Replace `extractAllTo` with a per-entry extractor that (a) rejects absolute
paths and any path containing `..`, (b) rejects symlink entries, (c) caps the total uncompressed
size and the per-entry size, (d) rejects duplicate entry names, and (e) writes only inside the
destination root. The same hardened helper should serve `ai-artifact-zip.js` where it reads
archives.

---

### P1 — fix during Polish V1–V2

#### F-03 · MED · No Content-Security-Policy on any internal page

**Evidence.** `node scripts/audit-static-probe.cjs` — **15 / 15** internal pages report `csp=NO`:

```
accounts.html  csp=NO inlineScript=1   artifact.html csp=NO   blocked.html csp=NO
bookmarks.html csp=NO   connecting.html csp=NO   downloads.html csp=NO
extensions.html csp=NO   files.html csp=NO   history.html csp=NO
inspector-fallback.html csp=NO   newtab.html csp=NO   offline.html csp=NO
report.html csp=NO   settings.html csp=NO   welcome.html csp=NO
```

**Root cause.** The pages are served through `protocol.handle` (`browser.js:388-398`), which
returns the raw file with no `content-security-policy` header, and no page declares a meta CSP.

**Mitigating factor (verified, not assumed).** I checked the report viewer and the artefact
renderer for injection: `code/src/renderer/pages/report.html` builds every node with
`document.createElement` + `textContent` (the only `innerHTML` write is `wrap.innerHTML = ''`,
a clear), and `code/assets/ai-artifacts.js` does the same. Model-authored HTML is therefore not
executed as script in the page today.

**Why it still matters.** `dexerion://` pages hold the preload bridge. A single future
`innerHTML = modelText` regression becomes script execution in a privileged origin, and without a
CSP nothing contains it.

**Recommended fix.** Serve a CSP header from the `dexerion://` handler for the internal-page
branch (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
data:; font-src 'self'; connect-src 'self'`) — and verify the pages' inline scripts still run
before committing to it.

---

#### F-04 · MED · The preload forwards *every* IPC channel to every page

**Evidence.** `code/preload.js:8`:

```js
invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
on: (ch, fn) => ipcRenderer.on(ch, (e, ...a) => fn(...a)),
```

`code/src/main/browser.js:745-757` — **tab views, which load arbitrary websites, get this
preload**:

```js
webPreferences: {
  partition: ...,
  preload: path.join(__dirname, '../../preload.js'),
  contextIsolation: true, nodeIntegration: false, sandbox: false,
}
```

So a hostile page can call `window.dexerion.invoke('<any-channel>', ...)`. The only barrier is
the main-side sender check.

**Mitigating factor (verified).** `chromeSender(e)` (`browser.js:2735`) resolves the sender to a
window/tab and marks it `internal` only when its URL starts with `dexerion://`; `needChrome(e)`
(`browser.js:2773`) throws for any other sender. The guard scan shows **201 handlers, of which
186 are guarded**. The 15 that are not guard-resolved all resolve their own sender
(`snipCtx(e)` for the 11 snip channels, `BrowserWindow.fromWebContents` for `dex:inspector-retry`,
`ctxResolvers` for `dex:ctx-result`/`dex:ctx-dismiss`).

**Residual risk.** Two of the unguarded handlers are reachable from a web page and act on
Dexerion UI state:

- `dex:ctx-result` (`browser.js:2394`) resolves a context-menu selection by **id**, not by
  sender. The id is `'ctx' + Date.now() + random(1e6)` (`browser.js:2436`) and is delivered to the
  menu window, never to the page — but it is brute-forceable at 10⁶ per millisecond.
- `dex:menu-close` (`browser.js:4609`) uses `stateFor(e)`, which matches **any** tab's
  `webContents`, so a web page can dismiss a Dexerion menu.

**Recommended fix.** Narrow the preload to an explicit allowlist of the channels Dexerion's own
renderers use, and make `dex:ctx-result` / `dex:ctx-dismiss` verify that the sender is one of the
registered context-menu windows (`ctxWindows`).

---

#### F-05 · MED · 18 form controls have no programmatic label; 13 of 15 pages have no `lang`

**Evidence.** `node scripts/audit-a11y-pages.cjs`:

```
accounts.html    noLabel=3   labels: nm,em,gm
extensions.html  noLabel=1   labels: storeurl
history.html     noLabel=1   labels: q
newtab.html      noLabel=5   labels: q,ai-model,ai-key,ai-files
report.html      noLabel=1   labels: searchInput
settings.html    noLabel=7   labels: se,aiadapt,dl,aikey
totals: {"nameMissing":0,"labelMissing":18,"altMissing":0,"langMissing":13,"h1Missing":1}
```

A whole-file scan confirms it: across all 15 internal pages there are exactly **two**
`<label for>` elements (`report.html` only). Everything else relies on `placeholder`, which is not
an accessible name — it disappears the moment the person types and is skipped by several screen
readers. `report.html` also has no `<h1>` (its headings are injected at render time).

**Recommended fix.** Add `aria-label` (or a real `<label for>`) to the 18 controls, add
`lang="en"` to the 13 `<html>` elements, and give the report viewer a real `<h1>`.

---

#### F-06 · MED · 434 empty `catch {}` blocks hide failures across the codebase

**Evidence.** `node scripts/audit-hygiene.cjs`:

```
source files: 84 | empty catch blocks: 434 | TODO/FIXME: 0 | console.log: 17 | debugger: 0
  src\main\ai-agent.js      emptyCatch=50
  main.js                   emptyCatch=23
  src\main\ai-providers.js  emptyCatch=13
  code\src\main\ai-search-providers.js  emptyCatch=8
  code\assets\ai-artifacts.js            emptyCatch=8
```

Most are legitimately best-effort (optional files, teardown paths). The risk is the ones that
swallow a **user-visible** failure — for example the `catch {}` around `fs.writeFileSync` in the
artifact save path, where a failed write leaves an optimistic UI showing "Saved".

**Recommended fix.** Audit the empty catches on the persistence and save paths specifically and
turn the ones that can hide a failed write into surfaced errors. The rest can stay.

---

### P2 — fix during Polish V3–V5

#### F-07 · MED · The key state is only read when the sidebar opens

**Evidence.** Found while driving the real app: `dex:ai-open` makes the panel load its status,
and the sidebar's own setup flow (`ai-sidebar.js:2144-2171` `connectKey`) refreshes it correctly.
But a key set **from outside** the panel's own flow does not re-read the status, and the panel
keeps showing the setup card. This is not a bug in the in-app path (the Connect button works and
says "Key works. Pick a difficulty…"), but it is a fragile contract: the panel's readiness is a
one-shot read rather than a subscription.

**Recommended fix.** Make the panel re-read `dex:ai-status` on focus and after any key event
instead of only at open time, so the panel can never disagree with the stored state.

---

#### F-08 · LOW · Memory baseline is high, and the cold-start figure in the old notes was wrong

**Evidence.** `node scripts/perf.js`:

```
perf: boot            959 MB total, 117 MB main
perf: 5 internal tabs 979 MB total {"Browser":120,"GPU":308,"Utility":252,"Tab":299}
perf: + assistant     996 MB total
perf: growth from boot to 5 tabs + assistant: 37 MB
```

The older note "cold DOMContentLoaded 16.9 s" measured **Playwright's attach overhead, not the
app**. `node scripts/audit-boot-timing.cjs` measures the app itself:

```
cold  launch->firstWindow 0ms | ->domcontentloaded 181ms | ->toolbar 249ms | total 22398ms
warm  launch->firstWindow 0ms | ->domcontentloaded 179ms | ->toolbar 253ms | total 22725ms
```

**Interpretation.** The shell is usable in **250 ms**; the 22 s figure is the harness spawning
Electron under OneDrive. The growth figure (+37 MB for five tabs *and* the assistant) is the
number that matters, and it is good. The 959 MB boot baseline is mostly GPU + utility processes
(308 + 252 MB) and is the largest single lever left.

**Recommended fix.** No emergency action. Record the corrected boot number, and treat the GPU and
utility process footprints as the V10 performance target.

---

#### F-09 · LOW · The dependencies are few, but `adm-zip` is the only production one with a CVE

**Evidence.** `build/package.json` production dependencies: `adm-zip`, `lucide`, `motion`,
`open-props`. `npm audit --omit=dev` → 1 high (F-02), 0 moderate, 0 low. The dev tree
(`@playwright/test`, `jsdom`, `pdfjs-dist`, `tesseract.js`, `electron-builder`) is not shipped.

**Recommended fix.** Resolve F-02 by hardening the extraction path (a new dependency would need
its own approval).

---

### P3 — polish programme

#### F-10 · LOW · The design system's font layer is the only part of the token file that never shipped

**Evidence.** `code/assets/tokens.css:17-55` defines five `@font-face` rules for Geist Variable,
Geist Mono Variable and Newsreader Variable. `npx asar list` confirms `assets/fonts` **is** in the
packaged build, so the files are shipped and correct — they are simply never fetched (F-01).

**Recommended fix.** Fixed by F-01. Verify with the walkthrough that the error count per page
drops to zero.

---

## 2. Checked and clean (verified, not assumed)

| Area | Evidence |
|---|---|
| `dexsite://` virtual host | `ai-site-host.js:191-269` — `safeSitePath` rejects traversal, every response carries `content-security-policy`, `x-content-type-options: nosniff`, `cache-control: no-store`; `<base>` and meta-refresh are stripped |
| `dexerion://assets` traversal | `browser.js:372-378` — the resolved file must stay inside the assets root |
| Profile durability | `profile.js:20-31` — every write is atomic (temp file → `fsync` → rename) and the loader strips a BOM, so a crash cannot truncate the store |
| Report / artefact DOM injection | `report.html` and `ai-artifacts.js` build every node with `createElement` + `textContent`; no model text reaches `innerHTML` |
| AI transport error handling | `ai-providers.js:146-172` — 401/403 → "That NVIDIA API key was rejected", 429 → rate-limit message with a `retryable` flag, 5xx retried; `MAX_STREAM_BYTES` cap at `:655`; request timeouts; the key never leaves the main process |
| Key storage | The key is held in the OS keychain via the main process; `preload.js` exposes no key material and the renderer only sees the status object |
| IPC guard coverage | 201 handlers scanned; 186 call `needChrome`/`Aof`/`chromeSender`; the 15 that do not all resolve their own sender |
| Extension permissions | `code/src/main/permissions.js` is deny-by-default with an explicit prompt per host |
| Source hygiene | 0 TODO/FIXME, 0 stray `debugger` statements, 17 `console.log` all behind dev/selftest flags |
| Deleted modules stay deleted | `ics.js`, `schedule.js`, `timeframe.js`, `focus.js`, `pages/schedule.html`, `pages/modes.html` are absent; the smoke suite asserts their absence |
| Boot speed | Shell DOM-ready in 250 ms cold, 253 ms warm |

---

## 3. Top 5 risks, in order

1. **F-01** — the design system's type layer is dead on every internal page. One-line fix, product-wide visual effect.
2. **F-02** — untrusted archives extracted with a library that follows symlinks and honours attacker-declared sizes.
3. **F-04** — every web page can invoke every IPC channel; the main-side guard is the only barrier, and two unguarded handlers act on Dexerion UI state.
4. **F-03** — a privileged origin (`dexerion://`) with the preload bridge and no CSP.
5. **F-05** — 18 unlabelled controls and 13 pages without a document language across the whole internal surface.

---

## 4. What the audit did **not** find

Stated explicitly so the polish programme is not scoped by ghosts:

- **No broken workflow.** Every major path completed in the real app: 13 internal pages rendered,
  the AI sidebar streamed a reply, produced a **website card with all 22 actions and a live
  sandboxed preview**, and produced a **report card with 12 actions**, and the report viewer
  opened in its own tab. The report card's actions were `Open | Download HTML | Edit | Open in a
  tab | Design | Regenerate | Copy | Code | Undo edit | NOAA`; the site card's were `Preview |
  Download HTML | Open in a tab | Regenerate | Copy | Code | Project .zip | Download PDF | Phone |
  Tablet | Desktop | Expand | Restart | Console | Edit | Open Code | Fix with AI | Update | Cancel |
  Clear | Ask to fix`.
- **No data loss.** The atomic-write profile store, the per-account `saveAcc` persistence and the
  artefact store all held up; no optimistic-UI-without-write was found on the bookmark, history or
  login paths.
- **No console errors in the shell itself** — 0 shell console errors and 0 shell page errors across
  the whole walkthrough. Every error came from the font fetch.
- **No crash or hang** in the app during the walkthrough, the boot probe, the perf probe or the
  20-suite gate.

---

## 5. Agent contributions to the audit (honest bookkeeping)

| Role | Session | Outcome |
|---|---|---|
| Real-app walkthrough driver | (this agent, `build/scripts/audit-walkthrough.cjs`) | 17 surfaces, 14 screenshots, 72 error lines, all triaged to one root cause |
| Security + architecture reviewer | `ses_e1641207cffePSoQTnb8QzK4zE`, `ses_e162ccd78ffegxij45Na2qnhnj` | provider HTTP 429 twice — **no output received**; the same ground was covered directly by the static probe, the IPC-guard scan and the code reads cited above |
| AI sidebar reviewer | `ses_e164061a6ffexMFqfiSmNPaDNQ` | **output received**: 12 findings. #1 was a stored DOM XSS in the search-result list and is fixed in `polish-v1` (see F-11 below); #2–#5 are queued as Polish V2–V5 work (duplicate message mutations on react/pin/edit, duplicate-send race, composer state leaking across chats, cancellation not stopping agent work) |

No agent finding is claimed as evidence unless its output was actually received.

---

## 6. Finding added after the audit: F-11

### F-11 · HIGH · Stored DOM XSS in the AI sidebar's search results (found in `polish-v1`)

**Where.** `code/src/renderer/ai-sidebar.js`, the message-search result list. Each hit was built
as an HTML string from the message body and written with `innerHTML`, so any markup a model (or a
page a model read) had produced became live DOM in the sidebar renderer — which is the renderer
that can call `window.dexerion.*`.

**Fix in `polish-v1`.** `renderHighlighted()` now builds text nodes and marks with `createElement`;
each row is a real `<button>`; `.ai-msg-search-result` was reset in `shell.css` so a button row
looks like the old div, with a visible focus ring.

**Why it is listed separately from F-01..F-10.** The audit's static probe did not catch it — it
looks like ordinary string formatting — and the sidebar reviewer found it by reading the render
path. That is recorded here so the coverage gap is not mistaken for a clean result.

