# TEST-REPORT-1 — Dexerion vs Edge (interim, Controller-compiled)

Compiled by the Controller from the Tester's captured run log after the
Tester's baseline phase wedged silently (recovery instance in flight; if it
delivers, its version supersedes this file). All numbers are verbatim from
the protocol's own printed output — nothing is extrapolated.

## Run conditions

- Protocol: TESTER-BRIEF.md (paired RAPL floors, whole process tree, GPU
  Engine counters, throwaway profiles both browsers, ≥5 interleaved trials
  per scenario per browser).
- Machine noise: floors swung 3,964→18,816 mW between adjacent minutes;
  **15 of 50 trials marked INVALID** (floor-swing >20%) by the contamination
  rule.
- Deadline: the 45-minute limit cut multitasking at trial 3.
- Baseline: SKIPPED-WEDGED (pre-build-1 worktree pass never produced data).

## Verdict matrix vs the ≤60%-of-Edge bar (from the protocol's own JSONs)

| Scenario | CPU | RAM | GPU | Power |
|---|---|---|---|---|
| active-browsing | **FAIL 137.5%** | **FAIL 163.1%** | FAIL 66.7% | "PASS" 16.1% — UNPROVEN (2–3 valid trials; within-window co-tenant spike in edge/3 invisible to floor checks) |
| background-tabs | **PASS 0.9%** | FAIL 78.7% | **PASS 0%** | ≈equal (both ≈0 attributable) — not a demonstrated reduction |
| idle | **PASS 36.4%** | FAIL 164.9% | n/a (≈0 both) | meaningless (both ≈0 attributable) |
| multitasking (3/5 trials, deadline-cut) | ~45–48% → PASS trajectory | ~81% → FAIL trajectory | ~25% → PASS trajectory | mixed |

## Key raw numbers (clean trials, verbatim)

- active-browsing: Edge 26.9–28.5% core / 435–444 MB; Dexerion 35.1–38.9%
  core / 715–729 MB (software-rendering build).
- background-tabs: Edge 8.2–26% core / 951–969 MB; Dexerion **0.0–1.4% core**
  / 756–766 MB, GPU 0 pts.
- idle: Edge 0.6% core / 413 MB; Dexerion 0% core / 684 MB.

## Honest findings

1. **Background-tab CPU is ~100× below Edge** (five matched trials) — the
   detach+hide compositing fixes are proven by independent measurement.
2. **Active-browsing CPU failed because of the software-rendering policy** in
   force during this run (user-directed, commit 8070fed): compositing moved
   onto the CPU. The V1 GPU decision (hardware-accelerated Adaptive) targets
   exactly this axis.
3. **RAM fails in every scenario** (~63–65% above Edge in foreground states;
   Dexerion carries a ~270 MB higher baseline). This is the systematic
   blocking failure for the version ladder.
4. **Power PASSes in this run are not demonstrations**: background/idle are
   both-near-zero ties; active-browsing rests on 2–3 valid trials with a
   within-window spike edge/3 (19,471 mW against a 5,672 floor) that
   floor-swing checks cannot catch.

## Functional proofs (at report time)

- test-gpu-modes ALL PASS (per-mode switch state + persistence round-trips).
- probe-overlay-visibility / probe-popup-visibility / probe-wcv-semantics:
  PASS (rAF ground truth) — from build-1's gate evidence; recovery-instance
  re-run pending in TEST-REPORT-2 if delivered.
