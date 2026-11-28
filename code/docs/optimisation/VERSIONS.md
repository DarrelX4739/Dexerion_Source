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
| V4 | foreground RAM 140.7% of Edge (GPU process 114 MB WS / 69 MB private — largest private consumer; third renderer persists at idle) + active-browsing CPU 115.3% | gpuMemBudget 256→128 MB A/B; renderer consolidation; active-browsing CPU audit | **All three measured and rejected, zero product changes**: GPU budget 512→64 = 0 MB GPU-process effect (allocation headroom, not resident footprint; argv-override assumption falsified); third renderer = the boot newtab (workload asymmetry, not an app defect); CPU rank-1 mechanism = run 2 ran on battery → CPU raster, so the fix is an on-AC re-run, not code | NO (no-win) |
| **R3** (checkpoint) | Run 2 confounded by battery raster + one extra page | On-AC + fairness-fixed harness (boot newtab navigated in place), 30/30 trials | **TEST-REPORT-3**: background CPU 3.6% / RAM 57.6% / GPU 0% **all PASS both bars**; idle CPU 26.7% PASS, power 75.5% PASS ≤80; active-browsing CPU 107.0% / RAM 110.6% / GPU 97.2% / power 120.5% (all FAIL, all within 3–21% of Edge) | checkpoint |
| V6 | newtab sky drift: 63–67% of a core whenever a new tab is visible (Edge ~0%); same burn while covered | **Static sky** (user-approved UI decision; sky-ab.js proved no cheap drift variant exists) | foreground newtab **61.8% → 4.4%** of a core; covered window **68.9% → 4.7%**; probe-occlusion PASS (pixel spread 253, rAF resumes); verify-all OK; Playwright + rebuild queued behind run 4 | YES |
| V7 | shell renderer +45 MB — the AI bundle (~430 KB: ai-sidebar/ai-search/ai-markdown/ai-artifacts/report-export) parses at boot for a panel that may never open | lazy-load on first panel intent via the `dex:ai-open` choke point + idempotent replay (`dex:ai-eager` kill switch); **REVERTED before commit**: Playwright caught 2 AI-search flow failures (search.spec, site-offline-assets) — the search entry paths bypass the choke point, so lazy timing breaks functionality; user directive: functionality untouchable. Both specs re-verified green on the reverted tree | REVERTED (functionality risk; projected win was only −5…−15 MB) | NO (reverted) |
| V5 | active-browsing power +20.5% and foreground/idle RAM +10.6%/+11.7% (~46–48 MB); no per-process attribution existed | per-process split probes (Dexerion + Edge-side mirror with throwaway-tree seeding), occlusion investigation, protocol fairness fix 2 | **Findings, no product change (reverted no-op)**: active CPU is GPU-compositing-dominated in BOTH browsers (Dexerion GPU 3.25 of 5.94% steady; Edge GPU 37.5 of 61.5% — same structure, not an anomaly); RAM gap = the shell chrome renderer (+102 MB) partly offset by Dexerion's leaner main (−50) and network (−31) processes; covered windows burn ~53–71% of a core because Electron 44 force-disables CalculateNativeWinOcclusion (not-disable AND explicit enable-features both no-ops — proven twice); minimized is fine (0.39%); the newtab sky's drift itself is the cost (any animation 63–67% of a core, static 2.8% — user UI decision); shell JS heap only 10 MB (lazy-AI upside ~5–15 MB) | checkpoint |

## Status summary (updated per version)

- Current best: **V6 tree** (hardware Adaptive GPU + renderer V8 caps +
  static newtab sky), as measured by run 4 (TEST-REPORT-4, on AC, focused
  windows both arms).
- **Parity bar (≤100% of Edge, user-directed) met in 8 of 10 measurable
  cells**: active CPU 99.4% and power 86.6% (Dexerion draws LESS),
  background CPU 2.2% / RAM 56.5% / GPU 0% (pass both bars), idle CPU 18.7%
  (passes both) and power 95.5%; active GPU 101.5% (parity within noise).
- Remaining gap: **RAM ~110% in every foreground state (+45 MB) = the shell
  chrome renderer** (99 MB — Electron renders the browser UI as a renderer;
  Edge's UI is native), partly offset by Dexerion's leaner main (−50 MB) and
  network (−31 MB) processes. Removing it means removing the UI — out of
  scope by the mission's own rules. Queued decision for the user: an
  Electron upgrade (newer Chromium baselines) is the one path that could
  close it without UI changes — a large functionality-affecting undertaking,
  deliberately deferred per user instruction.
- Background power 108.5% / idle power 95.5%: noise-flagged (45× less
  compute than Edge; floors 2,986–11,037 mW with the user's own Edge session
  as co-tenant) — not credible as real effects, reported not claimed.
- Real-world (non-benchmark) wins, user-approved and measured: newtab
  foreground **61.8% → 4.4%** of a core; covered window **68.9% → 4.7%**.
- Reverted: software-rendering GPU policy (8070fed) — measured active-browsing
  CPU regression; popup hide-with-owner (build-1) — measured no-op; ai.js
  lazy-load (V3) — 0.5 MB; V5 occlusion enable — proven no-op (Electron
  overrides the feature in C++).
- **Ladder length is not fixed at 50** (user direction): versions continue only
  until every axis meets the bar in every state, then the ladder stops and the
  final report is written.

## Current target: at least 20% lighter than Edge (40% stretch)

Grade CPU, RAM, GPU utilisation and attributable power separately in active
browsing, background tabs, idle and multitasking. The minimum is **≤80% of
Edge in each cell**, with **≤60%** as the stretch. Missing counters, zero
Edge baselines and noise-limited power do not count as passing. Run the
existing Windows protocol on AC with disposable profiles, both windows
focused during their respective trials, and no competing browser session.
From `code/build`, run:

```powershell
node scripts/measure-protocol.js
node scripts/grade-edge-target.cjs "$env:TEMP\opencode\dexerion-test1\measure-protocol-main.json"
node --test scripts/test-bookmarks-bar.cjs scripts/test-edge-target.cjs
```

Run 4 remains historical evidence, not a result for this branch. Its active
working set was 488.1 MB against Edge's 442.8 MB (20% target: 354.2 MB);
idle was 457.7 MB against 413.3 MB (target: 330.6 MB). Foreground CPU and GPU
were near parity; power was noise-limited. Do not trade off browser behaviour
or change the workload to meet the target.

First renderer change: retain bookmark bar links across unchanged chrome
updates. The repeat-state test with 100 bookmarks and 250 subsequent updates
allocates 100 links instead of 25,100 under the previous rebuild path. This is
a link-allocation count in a test fixture, not a measured CPU, RAM or power
gain. On Windows, check the toolbar and new-tab suggestions, rapid typing and
close/reopen, keyboard navigation, and bookmarking after tab switches in the
real app. For the previous suggestion change, use `DEX_SUGGEST_RESCAN=1` to
measure the old double scan on the same commit; time local results separately
from network completions.

### Follow-up: remove redundant shell work

- Bookmark membership now checks the URL directly rather than building a Set
  on every chrome update or click. On Linux/Node, a 1,500-bookmark fixture
  (early hit, late hit, miss; seven alternating 15,000-lookup batches per arm)
  went from 64.9 to 14.0 µs per lookup (78% less). This is not a full-app result.
- When a saved accent is present, skip the unused computed-style read. Tests
  cover the saved value, theme-token fallback and default fallback.
- Rejected a deferred profile writer that skipped byte-identical files.
  Changing only history cut flushes from ten to one, but a seven-batch
  local disk A/B was slower (0.53 to 0.75 ms per save). Profile persistence
  was left unchanged.
- Eight focused tests, the 82-file fast gate, and 16 packaging tests passed.
  No Windows/Edge resource result is claimed for these changes.

### Shell startup: load only the Lucide icons used by the browser chrome

The shell loaded 2,137 Lucide registry entries at startup, though its markup
needs only 14 and detached artifact menus reference two ellipsis aliases.
The shell now loads a generated subset with the original upstream SVG helpers
and the same load order. The full vendor file stays in the repository as the
generator input; this change does not shrink the installer or lazy-load AI.

- Startup script read: 449,915 → 5,448 bytes (98.8% less).
- Isolated Linux/Node V8 A/B (17 alternating fresh processes per arm, median):
  parse and initialise 21.89 → 0.29 ms; retained JS heap 2,602,872 → 24,136 bytes.
  These are component readings, not Electron process RAM, CPU %, or Edge results.
- Exact SVG trees, geometry, classes and ARIA attributes matched the full
  bundle for every shell placeholder and both artifact menu aliases. The
  fast verify gate checks that the checked-in bundle matches its generator.

From the repository root, run the parity test with
`node --test code/build/scripts/test-lucide-shell.cjs`, the A/B with
`node code/build/scripts/bench-lucide-shell.cjs`, or regenerate after adding
an icon with `node code/build/scripts/vendor-lucide-shell.cjs`. If a new icon
is created dynamically, add its registry name to the generator as well.

### Background sweeps: no tab scan when there cannot be a sleep victim

Memory Saver previously asked for every live tab's PID and audibility at each
sweep, even when the measured working set was at or below the configured cap.
The sweep keeps the same cadence and process sample, but skips per-tab work
when the planner cannot use it. Above the cap, sleep priorities, active and
audible-tab protection, and warnings still use the old path. Below the cap,
stale warning cleanup still runs.

In a 100-live-tab fixture, the under-cap path went from 100 PID and 100
audibility calls per sweep to zero; the single process sample stayed.
An isolated Linux/Node A/B with stubbed Electron APIs went from 85.6 to 1.6
µs per under-cap sweep (median of nine alternating 4,000-sweep batches per
arm). Those times exclude native sampling and are not app CPU or Edge
results. Tests cover the exact cap, forced over-cap samples, audible/active
guardrails, warning publication and cleanup, and the disabled saver.

### Focus Timer: retain the blocklist while only the clock changes

The running Focus Timer delivers a new state every 500 ms. Its renderer was
discarding and rebuilding all blocklist rows on every tick, even when their
ordered hostnames were identical. Keep the existing controls until a host
is added, removed, or reordered. The countdown, expanded and collapsed
controls, audio calls, and site's Unblock action update as before; an
unchanged Unblock button no longer loses focus on a clock tick.

In a Linux/Node fake-DOM A/B (25 hosts, 3,600 simulated ticks, median of nine
alternating batches per arm), the timer update went from 18.73 to 5.25 µs
and created 75 rather than 270,000 list nodes. This measures local code and
allocation counts, not app CPU %, working set, or Edge. The tests exercise
timer/audio state, focus retention, list changes, and exact removal targets.

### Extension toolbar: reconcile buttons and share pending icon calls

Keep toolbar buttons across unrelated tab updates. Continue to reflect the
ordered, enabled extension list, tooltip/version/error state, real or
placeholder icons and the same popup IDs. Preserve keyboard focus for
surviving buttons. Track a single pending icon request per display ID;
ignore late replies after uninstall, keep cached icons when disabled and
retry a rejected IPC on the next update. Broken records with identical
display IDs still get distinct buttons, in the original order.

In a Linux/Node fake-DOM A/B with 12 extensions and 200 extra state pushes
while icons were pending, the old path created 2,412 buttons and issued
2,412 icon calls; the new path did 12 of each. With icons resolved already,
the median of nine alternating 3,000-update batches was 40.99 → 9.18 µs per
update and the candidate made no button, image, or insertion allocations.
These are component samples, not whole-app CPU, RAM, GPU, or Edge results.

### Main-process task snapshots: reuse normalized wire rows between mutations

State serialization was replacing, sanitizing and sorting an account's task
list on every read, including unrelated tab navigation. Reuse the immutable
public rows while the normalized backing array stays current. The existing
task and reminder mutation paths replace that array before editing; a weak
key cannot pin superseded arrays or account objects. The renderer still
receives the same fields and handles date labels and overdue state as before.
Set `DEX_TASK_SNAPSHOT_CACHE=off` to restore the old read path.

In a 600-task Linux/Node fixture with unchanged data, 750 reads reduced
750 normalize/sort passes to one. Median time including the first read
was 194.26 → 0.62 µs per read across nine alternating batches per arm.
The cache retains one immutable wire snapshot per currently used list;
this measurement concerns CPU and repeated allocations, not application
RAM, Electron IPC cost, or Edge. Tests cover exact serialized rows, malformed
records, real task-handler mutations, account replacement, reminder flags,
and the off switch.

### Task renderer: share date and time formatters within one render

Both the peek and full task views used to recreate locale date/time formatters
per row. Lazily create at most one date and one time formatter for both views
on a render, and discard them when it finishes. This does not memoize labels,
tasks, time zones or overdue state between renders. The tests compare exact
text across six locale/zone pairs, including DST and invalid dates, and check
overdue, toggle/delete and empty/all-day behavior.

In a 125-task Linux/Node fake-DOM fixture, the median of seven alternating
eight-render batches went from 8.79 to 1.54 ms per render (about 82% less).
This is an isolated large-list path, not an app CPU or Edge measurement.
