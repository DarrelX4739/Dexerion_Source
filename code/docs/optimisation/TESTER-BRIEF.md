# TESTER-BRIEF.md — measurement protocol for the Dexerion vs Edge mission

Authorised by the Controller (main session) under `COORDINATION.md`. The
Tester implements this protocol in new files under `build/scripts/` and
writes reports to `docs/optimisation/`. The Tester never edits app source.

## Acceptance bar (mission)

Dexerion ≤ **60% of Edge** (= ≥40% reduction) on **all four axes** — CPU,
RAM, GPU, power — during **active browsing** (animated foreground content +
background tabs, not just idle/sleeping), measured on the **whole browser
process tree**, same computer, same websites, same workloads, repeated
controlled trials. Results must be confirmed by this independent protocol,
not by the Builder's own claims.

## Protocol requirements (each is a hard requirement, not a suggestion)

1. **Repeated trials.** ≥5 trials per scenario per browser per metric.
   Report median + IQR and per-trial values; never a single run.
2. **Whole process tree.** Sum CPU time (100 ns units via
   `Win32_Process` deltas or `Get-Process` TotalProcessorTime), working set,
   and GPU Engine utilisation across the browser process AND every child
   (renderers, GPU, utility, crashpad). Attribute to the tree, not one PID.
3. **GPU axis.** Sample `\GPU Engine(*)\Utilization Percentage` and
   `\GPU Engine(*)\Memory(*)` grouped by pid. Note: Dexerion currently runs
   software rendering by user decision — record GPU utilisation honestly
   (expected near-zero) and report the CPU cost side-by-side, since
   software rendering shifts work from GPU to CPU.
4. **Power axis.** Windows RAPL `\Energy Meter(rapl_package0_pkg)\Power`
   (mW, 1 Hz, first sample discarded) with the paired-floor protocol
   (floor sampled immediately before each workload). Record co-tenant
   processes (VS Code, Defender, OneDrive, agents) during every trial and
   mark any trial contaminated by a >20% floor swing as invalid.
5. **Identical workloads.** Local HTTP server serving deterministic animated
   pages (reuse the harness in `power-benchmark.js`). Scenarios: idle,
   active browsing (foreground animation), background tabs (8 animated,
   1 active static), multitasking (foreground animation + 8 background
   animated). Both browsers: throwaway profiles, no sync, no first-run.
6. **Environment recording.** Per trial: power plan (pin High Performance
   if permitted), AC/battery state, Edge + Electron versions, OS build,
   co-tenant CPU load. A trial missing these is invalid.
7. **Functional safety probes.** After measurement, prove features still
   work: navigation, background-tab wake, popups, downloads dir setting,
   Focus page, settings persistence (existing `test-gpu-modes.js` and
   `probe-*.js` cover part of this — run them and record results).
8. **No gaming.** Do not disable caches/updates only inside the benchmark
   path, do not special-case the measurement pages, do not throttle the
   foreground. Kill switches stay in their shipped (default) state.

## Deliverables

- `build/scripts/measure-protocol.js` (+ helpers): implements 1-6, emits JSON.
- `docs/optimisation/TEST-REPORT-<n>.md`: per-scenario tables
  (Dexerion vs Edge, median + IQR, per-axis % of Edge), trial counts,
  environment block, invalid-trial log, functional-probe results, and an
  honest PASS/FAIL per axis against the ≤60% bar.
- A verdict section stating which axes meet the bar and which do not, with
  the measured numbers — no extrapolation.

## Baseline duty

The FIRST report must measure the **pre-build-1** baseline if it can
(stash-free: use a git worktree of the pre-builder commit with a
`build/node_modules` junction, as done for `power-baseline-ab.json`), so
the Builder's delta is separable from the Edge comparison. If the Builder's
changes are already committed, measure the committed tree and state that
the pre/post split comes from the git history instead.
