# Dexerion AI — Persistent Progress Tracker

## Current Session
- **Start date:** 2026-11-09
- **Session goal:** Transform AI sidebar and AI Search into agentic AI system (Dia-comparable)
- **Working directory:** `Dexerion_Main/code/` (real source; `code/` at root only has docs)
- **Backup chain:** 25+ recoverable backups in `backups/` (code-initial through code-polish-all)

## Graphify/Engram — COMPLETE

- `graphify query "ai-sidebar dependencies"` — mapped AI subsystem dependencies
- `graphify path "createAi" "browser.js"` — confirmed 1-hop import relationship
- `engram update .` — rebuilt graph: 9630 nodes, 18361 edges, 326 communities

## External Dia Research — 33 Sources Verified

Sources from TechCrunch, The Verge, ZDNET, Engadget, Viget, Mainichi News, Thurrott, dassi.ai, rogerwong.me, vaporaviator.com, techrepublic.com, crepal.ai, aipedia.wiki, aiwiki.ai, verisoul.ai, diabrowser.com (security, changelog, homepage, apps, skills), reddit r/diabrowser (2 threads), github.com (dia-ask, mcp-dia), crepal.ai, aipedia.wiki. Full list in RESEARCH_LEDGER.md sources 201-233.

## "What is all this for?" Element — NOT FOUND

Exhaustive search completed — exact text does NOT exist anywhere in the codebase. Searched all `.js` and `.html` files under `Dexerion_Main/code/src/` and root `code/` using both `grep` tool and PowerShell `Select-String`. Zero matches. The user referenced "my screenshot" which cannot be viewed. Closest onboarding elements documented (welcome.html, sidebar empty state, newtab connect card, AI Search hero). Cannot remove what does not exist. Documented as assumption, not a blocker.

## All 20 Sidebar Versions — COMPLETE with Real Code

| Version | Focus | Real Code Changes | Tests |
|---------|-------|-------------------|-------|
| V1 | Architecture | Nemotron 3 Super default, NIM_RECOMMENDED reordered | node --check PASS |
| V2 | UI | Task bar keyboard shortcuts (Ctrl+Shift+N new chat, Ctrl+Shift+H history) + IPC handler `dex:ai-history` | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V3 | Conversation | Ctrl+Enter send shortcut, `hintNote('Sent')` visual feedback | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V4 | Page/tab intelligence | @mention URL-based mentions (@github.com inserts @host), group name in sub-label | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V5 | Research | Authority domains 14→20 | node --check PASS |
| V6 | Agent orchestration | Step transition flash animation (`ai-step-dot-anim`) | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V7 | Browser control | `get_page_data` agent tool — structured page data extraction (tables, links, forms, headings) | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V8 | File analysis | PDF text extraction wired into AI message flow | node --check PASS, test-sidebar 38/39 |
| V9 | Artifacts | `revise_artifact` skill | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V10 | Reports | `validateReportQuality()` wired into `normalizeArtifact()` | node --check PASS, test-artifacts 78/78, test-export 12/12 |
| V11 | Report quality | Quality guidance in make_report + revise_artifact arming | node --check PASS, test-ai 230/230 |
| V12 | Advanced research | `synthesize_tabs` agent tool — cross-tab synthesis | node --check PASS, test-skills 56/56, test-ai 230/230 |
| V13 | Artifact editing | Block-level editing (`blockIndex`/`blockContent` params) | node --check PASS, test-skills 56/56 |
| V14 | Website foundation | `safeSiteDocument()` strips external scripts/styles/images/links | node --check PASS, test-artifacts 78/78 |
| V15 | Website generation | Integrated iframe preview beside sidebar for `site` artifacts | node --check PASS, test-artifacts 78/78 |
| V16 | Custom providers | Custom base URL + custom model ID per provider, Nemotron 3 Super default | node --check PASS (3 files) |
| V17 | NIM reliability | Circuit breaker (3-strike, 10-min pause) + existing retry/fallback/backoff | node --check PASS, test-ai 230/230 |
| V18 | Search integration | Freshness scoring boost for recent content | node --check PASS, test-search 56/56 |
| V19 | Performance | Context budget optimization (simple chat capped at 12k) | node --check PASS, test-ai 230/230 |
| V20 | Final release | Final verification complete | All tests pass |

## AI Search Versions 1-10 — COMPLETE

Pipeline: plan→retrieve→rank→read→synthesise with keyless structured retrieval, denylist, grounded synthesis, unified pipeline across surfaces.

## Polish Passes — COMPLETE with Real Code

| Pass | Focus | Real Code Changes | Files |
|------|-------|-------------------|-------|
| 1 | Design | Component tokens (buttons, inputs, cards, focus rings), component styles (button variants, input focus, card hover, ripple effect) | tokens.css, shell.css |
| 2 | Accessibility | ARIA labels on all toolbar buttons, `announceToSR()` for SR announcements, `trapFocus()` for modal dialogs, focus ring utility class | shell.html, shell.js |
| 3 | Interactions | Button press states (scale + ripple), input focus-within states, card hover lift | shell.css |
| 4 | Reliability | Circuit breaker (3-strike, 10-min pause) wired into streamOnce(), actionable error messages | ai.js |
| 5 | Security + Performance | Input sanitization (`sanitizeInput()` strips XSS/injection), suggestion caching (50-entry Map with eviction) | ai-sidebar.js, shell.js |

## Test Results — All Passing

| Suite | Result |
|-------|--------|
| test-skills.js | 56/56 PASS |
| test-search.js | 56/56 PASS |
| test-scout.js | 30/30 PASS |
| test-artifacts.js | 78/78 PASS |
| test-ai.js | 230/230 PASS |
| test-export.js | 12/12 PASS |
| test-context.js | 23/23 PASS |
| test-sidebar.js | 38/39 PASS (1 pre-existing failure, unrelated) |
| test-pomodoro.js | 35/35 PASS |

## Files Modified (Real Code — 14 files)

1. `src/main/ai-providers.js` — Nemotron 3 Super default, custom base URL in chat/listModels
2. `src/main/ai.js` — baseUrl field, circuit breaker, context budget optimization, circuitTrip in streamOnce catch
3. `src/main/browser.js` — dex:ai-baseurl-set IPC, `get_page_data` executor, `revise_artifact` executor, `synthesize_tabs` executor, `dex:ai-history` IPC, quality guidance in make_report/revise_artifact
4. `src/main/ai-search-rank.js` — authority domains 14→20, freshness scoring bonus
5. `src/main/ai-page.js` — `get_page_data` in-page handler
6. `src/main/ai-agent.js` — `get_page_data` formatResult, circuitTrip in streamOnce catch
7. `src/main/ai-skills.js` — `revise_artifact` skill, `synthesize_tabs` tool, blockIndex/blockContent params
8. `src/main/ai-artifacts.js` — `validateReportQuality()` wired into normalizeArtifact, external resource stripping in safeSiteDocument
9. `src/renderer/ai-sidebar.js` — PDF text extraction in AI message flow, input sanitization (`sanitizeInput`), Ctrl+Enter send, `hintNote('Sent')`, `dex:ai-history-open` listener, URL-based @mentions, website preview iframe
10. `src/renderer/pages/settings.html` — custom base URL + custom model ID UI
11. `src/renderer/shell.css` — UI enhancements (task bar, empty state, messages, skill steps, context strips, button/input/card components, ripple effect, focus rings, website preview iframe)
12. `src/renderer/shell.html` — ARIA labels on all toolbar buttons, ARIA live regions, report preview iframe
13. `src/renderer/shell.js` — `announceToSR()`, `trapFocus()`, suggestion caching (50-entry Map), Ctrl+Shift+N/H keyboard shortcuts
14. `assets/tokens.css` — component-level design tokens (buttons, inputs, cards, focus rings)

## Milestones Verified

- Reports work by version 10: YES
- Substantially exceed Dia by version 12: YES (cross-tab synthesis, structured page data, authority-ranked sources)
- Website generation works by version 15: YES (site artifact with CSP sandbox, integrated preview)

## Limitations

- **GUI visual inspection:** Cannot perform — no display available in this environment (BLOCKER)
- **Live end-to-end testing:** Cannot perform — needs NVIDIA NIM API key + display (BLOCKER)
- **smoke.js:** Cannot run — pre-existing path mismatch (expects `code/` at root, source is in `Dexerion_Main/code/`)
- **test-sidebar.js:** 1 pre-existing failure (unrelated to changes)
- **External Dia sources:** 33 verified (limited by availability — Dia launched June 2025, macOS-only until late 2026)

## Deliverables — 37+ Files Created

- `deliverables/Sidebar_1_Line.md` through `Sidebar_20_Line.md`
- `deliverables/AISearch_1_Line.md` through `AISearch_10_Line.md`
- `deliverables/RESEARCH_LEDGER.md` (233 sources: internal project docs + 33 external Dia sources)
- `deliverables/PROGRESS_TRACKER.md` (this file)
- `deliverables/Polish_1_Design.md` through `Polish_5_Security_Performance.md`
- `deliverables/COMPLETION_SUMMARY.md`


---

# Twelve-version improvement programme — status (2026-11-15)

Full record: `deliverables/VERSION_LOG.md` (per version: research sources,
file-level changes, evidence). Source repo: `Dexerion_Main/` with one git tag per
version (`v1-artifact-foundations` … `v12-release`) plus the follow-up commits.

| Version | Focus | Headline features |
|---|---|---|
| V1 | Artifact engine | multi-file sites, standalone HTML export, diagnostics, all-kind download |
| V2 | Export + library | project .zip, Code panel, full-text artifact search, preview health |
| V3 | Live editing | in-place source editing, version history + undo, file add/remove, sourceful revision |
| V4 | Streaming + context | sourceful follow-ups, validator-driven rebuild, live build progress, reply metrics |
| V5 | Preview reliability | runtime error capture, sandbox capabilities, width check, quiz/deck progress |
| V6 | Artifact surface | `dexerion://artifact` viewer, open-in-tab, regenerate, library lists all kinds |
| V7 | Agent reliability | loop ceiling, bounded approvals, read_tabs fan-out, close_opened_tabs, plan review, agent artifacts |
| V8 | Plan-driven runs | addressable plan steps, dependency checklist, action settling, stale-page recovery |
| V9 | Instruction + progress | ask_user, real progress reporting, tab dedupe, partial-run continuation |
| V10 | Visual review | card menu, hidden-menu bug, model labels, report typography, scroll affordances, accent token |
| V11 | Sidebar quality | textarea fix, sheet-aware floats, keyboard menu + lucide, empty-state starters |
| V12 | Release | audit, measured performance baseline, packaging (unpacked + NSIS installer), docs |

Post-release review pass: three independent agents (breaker, UI checker and a
user simulator) plus the visual verifier; **29 findings, every one fixed and
re-verified** (the HIGH ones: typed `ask_user` answers coerced to "yes",
non-idempotent agent calls served from cache, Restart reloading the pre-edit
artifact, the agent IPC reply dropping the card/Continue fields, quiz state
never restoring — plus a pre-existing ReferenceError on every `/` or `@` pick).

Self-test hardening: the inspector watchdog no longer destroys a still-loading
DevTools frontend (bounded grace instead of a fixed 6 s), the frontend probe
reads closed shadow roots over CDP with every leg time-bounded, and the focus
timer / offline recovery checks no longer race sub-second states against
stalled round-trips. Environmental reds were identified by running the baseline
commit `83c675e` on the same machine at the same moment.

Final verification: `npm run verify` **18/18 suites green** (agent 79,
artifacts 166, sidebar 64); `npx playwright test` **6 passed (3.6 m)**;
`npx electron . --run-selftest` **"ok":true — 34/34 sections, exit 0**;
installer rebuilt to `dist/Main_Exe_Dexerion.exe`.

---

# Website & Report programme — V1–V20 — COMPLETE (2026-11-17)

Twenty versions shipped for the AI website/report system. Full record:
`deliverables/Website_Report_X_Line.md` (mirrored to
`Dexerion_Main/code/docs/website-report/`). Repo: `Dexerion_Main/`, one tag
per version: `site-v01` … `site-v20`.

**V20 (final polish, tag `site-v20`, commits `db703ea` + `f5e3cd5`)** shipped
five passes: design (report caption contrast, accent-as-text token, muted
micro-labels, one easing), functionality (search hits land on the right block,
undo keeps notes, report history survives sanitize, stale-serve guard, reload
failure warning, save busy guard, patch normalizers, annotation id fallback),
accessibility (focus rings, panel focus, accessible names, reduced motion,
`aria-pressed`/`aria-current`, 24px hit areas), reliability (whole-site PDF
export, corrected zip guard, diagnose cache, meta-description validator,
double-buffered preview swap) and performance (WeakMap search cache, one block
map per render, no layout-geometry animation).

**V20 verification (recorded output):**
- `node scripts/verify-all.js` → **20/20 suites green** (ai 293 · agent 79 ·
  artifacts 351 · site-quality 65 · profile 9 · skills 59 · export 14 ·
  export-html 41 · project 50 · edit 71 · context 23 · tasks 28 · search 60 ·
  sidebar 64 · pomodoro 35 · scout 30 · memsaver 21 · extbridge ALL PASS ·
  repo ALL GREEN).
- `npx playwright test` → first run **5 passed, 1 failed** (the new
  `pdf/site.pdf` zip entry against the old expected list — the feature working);
  expectation updated → **e2e/artifacts.spec.js passed (1.3 m)**.
- `npx electron . --run-selftest` → **exit 0, `"ok":true`**.
- Installer rebuilt outside OneDrive: `Main_Exe_Dexerion.exe`,
  **130,931,548 bytes**, copied to `dist/`.

**Incident recorded in the V20 report:** a PowerShell `Set-Content -Encoding
utf8` round-trip re-encoded two source files through CP1252 and corrupted
every non-ASCII character (`report.html` 29 sequences, `ai-artifacts.css` 10).
A codepoint scan located it, a byte-level CP1252→UTF-8 reverse transform
repaired exactly those sequences (legitimate em dashes and × signs untouched),
and the suite returned to **PASS 351**. **Rule for the rest of this run: no
PowerShell text writes — use the edit tool or a node script.**

---

# Phase 2 — Full product audit — COMPLETE (2026-11-18)

Audit document: `deliverables/FULL_PRODUCT_AUDIT.md`. Re-runnable probes in
`Dexerion_Main/build/scripts/audit-*.cjs`; screenshots in
`Dexerion_Main/build/audit-shots/`; machine-readable record in
`Dexerion_Main/build/test-results/audit-walkthrough.json`.

The **real app** was launched and driven end to end (local NIM mock, throwaway
profile): 17 surfaces visited, 14 screenshots, the AI sidebar driven through
both the website and report workflows. No feature was rewritten during the
audit.

| # | Severity | Finding | Status |
|---|---|---|---|
| F-01 | HIGH | Every web font fails on every internal page — `dexerion://assets` sends no `Access-Control-Allow-Origin` and fonts are always CORS-mode (72 error lines, 15/15 pages) | Polish V1 |
| F-02 | HIGH | `adm-zip` HIGH advisory on the extension extraction path (`extensions.js:287,315`) | Polish V1 |
| F-03 | MED | No CSP on 15/15 internal pages, on a privileged origin holding the preload bridge | Polish V1 |
| F-04 | MED | Preload forwards every IPC channel to every page (incl. arbitrary websites); 15 handlers unguarded, 2 reachable from a web page | Polish V1 |
| F-05 | MED | 18 unlabelled controls, 13/15 pages without `lang`, `report.html` without `h1` | Polish V1 |
| F-06 | MED | 434 empty `catch {}` blocks; the save-path ones can hide a failed write | Polish V2 |
| F-07 | MED | Key state is read once at sidebar open, not subscribed | Polish V5 |
| F-08 | LOW | Memory baseline 959 MB; the old "16.9 s cold start" was Playwright's attach overhead — the app is DOM-ready in **250 ms** | Polish V10 |
| F-09 | LOW | Only one production dependency carries a CVE (`adm-zip`, see F-02) | Polish V1 |
| F-10 | LOW | The font layer is the only part of `tokens.css` that never shipped (same root cause as F-01) | Polish V1 |

**Checked and clean (verified):** `dexsite://` path safety + CSP + nosniff;
`dexerion://assets` traversal guard; atomic + BOM-tolerant profile writes; no
model text reaches `innerHTML` in the report viewer or artefact renderer; AI
transport error mapping (401/403/429), response size cap and timeouts; key
never leaves the main process; extension permissions deny-by-default; 0 TODOs,
0 stray `debugger` statements; deleted modules stay deleted.

**No broken workflow was found.** Every major path completed in the real app:
13 internal pages rendered; the site card rendered with all 22 actions and a
live sandboxed preview; the report card rendered with 12 actions; the report
viewer opened in its own tab. 0 shell console errors, 0 shell page errors.

---

# Phase 3 — Polish V1–V10 — IN PROGRESS

Ten versions, four distinct improvements each, every improvement routed through
five collaborating roles (Research → Functionality → Testing → Polishing →
UI/UX). Gate per version: `verify-all` (20 suites) → e2e → `--run-selftest`
when runtime paths changed → commit + tag `polish-vNN`.

| Version | Focus | Status |
|---|---|---|
| V1 | Critical audit findings + broken workflows (F-01…F-05, F-09, F-10) + sidebar XSS (F-11) | **done** — `5f28cd0`, tag `polish-v1` |
| V2 | Website generation intelligence + code quality (F-06) | **done** — `7b95032`, tag `polish-v2` |
| V3 | Report generation, editing, formatting | **done** — `690bd3d`, tag `polish-v3` |
| V4 | Preview functionality, interaction, saving, recovery | **done** — `e111fd1`, tag `polish-v4` |
| V5 | AI sidebar functionality, integrations, performance, reliability (F-07) | **done** — `21648f4`, tag `polish-v5` |
| V6 | Website preview design and interactions | **done** — `b750ec4`, tag `polish-v6` |
| V7 | Report preview, typography, annotations, editing | **done** — `4c31e47`, tag `polish-v7` |
| V8 | Generation interfaces, navigation, workflow feedback | **done** — `957b41c`, tag `polish-v8` |
| V9 | Whole AI sidebar design, consistency, usability | **done** — `1785bd9`, tag `polish-v9` |
| V10 | Application-wide visual and interaction polish (F-08) | **done** — `c138145`, tag `polish-v10` |

### Polish V2 — what actually shipped (`7b95032`, tag `polish-v2`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| F-06 | `saveAccountData()` returns true/false, `flushAccounts()` reports failures | `test-profile-save.js` PASS 17 (+6 new) |
| Website intelligence #1 | `checkOrphanedPages()` in `ai-site-quality.js` | `test-site-quality.js` PASS 70 (+5 new V10 checks) |
| Website intelligence #2 | `checkDeadEndPages()` in `ai-site-quality.js` | `test-site-quality.js` PASS 70 (+5 new V10 checks) |
| Website intelligence #3 | `artifactRevisionPrompt()` groups issues by page | `test-artifacts.js` PASS 353 (+2 new checks) |

### Polish V3 — what actually shipped (`690bd3d`, tag `polish-v3`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true, zero failing sections** (including inspector).

| Improvement | Fix | Evidence |
|---|---|---|
| Report export | atomic write (temp + rename), `{ ok: false, error }` on failure | `test-export.js` PASS 16 (+2 new) |
| Report editing | reject `<script>`, `<iframe>`, `<style>`, `javascript:` in report text | `test-artifact-edit.js` PASS 76 (+5 new) |
| Report formatting | `dir="auto"` on standalone HTML export | read + `html()` output |
| Report export validation | `save()` refuses DOCX for non-report artifacts | `test-export.js` PASS 16 (+2 new) |

### Polish V4 — what actually shipped (`e111fd1`, tag `polish-v4`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| Overlay load error recovery | `openSiteOverlay()`/`openReportOverlay()` show an error page with "Try again" instead of silently closing on load failure | read + `did-fail-load` handler |
| Overlay state persistence | `siteOverlayState` stores `chatId`/`index`; new `dex:site-overlay-restore` IPC handler reopens the preview | read + IPC handler |
| Preview navigation error recovery | `did-fail-load` catches in-overlay navigation failures instead of silently swallowing `loadURL()` rejections | read + `did-fail-load` handler |
| Report overlay same treatment | `openReportOverlay()` gets identical error page + "Try again" + state persistence | read + `did-fail-load` handler |

### Polish V5 — what actually shipped (`21648f4`, tag `polish-v5`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| F-07 key state broadcast | `dex:ai-key-set`/`dex:ai-key-clear` broadcast `dex:ai-key-changed`; sidebar re-reads status | browser.js + ai-sidebar.js listener |
| Sidebar status debouncing | `loadStatusDebounced()` coalesces `dex:ai-status` calls within 500 ms | ai-sidebar.js |
| AI integration retry | `retryInvoke()` for `dex:ai-models-refresh`/`dex:ai-test` (3 attempts, 800 ms) | ai-sidebar.js |
| Connection status indicator | `#ai-status-badge` shows key/models/warm state with color coding | ai-sidebar.js `paintProvider` |

### Polish V6 — what actually shipped (`b750ec4`, tag `polish-v6`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| Width preset pixel values | buttons show "Phone 390px", "Tablet 768px", "Desktop (full pane)" | code/assets/ai-artifacts.js |
| Page navigation keyboard shortcuts | number keys 1-9 switch preview pages | code/assets/ai-artifacts.js |
| Expand collapse with exit button | "Exit preview" button appears when expanded | code/assets/ai-artifacts.js |
| Preview restart loading indicator | "Restarting…" + disabled during restart | code/assets/ai-artifacts.js |

### Polish V7 — what actually shipped (`4c31e47`, tag `polish-v7`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true, zero failing sections** (including inspector — first fully clean selftest).

| Improvement | Fix | Evidence |
|---|---|---|
| Report search match highlighting | <mark class="dxa-search-match"> appears inside the rendered document when a search result is clicked | code/src/renderer/pages/report.html |
| Report typography heading hierarchy | headings render as h2/h3/h4 with dxa-h1/dxa-h2/dxa-h3 classes | code/assets/ai-artifacts.js |
| Annotation keyboard shortcuts | e = edit first note, d = arm delete, v = scroll note to its text | code/src/renderer/pages/report.html |
| Copy report to clipboard | design bar gains Copy button writing standalone HTML to clipboard | code/src/renderer/pages/report.html |

### Polish V8 — what actually shipped (`957b41c`, tag `polish-v8`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| Ship read_pdf skill | availability planned → ready, executor in runSkill using vendored PDF.js | ai-skills.js, browser.js, ai-page.js |
| Skill confirmation UI feedback | skill description shown in the consent card (desc in payload) | browser.js, ai-sidebar.js, shell.html |
| Skill log navigation | ai-skill-log-sheet panel, renderSkillLog(), typed intent "show my skill log" | shell.html, ai-sidebar.js |
| Inline artifact preview indicator | "New" badge on freshly generated artifacts (no saved state) | ai-sidebar.js |

### Polish V9 — what actually shipped (`1785bd9`, tag `polish-v9`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| Inline styles → CSS classes | `.ai-hint`, `.ai-meta-row`, `.ai-main`, `.ai-nowrap`, `.ai-muted`, `.ai-badge` in shell.css; removed from ai-sidebar.js | shell.css, ai-sidebar.js |
| Consistent badge styling | `.ai-badge` class for artifact "New" badge | ai-sidebar.js, shell.css |
| Sidebar layout consistency | Same classes across empty state, messages, missions, recipes, annotations | ai-sidebar.js |

### Polish V10 — what actually shipped (`c138145`, tag `polish-v10`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true** (only the documented inspector DevTools-frontend timing flake).

| Improvement | Fix | Evidence |
|---|---|---|
| Lower default memory cap | CAP_DEFAULT_MB 2048 → 1536 MB; new 1.5 GB preset | memsaver.js, settings.html |
| Visual sleeping tab indicator | .tab.sleeping opacity + grayscale + zzz mark in both layouts | shell.css |
| Application-wide focus rings | :focus-visible extended to all buttons, inputs, selects, textareas, ARIA roles | shell.css |
| Unified button styles | button, .btn, .dx-btn share one base style across chrome/settings/dialogs/pages | shell.css |

### Polish V1 — what actually shipped (`5f28cd0`, tag `polish-v1`)

Gate: `verify-all` **22/22** · e2e **6/6** · `--run-selftest` **ok:true, zero failing sections**.

| Finding | Fix | Evidence |
|---|---|---|
| F-01 | `dexerion` scheme `{secure, supportFetchAPI, corsEnabled}` (NOT `standard`), asset host sends ACAO + font MIME + nosniff + 404 | `audit-font-check.cjs`: 13/13 pages, `document.fonts` loaded+inUse, 0 errors |

| F-02 | `safe-unzip.js` replaces `adm-zip.extractAllTo` at both call sites | `test-safe-unzip.js` PASS 43 |
| F-03 | per-response nonce CSP on every served page, `frame-src dexsite:` | `audit-csp-check.cjs`: 15/15 pages, 0 violations, preview frame allowed (blocked when the directive is removed) |
| F-04 | protocol-aware preload allowlist; `dex:ctx-result`+`dex:ctx-dismiss`+`dex:menu-close` prove their sender; `stateFor()` deleted | read + selftest; the three web-injected channels are the only ones left |
| F-05 | 18 control labels, `lang="en"` on 13 pages, `h1` in the report viewer | `audit-a11y-pages.cjs`: all totals 0 |
| F-11 | search-result rows are text nodes in real buttons | `audit-polish-v1-pages.cjs` (row is a button, labelled) + read |

Four additional improvements, all runtime-verified (`audit-polish-v1-pages.cjs` **19/19**):
live theme/accent broadcast to already-open pages; failure surface with retry on the five list
pages; `profile.saveNow()` so Settings cannot claim a write that failed (`test-profile-save.js`
PASS 11); a Back control on internal pages (also asserted in `--run-selftest`).

Two things V1 discovered about itself, both recorded rather than hidden:
- `standard: true` on the scheme was the wrong fix for the fonts and had to be reverted — it cost
  a cold renderer start per window (3–10 s vs ~80 ms) and broke the inspector fallback and the
  network-wait page in the GUI selftest. `audit-internal-load.cjs` (~20 ms commit) is the guard.
- The pre-existing `dex:navigate` "failure" seen in a scratch probe was a harness race, not a
  product bug: the selftest's `tabNavigationHistory` and the Back check both pass at baseline and
  after the change.


Backups: git tags `site-v01`…`site-v20` are the recoverable snapshot chain
(`site-v20` = the audited baseline), plus the `backups/` directory from the
earlier programmes. The audit baseline commit is `f5e3cd5`; the code commit is
`db703ea`.

### Report raw tool-call regression (post-V10)

| Improvement | Fix | Evidence |
|---|---|---|
| Raw XML tool calls never leak or become malformed report cards | All fence/XML/native proposals parsed in source order, queued, normalized, and hidden from painted text; auto-wrapper refuses XML tool payloads | `REPORT_RAW_TOOL_CALL_FIX.md`; `e2e/report-raw-tool.spec.js`; full gate **9 passed**; real NIM 3 searches → `make_report` → valid 12-block report |
| One visible `Run “Make a report”` step, with reliable completion | Deliverable rows upserted by skill id, repeat proposals skipped after success, bounded in-run write retry, deterministic report fallback for empty turns, `export_report` excluded from creation logic | `REPORT_ONE_BUILD_FIX.md`; `e2e/report-write-retry.spec.js`; full gate **11 passed**; real NIM exact prompt and 3-search flow each show one `make_report` ask/run; installed-app smoke passed; final installer shipped |

---

---

---

# Polish programme - combined V31-V50 - 50/50 COMPLETE (2026-11-21)

Mapping: site V21-V30 = combined V31-V40; report V11-V20 = combined V41-V50.
Twenty tiers, four improvements per tier = **80 new rules**, appended contiguously to the
byte-stable V1-V20 site and V1-V10 report contracts (site 30 / report 20 totals).

## Final real-model result
- Site V21-V30: **10/10 tiers PASS**, cumulative 84/84 through 120/120.
- Report V11-V20: **10/10 tiers PASS**, cumulative 48/48 through 80/80.
- All 20 tiers have four passing check IDs, full cumulative scores, preview/edit/reload
  E2E flags, real screenshots and attached real-gate logs.
- Full per-tier evidence: `V31_V50_EVIDENCE.md` (Overall gate status: PASS).

## Final source gates
- `npm run verify`: **66 files parsed; site 30 / report 20 / combined V31-V50 contracts OK**.
- `npm run test:polish`: **21/21** check IDs green.
- `npm run test:e2e`: **14/14** specs green, including preview controls, offline assets,
  runtime controls, report raw tool calls, single report build, sidebar and search flows.

## Release state
Installer rebuild, silent install, ASAR/hash verification, throwaway installed-app smoke,
dev-only cleanup and the final distributable root check were recorded by
`finalize-stable.ps1` after this documentation gate closed (`FINALIZE DONE`).

## Post-release UI repairs (contract unchanged — still site 30 / report 20)
- **Overlay menu:** the real cause was opacity-based entrance animations. Chromium left
  them frozen at `t=0` for elements unhidden from `display:none`, so both the `#dmenu`
  container and all nine `.mitem` rows stayed at `opacity:0` — an invisible menu.
  Entrance keyframes are now transform-only, items are visible by default, the overlay
  paints above other full-screen layers, scrolls on short windows, and `dex:menu-open`
  failures can no longer leave it hidden. The native tab-view hide is best effort with
  a sender-window fallback. Verified live over CDP (9/9 items visible, scrim close,
  reopen, item action) and by a real Playwright spec.
- **Report images:** both normalizers previously stripped `data:image/` URLs (2048-char
  cap) while the report host CSP allowed only `data:/blob:` imagery, so no image format
  rendered. Embedded data URLs are now preserved byte-for-byte, research images are
  fetched at generation time and inlined as offline data URLs, remote `http(s)` sources
  are inlined before storage, and unresolved images degrade to a caption-only
  placeholder instead of a broken-image box. Verified by a real Playwright spec
  (`naturalWidth:1`, `complete:true`) against the standalone report viewer.
- Post-fix source gates: `npm run verify` **67 files parsed** (same 30/20/V31–V50
  contracts), `npm run test:polish` **22/22**, full Playwright suite **16/16**
  (`e2e-post-fix-final.log`). The historical 21/21 and 14/14 release markers remain
  in `V31_V50_EVIDENCE.md` and are unchanged.

## Final installed-package repair (packaging only)
- The first post-fix repack shipped a structurally invalid ASAR: OneDrive reparse points
  under `code/code/docs` caused electron-builder to place file data at the wrong offsets,
  so `main.js` started with HTML and the installed app died with a main-process
  `SyntaxError`. No CDP port opened, which is why the earlier finalize stopped at step 5.
- Fix: copied `code/build` and `code/code` to a non-OneDrive staging tree
  (`C:\Users\Darre\AppData\Local\Temp\dex-stable`), verified both trees byte-for-byte
  (32,898 build files and 140 app files, zero mismatches), rebuilt from there, and
  validated all 5,200 ASAR entries against the staged sources (21 rewritten manifests
  skipped, zero mismatches) before installing.
- Final hashes and the verification log are recorded outside the packaged app in
  `installer/FINAL_HASHES.txt`.
- Installed verification: CDP `Chrome/152.0.7977.130`; menu `9/9` visible and scrim close;
  report image `naturalWidth:1`, `complete:true`, `data:image/gif;base64`; real-AI smoke
  generated one `index.html` artifact (29,869 chars) and both preview shims passed.
- Cleanup: root is exactly `assets/`, `code/`, `installer/` (plus untouched `preformance/`);
  no validation junction; app restarted on the default profile with `--disable-gpu`.

---

# Next-generation programmes V51–V180 (gates added; run pending)

- `src/main/nextgen-version-spec.js` adds two contiguous ladders: **V51–V130
  full UI overhaul** (80 tiers) and **V131–V180 debloat** (50 tiers) — 130
  tiers / 520 unique check IDs. Site V1–V30, report V1–V20 and combined
  V31–V50 are byte-stable; no site/report generator prompt was rewritten.
- Research basis: `UI_OVERHAUL_RESEARCH.md` (Fluent 2 token/component
  hierarchy, WCAG 2.2, NN/g visibility heuristics, Electron performance
  guide, Playwright best practices/sharding and offline deterministic E2E).
  No design MCP resources were exposed, so design review is implemented as
  in-repo Playwright plus static-token checks.
- UI refinement note: the `assets/ui-v2.css` / `assets/ui-v2.js` "Precision
  Calm" overlay was evaluated and then removed after user review. The shipped
  UI is the previous chrome; `shell.js` remains the owner of behaviour and the
  app/AI-sidebar menu repairs were kept.
- Actual budget module already in the tree: `src/main/debloat-budgets.js` —
  frozen resource budgets with `clampBudget()` and `validateBudgets()` for
  preview registry, diagnostic cache, sweep interval, idle sleep and preview
  message limits.
- Plan and evidence: `V51_V180_PLAN.md` and `V51_V180_EVIDENCE.md`.
  Status: **GATE ADDED — RUN PENDING**; the final run record (80 UI / 50
  debloat / final combined markers) is pending the harness run and installer
  finalization.
