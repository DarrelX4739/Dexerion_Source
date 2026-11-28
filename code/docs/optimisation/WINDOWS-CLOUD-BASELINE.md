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

## November 28 follow-up: why the launch flags and RAM metric matter

The [first direct-binary run](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46096816986)
used a new disposable profile per trial and loopback DevTools, without
Playwright's Chromium launch flags. After a 4-second settle, Dexerion used
452.0 MiB vs Edge's 725.4 MiB summed working set (37.7% lower) across five
active trials per browser. Both recorded about 68 animation callbacks per
second, but the viewport dimensions differed slightly. Native Edge had nine
renderer processes even with one measured tab; Dexerion had two. Private
commit was about 168.5 vs 313.3 MiB. These figures are not a product change
since the earlier Edge runs, and do not generalise to warmed profiles.
[Fresh-profile, 22-second settle follow-up](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46097489951).

[The PID-attribution control](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46096917326)
used the original automation-launch conditions to map the exact Dexerion
shell and page renderer. The two memory figures are different:

| Active process group | Summed working set | Private resident working set |
|---|---:|---:|
| Dexerion interface | 103.4 MiB | 35.9 MiB |
| Dexerion test page | 109.0 MiB | 27.3 MiB |
| Edge renderers combined | 101.0 MiB | 28.6 MiB |
| Dexerion whole tree | See raw run | 122.6 MiB |
| Edge whole tree | See raw run | 87.5 MiB |

Total working set can count shared library pages once per process; private
commit is not equivalent to resident RAM. For the metric definitions, see
[Microsoft's working-set documentation](https://learn.microsoft.com/en-us/windows/win32/memory/working-set)
and [Windows memory counter mapping](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information).
Do not combine numbers across those launch modes when grading a target.

In [three live renderer profiles](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46097995449)
with a simple loaded page, the interface used about 2.3 MiB of JavaScript
heap in a ~34 MiB privately resident process. Blink/embedded heap, native
renderer memory, and shared mappings are not the JS heap. This puts a
strong limit on the fresh-window savings available from script tuning
alone. It does not rule out bigger lifecycle fixes for long-lived,
feature-heavy sessions. The privileged interface and website renderer
remain separate and their sandboxing is unchanged.


### Same-host launcher control and unpacked build

The [four-arm control](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46098370022)
on one VM confirmed that launcher choice, rather than a product patch,
changed the initial denominator. Estimated working set was 716.7 MiB with
direct Edge vs 407.7 MiB under automation; Dexerion moved only from
444.3 to 443.8 MiB. Direct Edge exposed three nonworkload service-worker
targets and a median of nine renderer processes (two with automation).
Direct Edge used 186.7 MiB of private resident working set vs 124.3 MiB
for direct Dexerion in that short-settle experiment.

The more representative [unpacked-binary comparison](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46098467113)
used 22-second settling on fresh profiles. It built and started Dexerion
without signing, installing or publishing. In the same visible foreground
workload, Dexerion used 478.8 vs Edge's 553.4 MiB summed working set
(13.5% lower); private resident memory was 147.0 vs 150.9 MiB (2.6% lower).
GPU engine utilisation was essentially tied. Edge had five renderer
processes after the longer settle. The 20% foreground memory threshold is
not established under these conditions. This is still a disposable-profile
VM comparison, not a benchmark of previously used profiles or a physical
GPU/power test.

### All workloads with a fresh profile and a 22-second settle

[Run 46097489951](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46097489951)
used direct binaries and the source-tree Dexerion build. Five launches per
browser per workload, same VM. In this and the preceding run, a longer
settle does not imply an existing browsing profile. Each trial started
with a new disposable profile.

| Workload | Dexerion / Edge total working set | Dexerion / Edge private resident | Dexerion / Edge CPU (% of one core) |
|---|---:|---:|---:|
| Active | 439.4 / 554.9 MiB (−20.8%) | 120.0 / 144.5 MiB (−17.0%) | 1.226 / 1.832 |
| Background tabs | 470.1 / 1,026.8 MiB (−54.2%) | 157.0 / 268.0 MiB (−41.4%) | 1.858 / 1.439 |
| Idle | 420.0 / 527.5 MiB (−20.4%) | 109.7 / 138.1 MiB (−20.6%) | 1.235 / 0.822 |
| Multitasking | 506.8 / 1,044.3 MiB (−51.5%) | 174.1 / 268.6 MiB (−35.2%) | 2.845 / 3.858 |

GPU engine utilisation was roughly tied in the animated workloads (Dexerion
3.33 vs Edge 3.25 active; 3.37 vs 3.29 multitasking), with zero medians in
both nonanimated workloads. A zero baseline does not establish a saving.
Physical power was unmeasured. These absolute Windows percentages do not
come from Task Manager's busiest-engine view.

### Previously primed profile control

[Run 46099031702](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46099031702)
primed each browser once on a synthetic local page, then cloned its
temporary profile for each measured launch. No real profile was read.
Foreground working set was **449.1 vs 414.1 MiB (+8.5%)**, and private
resident memory was **127.4 vs 101.9 MiB (+25.0%)** (five Dexerion and
four usable Edge private resident samples). GPU engine utilisation was
near equal (1.607 vs 1.585). Edge used a median of two renderer processes
here, compared with nine in the first short-settle fresh-profile run.
This shows why initial fresh-profile results cannot establish the target
for continued use. The browser UI and compiler/runtime footprint are
not explained by JavaScript heap alone.
