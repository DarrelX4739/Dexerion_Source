# Report raw tool-call regression fix

## Symptom

The prompt:

> Write me a report on the 3 types of internet copper fibre optic and wireless

sometimes produced three `Run Web search` steps, then:

- no `make_report` consent card,
- a visible `<tool_call><function=make_report>…` fragment, or
- a report card titled `<toolcall> <function=makereport> <parameter=title> …`
  with the leaked XML as its only paragraph.

## Root cause

Nemotron has three non-standard behaviours in this flow:

1. It writes tool calls into `content` as raw XML instead of using native
   `tool_calls`. Two shapes were observed: `<tool_call>` with
   `<parameter=preset>standard…`, and `<toolcall>` with the finished report
   itself in `title`/`subtitle`/`summary`/`theme`/`blocks` parameters.
2. It can append the raw report call **after** the fenced `dex-skill` block for
   the third search. The old parser only looked at the first fence, so the
   second call was ignored.
3. With no fence found, the artifact auto-wrapper treated the leaked XML as a
   report and built a malformed card from it. The three-search budget then
   returned the findings instead of the requested deliverable.

## Fix

- `ai-skills.js`
  - Parses every skill call in a reply, in source order: native tool calls,
    fenced `dex-skill` blocks, `<tool_call>` and `<toolcall>` XML.
  - Accepts `<parameter=name>value</parameter>` and
    `<parameter name="name">value</parameter>`, truncated closing tags, and
    underscore-free names such as `makereport`.
  - Converts an artifact-shaped `make_report` tool payload directly into a
    normalized report proposal, preserving the model's content.
  - `visibleText()` strips every call block (and partial opening tags), so no
    tool syntax can be painted into the chat.
- `ai-skill-loop.js`
  - Queues multiple proposals from one reply; the third search and the
    following report both get their normal consent step.
  - Validates a supplied report payload through the normal artifact normalizer
    and returns it without an unnecessary second write turn.
  - Keeps the final `make_report`/`make_site` deliverable exempt from the
    three-research-skill budget.
- `ai-artifacts.js`
  - Refuses to auto-wrap raw tool-call text as a report, so a parser miss can
    no longer produce a card titled `<tool_call> …`.
- `browser.js`
  - Passes the artifact normalizer into the skill loop for direct payloads.

## Verification

- Unit/regression checks passed for: queued fence + raw call, direct artifact
  payload, XML stripping, invalid-arg handling, and the three-search budget.
- Focused E2E: `e2e/report-raw-tool.spec.js` — three searches, a raw
  artifact-shaped `make_report` call, valid report, no XML leak.
- Full Playwright gate: **9 passed** in
  `%TEMP%\opencode\e2e-report-rawcall-final-all.log`.
- Real NIM reproduction (forced three searches): 3 `search_web` approvals →
  `make_report` approval → valid 12-block report; no `<tool_call>` in stored
  text. Evidence: `%TEMP%\opencode\repro-report-search-after-final-fix.json`.
- Real NIM exact prompt: valid report with `make_report` approved. Evidence:
  `%TEMP%\opencode\repro-report-exact-after-final-fix.json`.
