# Native Dexerion shell experiment

This is a separate C++/CEF executable for Windows x64 and Linux x86-64.
It does not replace the Electron app or change its installer, profiles,
shortcuts, permission policy or build. The native browser window uses
CEF Views for navigation controls and Chromium for the page. It currently
has one view with an HTTP(S) address field, Go, Back, Forward and Reload.
It is not a feature-complete browser or a migration tool.

Use a dedicated absolute profile directory (a new/empty one or one already
marked for this experiment); never point this app at an Electron, Edge or
Chrome profile. The Linux process must be run as a normal user with working
Chromium sandbox support. Windows uses the CEF SDK's sandbox bootstrap.
Neither executable has an unsandboxed fallback.

The branch-only GitHub Actions workflow fetches the exact upstream CEF SDK,
validates published archive integrity, compiles native Windows/Linux targets
where available, and attempts to prove that Chromium renders a loopback
fixture and exits. Dependency binaries, builds and profiles are not vendored.
See [CEF's sandbox setup](https://chromiumembedded.github.io/cef/sandbox_setup)
and [upstream build requirements](https://github.com/chromiumembedded/cef/blob/master/docs/branches_and_building.md).

Next feature-parity priorities are separate account contexts, safe popup and
permission handling, navigation history and tab/session restoration, extension
compatibility, and a sandboxed bridge for existing research/AI previews. Do
not compare this one-view experiment's memory with an entire Dexerion build
and call the difference a product saving. The page engine and measured
feature workload would first need to match.
