# VERSIONS.md — 50-version optimisation ladder (Dexerion vs Edge)

Method per version: identify bottleneck (from measured data) → one controlled
change → benchmark → functional validation → keep only verified improvements
(revert regressions). Primary measurement: process-tree CPU% (of one core),
working set, GPU Engine utilisation points, RAPL package power with paired
floors — in three states (active browsing / background-minimised / idle),
Task-Manager-equivalent metrics. Milestone checkpoints (V10/V20/... ) re-run
the full paired protocol; between milestones the quick per-version gate runs.

Baseline: TEST-REPORT-1.md (independent Tester's recomputed report — 3
complete scenarios, multitasking PARTIAL, baseline SKIPPED-WEDGED; 13/40
trials invalidated by the noise rule). Blocking failures at baseline:
active-browsing CPU 137.5% of Edge, RAM 163.1% active / 164.9% idle / 78.7%
background (fails every scenario).

| V | Bottleneck (measured) | Change | Result | Kept? |
|---|---|---|---|---|
| V1 | active-browsing CPU 137.5% of Edge — caused by the software-rendering policy (compositing on CPU) | Restore hardware-accelerated Adaptive GPU (raster on AC boots, zero-copy, 256/512 MB GPU budget); adaptive controller unchanged | Gates: 8/8 unit, GPU MODES ALL PASS (hardware compositing enabled verified live), verify-all 75 files, boot smoke 3/3. Edge comparison pending V1 re-measure | YES (pending confirm) |
| V2 | RAM baseline ~163–165% of Edge (idle/active) | renderer V8 heap caps: old space 512→256 MB + semi-space 8 MB (verified propagated: renderer cmdlines + performance.memory.jsHeapSizeLimit 608→280 MB); renderer-process-limit 6→4 evaluated and REJECTED (inert under process-per-site — 10 renderers at both limits, A/B measured) | Gates: verify-all 75 OK, 8/8, GPU MODES ALL PASS, Playwright 43/43 (6.8m incl. 20 intensive rounds, no OOM); probe: tree WS 642–646 MB, caps bind growth headroom (~55% lower per-renderer reservation) | YES |
| V3 | Browser process 121 MB — ai.js eager dep chain | ai.js lazy-load implemented via the proven accessor pattern, all gates green (43/43), then **REVERTED on measurement**: whole chain costs ~0.5 MB RSS (10× under the bar); browser.js's B3 pins already hold 5/7 deps eagerly; GPU process (111 MB), renderers (3×~114-134 MB) and Chromium core are the real weight | REVERTED (no-win; patch preserved %TEMP%\opencode\V3-ai-lazy-REVERTED.patch; probe-ai-boot-modules.js kept) | NO (reverted) |
| V4 | foreground RAM 140.7% of Edge (GPU process 114 MB WS / 69 MB private — largest private consumer; third renderer persists at idle) + active-browsing CPU 115.3% | gpuMemBudget 256→128 MB A/B; renderer consolidation (find+fold the idle third renderer); active-browsing CPU profiling | pending | — |

## Status summary (updated per version)

- Current best: V1 (hardware-accelerated Adaptive GPU + build-1 items
  53b7cc7).
- Measured blockers: RAM (all states), active-browsing CPU.
- Reverted: software-rendering GPU policy (8070fed) — measured active-browsing
  CPU regression; popup hide-with-owner (build-1) — measured no-op.
