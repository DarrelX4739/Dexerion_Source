# TEST-REPORT-2.md — Dexerion vs Edge, re-measurement run 2 (Tester phase, V1+V2 tree)

**Status: COMPLETE.** Bounded re-measurement per the Controller's instruction: 3 scenarios
(active-browsing, background-tabs, idle) × 5 interleaved trials × 2 browsers, whole run
finished in ~24 min with **30/30 trials completed, zero harness errors, zero wedges**.
Purpose: TEST-REPORT-1's active-browsing CPU FAIL (137.5% of Edge) was measured under the
since-reverted **software-rendering** policy; V1 restored hardware-accelerated Adaptive GPU
and V2 added renderer V8 heap caps. This run answers: **did V1+V2 move the verdicts?**
Report author: Tester (3rd instance). Tree state: `33b99ab` (committed; V3's ai.js lazy-load
implemented and already reverted on measurement). Multitasking and the pre-build-1 baseline
were **SKIP**ped per instruction (V2's delta is covered by the quick probe comparisons in
VERSIONS.md — independently reconfirmed here, §7). Nothing committed; no repo files modified.

## 1. Evidence sources

| # | Source | What it is |
|---|--------|-----------|
| 1 | `%TEMP%\opencode\dexerion-test2\measure-protocol-main.json` | Machine-written end-of-run protocol JSON (this time it WAS written): per-trial CPU/RAM/GPU/power/env/co-tenants, floor-swing invalidations, per-scenario verdicts. |
| 2 | `%TEMP%\opencode\dexerion-test2-run.log` | Verbatim printed trial log (Tee-Object). |
| 3 | `%TEMP%\opencode\dexerion-test2\probe-memory-1..5.json` | 5 standalone `probe-memory-footprint.js` runs (the ladder's RAM probe): tree WS, per-process breakdown, renderer js-flags ground truth. |
| 4 | Functional-probe output (§8) | `test-gpu-modes.js` + 3 visibility probes, run fresh this session. |

Helper written for this report (kept out of the repo):
`%TEMP%\opencode\extract-test2.js` (read-only summary extractor over source #1).

## 2. Method (unchanged from run 1 — same committed harness)

`build/scripts/measure-protocol.js` unmodified, configured via env only:
`MEASURE_SCENARIOS=active-browsing,background-tabs,idle`, `MEASURE_TRIALS=5`,
`MEASURE_DEADLINE_MIN=28`, out dir `%TEMP%\opencode\dexerion-test2`.

Per trial: paired RAPL floor (no browser, 5 s) → env record → launch (throwaway profile) →
6 s settle → whole-tree snapshot A → 12 s concurrent GPU-engine (2 s) + RAPL (1 Hz) sampling →
snapshot B → teardown, 2 s rest. CPU = `Win32_Process` UserMode+KernelMode delta summed over
the browser tree (% of one logical core); RAM = tree working set at snapshot B; GPU = GPU
Engine utilisation points summed per pid, tree-filtered; power = workload median − paired
floor median (net mW). Invalid: floor swing >20% vs group reference (2-pass), or missing env
record. Medians/IQR (type-7) over valid trials only. Interleaved rounds with randomized
browser order. Dexerion via e2e harness `gpu:'adaptive'` (the **shipped hardware-accelerated**
policy); Edge via playwright `channel:'msedge'`, throwaway profile, stock otherwise.

## 3. Environment

| Item | Value |
|---|---|
| OS | Windows 11 Pro, build 26300 (10.0.26300), 8 logical cores, 31.8 GB |
| Power plan | **Balanced** (`381b4222-…`) — recorded, not pinned (same deviation as run 1) |
| AC / battery | **On battery for EVERY trial** (`onAc:false` per-trial record; charge 27% → 19% across the run). Run 1 was (at smoke time) on AC. |
| Edge | 158.0.4370.33 (same build as run 1) |
| Dexerion runtime | Electron 44.4.5, Node v24.21.0, committed tree `33b99ab` |
| Edge launch | `--no-first-run --no-default-browser-check`, throwaway user-data-dir, stock otherwise |
| Dexerion launch | e2e harness, throwaway profile, gpu=adaptive (hardware), kill switches shipped-default |
| Co-tenants | `Code.exe` (VS Code) drew ~5–6% of machine CPU in nearly every trial, both arms equally (interleaved); `MsMpEng.exe` (Defender) appeared ~6–10% only in the idle scenario window — its sweep coincides with the idle floor drift (§5.3, §6). |

## 4. Run integrity and disclosures

1. **No deadline pressure this time**: last trial started at t+23.1 min (deadline 28). The
   end-of-run JSON exists — no log-forensics needed (contrast run 1).
2. **Cross-run comparability caveat (important).** Run 1 ran on AC, run 2 on battery. On
   battery, lower CPU clocks make identical work consume **more CPU-seconds** — this inflates
   %-core for *both* browsers and is visible in the raw numbers: Edge's own active-browsing
   CPU went 26.9 → 36.6 %core, Dexerion's 37.0 → 42.2. **Within-run ratios (the verdicts)
   are fair (both arms interleaved on the same battery state); cross-run CPU deltas are
   confounded** and graded indicative only (§5.1). RAM (MB) and GPU (pts) are not
   clock-dependent and cross-run cleanly. RAPL package power is **not** cross-run comparable
   at all (AC floors 4.4–19 kW in run 1 vs battery floors 2.1–2.6 kW here); power verdicts
   are within-run only.
3. **Power axis is noise-limited everywhere.** The harness's own `noiseLimited` flag
   (within-sample p90−p10 spread > max(net, 150 mW)) fired on **22 of 27 valid trials**
   (active: edge 3/5, dex 1/5; background: 9/9; idle: 5/5). Battery operation has much lower,
   noisier package power. All power figures below are graded accordingly.
4. **Floor-swing invalidations: 6 of 30** (vs 13 of 40 in run 1) — floors were far tighter
   this run except in the idle scenario, where a rising drift (2.3 → 5.0 kW, coinciding with
   a Defender sweep) invalidated 5 of 10 idle trials, leaving **idle at dex n=2 / edge n=3**
   (shortfall vs the 5-trial target, stated per the brief; the scheduled 5 ran — the
   invalidation rule, not the deadline, cut them).
5. **No other invalidity class**: no missing-environment trials, no errors, no mid-window
   pid churn beyond the expected (Dexerion tree 6 pids; Edge 8–16).
6. **Operational note (no measurement impact):** the four functional probes and the memory
   probe were first launched from the session's default working directory and failed
   instantly with MODULE_NOT_FOUND (a session invocation error, not probe failures); all
   probes then ran clean from `build\`. No probe hit the wedge/retry rule.

## 5. Per-scenario results

`% of Edge` = median(Dexerion) ÷ median(Edge) × 100. Bars per the Controller's instruction:
**≤80% mission** and **≤60% stretch** (both reported). Valid n shown per arm.

### 5.1 active-browsing — COMPLETE (n=5 / n=5, 0 invalid)

| Trial | Browser | CPU %core | WS MB | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|
| 1 | dexerion | 42.2 | 614.4 | 1366.21 | 8.64 | valid |
| 1 | edge | 37.3 | 438.5 | 1652.00 | 8.41 | valid |
| 2 | dexerion | 41.8 | 613.8 | 1393.20 | 8.57 | valid |
| 2 | edge | 35.8 | 436.1 | 1062.13 | 8.38 | valid |
| 3 | edge | 36.6 | 435.2 | 1690.99 | 8.13 | valid |
| 3 | dexerion | 41.1 | 607.0 | 1404.50 | 8.40 | valid |
| 4 | dexerion | 43.2 | 613.9 | 1099.59 | 8.57 | valid |
| 4 | edge | 34.0 | 436.2 | 1335.52 | 8.39 | valid |
| 5 | dexerion | 45.5 | 608.8 | 1579.89 | 8.23 | valid |
| 5 | edge | 39.2 | 435.4 | 1254.31 | 8.55 | valid |

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | vs ≤80% | vs ≤60% | Run 1 → Run 2 |
|---|---|---|---|---|---|---|
| CPU (%core) | 42.2 (41.8–43.2) | 36.6 (35.8–37.3) | **115.3%** | **FAIL** | **FAIL** | 137.5% → 115.3% (confounded, §4.2) |
| RAM (MB) | 613.8 (608.8–613.9) | 436.1 (435.4–436.2) | **140.7%** | **FAIL** | **FAIL** | 163.1% → **140.7%** (clean, §5.1.1) |
| GPU (pts) | 8.57 (8.40–8.57) | 8.39 (8.38–8.41) | **102.1%** | **FAIL** | **FAIL** | 66.7% (software) → 102.1% (hardware) |
| Power (net mW) | 1393.20 (1366.21–1404.50) | 1335.52 (1254.31–1652.00) | **104.3%** | **FAIL** | **FAIL** | 16.1% UNPROVEN (AC) → 104.3% (battery; not cross-comparable) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":104.3,"powerPass":"FAIL","cpuPctOfEdge":115.3,"cpuPass":"FAIL","ramPctOfEdge":140.7,"ramPass":"FAIL","gpuPctOfEdge":102.1,"gpuPass":"FAIL"}`

**5.1.1 What moved and why.** Dexerion's tree RAM fell **716.4 → 613.8 MB (−102.6 MB)** while
Edge's moved only −3.1 MB — the ratio change 163.1 → 140.7 is essentially all Dexerion-side
and matches V2's mechanism (renderer old-space 512→256 MB + semi-space 8 MB; caps verified
live in §7). The CPU ratio improved 137.5 → 115.3, but Edge's own CPU rose more than
Dexerion's (+9.7 vs +5.2 %core) under the AC→battery switch, so **V1's CPU contribution
cannot be separated from the clock confound**; what IS proven is the mechanism: hardware
compositing is live (`gpu_compositing:"enabled"`, §8 — run 1 had `disabled_software`), the
software-rendering CPU penalty is gone from the shipped tree, and Dexerion's CPU IQR is now
tight (41.1–45.5) rather than the run-1 software-rendering profile. Verdict-grade statement:
**active-browsing CPU is still 115.3% of Edge under hardware rendering — V1 removed the
software-rendering penalty but did NOT make Dexerion cheaper than Edge on CPU.**

### 5.2 background-tabs — COMPLETE (dex n=4 / edge n=5, 1 invalid)

8 animated background tabs + 1 active static tab.

| Trial | Browser | CPU %core | WS MB | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|
| 1 | edge | 18.1 | 962.4 | 635.65 | 1.54 | valid |
| 1 | dexerion | 2.6 | 656.4 | 1191.28 | 0 | valid |
| 2 | edge | 27.3 | 965.6 | 781.65 | 2.74 | valid |
| 2 | dexerion | 0.7 | 661.1 | 634.94 | 0 | valid |
| 3 | dexerion | 0.2 | 658.3 | −8.49 | 0 | **INVALID** (floor-swing; §6) |
| 3 | edge | 21.9 | 957.8 | 1525.26 | 1.39 | valid |
| 4 | dexerion | 0.3 | 658.2 | 931.89 | 0 | valid |
| 4 | edge | 24.1 | 953.6 | 740.83 | 1.07 | valid |
| 5 | dexerion | 0.1 | 658.9 | 479.95 | 0 | valid |
| 5 | edge | 20.4 | 957.9 | 820.98 | 1.47 | valid |

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | vs ≤80% | vs ≤60% | Run 1 → Run 2 |
|---|---|---|---|---|---|---|
| CPU (%core) | 0.5 (0.25–1.18), n=4 | 21.9 (20.4–24.1), n=5 | **2.3%** | PASS | PASS | 0.9% → 2.3% (both arms' medians moved <1 %core; frozen-background behaviour unchanged) |
| RAM (MB) | 658.55 (657.75–659.45), n=4 | 957.9 (957.8–962.4), n=5 | **68.7%** | **PASS** | **FAIL** | 78.7% → **68.7%** (clean: dex −102.7 MB, edge −9.0) |
| GPU (pts) | 0 (0–0), n=4 | 1.47 (1.39–1.54), n=5 | **0%** | PASS | PASS | 0% → 0% (unchanged; frozen tabs, §8 caveat) |
| Power (net mW) | 783.41 (596.19–996.74), n=4 | 781.65 (740.83–820.98), n=5 | **100.2%** | **FAIL** | **FAIL** | −0.6% not-meaningful → 100.2% (parity; noise-limited 9/9 trials) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":100.2,"powerPass":"FAIL","cpuPctOfEdge":2.3,"cpuPass":"PASS","ramPctOfEdge":68.7,"ramPass":"FAIL","gpuPctOfEdge":0,"gpuPass":"PASS"}`

Note: this is the first scenario where the power axis produced a **credible parity figure**
(both arms ≈ 0.8 W net on battery, tight IQRs) — run 1's negative-net artefact is gone.
Dexerion pays nothing in package power for its frozen background tabs; the CPU/GPU savings
are real, but RAM (68.7%) still misses the stretch bar.

### 5.3 idle — COMPLETE with heavy invalidation (dex n=2 / edge n=3, 5 invalid)

| Trial | Browser | CPU %core | WS MB | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|
| 1 | dexerion | 0.2 | 589.8 | 791.86 | 0 | **INVALID** (floor-swing) |
| 1 | edge | 0.7 | 409.2 | 910.01 | 0 | valid |
| 2 | dexerion | 0.3 | 579.0 | 1070.66 | 0 | **INVALID** (floor-swing) |
| 2 | edge | 0.6 | 410.1 | 2064.10 | 0 | valid |
| 3 | edge | 0.7 | 416.0 | 1503.92 | 0 | valid |
| 3 | dexerion | 0.4 | 583.8 | −629.42 | 0 | **INVALID** (floor-swing + attributable-negative) |
| 4 | dexerion | 0.2 | 582.5 | 455.38 | 0 | valid |
| 4 | edge | 0.6 | 408.6 | 385.50 | 0 | **INVALID** (floor-swing) |
| 5 | edge | 0.5 | 409.2 | 788.71 | 0 | **INVALID** (floor-swing) |
| 5 | dexerion | 0.1 | 581.5 | 1589.26 | 0 | valid |

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | vs ≤80% | vs ≤60% | Run 1 → Run 2 |
|---|---|---|---|---|---|---|
| CPU (%core) | 0.15 (0.13–0.18), n=2 | 0.7 (0.65–0.7), n=3 | **21.4%** | PASS | PASS | 36.4% → 21.4% (both ≈0; thin dex n) |
| RAM (MB) | 582.0 (581.75–582.25), n=2 | 410.1 (409.65–413.05), n=3 | **141.9%** | **FAIL** | **FAIL** | 164.9% → **141.9%** (clean: dex −100.6 MB, edge −3.75) |
| GPU (pts) | 0 (0–0), n=2 | 0 (0–0), n=3 | — | n/a | n/a | n/a → n/a (both exactly 0) |
| Power (net mW) | 1022.32 (738.85–1305.79), n=2 | 1503.92 (1206.97–1784.01), n=3 | **68.0%** | nominal PASS | FAIL | −393.1% not-meaningful → 68.0% **UNPROVEN** (n=2/n=3, 5/5 noise-limited, drifting floors) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":68,"powerPass":"FAIL","cpuPctOfEdge":21.4,"cpuPass":"PASS","ramPctOfEdge":141.9,"ramPass":"FAIL","gpuPctOfEdge":null,"gpuPass":"n/a"}`

Idle-power reading: unlike run 1, Edge's valid nets are all positive here and Dexerion's
nominal net draw is ~0.7 W below Edge's — directionally sensible (Dexerion's idle tree is
quieter on CPU), but with n=2/n=3, every trial flagged noise-limited, and floors drifting
2.3→5.0 kW through the window (Defender sweep in co-tenant record), the 68% is **UNPROVEN**,
not a pass to claim.

## 6. Invalid-trial log (verbatim, complete — 6 entries)

```
INVALID dexerion/3: floor-swing>20% (floor 3346.58 vs ref 2413)      [background-tabs]
INVALID edge/4: floor-swing>20% (floor 3718.18 vs ref 2721)          [idle]
INVALID edge/5: floor-swing>20% (floor 3073.13 vs ref 2548)          [idle]
INVALID dexerion/1: floor-swing>20% (floor 2384.56 vs ref 3211)      [idle]
INVALID dexerion/2: floor-swing>20% (floor 2317.01 vs ref 3211)      [idle]
INVALID dexerion/3: floor-swing>20% (floor 5026.31 vs ref 3211)      [idle]
```
No other invalidity class occurred. The idle drift pattern (floors rising through the
scenario on battery, coinciding with MsMpEng co-tenant rows) is the machine's background
load, caught by the rule on both arms — 3 Edge + 2 Dexerion trials lost, so the rule did not
favour either side.

## 7. Memory-footprint probe (the ladder's RAM probe) — 5 runs, all OK

`node scripts/probe-memory-footprint.js` (standard 5-tab workload: 1 active animated + 4
background animated, single origin), run standalone ×5 after sampling, throwaway profile,
`gpu:'adaptive'`:

| Run | TREE_WORKING_SET_MB | TREE_PRIVATE_MB | Renderers | js-flags seen |
|---|---|---|---|---|
| 1 | 651 | 299 | 3 | `--max-old-space-size=256 --max-semi-space-size=8` |
| 2 | 646 | 301 | 3 | same |
| 3 | 638 | 292 | 3 | same |
| 4 | 643 | 296 | 3 | same |
| 5 | 642 | 293 | 3 | same |

**Median 643 MB (IQR 642–646)** — independently reconfirms V2's quick-gate figure
(642–646 MB in VERSIONS.md): no RAM regression since V2, and the V8 caps are ground-truth
propagated to every renderer (command lines + pages reporting `jsHeapSizeLimit` 280 MB,
used 30–36 MB).

Method note (honest): these are **separate launches**, not the protocol trials themselves —
the probe cannot be injected into measure-protocol.js without editing committed protocol
code, which the Tester must not do. The probe measures tree WS via `app.getAppMetrics()`
while the protocol uses `Win32_Process` working sets; both land in the same range
(probe 643 MB at 5 tabs vs protocol 658 MB at 9 tabs). Per-process weight at run 1
(probe JSON): 3 renderers 133/117/116 MB (private 60/64/41), Browser 121 MB (53),
**GPU 114 MB (69 — largest private consumer)**, Network Service 49 MB (12).

## 8. Functional proofs (run fresh this session; all exited; no wedge retries needed)

**`node scripts/test-gpu-modes.js` — ALL CHECKS PASS** (verbatim tail; note the hardware
switches — this is V1 confirmed live, vs run 1's `--disable-gpu applied (software)`):
```
=== mode: adaptive ===
PASS adaptive: boots and serves browser state
PASS adaptive: gpu-info reachable
PASS adaptive: GPU not disabled (hardware compositing) — switches={"disableGpu":false,"forceLowPowerGpu":false,"gpuRasterization":false,"zeroCopy":true,"gpuMemBudgetMB":"256"}
PASS adaptive: gpu_compositing hardware-enabled — features={"2d_canvas":"enabled","direct_rendering_display_compositor":"disabled_off_ok","gpu_compositing":"enabled","multiple_raster_threads":"enabled_on","opengl":"enabled_on","rasterization":"enabled","raw_draw":"disabled_off_ok","skia_graphite":"disabled_off","trees_in_viz":"disabled_off","video_decode":"enabled","video_encode":"enabled","webgl":"enabled","webgpu":"enabled","webnn":"disabled_off"}
PASS adaptive: zero-copy enabled
PASS adaptive: raster/budget pair consistent with boot tier — raster=false budget=256
info adaptive: GPU-type processes in metrics = 1
PASS adaptive: persisted value survives boot — on disk: adaptive
PASS adaptive: legacy save normalises to adaptive — on disk: adaptive
GPU MODES: ALL CHECKS PASS
```

**`node scripts/probe-background-visibility.js` — FAIL** (verbatim tail; identical to run 1):
```
PROBE_TAB_TITLE: vis:visible:raf:no
BACKGROUND_TAB_HIDDEN: false
BACKGROUND_RAF_PAUSED: true
POWER_TIER: balanced VISIBLE_TABS=1/?
VISIBILITY PROBE FAIL
```
Reading unchanged from run 1: background renderers stop producing frames (RAF paused — the
mechanism behind §5.2's CPU/GPU wins) but the document still reports `visibilitystate:
visible`. Functional finding for the Builder; does not invalidate measurement.

**`node scripts/probe-popup-visibility.js` — PASS** (verbatim tail):
```
PROBE_POPUP_TITLE_BEFORE: vis:visible:raf:yes
PROBE_WINDOW_STATES_MINIMIZED: [{"url":"login","visible":false,"minimized":false},{"url":"shell.html","visible":false,"minimized":true}]
PROBE_POPUP_TITLE_OWNER_MINIMIZED: vis:visible:raf:yes
PROBE_POPUP_TITLE_RESTORED: vis:visible:raf:yes
POPUP_IS_REAL_WINDOW: true
POPUP_RENDERER_LIVE: true
OWNER_MINIMIZED: true
OS_HIDES_POPUP_WITH_OWNER: true (Windows owned-window behaviour)
POPUP_RENDERER_STILL_PRODUCING_WHILE_OS_HIDDEN: true (documented constraint: BrowserWindow hide/minimize does not propagate renderer visibility with CalculateNativeWinOcclusion disabled; no main-process lever exists for a BrowserWindow page)
POPUP VISIBILITY PROBE PASS
```

**`node scripts/probe-overlay-visibility.js` — PASS** (verbatim tail):
```
SNIP_OPEN_PRODUCING: true
PARENT_MINIMIZED: true
SNIP_RAF_PAUSED_WHEN_MINIMIZED: true
SNIP_PRODUCING_AFTER_RESTORE: true
SEARCH_PAGE_RAF_PAUSED_WHILE_COVERED: true
SEARCH_PAGE_PRODUCING_AFTER_CLOSE: true
OVERLAY VISIBILITY PROBE PASS
```

## 9. Overall verdict matrix

Bars: **mission ≤80%**, **stretch ≤60%** of Edge per axis.

| Scenario | CPU | RAM | GPU | Power |
|---|---|---|---|---|
| **active-browsing** (n=5/n=5) | **FAIL — 115.3%** (was 137.5) | **FAIL — 140.7%** (was 163.1) | **FAIL — 102.1%** (was 66.7, software) | **FAIL — 104.3%** (noise-limited) |
| **background-tabs** (n=4/n=5) | **PASS both — 2.3%** (was 0.9) | **PASS ≤80 / FAIL ≤60 — 68.7%** (was 78.7) | **PASS both — 0%** (was 0%) | **FAIL — 100.2%** (parity) |
| **idle** (n=2/n=3) | **PASS both — 21.4%** (was 36.4) | **FAIL — 141.9%** (was 164.9) | n/a (both 0) | nominal PASS ≤80 — **UNPROVEN** 68.0% (n=2/n=3, all noise-limited) |

### Direct before/after vs TEST-REPORT-1 (the three instructed numbers)

| Metric (run 1 → run 2) | Dexerion abs | Edge abs | Ratio | Reading |
|---|---|---|---|---|
| active-browsing CPU **137.5% → 115.3%** | 37.0 → 42.2 %core | 26.9 → 36.6 %core | −22.2 pts | Directionally consistent with V1 (hardware compositing verified live), **magnitude confounded by AC→battery clocks** (Edge's own CPU rose more than Dexerion's); still FAIL |
| active-browsing RAM **163.1% → 140.7%** | 716.4 → 613.8 MB (−102.6) | 439.2 → 436.1 MB (−3.1) | −22.4 pts | **Clean V2 attribution**: Edge stable, Dexerion −100 MB; probe corroboration §7 |
| background-tabs CPU **0.9% → 2.3%** | 0.2 → 0.5 %core | 21.3 → 21.9 %core | +1.4 pts | Both arms' medians moved <1 %core; frozen-background behaviour unchanged; PASS both bars |
| background-tabs RAM **78.7% → 68.7%** | 761.2 → 658.6 MB (−102.7) | 966.9 → 957.9 MB (−9.0) | −10.0 pts | Same V2 signature; now passes ≤80, still fails ≤60 |
| idle CPU **36.4% → 21.4%** | 0.2 → 0.15 %core | 0.55 → 0.7 %core | −15.0 pts | Both ≈0; thin dex n (2 valid) |
| idle RAM **164.9% → 141.9%** | 682.6 → 582.0 MB (−100.6) | 413.9 → 410.1 MB (−3.8) | −23.0 pts | Same V2 signature; still FAIL |

The **−100 MB Dexerion-side drop appears in all three scenarios with Edge stable within
−9…−4 MB** — that is V2's heap-cap signature measured under the independent protocol, and it
moved every RAM ratio by 10–23 points. It is the run's cleanest causal result.

## 10. Closing verdict

**Did V1+V2 move the verdicts? Yes on RAM; partially on CPU; the mission bar is still not met.**

- **Meets the ≤80% mission bar now:** CPU in background-tabs (2.3%) and idle (21.4%); GPU in
  background-tabs (0%); RAM in background-tabs (68.7% — newly, thanks to V2's −100 MB).
- **Meets the ≤60% stretch bar:** CPU (background-tabs 2.3%, idle 21.4%) and GPU
  (background-tabs 0%) only.
- **Remaining blockers, ranked:**
  1. **RAM in single-window scenarios** — active-browsing 140.7%, idle 141.9% (both arms
     n=5/n=3-grade data, tight IQRs; the fails are solid). Dexerion carries **+172–178 MB**
     over Edge whenever one window is the whole tree (613.8 vs 436.1; 582.0 vs 410.1).
  2. **Active-browsing CPU 115.3%** — the software-rendering penalty is gone (verified), but
     Dexerion still spends ~15% more CPU than Edge on the same foreground animation.
  3. GPU (102.1%) and power (104.3%) sit at **parity** in active browsing — at parity these
     axes cannot pass any reduction bar by construction; they are "not worse", which after
     V1 is the expected good outcome (the compositing work moved off the CPU onto the GPU
     where Edge also spends it).
- **Single biggest remaining bottleneck for V4: foreground RAM.** It is the axis furthest
  above the mission bar (needs 613.8 → ≤349 MB, i.e. another −265 MB, to hit 80% of Edge in
  active browsing), it fails in 2 of 3 scenarios, and it has a proven, just-demonstrated
  lever class (V2's −100 MB). **V4 recommendation (data-backed):** attack the heaviest
  single processes named by the probe — the **GPU process (114 MB WS / 69 MB private, the
  largest private consumer) via the gpuMemBudget 256→128 MB A/B** already queued in
  VERSIONS.md, and **renderer consolidation: 3 renderers persist even at idle with one tab**
  (protocol roles: `renderer:3` in every Dexerion trial) vs Edge's 2 — identify the third
  renderer's site/process and whether process-per-site can fold it. Secondary for the CPU
  blocker (115.3%): the shell/UI + IPC overhead (Dexerion's browser-process surface) —
  harder, and it should be next after RAM. Honest ceiling note: with GPU and power at
  parity, the ≤60% stretch on *all four axes* in active browsing is not reachable by
  efficiency alone unless Dexerion does measurably less work than Edge; the realistic
  mission target is ≤80% everywhere, with RAM the deciding axis.

**What run 3 must fix:** measure on AC (or record and pin AC state) so CPU cross-run deltas
become attributable; pin/record Edge's efficiency-mode surface; and get idle to ≥3 valid
trials per arm (run the idle scenario away from Defender's sweep window, or raise trial
count to absorb the invalidations).
