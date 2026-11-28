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

## Same-host reference A/B

[Run 46092264614](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46092264614)
compared `a06b2cd`, pre-batch `ce1ea87`, and Chrome on one Linux host, with
six balanced launch-order permutations per workload. The active-browsing
medians were 60.08 / 59.96 / 59.96 fps respectively and approximately
6.75% of one core in all three. Multitasking remained near 60 fps in all
arms, with CPU medians 7.49 / 7.99 / 41.20% of one core respectively.
Dexerion's process-tree PSS was about 1.35–3.83 MiB lower than the earlier
Dexerion build across the four workloads and 26.3–30.5% lower than Chrome.
The A/B is pre-dormant-account optimisation and does not measure that patch.

No broad foreground CPU win was demonstrated. Background CPU was low and
the idle Chrome CPU changed substantially across runners, so idle percent
reduction is not treated as a stable result. Hardware GPU and power
remain unmeasured in this Linux comparison.

## Dormant-account RAM, isolated on one build

[Run 46092715294](https://github.com/DarrelX4739/Dexerion_Source/actions/runs/46092715294)
compared the same Electron build `ebb9eb0` with
`DEX_COLD_ACCOUNT_TASKS=off` and with it on, six alternating trials per arm.
The fixture had 12 unopened synthetic accounts, 3,000 history entries and
50 archived chats per account. The normal boot reminder sweep had time to run.
Main-process PSS fell from 125.35 to 98.84 MiB (21.2%); the whole tree fell
from 369.75 to 344.36 MiB (6.9%). This isolates a real app gain for a large
multi-account profile; it does not extrapolate to a fresh profile or claim
a general 6.9% improvement against another browser.


### Automation caveat

Linux Chrome was started with a disposable profile and a small explicit
flag set. Dexerion was started with the Playwright Electron harness, which
adds Chromium automation switches that can change throttling and other
behaviour. This qualifies the Chrome comparisons as directional, especially
the background workloads. The paired Dexerion control and candidate use
the same harness and remain the more useful comparison for code changes.
Retest against both binaries with minimal launch flags before making
claims about normal-use cross-browser savings.
