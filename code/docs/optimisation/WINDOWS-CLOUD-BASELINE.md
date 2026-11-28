# Windows hosted comparison against Microsoft Edge

[Run 46091654316](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46091654316)
measured five trials per browser per workload on the same hosted Windows
Server 2025 VM, with throwaway profiles, a high-performance power plan,
Dexerion commit `aa8fd99` / Electron 44.4.5 and Microsoft Edge 158.0.4370.33.
Use the run artifact for raw trials and IQRs. These are Windows process and
GPU Engine counters, not screenshots from Task Manager or physical GPU
or battery measurements.

Both browser binaries were managed by Playwright, whose default Chromium
switches affect timer throttling, renderer backgrounding, and other
behaviour. "Fresh profile" does not mean an unmodified launch. Treat
cross-browser numbers as directional for this harness, particularly for
background tabs; retest with minimal launch flags on the same machine
before generalising to normal installations.

| Workload | Dexerion CPU / Edge CPU | Dexerion RAM / Edge RAM | Dexerion GPU / Edge GPU |
|---|---:|---:|---:|
| Active browsing | 0.0 / 1.4% core | 452.2 / 402.2 MiB (+12.4%) | 3.18 / 3.06 points (+3.9%) |
| Idle | 0.0 / 0.4% core | 425.6 / 385.5 MiB (+10.4%) | 0 / 0 points (no ratio) |
| Background tabs | 0.4 / 1.2% core | 510.4 / 912.3 MiB (−44.1%) | 0 / 0.08 points (near floor) |
| Multitasking | 1.2 / 1.6% core | 545.5 / 963.9 MiB (−43.4%) | 3.36 / 3.95 points (−14.9%) |

Zeros at the CPU or GPU resolution are not proof of no cost. In particular,
foreground and idle CPU should not be interpreted as a 100% win; this
Windows run does not independently verify foreground animation cadence.
The Windows hosted run omitted power. Active/idle RAM and active/multitasking
GPU remain outside the Windows 20% target.

At this host's Edge medians, the 20%-lighter RAM budget is 321.8 MiB
active and 308.4 MiB idle, versus measured Dexerion 452.2 and 425.6 MiB.
Meeting that budget requires reducing about 130 and 117 MiB respectively
under the same workload, not just reducing component heap.

## Foreground cadence control

[Run 46093696956](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46093696956)
repeated the visible foreground workload five times per browser with
roughly 68 animation callbacks/s for each arm. The medians were 451.6 vs
405.9 MiB working set (+11.3%) and 2.16 vs 2.10 GPU Engine points (+2.9%).
CPU medians were 0.2% vs 1.9% of one core on the seven-second samples; the
absolute difference is small and does not establish a CPU win on other
workloads. Animation callbacks verify workload cadence, not presented
frames. There was no physical power measurement.

The subsequent protocol distinguishes the foreground URL and checks the
exact tab inventory. It also records per-role working set and private
allocations and rotates trial order. These are diagnostics for deciding
whether to investigate the shell renderer, other renderers or the GPU
process; private allocations are not physical resident memory. No role
subtotal changes the existing whole-tree working-set acceptance metric.

For the separate Linux Chrome observations see [CLOUD-BASELINE.md](CLOUD-BASELINE.md).
The OSes use different memory counters; do not subtract them or claim an
isolated patch caused the cross-browser differences.
