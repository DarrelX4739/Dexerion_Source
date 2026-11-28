# Linux hosted comparison baseline

[GitHub Actions run 46090406483](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46090406483)
compared commit `5cf737f` with installed Google Chrome on the same Ubuntu runner,
using the same local workloads, throwaway profiles, a virtual display and
software rendering in both arms. Both browsers ran five matched trials in each
scenario. The job kept the raw evidence. Its comparison step returned nonzero
because the first checker conflated a zero reference with missing measurements;
all CPU and RAM trial readings were present.

| Workload | Dexerion CPU | Chrome CPU | Dexerion PSS | Chrome PSS | Dexerion vs Chrome |
|---|---:|---:|---:|---:|---|
| Idle | 0.25% | 0.00% | 307.5 MiB | 418.7 MiB | CPU ratio undefined; RAM 26.5% lower |
| Active browsing | 5.25% | 5.25% | 315.0 MiB | 426.0 MiB | CPU near parity; RAM 26.1% lower |
| Background tabs | 0.25% | 1.25% | 383.4 MiB | 537.3 MiB | CPU 80.0% lower; RAM 28.6% lower |
| Multitasking | 4.75% | 31.47% | 388.7 MiB | 560.9 MiB | CPU 84.9% lower; RAM 30.7% lower |

CPU percentages are of one logical core. PSS is whole-tree proportional set
size, which accounts for shared pages and is not Windows Task Manager working
set. These are the observed medians for this software-rendered fixture, not
a claim about all sites, hardware GPU use, power, or Microsoft Edge. They do not
isolate the effect of any single patch. Target remaining in this runner:
foreground CPU. Idle CPU is too close to the counter floor to infer a
reliable percentage from this run.
