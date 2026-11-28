# Windows hosted comparison against stock Edge

[Run 46091654316](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46091654316)
measured five trials per browser per workload on the same hosted Windows
Server 2025 VM, with throwaway profiles, a high-performance power plan,
Dexerion commit `aa8fd99` / Electron 44.4.5 and stock Edge 158.0.4370.33.
Use the run artifact for raw trials and IQRs. These are Windows process and
GPU Engine counters, not screenshots from Task Manager or physical GPU
or battery measurements.

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

For the separate Linux Chrome observations see [CLOUD-BASELINE.md](CLOUD-BASELINE.md).
The OSes use different memory counters; do not subtract them or claim an
isolated patch caused the cross-browser differences.
