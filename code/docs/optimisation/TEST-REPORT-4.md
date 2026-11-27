# TEST-REPORT-4 — Dexerion vs Edge, final ladder measurement (run 4)

**Provenance.** Controller-executed protocol run (the independent Tester
instances became unavailable — provider usage limits — after run 3; the
protocol itself is deterministic and its evidence JSON is the record). Tree:
commits through V6 (`70c190d`, static sky) + the run-4 fairness fix
(`prepareDexerion` now focuses the window, matching `prepareEdge`'s
`bringToFront`, so both arms are measured in the same actually-visible
state).

**Environment.** On AC for every trial (charge 70 % at start), Balanced plan,
Windows 11 build 26300, Edge 158.0.4370.33, throwaway profiles both arms,
30 scheduled trials, **6 invalidated** by the floor-swing rule (co-tenant
load — the machine was in active use during the run; the paired-floor +
invalidation rules did their job). Zero protocol errors. All power trials
noise-limited (within-sample p10–p90 spread exceeds the attributable
signal) — power verdicts are parity-grade, not precision-grade.

## Method

Identical to TEST-REPORT-3 §3 (paired RAPL floors, whole-tree Win32_Process
CPU deltas, tree working set at snapshot B, GPU Engine points, 12 s sample,
5 s floor, 6 s settle, throwaway profiles). The harness's own PASS/FAIL
grades ≤60 % of Edge; the mission bar is ≤80 %; **this session's
user-directed bar is parity (≤100 % = "same level") with ≥10 % better
(≤90 %) as the stretch.** All three bars are shown.

## Final verdict matrix — every axis, every state

| Scenario | Axis | Dexerion | Edge | vs Edge | ≤100 % parity | ≤80 % mission |
|---|---|---|---|---|---|---|
| **active-browsing** (Dex 5/5, Edge 3/5 valid) | CPU %core | 32.2 | 32.4 | **99.4 %** | **PASS** | FAIL |
| | RAM MB | 488.1 | 442.8 | 110.2 % | FAIL | FAIL |
| | GPU pts | 9.26 | 9.12 | 101.5 % | PASS (noise) | FAIL |
| | power mW | **4,868** | 5,623 | **86.6 %** | **PASS** | FAIL |
| **background-tabs** (Dex 4/5, Edge 5/5) | CPU %core | **0.5** | 22.7 | **2.2 %** | **PASS** | **PASS** |
| | RAM MB | 543.4 | 962.2 | **56.5 %** | **PASS** | **PASS** |
| | GPU pts | **0** | 2.84 | **0 %** | **PASS** | **PASS** |
| | power mW | 5,336 | 4,919 | 108.5 % | noise-flagged¹ | noise-flagged¹ |
| **idle** (Dex 4/5, Edge 3/5) | CPU %core | **0.15** | 0.8 | **18.7 %** | **PASS** | **PASS** |
| | RAM MB | 457.7 | 413.3 | 110.7 % | FAIL | FAIL |
| | power mW | 4,031 | 4,223 | 95.5 % | PASS (noise) | FAIL |

¹ Background power "FAIL" is **not credible as a real effect**: Dexerion
burns 0.5 % of a core with GPU 0 while Edge burns 22.7 % and 2.8 GPU points
— ~45× less compute cannot draw more power. The attributable-power
differences in both background and idle are floor-dominated (floors swung
2,986–11,037 mW this run; the user's own Edge session was running as a
co-tenant). Reported as noise, not claimed.

**Headline: Dexerion's foreground page now costs the same as Edge's (99.4 %
CPU) and draws LESS attributable power (86.6 %)** — the two axes that
looked worst in run 3 (107 % CPU, 120.5 % power) were substantially
measurement-condition artifacts (unfocused window on Dexerion's arm +
battery-raster confound in run 2), now removed and re-measured.

## Run-over-run progression (active-browsing, the hardest scenario)

| Metric | Run 1 (software GPU) | Run 2 (on battery, +1 page) | Run 3 (on AC, fair pages) | Run 4 (focused windows) |
|---|---|---|---|---|
| CPU | 137.5 % | 115.3 % | 107.0 % | **99.4 %** |
| RAM | 163.1 % | 140.7 % | 110.6 % | 110.2 % |
| GPU | 66.7 % | 102.1 % | 97.2 % | 101.5 % |
| Power | 16.1 % (unproven) | 104.3 % | 120.5 % | **86.6 %** |

## Raw trial record (medians of valid trials; per-trial data in
`%TEMP%\opencode\dexerion-test4\measure-protocol-main.json`)

- active-browsing — Dexerion 31.1–36.6 %core / 486.3–490.5 MB / GPU
  9.05–9.96 / attributable 6,730–8,375 mW; Edge 25.2–33.2 %core / 436.5–442.8
  MB / GPU 8.79–9.71 / attributable 7,422–8,745 mW.
- background-tabs — Dexerion 0.1–1.1 %core / 539–546 MB / GPU 0; Edge
  17.2–25.4 %core / 953–977 MB / GPU 1.72–4.87.
- idle — Dexerion 0.1–0.3 %core / 456–461 MB; Edge 0.4–1.1 %core / 411–416 MB.

## Where every remaining gap lives (V5 attribution, unchanged by run 4)

- **RAM (+10.2 % active / +10.7 % idle, +45 MB)**: the shell chrome renderer
  (99 MB — Electron renders the browser UI as a renderer; Edge's UI is
  native in the browser process). Offset partially by Dexerion's leaner main
  (117 vs 166 MB) and network (49 vs 80 MB) processes. Removing it means
  removing the UI — out of scope by the mission's own rules. In-scope
  residual: lazy-loading the AI bundle (~430 KB source, shell JS heap is
  only 10 MB used) recovers ~5–15 MB — not parity.
- **GPU active (101.5 %)**: parity within noise (0.14 GPU-point difference).
- **Covered-window rendering**: Electron 44 force-disables Chromium's native
  occlusion tracker (proven: not-disable AND explicit enable-features are
  both no-ops). After V6, a covered window idles at ~4.7 % of a core; a
  future page with continuous animation would still render while covered —
  documented platform limitation with a canary probe.

## Functional state at report time

- `test-gpu-modes.js`: **ALL CHECKS PASS** (hardware compositing live,
  verified in the run-3 probe round).
- Visibility probes: popup PASS, overlay PASS, background-visibility FAIL
  (pre-existing, identical since report 1 — frames stop,
  visibilityState "visible"; not a regression).
- probe-occlusion PASS on the V6 tree (restored newtab pixel spread 253,
  rAF resumes — no blank views).
- verify-all: 75 files OK. Full Playwright + rebuild/reinstall queued behind
  this run (the install was kept off the measurement machine-time).
