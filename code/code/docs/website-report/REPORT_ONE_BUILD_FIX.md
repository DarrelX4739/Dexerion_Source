# Report one-build fix

## Symptom

The conversation sometimes showed `Run “Make a report”` two or three times for
one answer. In other runs the report skill was approved but the answer ended
with prose and no report card.

## Root causes

1. Repeated tool-call events (or repeated raw calls in one model reply) each
   created a new live step row. The row was the visual duplicate; the audit log
   showed the actual build had often run only once.
2. `export_report` carries the same `report` executor tag as `make_report`, so
   the retry logic briefly treated an export as a new report build and injected
   a stray “write the artifact” note into a later message.
3. Nemotron can answer the arming turn with prose (the JSON stays in reasoning),
   or emit no tool call at all for an obvious report request.

## Fix

- `ai-skill-loop.js`
  - A successful `make_report`/`make_site` is recorded in
    `successfulCreations`; repeated proposals in the same message are skipped.
  - Deliverables are identified by skill id, not by the broad `report`
    executor tag, so `export_report` is unaffected.
  - If an armed report never produces a dex-artifact, the loop makes one
    bounded write retry with an explicit instruction to output the block. The
    retry does not emit another skill run or consent card.
  - A new `report-intent.js` fallback injects `make_report` when an explicit
    report request produces no proposal at all. Website intent still wins, and
    report follow-ups on an existing artifact remain revisions.
- `browser.js`
  - Emits only one `skill-run` row for `make_report`/`make_site` per answer.
    Retries update that same row instead of adding another.
  - The report executor tells the model not to propose `make_report` again;
    writing the artifact completes the one run.
  - Report fallback keeps the normal one-time consent card.
- `ai-sidebar.js`
  - Deliverable step rows are upserted by skill id. Research skills still get
    one row per call (three searches = three rows).

## Verification

- `e2e/report-raw-tool.spec.js`: duplicate raw calls after three searches →
  one report step row, one audit row, valid report, no XML leak.
- `e2e/report-write-retry.spec.js`: prose-only write turn → one bounded retry
  inside the same run; empty model turn → deterministic report fallback. Both
  keep one step row and one consent.
- Full Playwright gate: **11 passed** in
  `%TEMP%\\opencode\\e2e-report-one-build-final-all.log`.
- Real NIM exact prompt: one `make_report` ask/run, 20-block report. Evidence:
  `%TEMP%\\opencode\\repro-report-final-exact.json`.
- Real NIM forced three searches: 3 `search_web` + one `make_report`, 12-block
  report, no raw tool syntax. Evidence:
  `%TEMP%\\opencode\\repro-report-clean-one-build.json`.
  (Earlier evidence showed doubled event counts only because the repro harness
  accumulated a second IPC listener across runs.)

## Shipped build

- Installer rebuilt after all source and documentation edits, then copied to
  `installer/Main_Exe_Dexerion.exe`.
- Silent install into `C:\Users\Darre\AppData\Local\Programs\Dexerion`; the
  installed `resources/app.asar` SHA-256 was verified against the fresh build.
- Installed-app real-AI smoke passed: valid site with one `index.html`,
  preview frame loaded, storage/clipboard shims present.
- Dev-only `node_modules` junction and `opencode/` removed; distributable root
  contains only `assets/`, `code/`, `installer/`.
- Installed app relaunched on the normal profile with `--disable-gpu`.
