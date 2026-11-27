# TEST-REPORT-3 — Dexerion vs Edge, fair harness on AC

**Provenance.** Measurement run 3 executed the protocol to completion (30/30
trials, evidence JSON written, zero protocol errors). The Tester instance then
terminated with `HTTP 429 Too Many Requests` during post-processing, before
writing this file or running the functional probes. This report is compiled by
the **Controller** directly from the captured evidence
(`%TEMP%\opencode\dexerion-test3\measure-protocol-main.json`, 129 KB) and the
printed run log; the four functional probes were executed by the Controller
afterwards and are reported verbatim in §7. No number here is estimated.

## 1. Why this run exists — two confounds removed

Run 2 (TEST-REPORT-2) measured **on battery**, so the frozen GPU plan's
conservative tier ran with `gpuRasterization=false` (compositor tile raster on
the CPU) while Edge kept GPU raster. Run 2's harness also opened Dexerion's
workload tabs *next to* the boot newtab, while Edge navigated its first page in
place — giving Dexerion's tree exactly one extra live page in every scenario.

Run 3 removes both:

| Confound | Control applied |
|---|---|
| Battery → CPU raster | Machine verified on AC (`batteryStatus=2`) before launch and recorded per trial (`acAtTrial`); every one of the 30 trials reports `onAc: true`, charge 63 % |
| Extra boot page | `prepareDexerion` now navigates the boot newtab **in place** for the first workload page via the shell's own `dex:navigate` IPC (fairness fix in `build/scripts/measure-protocol.js`, committed with this report). Page counts now match Edge's arm exactly |

## 2. Environment (recorded per trial)

- Windows 11 Pro, build 26300 · Edge 158.0.4370.33 · Balanced power plan
- AC power, charge 63 % at start; all 30 trials `onAc: true`
- Dexerion: e2e harness, throwaway profile, `gpu=adaptive` (shipped policy),
  kill switches at shipped defaults; commits through `8dd269c`
- Edge: `--no-first-run --no-default-browser-check`, throwaway `--user-data-dir`
- Config: 5 trials/scenario/browser, 12 s sample, 5 s paired floor, 6 s settle,
  8 background tabs, 20 % floor-swing invalidation

## 3. Method (harness verbatim)

> Per trial: paired RAPL floor (no browser, immediately before workload) →
> launch (throwaway profile) → settle → whole-tree snapshot A → concurrent
> GPU-engine + RAPL sampling → whole-tree snapshot B → teardown. CPU =
> Win32_Process UserMode+KernelMode delta summed over the browser tree; RAM =
> tree working set at snapshot B; GPU = GPU Engine utilisation points summed
> per pid, tree-filtered; Power = workload median mW minus that paired floor
> median. Invalid: floor swing >20 % vs group reference. Medians/IQR over
> VALID trials only; all trials published.

The harness's own PASS/FAIL grades against **≤60 % of Edge**; this report also
grades the mission's **≤80 %** bar. Both are shown.

## 4. Verdict matrix — run 3

| Scenario | CPU | RAM | GPU | Power |
|---|---|---|---|---|
| **active-browsing** (4/4 valid each) | **107.0 %** FAIL both | **110.6 %** FAIL both | **97.2 %** FAIL both | **120.5 %** FAIL both |
| **background-tabs** (Dex 4/5, Edge 5/5) | **3.6 %** **PASS both** | **57.6 %** **PASS both** | **0 %** **PASS both** | 141.7 % FAIL both |
| **idle** (Dex 3/5, Edge 4/5) | **26.7 %** **PASS both** | 111.7 % FAIL both | n/a (both 0) | 75.5 % PASS ≤80 / FAIL ≤60 |

Ratios are Dexerion median ÷ Edge median of valid trials. Full medians:

| Scenario | Axis | Dexerion (median, IQR) | Edge (median, IQR) | Ratio |
|---|---|---|---|---|
| active-browsing | CPU %core | 26.7 (24.3–29.0) | 24.95 (24.15–25.45) | 107.0 % |
| | RAM MB | 484.8 (482.3–487.3) | 438.45 (437.1–439.0) | 110.6 % |
| | GPU pts | 8.30 (8.15–8.44) | 8.54 (8.07–9.04) | 97.2 % |
| | power mW attrib. | 7,798 (6,649–9,010) | 6,474 (6,046–6,630) | 120.5 % |
| background-tabs | CPU %core | 0.45 (0.40–0.82) | 12.4 (11.9–12.7) | 3.6 % |
| | RAM MB | 543.0 (542.5–544.9) | 943.2 (943.1–946.5) | 57.6 % |
| | GPU pts | 0 (0–0) | 1.93 (1.75–1.99) | 0 % |
| | power mW attrib. | 6,649 (5,955–6,939) | 4,693 (4,133–6,594) | 141.7 % |
| idle | CPU %core | 0.2 (0.1–0.3) | 0.75 (0.55–3.32) | 26.7 % |
| | RAM MB | 459.1 (458.5–460.4) | 411.15 (409.9–2,726.7) | 111.7 % |
| | GPU pts | 0 | 0 | n/a |
| | power mW attrib. | 4,262 (3,985–5,170) | 5,642 (4,955–6,059) | 75.5 % |

## 5. Raw trial record (verbatim from the evidence JSON)

```
=== active-browsing ===
dexerion  t1 valid  cpu 29.4%  ws 482.3MB  pwrAtt  8883mW  floor 2944.04  gpu 8.17
dexerion  t2 valid  cpu 24.6%  ws 487.3MB  pwrAtt  6458mW  floor 2996.41  gpu 8.43
dexerion  t3 valid  cpu 28.8%  ws 487.4MB  pwrAtt  9392mW  floor 3275.00  gpu 8.46
dexerion  t4 valid  cpu 23.4%  ws 482.3MB  pwrAtt  6713mW  floor 3296.84  gpu 8.10
dexerion  t5 INVALID cpu 23.2% ws 487.6MB  pwrAtt  6035mW  floor 4155.07  gpu 8.22  (floor-swing)
edge      t1 valid  cpu 25.4%  ws 438.2MB  pwrAtt  6369mW  floor 2824.06  gpu 8.09
edge      t2 valid  cpu 23.1%  ws 438.7MB  pwrAtt  5079mW  floor 3297.12  gpu 8.98
edge      t3 INVALID cpu 23.6% ws 437.6MB  pwrAtt  4174mW  floor 4074.73  gpu 8.24  (floor-swing)
edge      t4 valid  cpu 24.5%  ws 439.9MB  pwrAtt  6579mW  floor 2915.90  gpu 9.23
edge      t5 valid  cpu 25.6%  ws 433.9MB  pwrAtt  6782mW  floor 2758.84  gpu 8.03

=== background-tabs ===
dexerion  t1 valid  cpu 1.8%   ws 542.4MB  pwrAtt  7200mW  floor 2992.69  gpu 0
dexerion  t2 valid  cpu 0.4%   ws 542.5MB  pwrAtt  6446mW  floor 2629.38  gpu 0
dexerion  t3 valid  cpu 0.5%   ws 549.2MB  pwrAtt  6852mW  floor 2777.90  gpu 0
dexerion  t4 INVALID cpu 0.6% ws 545.7MB  pwrAtt  4810mW  floor 5017.07  gpu 0  (floor-swing)
dexerion  t5 valid  cpu 0.4%   ws 543.5MB  pwrAtt  4482mW  floor 3424.45  gpu 0
edge      t1 valid  cpu 12.4%  ws 943.2MB  pwrAtt  6594mW  floor 2860.89  gpu 1.75
edge      t2 valid  cpu 11.9%  ws 943.1MB  pwrAtt  3687mW  floor 2763.96  gpu 1.99
edge      t3 valid  cpu 11.1%  ws 961.0MB  pwrAtt  7470mW  floor 2852.01  gpu 1.48
edge      t4 valid  cpu 14.9%  ws 946.5MB  pwrAtt  4693mW  floor 3283.04  gpu 1.93
edge      t5 valid  cpu 12.7%  ws 941.1MB  pwrAtt  4133mW  floor 2906.49  gpu 2.09

=== idle ===
dexerion  t1 valid  cpu 0%     ws 457.8MB  pwrAtt  6078mW  floor 2742.42  gpu 0
dexerion  t2 INVALID cpu 0.2% ws 457.6MB  pwrAtt  3938mW  floor 4430.83  gpu 0  (floor-swing)
dexerion  t3 INVALID cpu 0.1% ws 457.9MB  pwrAtt  2830mW  floor 3684.35  gpu 0  (floor-swing)
dexerion  t4 valid  cpu 0.4%   ws 461.7MB  pwrAtt  4262mW  floor 3139.76  gpu 0
dexerion  t5 valid  cpu 0.2%   ws 459.1MB  pwrAtt  3707mW  floor 2910.48  gpu 0
edge      t1 valid  cpu 10.6%  ws 9671MB  pwrAtt  5441mW  floor 3045.24  gpu 0.06  ← TEARDOWN TRANSIENT (see §6)
edge      t2 valid  cpu 0.9%   ws 410.4MB  pwrAtt  3496mW  floor 2944.71  gpu 0
edge      t3 valid  cpu 0.6%   ws 408.2MB  pwrAtt  5843mW  floor 2712.96  gpu 0
edge      t4 INVALID cpu 0.9% ws 408.1MB  pwrAtt  6450mW  floor 3791.73  gpu 0  (floor-swing)
edge      t5 valid  cpu 0.4%   ws 411.9MB  pwrAtt  6704mW  floor 2505.36  gpu 0
```

## 6. Invalid trials and disclosures

**Six of 30 trials invalidated** by the floor-swing rule (all power-only;
their CPU/RAM/GPU values are still published above but excluded from medians):
`edge/active-browsing/3`, `dexerion/active-browsing/5`,
`dexerion/background-tabs/4`, `edge/idle/4`, `dexerion/idle/2`,
`dexerion/idle/3`.

**Edge idle trial 1 teardown transient — disclosed, not hidden.** That trial
sampled `10.6 % core / 9,671 MB WS`, i.e. the previous scenario's background
tabs were still tearing down when the snapshot was taken. Its *paired floor was
clean* (3,045 mW), so the floor rule did not invalidate it. Effect on the
verdicts, computed both ways:

- RAM: including it, Edge median = 411.15 MB (ratio 111.7 %); excluding it,
  Edge median = 410.4 MB (ratio 111.9 %). **Median is unaffected — the outlier
  sits in the max, not the centre.**
- CPU: including it, Edge median = 0.75 % (ratio 26.7 %); excluding it, Edge
  median = 0.6 % (ratio 33.3 %). **Still PASS either way.**

Conclusion: the transient does not change any verdict. It is recorded here so
the number is not mistaken for a clean Edge idle sample.

**Power is noise-limited in every valid trial.** The harness flags a trial when
within-sample p10–p90 spread exceeds the attributable signal (all 24 valid
trials flagged). The floor itself swung 2,505–5,017 mW across the run. Therefore:

- active-browsing 120.5 % is directionally credible (Dexerion's four valid
  trials are 6,458–9,392 mW vs Edge's 5,079–6,782 mW — non-overlapping at the
  medians) but its magnitude is not precise.
- background-tabs 141.7 % is **not credible as a real effect**: Dexerion burns
  0.45 % of a core with GPU 0 while Edge burns 12.4 % and 1.9 GPU points; a
  browser doing ~30× less compute cannot plausibly draw 1.4× the attributable
  power. This is floor noise, and it is reported as an unreliable FAIL rather
  than a finding.
- idle 75.5 % passes the ≤80 % bar but is likewise floor-dominated (Dexerion's
  own valid trials span 3,707–6,078 mW).

## 7. Functional proofs (Controller-run, after the Tester's 429)

```
node scripts/test-gpu-modes.js
  PASS adaptive: GPU not disabled (hardware compositing)
  PASS adaptive: gpu_compositing hardware-enabled
  PASS adaptive: persisted value survives boot — on disk: adaptive
  GPU MODES: ALL CHECKS PASS

node scripts/probe-background-visibility.js
  BACKGROUND_TAB_HIDDEN: false
  BACKGROUND_RAF_PAUSED: true
  VISIBILITY PROBE FAIL            ← pre-existing, identical in reports 1 and 2
                                     (frames stop; visibilityState stays "visible")

node scripts/probe-popup-visibility.js
  POPUP VISIBILITY PROBE PASS

node scripts/probe-overlay-visibility.js
  OVERLAY VISIBILITY PROBE PASS
```

The background-visibility FAIL is the documented, unchanged mechanism behind
the background-tab CPU win: rAF stops even though `visibilityState` remains
"visible". It is not a regression.

## 8. Run 2 → run 3: what the controls changed

| Scenario | Axis | Run 2 | Run 3 | Reading |
|---|---|---|---|---|
| active-browsing | CPU | 115.3 % | **107.0 %** | Edge's own CPU fell 36.6→24.95 %core with AC clocks, so part of the ratio move is clock state; Dexerion's absolute fell 41–45→23.4–29.4 %core |
| | RAM | 140.7 % | **110.6 %** | Dexerion 607–614→482–487 MB with Edge flat (435–444→434–440). The ~125 MB drop is the removed extra page plus V2's caps — the V4 renderer-map finding, confirmed quantitatively |
| | GPU | 102.1 % | **97.2 %** | Hardware compositing at parity, now marginally below Edge |
| | power | 104.3 % | 120.5 % | Both noise-limited; Dexerion's attributable power is now measurably above Edge's |
| background-tabs | CPU | 2.3 % | 3.6 % | PASS both runs |
| | RAM | 68.7 % | **57.6 %** | Now under the ≤60 % stretch bar |
| | GPU | 0 % | 0 % | PASS |
| idle | CPU | 21.4 % | 26.7 % | PASS |
| | RAM | 141.9 % | **111.7 %** | Dexerion 582→459 MB (fair page count + caps); Edge 411 MB |
| | power | 68.0 % | 75.5 % | PASS ≤80 % / FAIL ≤60 %, noise-limited |

## 9. Closing verdict

**Mission bar (≤80 % of Edge) — met in 4 of 12 cells:**

- background-tabs: CPU **3.6 %**, RAM **57.6 %**, GPU **0 %** — all pass both bars
- idle: CPU **26.7 %** passes both bars; power 75.5 % passes ≤80 %
- active-browsing: **none of the four axes pass** — CPU 107.0 %, RAM 110.6 %,
  GPU 97.2 %, power 120.5 %

**Honest framing.** Every foreground axis is now within 3–21 % of Edge rather
than 37–63 % above it. GPU is *below* Edge (97.2 %) and CPU is near parity
(107 %). The two genuine remaining deficits are **active-browsing power
(+20.5 %, noise-limited) and foreground RAM (+10.6 %, i.e. ~46 MB)**, with idle
RAM (+11.7 %, ~48 MB) the same size.

**Structural note for V5.** Dexerion's browser chrome is an Electron renderer
(`file://…/shell.html`); Edge's chrome is native in the main process. That
one extra renderer is a permanent ~100 MB / small-CPU cost that cannot be
removed without changing the UI (out of scope by the mission's own rules). Any
further foreground gain must come from *within* that structure.

**V5 recommendation (data-backed):**

1. **Per-process CPU/power split during active browsing** — the diagnostic the
   ladder still lacks. `app.getAppMetrics()` gives per-pid CPU; attribute
   Dexerion's 26.7 % core and 1.3 W excess between shell renderer, page
   renderer, browser and GPU process. Without this, V5+ changes are guesses.
2. **Spare-renderer A/B** — Chromium keeps a spare renderer for fast
   navigation; if present it is a pure idle/foreground RAM cost. Measure
   renderer count + tree WS with the spare disabled.
3. **Idle RAM 48 MB gap** — same probe, focused on the shell + newtab pair.

Do not re-try: GPU memory budget (V4: 8× change = 0 MB effect),
renderer-process-limit (V4: inert under process-per-site), ai.js lazy-loading
(V3: 0.5 MB).
