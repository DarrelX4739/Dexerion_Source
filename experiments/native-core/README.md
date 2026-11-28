# Dexerion C++ policy experiment

This is an offline, opt-in prototype. It is **not linked into the Electron browser** or included in its builds. It does not create a browser process, change user profiles, load websites, or enable a new product feature. Keep launching Dexerion as usual.

## What is ported

`dex_memory_saver` takes a normalized tab snapshot and returns the Memory Saver plan, including victim order, projected usage, and warnings. The reference is `code/code/src/main/memsaver.js`; `collectTabSnaps` in the adjacent `browser.js` defines the input. Inputs are typed, finite browser values: window IDs are integers, tab IDs are strings, numeric PID zero denotes an unknown renderer, and the caller must supply the same measured time as the JS policy. The native interface intentionally does not accept arbitrary JavaScript coercions or read the system clock.

Sleeping/rendering actions remain outside the planner. Shared PIDs are grouped only among eligible tabs, matching the current policy even if a protected tab shares that process. Predicted memory is therefore an estimate, not guaranteed freed memory.

## Build and verify

Requires a C++17 compiler; tests additionally use Node and the existing JS source. No npm dependencies or Chromium SDK are needed. From the repo root, on Linux or Windows with the appropriate CMake generator:

```sh
cmake -S experiments/native-core -B build/native-core -DCMAKE_BUILD_TYPE=Release
cmake --build build/native-core --config Release
ctest --test-dir build/native-core -C Release --output-on-failure
```

On Linux without CMake:

```sh
c++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iexperiments/native-core/include experiments/native-core/src/memory_saver.cpp experiments/native-core/tests/memory_saver_unit.cpp -o /tmp/dex-ms-unit
/tmp/dex-ms-unit
c++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iexperiments/native-core/include experiments/native-core/src/memory_saver.cpp experiments/native-core/tests/memory_saver_replay.cpp -o /tmp/dex-ms-replay
node experiments/native-core/tests/memory_saver_parity.cjs /tmp/dex-ms-replay
```

Differential coverage includes explicit contract cases for all protected tab states; exact cap, idle, and warning boundaries; process groups across windows; PID-less fallback; zero-cost tabs; and stable ordering. A fixed seed generates 2,048 additional input sets. Native unit tests run independently of JS. The line-oriented replay executable is a bounded-count synthetic test adapter, not a browser interface or a service.

## Interpretation

Passing means these decisions matched for these inputs, not that the entire browser was ported. The Electron app does not call this library. No end-to-end memory, CPU, GPU or power saving is claimed. A browser integration must separately preserve process boundaries, revalidate tab identity and protection when applying a stale snapshot, and run the product and same-workload performance suites before any default changes.

## Second kernel: Adaptive Power

`dex_adaptive_power` ports the native decision surface of `code/code/src/main/adaptive-power.js`: normalized mode/migration, startup GPU settings, demand scoring, tiers, downgrade hysteresis, render/metrics policy, and deep-idle sweep cadence. It produces plain data only. The existing Node main process still owns all real GPU, lifecycle and timing operations. Inputs are normalized finite measurements; a missing tier timestamp is explicit rather than a JavaScript coercion.

The same CMake build/CTest commands above include its independent unit and JS differential tests. To build and exercise it separately without CMake:

```sh
c++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iexperiments/native-core/include experiments/native-core/src/adaptive_power.cpp experiments/native-core/tests/adaptive_power_unit.cpp -o /tmp/dex-ap-unit
/tmp/dex-ap-unit
c++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Iexperiments/native-core/include experiments/native-core/src/adaptive_power.cpp experiments/native-core/tests/adaptive_power_replay.cpp -o /tmp/dex-ap-replay
node experiments/native-core/tests/adaptive_power_parity.cjs /tmp/dex-ap-replay --bench
```

`--bench` is optional and never a pass/fail timing gate. It first checks exact policy outputs. Then it repeatedly evaluates the *runtime plan only* on the same synthetic inputs using the shipped JS and a release C++ binary; it excludes parsing, process startup, IPC, applying plans and all browser/rendering work. Seven rounds alternate execution order; both sides consume output and assert matching checksums. This stress test measures computational throughput, **not** actual scheduling frequency or a browser performance gain. Avoid extrapolating it to renderer memory, GPU load, battery life, or the Edge target.

## Third kernel: Focus Timer

`dex_focus_timer` ports the work/break clock state machine from `code/code/src/main/pomodoro.js`. It covers start, pause, resume, skip, reset, duration changes, tick/expiry, rounded display, and the fact that a paused work phase still blocks. The caller injects time and receives data describing a notification, state update and timer operation; it never starts timers, posts notifications or enforces permissions itself. On expiration the next phase is **not** automatically started. The unexpected but existing initial display with non-default saved settings is also preserved.

The differential test loads the existing JS engine with synthetic clock, profile, interval and notification adapters. It compares every public clock state and observable effect across 129 deterministic command traces. Test adapters check that active intervals stay single, get replaced correctly and use the original 500 ms cadence. Both host clock rollback and late ticks/pause are covered.

The original browser still owns the profile, sound/volume, audio playback, domain normalization, blocklist edits, network enforcement, UI, persistence and actual scheduling/notifications. The native blocking bit is only phase state; it is never used as a replacement for the browser's URL guard. The independent `shouldSleepTab` helper in the reference file is not part of this timer port. The portable CMake targets are `dex_ft_unit` and `dex_ft_replay`; to run the differential manually, pass the latter executable to `tests/focus_timer_parity.cjs`.

## Opt-in live shadow check (requires a desktop)

After installing the repository's locked dependencies in `code/build` and compiling a release `dex_ap_replay`, run, from the repository root:

```sh
xvfb-run -a node experiments/native-core/tests/electron_power_shadow.cjs build/native-core/dex_ap_replay
```

On Windows, use `node experiments/native-core/tests/electron_power_shadow.cjs build/native-core/Release/dex_ap_replay.exe`. An available Linux window manager permits additional minimized-state coverage. This test is **not** part of the ordinary CTest suite. The default suite tests its observer protections and verifies that a deliberately wrong native comparison fails, not that a GUI was launched.

The child is the unchanged source Electron application launched by its existing Playwright throwaway-profile harness with Adaptive GPU. A test-only observation hook in the trusted main process captures only normalized numeric/Boolean power measurements, tiers and the pure JS function's returned plan while real window operations run. It verifies the exact newly generated test profile, refuses packaged or non-test applications, and never records URLs or user content. Each observed real call returns the original JS result to the browser; the external C++ executable only receives and replays the trace **after the hook is removed**. Zero observed plans is a failure. A passing log reports exact matched decisions and observed tiers; it is a host-data contract check, not an end-to-end performance benchmark. The throwaway profile is deleted when the browser closes.
