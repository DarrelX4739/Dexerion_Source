# What "ported to C++" must mean

The `cpp-native-spike` branch starts at the exact `darrel-dev-1` snapshot
`64da61e4fbe16b6d7f3fe58752a90517569d45bf`. The app still ships from its
existing Electron tree. The experiment owns an alternate source directory
and a branch-only validation workflow, not a release or installer.

| Area | Original behavior to preserve | Experiment gate |
|---|---|---|
| Browser chrome | Address, keyboard shortcuts, tabs/groups, bookmarks, downloads, history, fullscreen, multiple windows | Native host prototype initially covers one page and basic navigation. Verify actual shortcuts/lifecycle, then test all original flows before activation. |
| Profiles and permissions | Account-specific separate state, durable session restore, website permissions, login and storage isolation | Test with two synthetic accounts and restart/reopen. Reject copying a real Electron/Chromium profile into the spike. Port formats with migration/rollback tests, not a bulk rewrite. |
| Memory Saver and Adaptive Power | Same decisions on protected/active tabs, shared process accounting, GPU demand/hysteresis | C++ kernels are pure, not activated. Compare JavaScript parity on deterministic inputs and selected live app decisions. No policy default changes. |
| Focus Timer | Work/break, pause/resume, timing, notifications and browser blocking | Native state machine compares observed timer decisions. OS timers, audio, settings and network enforcement remain original. |
| AI and previews | Provider connections, prompt/approval flows, sandboxed interactive/offline sites, report export, attachments | No CEF migration yet. Reuse existing fixture/mock test routes and preserve the original trust boundaries before adding any privileged bridge. |
| Extensions | Existing permission controls, extension context/profile, imports, icons and popups | Validate available CEF extension APIs with real mock extensions before promising compatibility. Current single-window CEF host does not port this feature. |
| Platforms/updates | Windows and Linux packaging, accessibility, patch cadence | Don't ship prototype artifacts. Keep engine version and integration reproducible; run all gates on both platforms. |

## Performance acceptance

Compare only observable equivalents on the same host: pinned original and
candidate, identical test pages and workload, showed foreground state,
same graphics/display conditions, measured fresh and already-primed
disposable profiles, balanced order and repeat samples. Report whole-browser
CPU and process-tree memory under exact conditions. Give private resident
and shared-inclusive Windows figures separate labels. Never infer power
or actual user sessions from hosted runner process snapshots.

The single-page prototype footprint diagnostic only measures the present
architecture. Its feature/UI surfaces and engine revision can differ from
the Electron browser; do not treat smaller totals as a migration approval.
Security boundaries, accessibility and original feature checks are hard
gates, not knobs to meet the percentage goal.
