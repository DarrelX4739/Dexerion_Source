# Scope of the matched footprint diagnostic

This is an opt-in comparison of the **current full Electron app** and the **partial CEF window**, not two feature-equivalent browsers. It does not launch Edge, sample CPU/GPU/power, or test a 20% reduction target.

Prerequisites: running desktop Windows or Linux/X11, a sandbox-enabled CEF probe built with this branch's instructions, and the source Electron binary installed by the repo's locked dependencies in `code/build`. Install `psutil==7.2.2` for test-only sampling and `python-xlib==0.33` on Linux for a targeted graceful window-close *after* sampling. From the repo root on Linux, for example:

```sh
python -m pip install --only-binary=:all: psutil==7.2.2 python-xlib==0.33
npm ci --prefix code/build
ELECTRON="$(cd code/build && node -p "require('electron')")"
xvfb-run -a python experiments/cef-shell/compare_footprint.py --cef /absolute/path/to/dexerion_cef_probe --electron "$ELECTRON" --output footprint.json
```

On Windows use the Python command directly with the absolute paths to both executables, without `xvfb-run`. To run the non-GUI diagnostic contract controls: `python experiments/cef-shell/test_compare_footprint.py`.

Both arms render identical static HTML, not a blank window: a 640×360 content box and validated text, a single held loopback connection, and two visible-frame proofs before/after measurement. The runner checks viewport, scale, DOM and UA-reported Chromium (which may be reduced by UA policy); only one navigation and a single pair of valid proofs are accepted. Electron restores one synthetic URL with the welcome overlay disabled; after sampling, the runner closes only its owned window and verifies that **Electron itself wrote** a single-window, single-tab session with the exact loaded URL and title. CEF has one BrowserView by construction. Actual desktop viewport sizes can differ; the observed sizes are reported rather than silently treated as matched.

Arms run sequentially Electron, CEF, CEF, Electron, with a fresh temporary profile each time. By default each run settles three seconds after proof and collects five complete, stable descendant-tree RSS samples. RSS/working set can double-count shared pages. USS is unique resident memory; Linux PSS apportions shared pages. Windows private commit is not resident RAM. Optional metrics are null if inaccessible for **any** sampled member, never a partial sum. Processes outside the launched tree, the OS, and the test driver are not included. The diagnostic reports raw samples and both launches' medians; two launches per arm are exploratory, not statistical proof.
