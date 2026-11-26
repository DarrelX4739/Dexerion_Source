# Dexerion Optimisation Plan

Companion to `RESEARCH.md` (evidence log, 425 sources). This plan is what the
Builder executes; the Tester's measurement work is tier C. Ranking below is
expected impact × safety (highest first within each tier).

Ground rules (hard constraints, repeated from the mission):
- Never remove features, never change the UI, never degrade foreground
  responsiveness, never game benchmarks.
- The `CalculateNativeWinOcclusion` disable stays (Windows occlusion misfires
  break Cloudflare challenges — see main.js note and RESEARCH [177][361]).
- No `--in-process-gpu` (AppHangB1 history — main.js comment; RESEARCH [26]).
- Hardware video decode stays on in every GPU tier (RESEARCH [29][362]).
- Every lever ships with a kill switch (env flag or named budget), following
  the existing `DEX_DEBLOAT_BASELINE` pattern (debloat-budgets.js; RESEARCH
  [348][349][415]).

Item fields: {id, lever, files/functions, mechanism, expected effect,
functional risk, reversibility, verification}. Evidence references point into
RESEARCH.md.

Status legend: **DONE** = already in the repo, do not redo; **NEW** = to build;
**AUDIT** = measure first, change only if profiling justifies.

---

## Tier A — No-brainer safe switches/config (main.js)

### A1. Bounded HTTP + media disk cache 【NEW, medium impact】
- lever: cap Chromium's disk cache so long sessions don't accumulate disk-I/O
  work and cache maintenance cost.
- files/functions: `main.js` (next to the existing switch block, lines ~75–79);
  new named budget in `src/main/debloat-budgets.js`
  (`diskCacheBytes: 256 * 1024 * 1024`, `mediaCacheBytes: 192 * 1024 * 1024`).
- switches: `--disk-cache-size=<bytes>`, `--media-cache-size=<bytes>` (both
  launch-time only — RESEARCH [79]).
- mechanism: Chromium's simple-cache backend's maintenance/eviction cost scales
  with cache size (RESEARCH [31][32][208][209]); a bounded cache bounds that
  background I/O. Cache *hits* are unaffected for working sets under budget.
- expected effect: power ↓ (disk spins/I/O energy), RAM ~0, CPU ~0, GPU 0.
- functional risk: very low — sites may re-download content evicted early.
  Working sets under 256 MB are unaffected; oversized media sites could
  re-fetch. Keep caps generous; revisit only with NetLog evidence (RESEARCH
  [211][389]).
- reversibility: `DEX_CACHE_BUDGET=off` skips the switches entirely; budgets
  are named and clamped like the existing ones.
- verification: `power-benchmark.js` run before/after (disk-light scenario);
  NetLog capture shows no functional cache-miss regression; Windows perf
  counter `\PhysicalDisk(_Total)\Avg. Disk Queue Length` sampled by the Tester
  (RESEARCH [162][163]).

### A2. Disable Chromium background networking Dexerion doesn't use 【NEW, low-medium impact】
- lever: `--disable-background-networking` (+ `--disable-component-update`).
- files/functions: `main.js` switch block only.
- mechanism: Chromium-branded background services (variations fetch,
  component updater, safe-browsing updates) have no equivalent feature in
  Dexerion today; the switches stop their schedulers from waking the network
  service (RESEARCH [203][210]).
- expected effect: power ↓ slightly (no periodic network-service wakes),
  CPU ↓ slightly, RAM ~0 (no buffers/process churn), GPU 0.
- functional risk: low — but the Builder MUST first grep the running browser
  (`chrome://net-export` equivalent via netLog, RESEARCH [135][211]) to confirm
  no Dexerion feature depends on a disabled background fetch. If any does,
  drop the switch. Site-facing features (safe browsing, updates) are
  Electron-app concerns, not Chromium ones here.
- reversibility: single env flag `DEX_LEGACY_NET=1` suppresses both switches.
- verification: `power-benchmark.js` idle-scenario delta; netLog shows no
  background requests during idle samples.

### A3. Confirm existing launch switches stay pinned 【DONE — keep, do not redo】
- renderer-process-limit=6, process-per-site, js-flags max-old-space-size=512,
  disable-features list, GPU plan switches (`--enable-gpu-rasterization`,
  `--enable-zero-copy`, `--force-gpu-mem-available-mb`, `--force-low-power-gpu`
  per adaptive-power.startupGpuPlan), clean-UA pipeline.
- evidence: RESEARCH [13][40][78][79][84][196]; code: main.js lines 75–142.
- verification: existing `build/scripts/test-gpu-modes.js` +
  `test-adaptive-power.js` cover the plan logic; keep green.

### A4. Electron version currency 【AUDIT → standing task】
- lever: stay on a recent Electron major so engine-level wins (pointer
  compression, Maglev/Sparkplug tuning, static roots, SQLite IndexedDB,
  shared-dictionary compression) are inherited without code.
- files/functions: `build/package.json` dependency pin only.
- mechanism: RESEARCH [84][86][87][91][96][118][280][294][298][382][387][394][413][414].
- expected effect: CPU ↓, RAM ↓, power ↓ — magnitude depends on the jump.
- functional risk: Electron majors carry breaking changes (RESEARCH [149]);
  gate every bump on the full existing test suite (`final-gate.js`,
  `functional-smoke.js`, `intensive-e2e.js`).
- reversibility: version pin revert.
- verification: full test suite + `power-benchmark.js` A/B (old vs new
  Electron), same protocol as tier C.

---

## Tier B — Code changes in main/browser (ranked impact × safety)

### B1. Keep hidden-view/teardown machinery complete and consistent 【NEW, highest impact】
- lever: every non-visible WebContentsView must be hidden (compositing stops,
  rAF suspends, Blink throttles) and every truly idle tab must reach the
  existing sleep/teardown state; the focused tab must NEVER be touched.
- files/functions: `src/main/browser.js` —
  `setWindowViewsVisible()` (~L257), `createTabView()` (~L1014),
  `sleepSweep()` (~L1343), `memorySweep()` (~L1447),
  `collectTabSnaps()` (~L1424), `trackPopupWindow()` (~L1117),
  `openPopup()`; `src/main/memsaver.js` `planSweep()` (policy already pure).
- mechanism: hidden views stop frame production end-to-end (rAF → BeginFrame →
  viz aggregation) — RESEARCH [20][22][42][80][81][207][274][352]; teardown
  frees what freezing cannot (heap slack, Oilpan floors) — [84][93][97].
- expected effect: background-tab CPU ↓↓, GPU ↓↓, power ↓↓, RAM ↓ (teardown).
- functional risk: medium if a tab wakes slowly — wake is a reload
  (RESEARCH [41][346]); keep the existing guards (never sleep: active, audible,
  loading, lazy, Focus-blocked; 60s idle floor — memsaver.js).
- reversibility: existing `DEX_DEBLOAT_BASELINE=1` restores legacy budgets;
  new sub-steps get their own budget names (e.g. `popupSleepMs`).
- verification: `build/scripts/probe-background-visibility.js` (exists) +
  new popup-case probe; `debloat-perf.js` A/B; manual multi-tab session.
- note: the core background-tab detach+hide fix is **DONE**; B1 is about
  consistency (popups/overlays/devtools paths) and the popup sleep state.

### B2. Adaptive main-process wakeup hygiene 【NEW, high impact on idle power】
- lever: fewer, longer, event-driven main-process wakeups.
- files/functions: `src/main/browser.js` — `scheduleSweep()` (~L319),
  `runPowerSweep()` (~L327), `applyPowerPlan()` (~L302);
  `src/main/adaptive-power.js` — `runtimePlan()` (raise `SWEEP_MAX_MS` floor
  logic only, pure function); `src/main/browser.js` L8868
  `setInterval(checkTaskReminders, 30000)` — make the reminders heartbeat
  adaptive: 30 s only when a task is due within 10 min, else 5 min
  (unit-testable pure helper in `src/main/tasks.js` + browser wiring).
- mechanism: every timer wake costs package power; Windows coalesces and
  Chromium aligns timers, but cadence is the app's lever — RESEARCH
  [43][44][154][155][329][373][281].
- expected effect: power ↓ (fewer C-state exits), CPU ↓ at idle, RAM 0, GPU 0.
- functional risk: low — sweeps are housekeeping; reminder punctuality is
  preserved for near-due tasks. Sweep minimum stays 15 s (SWEEP_MIN_MS) so
  responsiveness events (interaction, focus changes) still re-evaluate
  immediately (event-driven paths unchanged).
- reversibility: `DEX_DEBLOAT_BASELINE=1` restores legacy cadence;
  adaptive-heartbeat gets `taskHeartbeatMs` budget.
- verification: new `build/scripts/test-adaptive-power.js` cases (pure logic);
  runtime wake-count log behind `DEX_TIMER_DEBUG=1`; `power-benchmark.js`
  idle scenario (that is exactly the scenario where prior evidence showed the
  biggest gap to Edge).

### B3. Lazy-load the main-process AI/module stack 【NEW, high impact on boot CPU + main-process RAM】
- lever: browser.js currently `require()`s ~25 modules at load (ai-*,
  artifact*, report*, skills, agent loop…). Move first-use requires into
  factory functions so boot loads only the browsing core.
- files/functions: `src/main/browser.js` top-level require block (L3–41) →
  lazy accessors; `src/main/ai.js` already exposes `createAi` (keep eager —
  needed by IPC registration); everything else lazy.
- mechanism: main-process boot CPU and resident JS heap drop; modules that
  are never used in a session never cost memory (RESEARCH [18][48][75][145]).
- expected effect: boot CPU ↓, main-process RAM ↓ (tens of MB expected),
  power ↓ at boot; runtime 0.
- functional risk: low — first AI use gets a one-time require cost
  (tens of ms). Ensure every lazy seam logs/behaves identically (no behavior
  change), and the AI IPC surface is registered regardless.
- reversibility: none needed (pure refactor), but keep
  `DEX_EAGER_AI=1` env to force eager loading for A/B.
- verification: existing boot memory report line (main.js `[dexerion] memory
  at boot`, ~L255–263) + `DEX_MEM_DEBUG=1` (main.js ~L266–279); startup
  timestamps; full self-test (`--run-selftest`) must stay green.

### B4. On-battery efficiency demotion for Dexerion's OWN utility processes 【NEW, medium-high impact, guarded】
- lever: while on battery AND no audible media, apply below-normal process
  priority to Dexerion's non-UI helper processes (utility processes from
  `app.getAppMetrics()` `type: 'Utility'`), restoring on AC/focus. NEVER touch
  the GPU process or any renderer of a focused window.
- files/functions: `src/main/browser.js` power section (near `applyPowerPlan`)
  + `src/main/adaptive-power.js` (new pure decision `helperDemotion(signals)`).
- mechanism: mirrors Edge's efficiency mode and Windows EcoQoS intent with the
  API available in-process (`os.setPriority(pid, priority)` — Node built-in;
  EcoQoS itself would need a native module, out of scope) — RESEARCH
  [150][151][152][257][326][330][358].
- expected effect: power ↓ on battery, CPU contention ↓ when other apps run;
  plugged-in behavior unchanged.
- functional risk: medium — a demoted audio utility can glitch; the audible
  guard and AC-guard must be hard (unit-tested); never demote GPU (would hit
  foreground rendering — RESEARCH [355]).
- reversibility: `DEX_HELPER_DEMOTION=off`; demotion also clears on
  'on-ac', 'unlock-screen', and any audible signal (event-driven, not polled).
- verification: `test-adaptive-power.js` pure cases; manual on-battery run
  with media playing (must not demote); Get-Process priority check in Tester's
  harness (RESEARCH [165]).

### B5. Targeted IPC instead of full-state broadcasts 【NEW, low-medium impact】
- lever: `broadcastState()` sends full state to every window on transitions;
  switch high-frequency consumers (shell) to MessagePortMain channels with
  diffs, keep full-state broadcasts for rare transitions.
- files/functions: `src/main/browser.js` `broadcastState()` and its call
  sites (pomodoro onChange ~L368–389 already uses cheap ticks — extend that
  pattern); `src/preload.js` unchanged (renderer API surface identical).
- mechanism: less main-process serialization + IPC traffic (RESEARCH
  [15][138][139][140][354]).
- expected effect: CPU ↓ small; power ↓ small; RAM 0.
- functional risk: low-medium — any missed field is a UI bug; keep the
  existing `dex:get-state` full pull as fallback so nothing can desync.
- reversibility: `DEX_BROADCAST_LEGACY=1`.
- verification: existing selftest shell checks (menu/tabs/pomodoro) must stay
  green; IPC message counters behind `DEX_IPC_DEBUG=1`.

### B6. Profile-write batching audit 【AUDIT → change only with evidence】
- lever: history/bookmarks/settings writes are small JSON file writes; batch
  with a short debounce (e.g. 2 s) if the trace shows write bursts.
- files/functions: `src/main/profile.js` (save paths), call sites in
  browser.js.
- mechanism: disk I/O is power (RESEARCH [74][221][242]).
- expected effect: power ↓ small; risk: a crash within the debounce window
  loses the last write — acceptable only for history/settings, never for
  logins (safeStorage writes stay immediate).
- reversibility: `DEX_WRITE_BATCH=off`.
- verification: ProcMon/Process-Monitor style trace (RESEARCH [256]) or
  powercfg /energy disk section (RESEARCH [242]).

### B7. GPU tier tuning from measured data 【NEW, medium impact】
- lever: validate adaptive tiers against GPU Engine counters; tune
  `demandScore()` weights (webgl +5 / video +5 are absolute; animation +2) and
  `startupGpuPlan()`'s conservative branch (battery/low-RAM) if the data says
  a tier is either over-provisioning (wasted GPU) or under-provisioning
  (dropped frames).
- files/functions: `src/main/adaptive-power.js` `demandScore()`,
  `desiredTier()`, `decideGpuTier()`, `startupGpuPlan()` (all pure — fully
  unit-testable); `main.js` only reads the plan.
- mechanism: RESEARCH [2][3][4][29][79][160][206][355][402].
- expected effect: GPU ↓ / power ↓ on the over-provisioned side; no change if
  the current tiers measure correctly (equally valid outcome).
- functional risk: low while demandScore keeps video/WebGL → accelerated
  (mission: never suppress real GPU demand).
- reversibility: weights are named constants; `--gpu=` override stays.
- verification: `test-adaptive-power.js` + Tester's GPU Engine per-process
  sampling (RESEARCH [162][247]) across the animated workload.

---

## Tier C — Measurement work the Tester owns

### C1. Harden the paired benchmark into a repeated, controlled protocol 【NEW】
- extend `build/scripts/power-benchmark.js` + `power-compare.js`:
  - N ≥ 5 repetitions per scenario, randomized order, medians + IQR reported,
    ALL samples shown (no cherry-picking) — RESEARCH [54]–[61][333].
  - pin Windows power plan per run (powercfg; record it) — [242][272].
  - record: AC/battery state, OS energy-saver state, AV activity + top-3
    non-browser CPU consumers per window (co-tenant noise) — [243][342][378].
  - pin Edge policy surface for fairness: record Edge version, force the same
    efficiency-mode value (docs in [236][237][178]) and sleeping-tabs timeout
    ([238][179]); report differences rather than hide them.
- counters: RAPL Energy Meter package power (existing ps1), plus per-process
  CPU time + working set via Get-Process/Win32_Process — [163][164][165][166][167].

### C2. Per-process GPU utilisation sampling 【NEW】
- extend the ps1 to sample `\GPU Engine(*)\Utilization Percentage` and map
  engine instances → PIDs; report per-process GPU% for both browser trees
  — [160][162][169].
- caveat to document: GPU process memory counters can misreport on Windows —
  [244]; prefer utilisation + package power for GPU claims.

### C3. Process-tree attribution 【NEW】
- map the whole tree (browser/GPU/renderer/utility/crashpad) for Dexerion and
  Edge via Win32_Process CommandLine + ParentProcessId — [164][261][203][217].
- deliverable: per-scenario process inventory table (count + roles), so
  "whole process tree" is defined, auditable, and identical in scope.

### C4. Behavioral probes (functional-safety proofs) 【NEW, small scripts】
- prove hidden views stop producing frames (probe-background-visibility.js —
  exists; extend to minimized windows and popups) — [266][368].
- prove sleep/teardown preserves site state: localStorage/IndexedDB survive
  sleep+wake (RESEARCH [408][409][212][213]) — add to
  `intensive-e2e.js`/`functional-smoke.js`.
- prove no foreground regression: INP/CLS probes on shell + a real site
  before/after each tier-B item — [289][309][310][188].

### C5. Timer/wake forensics 【NEW】
- confirm no 1 ms timer requests and count main-process wakes per minute
  (ETW or powercfg /energy) before/after B2 — [155][156][158][159][329].
- verify sweep cadence matches adaptive-power's plan at runtime
  (DEX_TIMER_DEBUG log vs plan).

### C6. A/B harness discipline 【EXISTS — reuse】
- every tier-A/B lever lands behind an env flag; `debloat-perf.js` pattern
  (DEX_DEBLOAT_BASELINE) is the template: run optimized vs baseline, publish
  both numbers — [348][349][415].

---

## Explicit exclusions (never do these)
- No feature removal (translate UI stays disabled as already decided — that
  predates this mission; no new feature cuts).
- No UI changes, no visual changes, no new permissions.
- No foreground throttling: never `setBackgroundThrottling(false)`-inverse on
  focused tabs (throttling must stay ON for hidden ones), never hide/sleep the
  active tab, never demote the focused renderer or the GPU process, never
  request a finer system timer (RESEARCH [155]).
- No benchmark gaming: no workload detection, no per-scenario special cases,
  no shipping settings the shipped app doesn't use. All A/B results publish
  baseline and optimized numbers.
- No sandbox/contextIsolation weakening (RESEARCH [17][147][222]).
- No in-process-gpu (main.js comment; RESEARCH [26]).
- No disabling hardware video decode (RESEARCH [29][362]).

## Already DONE in the repo (do not redo)
- Launch switches: renderer-process-limit=6, process-per-site, js-flags
  --max-old-space-size=512, disable-features (TranslateUI, MediaRouter,
  DialMediaRouteProvider, OptimizationHints, CalculateNativeWinOcclusion).
- GPU plan at boot (adaptive/cap10/off) incl. gpu-rasterization, zero-copy,
  force-gpu-mem-available-mb, force-low-power-gpu — adaptive-power.startupGpuPlan.
- Runtime adaptive power: tiers + hysteresis + event-driven re-plan +
  timeout-based sweeps (no busy polling), powerMonitor transitions.
- Background-tab compositing fix: background tabs created detached+hidden so
  rAF suspends (the 1362 mW → fixed evidence case).
- Memory saver: working-set cap planner (LRU, heaviest-process-first),
  named budgets (sweep 60 s, idle teardown 3 min, preview limits),
  DEX_DEBLOAT_BASELINE A/B flag, boot memory report, DEX_MEM_DEBUG.
- Benchmark scripts: power-benchmark.js (RAPL paired-floor), power-sample.ps1,
  power-compare.js, probe-background-visibility.js, debloat-perf.js.

## Execution order (suggested)
1. C1+C3 (protocol first — every later claim needs it).
2. A1, A2 (config, cheap, reversible).
3. B1 (popup/overlay consistency) — biggest background win.
4. B2 (wakeup hygiene) — biggest idle-power win.
5. B3 (lazy modules) — boot CPU/RAM win.
6. B7, B4, B5 (tiered by measurement results; B4 last, most guarded).
7. C2, C4, C5 as continuous verification throughout.
