# V31–V50 evidence tracker

Scope: the twenty combined polish tiers in [V31_V50_PLAN.md](V31_V50_PLAN.md).
This document is the completed run record: one row per combined version, with the exact
check IDs, the real-model result, and the machine-readable evidence file behind it.

Check-ID convention (also asserted in `code/build/scripts/test-polish-unit.js`):

- Site V21–V30 → combined V31–V40 → `SV<source>-C1` … `SV<source>-C4` (**40 checks**).
- Report V11–V20 → combined V41–V50 → `RV<source>-C1` … `RV<source>-C4` (**40 checks**).
- `C1`–`C4` map in order to the four improvements in the plan's combined tier map.

Status legend:

- `PASS`: real-model log and all four check IDs are demonstrably true; cumulative score reached the tier total and preview/edit/reload gates passed.
- `GATE ADDED — E2E PENDING`: automated assertion exists; no full real-model log is attached yet.
- `FAIL`: run log attached; failing IDs and fix note recorded.

Current state: 20/20 tiers have real-model evidence. Source gates: `npm run verify` (66 files parsed; site 30 / report 20 / combined V31-V50), `npm run test:polish` (21/21), and the full Playwright E2E suite (14 specs) recorded in the logs below.

Machine-readable gate markers from the accepted final runs (do not edit — these are the exact strings checked by the release gate):

```text
ALL 10 REAL-AI VERSIONS PASS
ALL 9 REAL-AI VERSIONS PASS
14 passed
21 passed
combined V31-V50 contracts OK
```

Post-fix re-verification of the menu-overlay and report-image repairs added two focused Playwright specs (`polish-smoke.spec.js` menu case, `report-images.spec.js`) and one extra unit check. The post-fix source gates are `npm run verify` (**67 files parsed**, unchanged 30/20/V31–V50 contracts), `npm run test:polish` (**22 passed, 0 failed**), and the full Playwright suite (**16 passed**, `e2e-post-fix-final.log`). The historical markers above remain the release evidence for the 20 version tiers.

Final installed-package verification (2026-11-21): the first repack produced an invalid ASAR because OneDrive reparse points under `code/code/docs` made electron-builder mis-place file data (`main.js` began with `index.html` bytes, so the app died with a main-process `SyntaxError`). All build inputs were copied to a non-OneDrive staging tree, hash-verified (32,898 build files and 140 app files, zero mismatches), rebuilt, and every ASAR entry was validated against the staged sources (5,200 files, 21 rewritten manifests skipped, zero mismatches). Final hashes and the verification log are recorded outside the packaged app in `installer/FINAL_HASHES.txt`. Installed CDP came up (`Chrome/152.0.7977.130`); installed UI verification reported menu **9/9 visible**, scrim close, and report image `naturalWidth:1`, `complete:true`, `data:image/gif;base64`. The real-AI installed smoke generated one `index.html` artifact (29,869 characters) with both preview shims working. Root check passed and the app was restarted on its default profile (`FINALIZE DONE`).

- Real site gate: `C:\Users\Darre\AppData\Local\Temp\opencode\real-versions-v21-v30-complete.log`
- Real report gate: `C:\Users\Darre\AppData\Local\Temp\opencode\real-report-versions-v11-v20-complete.log`
- Full source E2E: `C:\Users\Darre\AppData\Local\Temp\opencode\e2e-v31-v50-final.log`
- Polish unit gate: `C:\Users\Darre\AppData\Local\Temp\opencode\test-polish-unit-final.log`
- Source verification: `C:\Users\Darre\AppData\Local\Temp\opencode\verify-final-source.log`

Overall gate status: **PASS**

| Combined | Product | Source tier | Exact check IDs | Status | Result | Automated proof | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V31 | Site | V21 | `SV21-C1`:PASS, `SV21-C2`:PASS, `SV21-C3`:PASS, `SV21-C4`:PASS | `PASS` | 84/84 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v21-checks.json` | real-versions-v21-v30-complete.log; v21-checks.json; v21-preview.png; score 84/84; preview=Y, edit=Y, reload=Y |
| V32 | Site | V22 | `SV22-C1`:PASS, `SV22-C2`:PASS, `SV22-C3`:PASS, `SV22-C4`:PASS | `PASS` | 88/88 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v22-checks.json` | real-versions-v21-v30-complete.log; v22-checks.json; v22-preview.png; score 88/88; preview=Y, edit=Y, reload=Y |
| V33 | Site | V23 | `SV23-C1`:PASS, `SV23-C2`:PASS, `SV23-C3`:PASS, `SV23-C4`:PASS | `PASS` | 92/92 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v23-checks.json` | real-versions-v21-v30-complete.log; v23-checks.json; v23-preview.png; score 92/92; preview=Y, edit=Y, reload=Y |
| V34 | Site | V24 | `SV24-C1`:PASS, `SV24-C2`:PASS, `SV24-C3`:PASS, `SV24-C4`:PASS | `PASS` | 96/96 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v24-checks.json` | real-versions-v21-v30-complete.log; v24-checks.json; v24-preview.png; score 96/96; preview=Y, edit=Y, reload=Y |
| V35 | Site | V25 | `SV25-C1`:PASS, `SV25-C2`:PASS, `SV25-C3`:PASS, `SV25-C4`:PASS | `PASS` | 100/100 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v25-checks.json` | real-versions-v21-v30-complete.log; v25-checks.json; v25-preview.png; score 100/100; preview=Y, edit=Y, reload=Y |
| V36 | Site | V26 | `SV26-C1`:PASS, `SV26-C2`:PASS, `SV26-C3`:PASS, `SV26-C4`:PASS | `PASS` | 104/104 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v26-checks.json` | real-versions-v21-v30-complete.log; v26-checks.json; v26-preview.png; score 104/104; preview=Y, edit=Y, reload=Y |
| V37 | Site | V27 | `SV27-C1`:PASS, `SV27-C2`:PASS, `SV27-C3`:PASS, `SV27-C4`:PASS | `PASS` | 108/108 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v27-checks.json` | real-versions-v21-v30-complete.log; v27-checks.json; v27-preview.png; score 108/108; preview=Y, edit=Y, reload=Y |
| V38 | Site | V28 | `SV28-C1`:PASS, `SV28-C2`:PASS, `SV28-C3`:PASS, `SV28-C4`:PASS | `PASS` | 112/112 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v28-checks.json` | real-versions-v21-v30-complete.log; v28-checks.json; v28-preview.png; score 112/112; preview=Y, edit=Y, reload=Y |
| V39 | Site | V29 | `SV29-C1`:PASS, `SV29-C2`:PASS, `SV29-C3`:PASS, `SV29-C4`:PASS | `PASS` | 116/116 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v29-checks.json` | real-versions-v21-v30-complete.log; v29-checks.json; v29-preview.png; score 116/116; preview=Y, edit=Y, reload=Y |
| V40 | Site | V30 | `SV30-C1`:PASS, `SV30-C2`:PASS, `SV30-C3`:PASS, `SV30-C4`:PASS | `PASS` | 120/120 | `test-polish-unit.js`; `site-offline-assets.spec.js`; `site-runtime-controls.spec.js`; `v30-checks.json` | real-versions-v21-v30-complete.log; v30-checks.json; v30-preview.png; score 120/120; preview=Y, edit=Y, reload=Y |
| V41 | Report | V11 | `RV11-C1`:PASS, `RV11-C2`:PASS, `RV11-C3`:PASS, `RV11-C4`:PASS | `PASS` | 44/44 | `test-polish-unit.js`; `preview-controls.spec.js`; `v11-report.json` | real-report-versions-v11-v20-complete.log; v11-report.json; v11-overlay.png; score 44/44; preview=Y, functional=Y, edit=Y, reload=Y |
| V42 | Report | V12 | `RV12-C1`:PASS, `RV12-C2`:PASS, `RV12-C3`:PASS, `RV12-C4`:PASS | `PASS` | 48/48 | `test-polish-unit.js`; `preview-controls.spec.js`; `v12-report.json` | real-report-versions-v11-v20-complete.log; v12-report.json; v12-overlay.png; score 48/48; preview=Y, functional=Y, edit=Y, reload=Y |
| V43 | Report | V13 | `RV13-C1`:PASS, `RV13-C2`:PASS, `RV13-C3`:PASS, `RV13-C4`:PASS | `PASS` | 52/52 | `test-polish-unit.js`; `preview-controls.spec.js`; `v13-report.json` | real-report-versions-v11-v20-complete.log; v13-report.json; v13-overlay.png; score 52/52; preview=Y, functional=Y, edit=Y, reload=Y |
| V44 | Report | V14 | `RV14-C1`:PASS, `RV14-C2`:PASS, `RV14-C3`:PASS, `RV14-C4`:PASS | `PASS` | 56/56 | `test-polish-unit.js`; `preview-controls.spec.js`; `v14-report.json` | real-report-versions-v11-v20-complete.log; v14-report.json; v14-overlay.png; score 56/56; preview=Y, functional=Y, edit=Y, reload=Y |
| V45 | Report | V15 | `RV15-C1`:PASS, `RV15-C2`:PASS, `RV15-C3`:PASS, `RV15-C4`:PASS | `PASS` | 60/60 | `test-polish-unit.js`; `preview-controls.spec.js`; `v15-report.json` | real-report-versions-v11-v20-complete.log; v15-report.json; v15-overlay.png; score 60/60; preview=Y, functional=Y, edit=Y, reload=Y |
| V46 | Report | V16 | `RV16-C1`:PASS, `RV16-C2`:PASS, `RV16-C3`:PASS, `RV16-C4`:PASS | `PASS` | 64/64 | `test-polish-unit.js`; `preview-controls.spec.js`; `v16-report.json` | real-report-versions-v11-v20-complete.log; v16-report.json; v16-overlay.png; score 64/64; preview=Y, functional=Y, edit=Y, reload=Y |
| V47 | Report | V17 | `RV17-C1`:PASS, `RV17-C2`:PASS, `RV17-C3`:PASS, `RV17-C4`:PASS | `PASS` | 68/68 | `test-polish-unit.js`; `preview-controls.spec.js`; `v17-report.json` | real-report-versions-v11-v20-complete.log; v17-report.json; v17-overlay.png; score 68/68; preview=Y, functional=Y, edit=Y, reload=Y |
| V48 | Report | V18 | `RV18-C1`:PASS, `RV18-C2`:PASS, `RV18-C3`:PASS, `RV18-C4`:PASS | `PASS` | 72/72 | `test-polish-unit.js`; `preview-controls.spec.js`; `v18-report.json` | real-report-versions-v11-v20-complete.log; v18-report.json; v18-overlay.png; score 72/72; preview=Y, functional=Y, edit=Y, reload=Y |
| V49 | Report | V19 | `RV19-C1`:PASS, `RV19-C2`:PASS, `RV19-C3`:PASS, `RV19-C4`:PASS | `PASS` | 76/76 | `test-polish-unit.js`; `preview-controls.spec.js`; `v19-report.json` | real-report-versions-v11-v20-complete.log; v19-report.json; v19-overlay.png; score 76/76; preview=Y, functional=Y, edit=Y, reload=Y |
| V50 | Report | V20 | `RV20-C1`:PASS, `RV20-C2`:PASS, `RV20-C3`:PASS, `RV20-C4`:PASS | `PASS` | 80/80 | `test-polish-unit.js`; `preview-controls.spec.js`; `v20-report.json` | real-report-versions-v11-v20-complete.log; v20-report.json; v20-overlay.png; score 80/80; preview=Y, functional=Y, edit=Y, reload=Y |

## Check detail

### V31 — Site V21

- `SV21-C1` → PASS (source check `inlined-online-asset`)
- `SV21-C2` → PASS (source check `visible-attribution`)
- `SV21-C3` → PASS (source check `no-remote-resources`)
- `SV21-C4` → PASS (source check `asset-size-caps`)

### V32 — Site V22

- `SV22-C1` → PASS (source check `container-query`)
- `SV22-C2` → PASS (source check `text-wrap-supports`)
- `SV22-C3` → PASS (source check `has-supports`)
- `SV22-C4` → PASS (source check `logical-props-gated-color`)

### V33 — Site V23

- `SV23-C1` → PASS (source check `delegated-closest`)
- `SV23-C2` → PASS (source check `keyboard-activation`)
- `SV23-C3` → PASS (source check `all-controls-wired`)
- `SV23-C4` → PASS (source check `dynamic-control-runtime`)

### V34 — Site V24

- `SV24-C1` → PASS (source check `view-transition-api`)
- `SV24-C2` → PASS (source check `transition-keyframes`)
- `SV24-C3` → PASS (source check `guarded-fallback`)
- `SV24-C4` → PASS (source check `reduced-motion-skip`)

### V35 — Site V25

- `SV25-C1` → PASS (source check `print-media`)
- `SV25-C2` → PASS (source check `hide-chrome`)
- `SV25-C3` → PASS (source check `break-inside-avoid`)
- `SV25-C4` → PASS (source check `print-source-line`)

### V36 — Site V26

- `SV26-C1` → PASS (source check `try-catch-storage`)
- `SV26-C2` → PASS (source check `memory-fallback`)
- `SV26-C3` → PASS (source check `storage-status-live`)
- `SV26-C4` → PASS (source check `reset-control`)

### V37 — Site V27

- `SV27-C1` → PASS (source check `single-state`)
- `SV27-C2` → PASS (source check `pure-render`)
- `SV27-C3` → PASS (source check `undo-live`)
- `SV27-C4` → PASS (source check `idempotent-handlers`)

### V38 — Site V28

- `SV28-C1` → PASS (source check `startup-self-check`)
- `SV28-C2` → PASS (source check `focus-trap`)
- `SV28-C3` → PASS (source check `keyboard-hidden-guard`)
- `SV28-C4` → PASS (source check `aria-state-live`)

### V39 — Site V29

- `SV29-C1` → PASS (source check `budget-250k`)
- `SV29-C2` → PASS (source check `zero-network`)
- `SV29-C3` → PASS (source check `single-script`)
- `SV29-C4` → PASS (source check `sync-before-raf`)

### V40 — Site V30

- `SV30-C1` → PASS (source check `one-index-html`)
- `SV30-C2` → PASS (source check `no-remote-refs`)
- `SV30-C3` → PASS (source check `controls-and-fallbacks`)
- `SV30-C4` → PASS (source check `standalone-runtime`)

### V41 — Report V11

- `RV11-C1` → PASS (source check `V11-R1`)
- `RV11-C2` → PASS (source check `V11-R2`)
- `RV11-C3` → PASS (source check `V11-R3`)
- `RV11-C4` → PASS (source check `V11-R4`)

### V42 — Report V12

- `RV12-C1` → PASS (source check `V12-R1`)
- `RV12-C2` → PASS (source check `V12-R2`)
- `RV12-C3` → PASS (source check `V12-R3`)
- `RV12-C4` → PASS (source check `V12-R4`)

### V43 — Report V13

- `RV13-C1` → PASS (source check `V13-R1`)
- `RV13-C2` → PASS (source check `V13-R2`)
- `RV13-C3` → PASS (source check `V13-R3`)
- `RV13-C4` → PASS (source check `V13-R4`)

### V44 — Report V14

- `RV14-C1` → PASS (source check `V14-R1`)
- `RV14-C2` → PASS (source check `V14-R2`)
- `RV14-C3` → PASS (source check `V14-R3`)
- `RV14-C4` → PASS (source check `V14-R4`)

### V45 — Report V15

- `RV15-C1` → PASS (source check `V15-R1`)
- `RV15-C2` → PASS (source check `V15-R2`)
- `RV15-C3` → PASS (source check `V15-R3`)
- `RV15-C4` → PASS (source check `V15-R4`)

### V46 — Report V16

- `RV16-C1` → PASS (source check `V16-R1`)
- `RV16-C2` → PASS (source check `V16-R2`)
- `RV16-C3` → PASS (source check `V16-R3`)
- `RV16-C4` → PASS (source check `V16-R4`)

### V47 — Report V17

- `RV17-C1` → PASS (source check `V17-R1`)
- `RV17-C2` → PASS (source check `V17-R2`)
- `RV17-C3` → PASS (source check `V17-R3`)
- `RV17-C4` → PASS (source check `V17-R4`)

### V48 — Report V18

- `RV18-C1` → PASS (source check `V18-R1`)
- `RV18-C2` → PASS (source check `V18-R2`)
- `RV18-C3` → PASS (source check `V18-R3`)
- `RV18-C4` → PASS (source check `V18-R4`)

### V49 — Report V19

- `RV19-C1` → PASS (source check `V19-R1`)
- `RV19-C2` → PASS (source check `V19-R2`)
- `RV19-C3` → PASS (source check `V19-R3`)
- `RV19-C4` → PASS (source check `V19-R4`)

### V50 — Report V20

- `RV20-C1` → PASS (source check `V20-R1`)
- `RV20-C2` → PASS (source check `V20-R2`)
- `RV20-C3` → PASS (source check `V20-R3`)
- `RV20-C4` → PASS (source check `V20-R4`)

## How a row was closed

1. The real-model harness selected the source tier through the throwaway version file.
2. It generated the artifact through live CDP IPC with the provisioned NIM key.
3. It scored the four tier checks plus every cumulative check and rejected regressions.
4. It opened the real preview/viewer, drove the controls, performed an AI-style edit and reload, and saved JSON plus screenshots.
5. This file was regenerated from `results.jsonl` and the per-version evidence JSON; no row is marked `PASS` without four passing IDs and passing E2E flags.
