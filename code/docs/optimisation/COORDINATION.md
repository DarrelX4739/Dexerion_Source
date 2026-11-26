# COORDINATION.md — Dexerion Optimisation Mission Ledger

**Mission:** make Dexerion use ≥40% less CPU, RAM, GPU and power than Microsoft Edge under equivalent ACTIVE-browsing workloads (≤60% of Edge on every axis), measured on the whole browser process tree — with **zero** loss of feature, compatibility or stability.

**Status:** ACTIVE. Written and maintained by the Controller. This file is the single source of truth for who may do what, in which order. Any agent whose instructions contradict this ledger must stop and ask the Controller (via the main session).

**Baseline reality (verified before this ledger was written):**
- App source: `code/code/` — entry `main.js` (the `package.json` "main" in `code/build` points at `../code/main.js`, so edits to `main.js` land in the packaged app).
- Main-process modules: `code/code/src/main/*.js` — including `adaptive-power.js`, a **pure decision-logic module** (no Electron, no timers, no I/O) implementing GPU modes `adaptive | cap10 | off`, tiers `suspended|minimal|balanced|accelerated`, 15 s hysteresis, 10-minute suspend idle.
- Build/test tooling: `code/build/` — `package.json` scripts (`verify`, `test`, `test:power`, `bench:power`, `test:e2e`, `test:intensive`, `test:memsaver`, …) and `scripts/*.js`.
- `npm run verify` runs `code/build/scripts/verify-all.js`: it syntax-parses **every** JS file in `code/code/src/main/` and `code/build/e2e/`, and enforces version-ladder and offline-delivery invariants. Any Builder edit is caught here if it breaks parsing or invariants.
- Existing perf tooling (all confirmed present in `code/build/scripts/`):
  - `power-benchmark.js` — whole-tree power/CPU/RAM/GPU benchmark driver.
  - `power-sample.ps1` — Windows process-tree sampler used by the benchmark.
  - `power-compare.js` — compares two benchmark runs (e.g. Dexerion vs Edge).
  - `probe-background-visibility.js` — probes background/visibility behaviour.
  - `test-adaptive-power.js` — unit tests for `src/main/adaptive-power.js` (no Chromium needed).
  - `test-gpu-modes.js` — GPU-mode (Adaptive | 10% cap | Off) tests.
  - `debloat-perf.js` — performance-debloat analysis/sweep tooling.
  - Adjacent gates: `verify-all.js`, `final-gate.js`, `functional-smoke.js`, `intensive-e2e.js`.

---

## 1. Agent roster and responsibilities

| Agent | Role | Writes | Reads |
|---|---|---|---|
| **Controller** (this agent; the main session acts as Controller and relays on its behalf) | Owns this ledger. Serialises phases, approves plan finality, grants edit windows, resolves ownership disputes, decides when targets are met, guards scope. | Only `docs/optimisation/COORDINATION.md` (and may authorise plan docs in `docs/optimisation/`). | Everything. |
| **Researcher/Planner** | Gathers external evidence (docs, Chromium/Electron flags, prior art, benchmark methodology), produces the research corpus and the **plan doc** (changes, rationale, expected effect, risk, reversibility, gate for each change). | Only `docs/optimisation/` research notes and plan docs. Never touches code. | Everything (read-only). |
| **Builder** | Implements plan-approved, performance-only changes during its granted edit window. Keeps every change reversible and self-contained. | Only the paths in §2 it is explicitly granted for that window. | Everything. |
| **Tester** | Runs benchmarks, unit tests, `npm run verify`, and the perf tooling; produces measurement reports against Edge baselines. Never edits source. | Only measurement output artifacts (logs/reports, outside source trees) and reports in `docs/optimisation/`. | Everything. |

**Relay rule:** the four agents do not talk to each other directly. The **main session relays** between them: it hands the final plan doc to the Builder, hands Builder output to the Tester, hands measurements back to the Controller, and relays this ledger's decisions. Agents must address requests *through* the main session, never side-channel edits.

---

## 2. File-ownership map

### Ownership matrix

| Path | Controller | Researcher | Builder | Tester |
|---|---|---|---|---|
| `code/docs/optimisation/COORDINATION.md` | **write** | read | read | read |
| `code/docs/optimisation/*` (plans, reports) | authorise | **write** | read | **write (reports only)** |
| `code/docs/**` (rest) | read | read | read | read — **shared read for all** |
| `code/code/main.js` | read | read | **write** (perf-only, in window) | read |
| `code/code/src/main/**` | read | read | **write** (perf-only, in window) | read |
| `code/code/src/main/adaptive-power.js` | read | read | **FROZEN** (see below) | read |
| `code/code/src/renderer/**` | read | read | **off-limits** unless change is *provably* performance-only and Controller approves in writing | read |
| `code/code/src/renderer/shell.css` | read | read | **FROZEN — never edit** | read |
| `code/code/src/renderer/shell.js` | read | read | **FROZEN — never edit** | read |
| `code/build/package.json` | read | read | **write** (scripts/config only, perf-related) | read |
| `code/build/scripts/*.js`, `*.ps1` | read | read | **write** (perf tooling, in window) | read |
| `code/build/e2e/**` | read | read | ask Controller first | read |
| Source trees (all) during any test/benchmark run | read | read | read | read |

### Hard freezes (no agent, no exceptions, until Controller explicitly unfreezes)

1. **`code/code/src/renderer/shell.css` and `code/code/src/renderer/shell.js`** — owned by the concurrent fullscreen-video feature. Absolutely frozen for this mission. Any change request touching them is refused at plan level.
2. **`code/code/src/main/adaptive-power.js` + `code/build/scripts/test-adaptive-power.js` + `code/build/scripts/test-gpu-modes.js`** — owned by the **concurrent GPU task (Adaptive | 10% cap | Off), which is finishing separately and must not be disturbed.** The Builder must not edit these files; the Tester may *run* `test:power` and GPU-mode tests read-only but must not modify them. Controller unfreezes only after the GPU task has landed and the main session confirms it.
3. **Feature/UI code** anywhere (menus, tabs UI, sidebar, artifacts, AI features, polish layers) — off-limits. Performance work adjusts *how* code runs (flags, cadences, caching, laziness, process config), *not what the browser does or looks like*.

### "Provably performance-only" bar for renderer files
A renderer change qualifies only if ALL of: (a) no DOM/CSS/layout/visual output changes, (b) no event-handler or API behaviour changes, (c) strictly removes/skips work (timers, observers, paints, allocations) without altering results, (d) plan doc contains a per-file diff rationale the Controller has approved, (e) `test:e2e` and `test:polish` pass unchanged. When in doubt, the answer is **no**.

---

## 3. Sequencing protocol

Strict phase order; **never two agents editing code at once.** One code-editor at any moment — full stop.

```
[1] RESEARCH      Researcher gathers sources (read-only)          — Builder idle, no edits
[2] PLAN          Researcher writes plan doc → Controller reviews → declares plan FINAL
[3] BUILD         Builder implements, one edit window at a time   — sole code editor
[4] TEST          Builder STOPPED (no edits). Tester benchmarks    — read-only + tools
[5] GATE          Controller compares vs Edge targets
      ├─ targets met → mission item CLOSED (reversibility + gate-check recorded)
      └─ unmet      → [6]
[6] POLISH        Researcher refines → Controller approves → Builder iteration → re-TEST
                  (repeat; see §5 escalation after 5 failed polish iterations)
[7] RETEST        full benchmark + npm run verify + final-gate before any hand-off
```

Rules:
- Phases are **serialised end-to-end**. The Tester never runs while the Builder holds an edit window; the Builder never edits while a benchmark is sampling (sampling must measure a stable tree).
- A **Builder edit window** = one approved plan item (or small batch). Builder must hand off (`npm run verify` green) before the window closes.
- Test results are always reported back through the main session to the Controller, which alone declares pass/fail against the ≤60%-of-Edge targets.
- Measurement order is fixed: baseline Edge run → baseline Dexerion run → change → re-run, same workload script, same machine state, via `power-benchmark.js` / `power-sample.ps1` / `power-compare.js`.

---

## 4. Conflict-prevention rules

1. **Plan finality gate:** the Builder edits **only after** the Controller (main session) explicitly confirms the plan doc is **FINAL**. An unfinalised or implicitly-approved plan is not permission to edit.
2. **Single-writer invariant:** at most one agent may hold an edit window. Edit windows are granted and revoked by the Controller and relayed by the main session.
3. **Tester is read-only on source:** the Tester runs read-only benchmarks plus `code/build` tools (`verify-all.js`, `power-benchmark.js`, `power-sample.ps1`, `power-compare.js`, `probe-background-visibility.js`, `test-adaptive-power.js`, `test-gpu-modes.js`, `debloat-perf.js`, `final-gate.js`, e2e suites) and writes only output artifacts/reports. It never patches code to "fix" a failing run.
4. **Verify-before-handoff:** **every agent** — Builder after editing, Tester after testing, Researcher before submitting a plan — re-runs `npm run verify` **from `code/build/`** and reports it green in its hand-off. A red `verify` blocks the phase transition. (Builder edits additionally pass the relevant targeted tests, e.g. `test:power` only if GPU files were legally touched post-unfreeze.)
5. **Frozen files are refuse-to-plan:** any plan item touching §2 hard freezes is rejected before it reaches the Builder.
6. **No concurrent GPU-task interference:** if a run, edit, or benchmark would disturb the GPU task (its files, its runs, shared machine state during its measurement windows), the Controller reschedules instead.
7. **Reversibility:** every Builder change ships with a revert note (what to undo, how). Un-reversible changes are not plan-approved.

---

## 5. Iteration policy (escalation)

If **five (5) consecutive Builder polish iterations** fail to reach a mission target (any axis still >60% of Edge):

1. Building **halts**. Controller closes Builder edit windows.
2. The **Researcher must add at least 200 additional distinct sources** (new, not re-cited: documentation pages, Chromium source/design docs, Electron issues, prior benchmark studies, vendor guidance, academic papers, real-world case studies) to the research corpus, focused on the unmet axis(es).
3. The Researcher produces a **revised plan doc** grounded in the new sources; the Controller reviews and re-declares finality.
4. Only then may building resume (back to §3 step [3]).

Purpose: five failures means the *knowledge base*, not the code, is exhausted. Escalation forces genuinely new evidence instead of thrashing the same ideas. The Controller tracks the iteration count in this ledger's status updates; the count resets only when a full TEST gate passes.

---

## 6. Scope guardrails (absolute)

1. **Performance-only.** Every change must be justifiable purely as CPU/RAM/GPU/power reduction. No behaviour, feature, or compatibility change rides along.
2. **No feature removal.** Nothing the browser does today may stop working, degrade in capability, or lose an entry point.
3. **No UI changes.** No visual, layout, animation, or interaction changes. Frozen shell files (§2) are the hard boundary.
4. **No foreground throttling.** No artificial delay, degradation, or reduced responsiveness for the *active/foreground* page. Background-tab and idle-state savings are in scope; anything a user can feel on the focused tab is out.
5. **No benchmark gaming.** No detecting the benchmark/harness, special-casing test URLs, pre-warming only during measurement, deferring work past the sampling window, or shifting cost onto the sampler. Measurements must reflect real active-browsing behaviour on the whole process tree.
6. **Reversible.** Every change has a documented revert path; a single-iteration revert must restore prior behaviour exactly.
7. **Gate-checked.** Every change passes `npm run verify` (from `code/build`), the relevant targeted tests, and the full benchmark gate (`final-gate.js` where applicable) before being declared done.
8. **Freezes respected.** §2 hard freezes are non-negotiable regardless of expected gain.

---

*Ledger maintained by the Controller. Amendments only via the Controller, relayed through the main session. Last grounded against: `code/build/package.json`, `code/build/scripts/verify-all.js`, `code/code/src/main/adaptive-power.js`, and the confirmed `code/build/scripts/` perf tooling listed above.*
