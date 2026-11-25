# Report generator — 10-version programme

Scope: the **report writer** only — the compact single-turn report system prompt,
the `dex:ai-report-generate` IPC, normalized `kind:'report'` artifacts, the
`dexerion://report` overlay, and the versioned AI-edit/save path. This is a
separate product from `make_site`/website generation: no site-preview iframe,
no `index.html`, and no website version file are involved.

The authoritative rules live in
`src/main/report-version-spec.js`. It exports `REPORT_GENERATOR_VERSION`,
`REPORT_VERSION_SPEC`, `promptRulesThrough()`, `focusThrough()` and
`activeVersion()`. `activeVersion()` reads `%TEMP%\dex-report-version` (throwaway
test override; users get V10). Each tier contributes exactly four rules.

## E2E gate

Harness: `%TEMP%\opencode\run-real-report-versions.mjs` (Node ESM, CDP-based).
It requires the authoritative spec with `createRequire`, so the generation
directive and the scoring gate use the same four rules for every version.

Run against the dev app with a real AI key in
`C:\Users\Darre\AppData\Local\Temp\dex-ai-webgen`, CDP port `9338` by default
(override with `CDP_PORT`). `FROM_VERSION` / `TO_VERSION` support resumable and
partial runs; prior scores/passed check ids are seeded from
`%TEMP%\opencode\real-report-versions\results.jsonl` and `vN-report.json`.

For each version the gate:

1. Writes `%TEMP%\dex-report-version` = `v` (cleaned up in `finally`).
2. Calls `window.dexerion.invoke('dex:ai-report-generate', { reqId, prompt, version, context })`
   from `shell.html` with one fixed research brief plus the spec-derived directive.
   On repair turns the previously approved artifact is placed in the authoritative
   `prompt` brief (with a surgical revision directive naming only the failed
   checks), so the model patches the best passing report instead of regenerating
   it from scratch. The `context` channel is reserved for untrusted research data.
3. Requires `{ ok, artifact, chatId, index, usage, error }` with a normalized
   `kind:'report'` artifact (`title`, `subtitle`/`summary`, `blocks[]`, optional `references[]`).
4. Scores **exactly four NEW checks** for `v` plus every cumulative check through `v`.
   A version passes only when all four new checks pass, no previously passed
   check id regresses, and the cumulative score is strictly higher.
5. Opens `dex:report-overlay-open` with `{ chatId, index }`, waits for the
   `dexerion://report?...&overlay=1` target, and asserts real controls
   (`#bar`, `#btnCloseOverlay`, `#btnOpenTab`, `#theme`, `#font`, `#papers .pdot`,
   Contents/Search/Notes/Copy) and rendered blocks
   (`.dxa-report`, `h1.dxa-report-title`, `[data-block-index]`, `.dxa-section`).
   It also clicks Contents and Search as functional checks.
6. Performs an AI-style versioned edit: tries the generic artifact save IPC
   (`dex:ai-artifact-source-save`) first and falls back to `dex:ai-report-edit`
   with `{ chatId, index, blockIndex, field:'text', value, note }`. It requires a
   higher artifact `version`, a history entry, and persisted marker text.
7. Reloads the overlay and confirms the edited text is rendered. JSON evidence
   (`results.jsonl`, `attempts.jsonl`, `vN-report.json`, `vN-artifact.json`) is
   primary; screenshots (`vN-overlay.png`, `vN-overlay-after-edit.png`) are secondary.

## Versions and their four rules

These are the exact, cumulative rules passed to the writer and used by the gate.

### V1 — Document foundation

1. Emit exactly one dex-artifact block with kind "report", a unique descriptive title and at least three real content blocks.
2. Open with a callout or one-paragraph summary that states the answer before the detail. Use an answer word such as recommend, should, launch, verdict, conclusion or bottom line in that lead.
3. Use real, specific content from the supplied conversation or sources: no lorem ipsum, no TODOs and no invented facts.
4. Use only supported block types and valid JSON; never put HTML, CSS or scripts inside a report.

### V2 — Reading flow

1. Organise the body into numbered sections with one idea per section and a short heading for each. Give each heading a descriptive word after the number, for example "1. Recommendation" or "2. Evidence"; never a bare "Section 1".
2. Keep paragraphs to two to four sentences so the document scans on a narrow preview. Keep every paragraph under 450 characters, and make at least one paragraph 60 characters or more.
3. End with a short "What to do next" section whose actions follow from the evidence. Put at least two content blocks after that heading (for example a checklist of actions followed by a short closing recommendation paragraph); do not end on the heading or a single lone block.
4. Avoid repeating the same sentence in the summary and the body; each block adds new information.

### V3 — Evidence and citations

1. Use a stats, table, timeline or chart block wherever the material has numbers, comparisons or dates.
2. Cite every external claim with a numbered reference that was actually supplied or read; never fabricate a URL. Mark citations inline in the text as [1] and [2], and include matching entries in the references array.
3. Label figures with their unit and time period, and say where the figure came from.
4. State uncertainty plainly when the material is incomplete instead of filling gaps with guesses.

### V4 — Visual system

1. Choose a restrained theme and paper that suit the subject; keep one accent and generous whitespace.
2. Use headings as deliberate type steps and keep body text at a readable size with comfortable leading.
3. Use cards, steps or proscons blocks to give dense information a clear shape.
4. Never use emoji; rely on typography, spacing and structure for emphasis.

### V5 — Preview reliability

1. Every block must render in the structured viewer: no raw markdown, no raw JSON and no unclosed fence.
2. Include at least one table with short headers and rows that fit the preview without horizontal clipping.
3. Keep chart labels short and legends explicit so the preview remains legible at phone width.
4. Use stable block order and avoid duplicate headings or orphaned divider/spacer blocks.

### V6 — Search findings

1. When the report comes from AI Search, preserve the original question as the subtitle or first heading.
2. Include the adapted searches as a compact list or note so the research path is auditable.
3. List every source that was read, with its title and host, in references.
4. Separate what the sources agree on from what remains contested or unknown.

### V7 — Revision readiness

1. Write sections as self-contained units so one block can be revised without breaking the whole document.
2. Use concrete, descriptive block text that a later revision prompt can target unambiguously.
3. Keep a consistent voice and tense across all blocks. Write in the third person throughout; do not use the words I, we, you or your anywhere.
4. Avoid vague quantity words when a real figure is available; prefer the figure and its unit. Never use the words many, several, a lot or lots. Use at least eight numerals across the report so every quantity is concrete.

### V8 — Document controls

1. Add a table of contents when the report has more than three sections. Set "toc": true on the artifact.
2. Enable in-report search when the document is longer than a single screen. Set "searchable": true on the artifact.
3. Group related notes as annotations where a caveat belongs next to a claim. Include at least one entry in the artifact's "annotations" array so the Notes control is useful.
4. Keep theme, paper, pattern and font choices valid so the viewer controls can restyle the document instantly.

### V9 — Export polish

1. Write headings and captions that still make sense when exported to Markdown, HTML or print.
2. Avoid colour-only meaning; every chart or stat must be understandable in plain text.
3. Keep reference titles and URLs complete so exported documents remain useful offline.
4. Use short, descriptive alt text for any image block.

### V10 — Consumer readiness

1. The report must feel like a finished independent document: complete content, coherent design and no placeholders. Emit at least eight blocks in total.
2. Proofread for grammar, duplicated words and inconsistent names before emitting.
3. Ensure the title, subtitle and summary are distinct and each adds information.
4. Finish with the strongest conclusion last, not an empty legal or boilerplate line. End on a concrete recommendation paragraph with words such as recommend, launch, decision, priority or next 90 days.

## Source control names

- Spec: `src/main/report-version-spec.js` — `REPORT_VERSION_SPEC`, `promptRulesThrough`, `focusThrough`, `activeVersion`.
- Version override: `%TEMP%\dex-report-version`.
- Generation IPC: `dex:ai-report-generate` — `{ reqId, prompt, version, context }` → `{ ok, artifact, chatId, index, usage, error }`.
- Overlay IPCs: `dex:report-overlay-open` — `{ chatId, index }`; `dex:report-overlay-close`.
- Edit/save IPCs: `dex:ai-artifact-source-save` (preferred when report-capable), fallback `dex:ai-report-edit` — `{ chatId, index, blockIndex, field, value, note }`.
- Store readback: `dex:ai-chat-open(chatId)` → `messages[index].artifact`.
- Artifact contract: `kind:'report'`, `title`, `subtitle`, `summary`, `blocks[]`, `references[]`, `theme`, `paper`, `pattern`, `font`, `version`, `history[]`.
- Viewer hooks: `dexerion://report?chat=…&i=…&overlay=1`, `.dxa-report`, `.dxa-report-title`, `[data-block-index]`, `.dxa-section`, `#bar`, `#theme`, `#font`, `#papers .pdot`, `#btnToc`, `#btnSearch`, `#btnAnnotations`, `#btnCopy`.

## Results (verified real-AI run)

| Version | Focus | Score | New checks | Preview | Edit | Reload | Evidence |
|---|---|---:|---:|---|---|---|---|
| V1 | Document foundation | 4/4 | 4/4 | ✓ | ✓ | ✓ | v1-report.json |
| V2 | Reading flow | 8/8 | 4/4 | ✓ | ✓ | ✓ | v2-report.json |
| V3 | Evidence and citations | 12/12 | 4/4 | ✓ | ✓ | ✓ | v3-report.json |
| V4 | Visual system | 16/16 | 4/4 | ✓ | ✓ | ✓ | v4-report.json |
| V5 | Preview reliability | 20/20 | 4/4 | ✓ | ✓ | ✓ | v5-report.json |
| V6 | Search findings | 24/24 | 4/4 | ✓ | ✓ | ✓ | v6-report.json |
| V7 | Revision readiness | 28/28 | 4/4 | ✓ | ✓ | ✓ | v7-report.json |
| V8 | Document controls | 32/32 | 4/4 | ✓ | ✓ | ✓ | v8-report.json |
| V9 | Export polish | 36/36 | 4/4 | ✓ | ✓ | ✓ | v9-report.json |
| V10 | Consumer readiness | 40/40 | 4/4 | ✓ | ✓ | ✓ | v10-report.json |


Run record:

- Command: `node %TEMP%\opencode\run-real-report-versions.mjs` (CDP 9338, throwaway profile `dex-ai-webgen`)
- Date (UTC): 2026-11-20T07:13:07.637Z
- Score progression: 4 → 40 (four strict new checks per version, no cumulative regressions).
- Overall result: ALL 10 REPORT VERSIONS PASS — strict real-model improvement, all preview/functional/edit/reload gates green
- Notes: deterministic per-rule gates + CDP overlay control/block assertions + versioned edit and reload readback. Primary JSON evidence lives in `%TEMP%\opencode\real-report-versions\`; screenshots are secondary.
