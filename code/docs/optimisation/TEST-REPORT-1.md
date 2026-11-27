# TEST-REPORT-1.md — Dexerion vs Edge, measurement run 1 (Tester phase, build-1 tree)

**Status: RECOVERED PARTIAL RUN — deadline-cut mid-multitasking; baseline phase SKIPPED-WEDGED.**
This report supersedes the Controller's interim compile of the same run (whose header
requested exactly that; a snapshot of that interim text is preserved outside the repo at
`%TEMP%\opencode\TEST-REPORT-1.controller-interim.md`). It incorporates the interim's two
attributions (software-rendering policy provenance; RAM baseline gap) and corrects two of its
counts (see §4.3). Report author: Tester (2nd instance) — the first Tester instance's session
wedged after the main measurement pass; this report ships from the surviving evidence. No
re-measurement was performed for the tables below; only the functional proofs (§8) were run
fresh.

## 1. Evidence sources (and their chain of custody)

| # | Source | What it is | Integrity |
|---|--------|-----------|-----------|
| 1 | `%TEMP%\opencode\dexerion-test1-run.log` (UTF-16LE, 11,958 B; transcribed to `dexerion-test1-run.utf8.txt`) | The complete printed trial record of run 1: every trial line, the per-scenario INVALID lists, and per-scenario comparison verdict JSONs for active-browsing, background-tabs, idle. The file ends at the `dexerion / multitasking / trial 3 (t+22 min)` header — the kill arrived as that trial started. | Parsed verbatim; nothing re-measured. |
| 2 | `%TEMP%\opencode\dexerion-test1\` — 35 `gpu-*.json` raw samples | Per-sample GPU Engine utilisation (tree-filtered), one per completed trial. | Cross-checked 1:1 against the log's 35 completed trials in log order: **35/35 exact match** on tree utilisation points (see §9). |
| 3 | `%TEMP%\opencode\dexerion-test1-smoke\measure-protocol-main.json` | The harness's own smoke run (1 trial, 6 min before run 1) — the only surviving machine-written JSON, used for the environment record (§3). | Read-only. |
| 4 | `build/scripts/measure-protocol.js` (+ `measure-*.ps1`) | The harness that produced the run; source of the metric definitions and statistics used to recompute everything in this report. | Read-only; not modified. |

**Verification of the numbers in this report.** A parse helper (`%TEMP%\opencode\parse-trials.js`,
written by this report's author, kept out of the repo) re-parses the log, re-applies the
harness's floor-swing invalidation, and recomputes every median/IQR/%-of-Edge with the
harness's own algorithm (type-7 quantiles; net power = workload median − paired floor median).
All 24 verdict keys emitted by the harness for the three complete scenarios match the
recomputation exactly (24/24 OK). The harness's end-of-run JSON
(`dexerion-test1\measure-protocol-main.json`) was **never written** — the run was killed
first — so the printed log is the surviving record of record.

## 2. What was measured (method, from the harness source)

Per trial: paired RAPL floor (no browser, 5 s, immediately before the workload) → launch
(throwaway profile) → 6 s settle → whole-tree snapshot A → 12 s of concurrent GPU-engine
(2 s interval) + RAPL (1 Hz) sampling → whole-tree snapshot B → teardown, 2 s rest.

- **CPU** — `Win32_Process` UserMode+KernelMode time deltas (100 ns units), summed over the
  browser process and every child; reported as **% of one logical core** (tree CPU-seconds ÷
  wall-seconds × 100). New children counted fully.
- **RAM** — tree working set (MB) at snapshot B.
- **GPU** — `\GPU Engine(*)\Utilization Percentage` grouped by pid, tree-filtered; unit is
  **percentage points summed across engines per pid** ("pts"). Dexerion ships software
  rendering by user decision (`--disable-gpu`, confirmed live in §8; policy from commit
  8070fed) — its GPU numbers are expected at/near zero and must be read together with the CPU
  axis, because software rendering moves that work onto the CPU.
- **Power** — RAPL package power (mW, 1 Hz, first sample discarded). The comparison metric is
  **net power = workload median mW − that trial's paired floor median mW**, medianed over
  valid trials. A trial whose floor deviates >20% from its group's reference floor (median of
  the group's valid floors) is **INVALID for all axes** (trial-level exclusion — the harness
  excludes an invalidated trial from the CPU/RAM/GPU summaries too, not only power).
  Medians + IQR (p25–p75) over **valid trials only**; all trials published.

Configured: 5 trials/scenario/browser (40 scheduled), randomized per-round browser order
(interleaved), 4 scenarios (active-browsing → background-tabs → idle → multitasking),
45 min harness deadline, Edge = stock msedge with throwaway profile, Dexerion = e2e electron
harness, `gpu:'adaptive'` shipped policy, kill switches at shipped defaults.

## 3. Environment

**Closest surviving environment record** — the harness smoke run at 2026-11-26T20:10:07Z,
six minutes before run 1 (run 1's own per-trial env records were captured by the harness —
trials missing them are auto-invalidated — but their values were lost with the unwritten JSON):

| Item | Value |
|---|---|
| OS | Windows 11 Pro, build 26300 (10.0.26300) |
| CPU / RAM | 8 logical cores / 31.8 GB |
| Power plan | **Balanced** (`381b4222-…`) — *not* pinned to High Performance; see §7 deviations |
| AC / battery | On AC, 91% (at smoke time; per-trial AC state of run 1 lost — see §7) |
| Edge | 158.0.4370.33 (same at report time) |
| Dexerion runtime | Electron 44.4.5, Node v24.21.0, committed build-1 tree (`C:\...\code\build`) |
| Run mode | `committed-tree` (build-1 @ 53b7cc7) — **not** a pre-build-1 baseline (§6) |
| Edge launch | `--no-first-run --no-default-browser-check`, throwaway user-data-dir, stock otherwise |
| Dexerion launch | e2e harness, throwaway profile, gpu=adaptive, kill switches shipped-default |

At report-writing time the machine reads **on battery, 87%** — the per-trial AC state of run 1
cannot be reconstructed; this is one more reason the power axis is graded UNPROVEN (§7).

Run 1 wall-clock: started ≈ 20:15Z 26 Nov 2026 (07:15 local, UTC+11), killed ≈ 20:37Z
(t+22.0 min).

## 4. Run integrity and disclosures

1. **Deadline-cut.** The run was terminated at ≈ t+22 min by the controlling session's
   45-minute budget (setup consumed part of the budget before t+0). The kill landed exactly as
   `dexerion / multitasking / trial 3` started: its header is the log's last line; its data
   line and everything after are missing. The harness's own pending-trial logic never
   triggered, and the end-of-run JSON was never written.
2. **Baseline phase SKIPPED-WEDGED.** The predecessor's pre-build-1 baseline pass
   (`DEX_BUILD_DIR` worktree run → `measure-protocol-baseline.json`) wedged silently and
   produced **no data**; no baseline artifacts exist anywhere under `%TEMP%\opencode`
   (verified). Consequence: **every number in this report is post-build-1 Dexerion vs Edge.**
   The Builder's delta is *not* separable from the Edge comparison by this data; per
   TESTER-BRIEF, the pre/post split must come from git history (`53b7cc7` = build-1;
   `027fde7` = pre-build-1) until a run 2 measures the baseline.
3. **Trial accounting (correction to the interim compile / VERSIONS.md).** 40 trials were
   scheduled (4 scenarios × 5 × 2). 35 completed with data, 1 printed a header only
   (dexerion/multitasking/3), 4 were never reached. The verbatim INVALID log contains
   **13 entries** (5 + 5 + 3 across the three complete scenarios) — not 15 — because
   multitasking never reached the harness's floor-swing validation stage. The full verbatim
   list is in §5.5. Multitasking has **no harness verdict**: the harness emits the comparison
   JSON and runs the floor-swing validation at scenario end; multitasking never got there.
   The multitasking statistics in §5.4 are **computed by this report's author using the
   harness's exact algorithm**, labelled `report-computed`, and are not verdict-grade (§7).

## 5. Per-scenario results (all trials verbatim from the log)

Convention: `net mW` = power − floor (the harness's power metric). Medians/IQR are over
**valid trials only**. `% of Edge` = median(Dexerion) ÷ median(Edge) × 100; the bar is
**≤60%**. Values are transcribed verbatim from the log lines `cpu X% core, ws Y MB, power N mW
(floor F), gpu G pts`.

### 5.1 active-browsing — COMPLETE (5+5 trials; 5 invalidated by floor swing)

| Trial | t+min | Browser | CPU %core | WS MB | Power mW | Floor mW | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | +0.0 | dexerion | 35.8 | 718.4 | 10386.16 | 5755.13 | 4631.03 | 5.91 | INVALID (floor-swing) |
| 1 | +0.6 | edge | 27.6 | 440.1 | 8533.34 | 4587 | 3946.34 | 8.88 | valid |
| 2 | +1.3 | dexerion | 35.1 | 717.3 | 9685.34 | 9797.49 | −112.15 | 5.17 | valid |
| 2 | +1.9 | edge | 63.2 | 988.4 | 11399.64 | 12401.03 | −1001.39 | 2.4 | INVALID (floor-swing) |
| 3 | +2.5 | edge | 26.9 | 439.2 | 19471.69 | 5672.17 | 13799.52 | 9.69 | valid ⚠ (§7a: co-tenant spike) |
| 3 | +3.1 | dexerion | 38.1 | 728.6 | 16579.69 | 17597.95 | −1018.26 | 7.32 | INVALID (floor-swing) |
| 4 | +3.8 | edge | 28.5 | 443.9 | 8715.42 | 8636.6 | 78.82 | 9.3 | INVALID (floor-swing) |
| 4 | +4.4 | dexerion | 36.3 | 722.3 | 9655.84 | 7325.83 | 2330.01 | 5.78 | INVALID (floor-swing) |
| 5 | +5.0 | edge | 26.9 | 435.5 | 10041.58 | 5595.9 | 4445.68 | 9.2 | valid |
| 5 | +5.7 | dexerion | 38.9 | 715.4 | 10795.05 | 9248 | 1547.05 | 7.11 | valid |

Valid n: dexerion 2, edge 3. Reference floors: dexerion 9248 mW, edge 5672 mW.

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | Verdict vs ≤60% |
|---|---|---|---|---|
| Power (net mW) | 717.45 (302.65–1132.25), n=2 | 4445.68 (4196.01–9122.60), n=3 | **16.1%** | nominal PASS — **graded UNPROVEN (§7a)** |
| CPU (%core) | 37.0 (36.05–37.95), n=2 | 26.9 (26.9–27.25), n=3 | **137.5%** | **FAIL** |
| RAM (MB) | 716.35 (715.88–716.82), n=2 | 439.2 (437.35–439.65), n=3 | **163.1%** | **FAIL** |
| GPU (pts) | 6.14 (5.66–6.63), n=2 | 9.2 (9.04–9.45), n=3 | **66.7%** | **FAIL** (marginal; see §7c) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":16.1,"powerPass":"PASS","cpuPctOfEdge":137.5,"cpuPass":"FAIL","ramPctOfEdge":163.1,"ramPass":"FAIL","gpuPctOfEdge":66.7,"gpuPass":"FAIL"}` — recomputation: all 8 keys match.

Context: the active-browsing CPU failure is measured **under the software-rendering policy in
force during this run** (user-directed, commit 8070fed) — compositing/raster moved onto the
CPU, which is exactly the 137.5% figure. The version ladder (VERSIONS.md V1) targets this
axis by restoring hardware-accelerated Adaptive GPU; this report is the baseline that change
must be re-measured against.

### 5.2 background-tabs — COMPLETE (5+5 trials; 5 invalidated by floor swing)

8 animated background tabs + 1 active static tab.

| Trial | t+min | Browser | CPU %core | WS MB | Power mW | Floor mW | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | +6.3 | edge | 16.6 | 964.9 | 12520.53 | 6975.16 | 5545.37 | 3.11 | valid |
| 1 | +6.9 | dexerion | 1.4 | 762.7 | 6868.33 | 6888.15 | −19.82 | 0 | valid |
| 2 | +7.5 | edge | 12.8 | 951.8 | 7126.22 | 6093.59 | 1032.63 | 1.38 | INVALID (floor-swing) |
| 2 | +8.2 | dexerion | 0.2 | 756.8 | 7892.9 | 8462.06 | −569.16 | 0 | valid |
| 3 | +8.8 | dexerion | 0.1 | 762 | 8777.86 | 17220.79 | −8442.93 | 0 | INVALID (floor-swing) |
| 3 | +9.4 | edge | 9.4 | 964.9 | 17212.39 | 9714.59 | 7497.8 | 1.82 | INVALID (floor-swing) |
| 4 | +10.1 | edge | 8.2 | 951.5 | 17205.47 | 18816.9 | −1611.43 | 1.69 | INVALID (floor-swing) |
| 4 | +10.8 | dexerion | 0 | 765.8 | 6325.2 | 17665.33 | −11340.13 | 0 | INVALID (floor-swing) |
| 5 | +11.4 | dexerion | 0.1 | 761.2 | 9183.1 | 7903.33 | 1279.77 | 0 | valid |
| 5 | +12.1 | edge | 26 | 968.9 | 9536.6 | 8031.37 | 1505.23 | 5.24 | valid |

Valid n: dexerion 3, edge 2. Reference floors: dexerion 8462 mW, edge 8031 mW.

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | Verdict vs ≤60% |
|---|---|---|---|---|
| Power (net mW) | −19.82 (−294.49–629.97), n=3 | 3525.30 (2515.26–4535.34), n=2 | **−0.6%** | nominal PASS — **not-meaningful (§7b)** |
| CPU (%core) | 0.2 (0.15–0.8), n=3 | 21.3 (18.95–23.65), n=2 | **0.9%** | PASS (read with §7c caveat) |
| RAM (MB) | 761.2 (759–761.95), n=3 | 966.9 (965.9–967.9), n=2 | **78.7%** | **FAIL** |
| GPU (pts) | 0 (0–0), n=3 | 4.17 (3.64–4.71), n=2 | **0%** | PASS (near-zero by construction, §7c) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":-0.6,"powerPass":"PASS","cpuPctOfEdge":0.9,"cpuPass":"PASS","ramPctOfEdge":78.7,"ramPass":"FAIL","gpuPctOfEdge":0,"gpuPass":"PASS"}` — recomputation: all 8 keys match.

### 5.3 idle — COMPLETE (5+5 trials; 3 invalidated by floor swing)

| Trial | t+min | Browser | CPU %core | WS MB | Power mW | Floor mW | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | +12.7 | edge | 0.6 | 412.6 | 17680.67 | 7646.64 | 10034.03 | 0 | INVALID (floor-swing) |
| 1 | +13.3 | dexerion | 0 | 684.3 | 6793.2 | 4970.6 | 1822.6 | 0 | valid |
| 2 | +13.9 | edge | 0.5 | 414.8 | 10073.54 | 11319.9 | −1246.36 | 0 | INVALID (floor-swing) |
| 2 | +14.6 | dexerion | 0.3 | 682.2 | 5380.42 | 5307.57 | 72.85 | 0 | valid |
| 3 | +15.2 | edge | 0.8 | 414.9 | 4641.55 | 5016.64 | −375.09 | 0 | valid |
| 3 | +15.8 | dexerion | 0.1 | 682.6 | 4794.43 | 4179.64 | 614.79 | 0 | valid |
| 4 | +16.4 | edge | 0.4 | 413.8 | 5098.19 | 3964.73 | 1133.46 | 0 | INVALID (floor-swing) |
| 4 | +17.0 | dexerion | 0.3 | 681.9 | 4925.58 | 4532.44 | 393.14 | 0 | valid |
| 5 | +17.6 | dexerion | 0.2 | 684.9 | 6325.64 | 4113.69 | 2211.95 | 0 | valid |
| 5 | +18.2 | edge | 0.3 | 412.8 | 4606.6 | 4544.34 | 62.26 | 0 | valid |

Valid n: dexerion 5, edge 2. Reference floors: dexerion 4532 mW, edge 5017 mW.

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | Verdict vs ≤60% |
|---|---|---|---|---|
| Power (net mW) | 614.79 (393.14–1822.6), n=5 | −156.41 (−265.75–−47.08), n=2 | **−393.1%** | nominal PASS — **not-meaningful (§7b)** |
| CPU (%core) | 0.2 (0.1–0.3), n=5 | 0.55 (0.42–0.68), n=2 | **36.4%** | PASS (both near zero; thin edge n) |
| RAM (MB) | 682.6 (682.2–684.3), n=5 | 413.85 (413.32–414.38), n=2 | **164.9%** | **FAIL** |
| GPU (pts) | 0 (0–0), n=5 | 0 (0–0), n=2 | — | **n/a** (both exactly 0) |

Harness verdict JSON (verbatim): `{"powerPctOfEdge":-393.1,"powerPass":"PASS","cpuPctOfEdge":36.4,"cpuPass":"PASS","ramPctOfEdge":164.9,"ramPass":"FAIL","gpuPctOfEdge":null,"gpuPass":"n/a"}` — recomputation: all 8 keys match.

### 5.4 multitasking — PARTIAL (deadline-cut; report-computed, NOT verdict-grade)

Foreground animation + 8 background animated tabs. Trials that exist:

| Trial | t+min | Browser | CPU %core | WS MB | Power mW | Floor mW | Net mW | GPU pts | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | +18.8 | edge | 81.8 | 998.5 | 7762.11 | 4370.7 | 3391.41 | 22.63 | valid (report-checked) |
| 1 | +19.5 | dexerion | 39 | 815.6 | 5939.77 | 4514.85 | 1424.92 | 5.84 | valid (report-checked) |
| 2 | +20.1 | edge | 80 | 1019.8 | 21224 | 4580.23 | 16643.77 | 23.92 | valid (report-checked) ⚠ spike (§7b) |
| 2 | +20.7 | dexerion | 33.6 | 814 | 5916.55 | 5824.98 | 91.57 | 5.82 | valid (report-checked) |
| 3 | +21.3 | edge | 78.8 | 1008 | 7839.98 | 4981.95 | 2858.03 | 22.62 | valid (report-checked) |
| 3 | +22.0 | dexerion | — | — | — | — | — | — | **header only — run killed here** |

Valid n (report-computed floor-swing check, harness algorithm: edge ref floor 4580 mW, dex ref
floor 5170 mW; all present trials within 12.7%): dexerion 2, edge 3.

| Axis | Dexerion median (IQR) | Edge median (IQR) | % of Edge | Verdict |
|---|---|---|---|---|
| Power (net mW) | 758.25 (424.91–1091.58), n=2 | 3391.41 (3124.72–10017.59), n=3 | 22.4% | PARTIAL — UNPROVEN (spike + tiny n) |
| CPU (%core) | 36.3 (34.95–37.65), n=2 | 80 (79.4–80.9), n=3 | 45.4% | PARTIAL — indicative only |
| RAM (MB) | 814.8 (814.4–815.2), n=2 | 1008 (1003.25–1013.9), n=3 | 80.8% | PARTIAL — nominally over bar |
| GPU (pts) | 5.83 (5.83–5.83), n=2 | 22.63 (22.63–23.27), n=3 | 25.8% | PARTIAL — indicative only |

No harness comparison JSON exists for this scenario (run cut first). All figures above are
`report-computed` with the harness's algorithm and **must not be quoted as PASS/FAIL**.

### 5.5 Invalid-trial log (verbatim, complete — 13 entries)

```
INVALID edge/2: floor-swing>20% (floor 12401.03 vs ref 5672)
INVALID edge/4: floor-swing>20% (floor 8636.6 vs ref 5672)
INVALID dexerion/1: floor-swing>20% (floor 5755.13 vs ref 9248)
INVALID dexerion/3: floor-swing>20% (floor 17597.95 vs ref 9248)
INVALID dexerion/4: floor-swing>20% (floor 7325.83 vs ref 9248)
INVALID edge/2: floor-swing>20% (floor 6093.59 vs ref 8031)
INVALID edge/3: floor-swing>20% (floor 9714.59 vs ref 8031)
INVALID edge/4: floor-swing>20% (floor 18816.9 vs ref 8031)
INVALID dexerion/3: floor-swing>20% (floor 17220.79 vs ref 8462)
INVALID dexerion/4: floor-swing>20% (floor 17665.33 vs ref 8462)
INVALID edge/1: floor-swing>20% (floor 7646.64 vs ref 5017)
INVALID edge/2: floor-swing>20% (floor 11319.9 vs ref 5017)
INVALID edge/4: floor-swing>20% (floor 3964.73 vs ref 5017)
```
(First five: active-browsing; next five: background-tabs; last three: idle. No other
invalidity class occurred — no missing-environment or error trials.)

## 6. Baseline (pre-build-1): SKIPPED-WEDGED

The baseline phase of run 1 (pre-build-1 worktree via `DEX_BUILD_DIR`, per TESTER-BRIEF
"Baseline duty") wedged silently before producing any data. No
`measure-protocol-baseline.json` and no baseline GPU samples exist (verified by search).
**There is no pre/post-build-1 split in this report.** All Dexerion numbers are the committed
build-1 tree. Separating the Builder's delta from the Edge comparison requires a run 2 that
actually completes the baseline arm.

## 7. Honest uncertainty

**(a) The active-browsing power "PASS" (16.1%) is UNPROVEN — not passed.**
It rests on **2 valid Dexerion trials** whose net powers are −112.15 and +1547.05 mW (the sign
flips; the workload median landed below the paired floor in one valid trial — the harness's
own `attributable-negative` condition) and **3 valid Edge trials**. The floor-swing check
cannot see *within-window* contamination, and the run contains a demonstrated instance:
**edge/3** drew 19,471.69 mW against a floor of 5,672.17 mW — that floor *equals* the group
reference exactly, so the trial passed the floor check while a co-tenant spike was inside its
12 s workload window (net 13.8 W, ~3× the other valid Edge nets; the neighbouring dexerion/3
trial caught the same event in its floor sample and was invalidated for it). Sensitivity:
excluding edge/3 would move the ratio from 16.1% to ≈17.1% — the direction (Dexerion's net
draw below Edge's) survives, but at n=2/n=3 with a demonstrated contaminated channel the
figure is **not proven to the mission's standard**. Grade: UNPROVEN.

**(b) idle and background-tabs power comparisons are not meaningful; multitasking power is
partial and spike-contaminated.**
- idle: Edge's valid net-power median is **negative** (−156.41 mW; its two valid trials straddle
  zero: −375.09 and +62.26), which produces the absurd ratio −393.1%. Dexerion's idle net
  median (614.79 mW) is itself within the floor's own swing band at idle (~4–5 W floors,
  ±20% swings observed). Both arms are near-zero/noise-dominated → **not-meaningful**.
- background-tabs: 2 of Dexerion's 3 valid nets are **negative** (−19.82, −569.16 mW) — the
  channel cannot resolve Dexerion's draw in this scenario at all; Edge's nets (1505–5545 mW)
  are real but n=2. The −0.6% ratio is arithmetically a "PASS" and physically a noise
  statement → **not-meaningful** (direction consistent with Dexerion drawing ≲0.5 W above
  floor vs Edge's 1.5–5.5 W, magnitude unproven).
- multitasking: partial (n=2/n=3) and edge/2 carries a 16.6 W net spike (21,224 mW against a
  4,580 mW floor) of the same co-tenant class as edge/3 in §7a → **partial, UNPROVEN**.

**(c) GPU comparisons under Dexerion's software-rendering policy must be paired with the CPU
cost.**
Dexerion ships software rendering (`--disable-gpu`; §8 confirms `gpu_compositing:
disabled_software`, `webgl: unavailable_software`). Its GPU-engine numbers are **exactly 0**
in background-tabs and idle — near-zero by construction — and 5.17–7.32 pts in
active-browsing (non-zero, plausibly software-adapter/composition engine accounting; GPU
process memory 0 MB vs Edge's 22–90 MB). GPU therefore cannot demonstrate savings in this
configuration; it can only be "not worse than Edge" or "worse". In active browsing it was
worse than the bar (66.7% of Edge, FAIL) **while the CPU axis simultaneously carried the
rendering work at 137.5% of Edge** — i.e., the GPU+CPU pair in active browsing is a net loss
vs Edge, which is the honest reading of the software-rendering policy under this workload
(the policy is user-directed, 8070fed; the V1 ladder reverts it). Conversely, background-tabs
CPU (0.9% of Edge) must be read with the same pairing in mind: Dexerion's background tabs
fully stop producing frames (GPU 0 pts, CPU ≈0.2% core; §8 shows RAF paused) while Edge's
kept animating (CPU 21.3% core) — a shipped-behaviour difference under stock-vs-stock
configs, not a measurement artefact, but it is a *behavioural* gap, not an efficiency gap,
and it coexists with the §8 background-visibility probe FAIL.

**Protocol deviations to carry into run 2** (both browsers ran under identical conditions, so
the comparison-internal fairness holds; absolute values are affected):
- Power plan was **Balanced**, not pinned High Performance (brief req 6 said "if permitted" —
  it was recorded, not pinned).
- Edge's efficiency-mode / sleeping-tabs policy surface was **not pinned or recorded**
  (brief tier-C1 asks for it; Edge ran stock).
- Per-trial AC/battery state was captured but lost with the unwritten JSON; report-time state
  is on-battery, smoke-time was on-AC — AC state during run 1 is unknown.
- Co-tenant records (top-3 non-browser consumers per window) were captured per trial and lost
  the same way; the surviving log carries no co-tenant names. The floor-swing check caught 13
  of the contaminated trials; §7a documents why it cannot catch all of them.

## 8. Functional proofs (run fresh by this session, 27 Nov 2026)

Run from `C:\Users\Darre\Dexerion_Distributable\code\build`. No probe wedged; all runs
exited. The background probe was run twice (identical output) after its first FAIL to rule
out a one-off.

**`node scripts/test-gpu-modes.js` — PASS** (verbatim tail):
```
=== mode: adaptive ===
PASS adaptive: boots and serves browser state
PASS adaptive: gpu-info reachable
PASS adaptive: --disable-gpu applied (software rendering) — switches={"disableGpu":true,"forceLowPowerGpu":false,"gpuRasterization":false,"zeroCopy":false,"gpuMemBudgetMB":null}
PASS adaptive: gpu_compositing not hardware — features={"2d_canvas":"unavailable_software","direct_rendering_display_compositor":"disabled_off_ok","gpu_compositing":"disabled_software","multiple_raster_threads":"enabled_on","opengl":"disabled_off","rasterization":"disabled_software","raw_draw":"disabled_off_ok","skia_graphite":"disabled_off","trees_in_viz":"disabled_off","video_decode":"disabled_software","video_encode":"disabled_software","webgl":"unavailable_software","webgpu":"unavailable_software","webnn":"unavailable_software"}
PASS adaptive: no raster/zero-copy/low-power extras
info adaptive: GPU-type processes in metrics = 1
PASS adaptive: persisted value survives boot — on disk: adaptive
PASS adaptive: legacy save normalises to adaptive — on disk: adaptive
GPU MODES: ALL CHECKS PASS
```

**`node scripts/probe-background-visibility.js` — FAIL** (reproduced 2/2, verbatim tail):
```
PROBE_TAB_TITLE: vis:visible:raf:no
BACKGROUND_TAB_HIDDEN: false
BACKGROUND_RAF_PAUSED: true
POWER_TIER: balanced VISIBLE_TABS=1/?
VISIBILITY PROBE FAIL
```
Reading: the background tab's renderer **stops producing frames** (RAF paused) but its
document still reports `visibilitystate: visible` (`BACKGROUND_TAB_HIDDEN: false`). Frames
are suppressed — which is what the background-tabs CPU/GPU numbers in §5.2 reflect — but the
probe's stricter visibility contract fails. This is a functional finding to hand the Builder;
it does not invalidate the measurement, but it explains the mechanism behind §5.2.

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

**`node scripts/probe-wcv-semantics.js` — no verdict line emitted (raw counters only); errors
none** (verbatim output; this probe was not in the mission's probe list but the Controller's
interim report cited it from gate evidence, so it was re-run here):
```
1-attached-visible: {"vis":"visible","raf":38} rafAdvanced=null
2-attached-setVisibleFalse: {"vis":"visible","raf":120} rafAdvanced=null
3-detached-only: {"vis":"visible","raf":204} rafAdvanced=null
4-detached-hidden: {"vis":"visible","raf":204} rafAdvanced=null
5-reattached-visible: {"vis":"visible","raf":205} rafAdvanced=null
6-window-minimized-view-attached: {"vis":"visible","raf":375} rafAdvanced=null
7-restored: {"vis":"visible","raf":534} rafAdvanced=null
WCV_ERRS: []
```
Note for the Builder: the rAF counter advanced in **all seven states, including
detached-hidden and minimized**, and `vis` never left "visible" — i.e., on this probe surface
a detached/hidden WebContentsView keeps producing frames. Whether that is the intended WCV
semantics or a wake bug is not graded here (the probe prints no PASS/FAIL and no
assertions); the raw states are recorded for whoever owns that decision.

## 9. Supplementary: raw GPU samples and process-tree sizes

All 35 `gpu-*.json` samples map 1:1 (in log order) to the 35 completed trials, and each
sample's summed per-pid `utilPointsMean` equals the log line's `gpu` value exactly
(35/35). Tree sizes and GPU-process memory (mean over the sample window):

| Scenario | Dexerion tree pids | Edge tree pids | Dexerion GPU mem | Edge GPU mem |
|---|---|---|---|---|
| active-browsing | 6 | 9–11 | 0 MB | 31.9–65.6 MB |
| background-tabs | 6 | 17 | 0 MB | 73.3–81.8 MB |
| idle | 6 | 9 | 0 MB | 22.1 MB |
| multitasking | 6 | 17 | 0 MB | 86.7–90.4 MB |

(Edge's larger tree is expected: one renderer per live background tab vs Dexerion's frozen
background tabs; GPU memory 0 MB under software rendering.)

## 10. Overall verdict matrix (bar: ≤60% of Edge per axis)

| Scenario | CPU | RAM | GPU | Power |
|---|---|---|---|---|
| **active-browsing** (complete, n=2/n=3 valid) | **FAIL — 137.5%** | **FAIL — 163.1%** | **FAIL — 66.7%** | nominal 16.1% → **UNPROVEN** |
| **background-tabs** (complete, n=3/n=2 valid) | PASS — 0.9% (see §7c) | **FAIL — 78.7%** | PASS — 0% (by construction) | not-meaningful (−0.6%) |
| **idle** (complete, n=5/n=2 valid) | PASS — 36.4% (both ≈0) | **FAIL — 164.9%** | n/a (both 0) | not-meaningful (−393.1%) |
| **multitasking** (PARTIAL, n=2/n=3, report-computed) | PARTIAL — 45.4% | PARTIAL — 80.8% | PARTIAL — 25.8% | PARTIAL — 22.4% (UNPROVEN) |
| **baseline pre-build-1** | SKIPPED-WEDGED | SKIPPED-WEDGED | SKIPPED-WEDGED | SKIPPED-WEDGED |

**Overall: the mission bar is NOT met on the measured evidence.** The mission requires ≤60% of
Edge on all four axes during active browsing. In active browsing — the mission's primary
scenario — **CPU (137.5% of Edge) and RAM (163.1% of Edge) are the blocking failures**, with
GPU also over the bar (66.7%) and power UNPROVEN rather than proven. RAM fails the bar in
every complete scenario (78.7–164.9%): Dexerion runs ~270 MB above Edge whenever a single
window is the whole tree (idle 683 vs 414 MB; active-browsing 716 vs 439 MB), and stays under
Edge's total only where Edge's per-tab renderers dominate the tree (background-tabs 761 vs
967 MB, multitasking 815 vs 1008 MB) — still over the 60% bar in background-tabs. The only
clean passes are CPU and GPU in
background-tabs/idle, where Dexerion's frozen background tabs and near-zero idle footprint
dominate, and even there the background pass rests on a frame-suppression behaviour whose
stricter visibility contract fails (§8).

**What run 2 must fix before any verdict is upgraded:** complete the pre-build-1 baseline arm
(SKIPPED-WEDGED here); reach ≥5 valid trials per axis (active-browsing power had 2); control
or log co-tenants well enough that within-window spikes (edge/3, edge/2-multitasking class)
are detectable, not just floor swings; resolve the AC-state record; and pin/record the power
plan and Edge policy surface.
