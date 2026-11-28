# Native policy boundary: keep the Electron path in JavaScript

**Decision: no activation.** C++ can win on data it already owns, but moving the existing Electron objects into C++ was slower. No product source, feature, renderer, profile or scheduler was changed. This is not a whole-browser or Edge benchmark.

Debian 13, Linux 6.18.57 x86-64, AMD EPYC 9V74 (cpuset 0–8), GCC 14.2 `-O2`, Electron 44.4.5 running embedded Node 24.21.0 / V8 15.2.124.28, Node-API v8. Baseline JS: `darrel-dev-1` commit `64da61e4fbe16b6d7f3fe58752a90517569d45bf`. All paths took identical synthetic inputs and returned equivalent results; JS plan objects escaped to retained state. “Host” below means a fresh Electron process on the same machine, not distinct hardware. OS signal collection and Chromium rendering were excluded.

## Adaptive Power

Mixed signals, median µs/decision. Five fresh hosts, 16 balanced rounds × 32,768 decisions/arm. Both wall and process-CPU series used five fresh processes in the packaged rerun. [Summary JSON](summary.json) includes every list size.

| Metric | Shipped JS | Direct JS* | C++ / JS objects | C++ / packed buffer** |
|---|---:|---:|---:|---:|
| Wall time | 0.886 | 0.083 | 2.347 | 0.150 |
| Process CPU (user + system) | 0.892 | 0.085 | 2.379 | 0.152 |
| Quiet signals in hot loop, CPU | 0.482 | 0.066 | 2.376 | 0.146 |

\* Local normalized-input JS control without repeated object spread; matched 5,163 differential cases. \** Includes JS packing, native call, unpacking, and rebuilding the public plan.

The packed path’s ~0.74µs hot CPU saving would require **~13,500 calls/second to save 1% of one core**. Normal periodic sweeps run at 60s, up to 600s in deep idle, plus lifecycle events. At 60 periodic calls/hour that projects to only ~44µs CPU/hour. This is not an observed human event rate. The actual hosted Electron shadow saw 8 Linux and 11 Windows decisions over a scripted lifecycle block containing a 250ms wait: roughly ≤32–44 calls/s averaged over that deliberately bursty block. Applying the Linux hot cost even to 44/s projects just ~0.0033% of one core, not a measured browser CPU saving.

Measured **wall latency after waiting**, µs/decision; not CPU consumed over the idle interval. Shared-wake modes call four methods serially with rotating order; only the first experiences a fresh wake. The stronger independent mode times only one method after each actual interval, rotating methods across four staggered processes.

| Real interval / mode | Calls per method | Shipped JS | Object-native | Packed-native | Text pipe |
|---|---:|---:|---:|---:|---:|
| 1s, shared wake | 16 | 8.8 | 37.6 | 8.3 | 343.5 |
| 60s, shared wake | 12 | 9.8 | 471.9 | 23.4 | 1,356.9 |
| 600s, shared wake | 4 | 14.6 | 180.1 | 19.6 | 1,686.5 |
| 60s, independent first call | 12 | 120.2 | 818.9 | 330.1 | 2,251.8 |

The four 600s wakes are descriptive only; their method order is not fully balanced at this sample size. The independent 60s medians favor shipped JS; their wide ranges overlap (see JSON), so they do not establish a stable wake penalty on other machines.

Over a persistent **binary pipe**, five-host medians were 32.68µs/decision singly, 5.19µs at batch 8, 1.26µs at 32, and 0.82µs at 128. These synchronous lifecycle decisions cannot wait for future events without changing behavior. A fresh helper took 3.20ms (24 launches per host). Across five fresh pairs and real quiet minutes, the blocked helpers accumulated zero observed CPU ticks/scheduled runtime; binary/text resident-private memory remained 144/248 KiB (RSS 632/1,836 KiB; PSS 152/378 KiB). No helper was integrated.

## Memory Saver and Tasks

- **Memory Saver:** five hosts, eight balanced rounds, 32 snapshot sets per size. At 32/128/512 over-budget tabs, shipped JS took 2.04/9.77/57.16µs versus 34.82/134.14/559.01µs for normal native-object conversion; original victim-object identity was checked. Even packing did not break even through 512 tabs. A kernel-only timing on already-native snapshots omits this transfer cost. The existing under-cap path already skips reading tab snapshots.
- **Tasks:** twelve balanced rounds per host, eight lists per size. At 100/500/2,000 normalized rows, the five-host cache-miss medians were 19.7/182.0/925.0µs in shipped JS, 66.2/394.4/1,707.2µs through native, or 11.4/102.4/486.3µs with a local direct-JS control avoiding repeat sanitation. A separate five-host pair gave C++ the same shallow-clone shortcut as JS: 56.8/345.3/1,545.8µs native versus 9.9/98.5/483.9µs direct JS. All returned detached rows, as the cache freezes snapshots. Cache hits skip the sort. Even the direct-JS saving at 100 rows (~8.3µs) would need ~1,200 actual cache misses per second for one core percentage point. Common freezing, renderer IPC, and persistence were excluded.
- **Baseline correctness note, not a performance win:** `browser.js:9132–9136` passes arrays of account-task arrays but `tasks.js:170–183` expects a flat list. A synthetic task due in 60s chose the intended 30s heartbeat when flat, versus 300s with the actual nested shape. Neither behavior was changed; flat-kernel parity does not prove app scheduler parity.

## Rerun

The [offline runner](run.py) builds only in a temporary directory. It requires Linux x86-64, Python 3, a C++17 compiler, the spike checkout, its installed Electron binary, and four unmodified Node v24.21.0 source headers (`src/{node_api,node_api_types,js_native_api,js_native_api_types}.h`). The runner checks their SHA-256 hashes.

```sh
# REPORT_DIR contains this file, run.py and bench/. REPO is the spike checkout.
ELECTRON="$(cd "$REPO/code/build" && node -e "console.log = console.error; process.stdout.write(require('electron'))")"
python "$REPORT_DIR/run.py" --repo "$REPO" --electron "$ELECTRON" \
  --node-include "$NODE_24_21_HEADERS" --hosts 5 --out "$PWD/boundary-rerun.json"
```

For real elapsed-time trials, replace `--hosts 5` with `--paced-seconds 60 --samples 12` (12 minutes) or `--paced-seconds 600 --samples 4` (40 minutes). Those samples measure latency at a wake, not CPU usage over the preceding quiet interval. Add `--independent-wakes` to run only one timed invocation per wake across four staggered, balanced hosts. Use `--hosts 5 --idle-helper-seconds 60` for incremental sleeping-helper CPU and memory.
