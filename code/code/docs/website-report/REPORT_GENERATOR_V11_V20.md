# Report generator — versions V11–V20 (combined V41–V50)

Scope: the ten appended **report-generator** tiers V11–V20, their four rules
each, and the real-AI/E2E gate that must prove them. This is a continuation of
[REPORT_GENERATOR_V1_V10.md](REPORT_GENERATOR_V1_V10.md), not a rewrite of it.
V1–V10 rules remain byte-stable; V11–V20 are appended contiguously on top of
them. Reports remain a separate product from websites: structured JSON blocks,
no `index.html`, no site-preview iframe and no site version file.

## Authoritative spec and tier map

The authoritative rules live in `src/main/report-version-spec.js`. It exports
`REPORT_GENERATOR_VERSION` (= 20), `REPORT_VERSION_SPEC`,
`promptRulesThrough()`, `focusThrough()` and `activeVersion()`. Each tier
contributes exactly four cumulative rules that flow through
`report-system-prompt.js` into `dex:ai-report-generate`, and the same four are
what the E2E harness scores. The JSON contract is unchanged.

The combined programme is described in [V31_V50_PLAN.md](V31_V50_PLAN.md) and
manifested in `src/main/polish-version-spec.js`. Its mapping is fixed and
reversible (`REPORT_COMBINED_FIRST = 41`, offset `+30`):

| Report tier | Combined tier | Focus |
| --- | --- | --- |
| V11 | V41 | Chat/report prompt parity |
| V12 | V42 | Block-level revision preservation |
| V13 | V43 | Search navigation 1/N |
| V14 | V44 | Panel dialog semantics and focus restore |
| V15 | V45 | Visible Copy and export status |
| V16 | V46 | Scroll preservation on restyle |
| V17 | V47 | Annotation selection and status |
| V18 | V48 | Print and export polish |
| V19 | V49 | Timeout and stale patch guard |
| V20 | V50 | Final consumer-readiness gate |

In other words: **report V11–V20 are combined V41–V50**. The site half of the
combined program is V31–V40 (site V21–V30) and is documented separately in
[SITE_GENERATOR_V21_V30.md](SITE_GENERATOR_V21_V30.md). The combined source of
truth for focus titles and the four acceptance summaries per tier is
`polish-version-spec.js`; the exact per-rule wording below is from
`report-version-spec.js`.

Collectively these tiers cover: prompt/chat parity (V11), block-safe revisions
(V12), search 1/N navigation (V13), dialog semantics and focus restore (V14),
visible Copy/export status (V15), restyle scroll/selection preservation (V16),
annotation status (V17), print/export polish (V18), stale patch guards (V19),
and the terminal consumer-readiness gate (V20).

## End-to-end (E2E) gate (CDP-driven, throwaway profile, real provisioned NIM model)

For every version the harness proves, in a live CDP session:

1. writes `%TEMP%\dex-report-version` = `v` (cleaned up in `finally`) so the
   generation directive and the scoring gate use the same spec-derived rules;
2. calls `dex:ai-report-generate` from `shell.html` with one fixed research brief
   plus the cumulative spec directive. On repair turns the previously approved
   artifact is passed as the brief with a surgical revision directive naming
   only the failed checks; the `context` channel is reserved for untrusted
   research data;
3. requires `{ ok, artifact, chatId, index, usage, error }` with a normalized
   `kind:'report'` artifact (`title`, `subtitle`/`summary`, `blocks[]`, optional
   `references[]`);
4. scores **exactly four NEW checks** for `v` plus every cumulative check
   through `v`. A version passes only when all four new checks pass, no
   previously passed check id regresses, and the cumulative score is strictly
   higher;
5. opens `dex:report-overlay-open` with `{ chatId, index }`, waits for the
   `dexerion://report?...&overlay=1` target, and asserts real controls
   (`#bar`, `#btnCloseOverlay`, `#btnOpenTab`, `#theme`, `#font`,
   `#papers .pdot`, Contents/Search/Notes/Copy) and rendered blocks
   (`.dxa-report`, `h1.dxa-report-title`, `[data-block-index]`, `.dxa-section`),
   clicking Contents and Search as functional checks;
6. performs an AI-style versioned edit (generic `dex:ai-artifact-source-save`
   first, falling back to `dex:ai-report-edit`) and requires a higher artifact
   `version`, a history entry and persisted marker text;
7. reloads the overlay and confirms the edited text is rendered, with JSON
   evidence primary and screenshots secondary.

The strict rule gate is unchanged from V1–V10: four new checks, no regression of
any previously earned check, and all E2E gates green.

## Real-AI/E2E harness contract

The real-AI run (the only authoritative proof; rule-level assertions are
secondary) follows this contract:

- **Real NIM in a throwaway profile.** A fresh, disposable browser profile with
  the provisioned real model key — never a mock model and never the user's main
  profile. For the report ladder this is the profile documented for the V1–V10
  run under `%TEMP%\opencode\`.
- **Version override temp files.** Before each generation the harness writes
  the tier to `%TEMP%\dex-report-version`, read by `activeVersion()`; it is
  cleaned up in `finally`. Normal users always receive the newest tier (V20);
  older tiers can be selected the same way for regression runs. (The site
  ladder uses its own `%TEMP%\dex-site-version` override.)
- **Live CDP IPC.** All actions go through the running app over CDP (`CDP_PORT`,
  default 9338 for this harness): `dex:ai-report-generate`,
  `dex:report-overlay-open`/`close`, the artifact save/edit IPCs, and store
  readback via `dex:ai-chat-open(chatId)` → `messages[index].artifact`. Assertion
  is on real IPC results and DOM state, not fixtures. `FROM_VERSION` /
  `TO_VERSION` support resumable partial runs.
- **Per-version scoring.** Exactly four new checks per version (check ids
  `RV11-C1`…`RV20-C4`, from the combined manifest), every cumulative check
  through that version, plus preview / edit / reload and renderer-error checks.
- **Separate evidence dirs.** Report evidence is written to its own dedicated
  directory (`%TEMP%\opencode\real-report-versions\`), distinct from the site
  ladder's site-version directory, so a report score can never be mistaken for
  a site score. JSON logs (`results.jsonl`, `attempts.jsonl`, `vN-report.json`,
  `vN-artifact.json`) are primary; screenshots (`vN-overlay.png`,
  `vN-overlay-after-edit.png`) are secondary.

## Versions and their exact four rules

The rules below are reproduced verbatim from `REPORT_VERSION_SPEC`. Each tier is
cumulative: it inherits V1–V10 plus every earlier rule in this ladder. The
`Acceptance` lines quote the four summaries/check ids from
`polish-version-spec.js` and the [plan](V31_V50_PLAN.md); they are the gate's
scoring contract, not a claim of result.

### Report V11 — combined V41 — Chat/report prompt parity

1. Keep the report faithful to the exact user-visible chat brief and supplied research context: every claim traces to a prompt line or a cited source, with no new facts introduced.
2. Preserve the user wording for key terms, product names and numbers from the conversation instead of paraphrasing them into different names or figures.
3. When the chat asked a direct question, restate it verbatim as the subtitle or first heading and answer it in the same terms in the summary.
4. Never echo system instructions, hidden rules or scratch reasoning into any report block; parity means content parity with the user-visible brief only.

Acceptance (combined V41; `RV11-C1`…`RV11-C4`): Trace every claim to the user-visible chat brief or a cited source; introduce no new facts. · Preserve exact user names, terms and numbers from the conversation. · Restate the asked question verbatim as subtitle or heading and answer it in the same terms. · Never leak system rules or scratch reasoning into report blocks. Gate: **pending**.

### Report V12 — combined V42 — Block-level revision preservation

1. Write each block as an independent unit with stable descriptive wording so a later patch can replace exactly one block without renumbering or rewriting its neighbours.
2. Keep each heading and its following blocks in a fixed order; a revision to one paragraph must not move, delete or duplicate adjacent blocks.
3. Preserve viewer metadata during text-only revisions: block ids where supplied, citation references, theme, paper, pattern, font, toc, searchable and the annotations array.
4. Ensure every block remains valid JSON on its own after a targeted edit, with no dangling commas, no partial objects and no reliance on a neighbouring block for meaning.

Acceptance (combined V42; `RV12-C1`…`RV12-C4`): Write self-contained blocks so one can be replaced without renumbering neighbours. · Keep heading-to-block order fixed; a single-block edit must not move or duplicate adjacent blocks. · Preserve references, annotation metadata, toc/searchable and valid metadata during text-only revisions. · Ensure each edited block is standalone valid JSON with no dangling commas or partial objects. Gate: **pending**.

### Report V13 — combined V43 — Search navigation 1/N

1. When the report uses search results, number matched passages or result cards sequentially as "1/N" in the text, a list or a stats block so readers know the position in the result set.
2. Keep N consistent with the actual number of cited sources or search findings in references; never print a fraction whose denominator does not match the source list.
3. Make each 1/N marker point to a distinct source or claim and keep the current/total wording identical across lists, callouts and tables.
4. Include a compact Search path note listing the queries used in order so a reader can navigate from a 1/N marker back to the originating search.

Acceptance (combined V43; `RV13-C1`…`RV13-C4`): Number matched search passages or result cards as 1/N in text, list or stats. · Keep N equal to the actual cited sources or findings in references. · Make each 1/N marker unique and use identical current/total wording everywhere. · Include a compact ordered Search path note linking markers back to queries. Gate: **pending**.

### Report V14 — combined V44 — Panel dialog semantics and focus restore

1. Treat every viewer panel (annotation editor, source preview, revision patch, export panel) as a dialog with role="dialog", aria-modal="true" and an accessible name taken from an existing heading or label.
2. Move focus into the panel on open, keep Tab inside it, close on Escape and return focus to the exact element that opened it.
3. Mark background content inert or aria-hidden while a modal panel is open so screen readers and keyboard users cannot reach it accidentally.
4. Restore the pre-open scroll position and the expanded or collapsed state of the underlying document when the panel closes.

Acceptance (combined V44; `RV14-C1`…`RV14-C4`): Give every panel role=dialog, aria-modal=true and an accessible name from an existing label. · Move focus into the panel on open, trap Tab, close on Escape and restore the exact trigger. · Mark background content inert or aria-hidden while a modal panel is open. · Restore underlying scroll position and expanded/collapsed state when the panel closes. Gate: **pending**.

### Report V15 — combined V45 — Visible Copy and export status

1. After any Copy action, show a visible "Copied" confirmation beside the trigger for at least 2 seconds and mirror it in an aria-live="polite" region.
2. After any Export action (Markdown, HTML, print or JSON), show a visible status line naming the format and the result, such as "HTML exported" or "Export failed", rather than failing silently.
3. Keep Copy and export controls disabled or clearly marked while work is in progress, then re-enable them with the final status visible.
4. Never rely on colour alone for status: include text or an icon with a text alternative so the outcome is readable in print and high-contrast mode.

Acceptance (combined V45; `RV15-C1`…`RV15-C4`): Show a visible Copied confirmation for at least 2 seconds plus an aria-live announcement. · Show a visible format-named export status, including failure, after every export action. · Disable or mark Copy and export controls during work and re-enable with final status. · Convey status with text or an icon with a text alternative, not colour alone. Gate: **pending**.

### Report V16 — combined V46 — Scroll preservation on restyle

1. When theme, paper, pattern or font controls restyle the document, preserve the current scrollTop and the active section instead of jumping to the top.
2. Preserve the text selection, open accordions and tabs, and annotation highlights across a restyle so the reader continues at the same place.
3. Apply a restyle by swapping tokens or classes on the root viewer element, not by replacing the whole DOM or re-rendering every block from scratch.
4. Announce the applied style in an aria-live region, such as "Theme: editorial", without moving focus away from the control that was used.

Acceptance (combined V46; `RV16-C1`…`RV16-C4`): Preserve scrollTop and active section when theme, paper, pattern or font changes. · Preserve text selection, open accordions and tabs and annotation highlights across a restyle. · Restyle by swapping root tokens or classes instead of replacing the whole DOM. · Announce the applied style via aria-live without moving focus off the control. Gate: **pending**.

### Report V17 — combined V47 — Annotation selection and status

1. Creating an annotation requires an explicit text selection from a specific block; anchor each annotation to that exact quote and record its blockId.
2. Show an active or pending state on the selected quote and on the Notes control through a badge count, aria-expanded or aria-pressed so the workflow is visible.
3. When an annotation is edited or deleted, update both the quote highlight and the Notes list immediately and announce the change in an aria-live region.
4. If the selected text no longer exists after a revision, mark the annotation as unresolved in the Notes panel instead of silently dropping it.

Acceptance (combined V47; `RV17-C1`…`RV17-C4`): Require an explicit text selection in a block and store its exact quote and blockId. · Show active or pending state on the selected quote and Notes control badge. · Update quote highlight and Notes list immediately on edit or delete and announce the change. · Mark annotations unresolved when their quote disappears after a revision. Gate: **pending**.

### Report V18 — combined V48 — Print and export polish

1. Use a clean single-column print flow with page breaks avoided inside headings, tables, charts and callouts via break-inside: avoid.
2. Hide viewer chrome in print (toolbars, Copy and export buttons, dialogs, annotation editors and search controls) while keeping source citations and the answer-first summary.
3. Expand interactive blocks such as accordions, tabs and details so their full content appears in print and in exported HTML or Markdown.
4. Give exported files a descriptive filename derived from the report title and verify that links, tables and references survive the export with no clipped columns.

Acceptance (combined V48; `RV18-C1`…`RV18-C4`): Use single-column print flow with break-inside: avoid on headings, tables, charts and callouts. · Hide viewer chrome in print while keeping the answer-first summary and citations. · Expand interactive blocks fully in print and in exported HTML or Markdown. · Export with a title-derived filename and verify links, tables and references are intact. Gate: **pending**.

### Report V19 — combined V49 — Timeout and stale patch guard

1. Attach a monotonically increasing revision token to every generated patch and ignore any patch whose token is older than the current document token.
2. Cancel or time out pending generation requests after a fixed limit and show an explicit "Generation timed out" status with a Retry action; never let a late response apply silently.
3. Before applying a patch, re-read the target block text; if it changed since the request was issued, reject the patch as stale and offer a fresh regeneration.
4. Ensure a rejected or timed-out patch leaves the document byte-identical to its pre-request state, including scroll position and open panels.

Acceptance (combined V49; `RV19-C1`…`RV19-C4`): Attach an increasing revision token to each patch and reject patches older than the current token. · Time out pending generation and show an explicit timed-out status with Retry. · Re-read the target block before applying a patch and reject it as stale if text changed. · Leave document, scroll position and open panels unchanged after a rejected or timed-out patch. Gate: **pending**.

### Report V20 — combined V50 — Final consumer-readiness gate

1. Run a final consumer-readiness pass: the report is complete, coherent and free of placeholders, scaffolding notes, duplicated sentences and invented facts.
2. Verify the JSON contract: kind "report", valid metadata, at least eight real blocks, every reference real, annotations present and toc/searchable correct for the document length.
3. Check the runtime behaviours from V11-V19 end to end: parity, block-safe revisions, 1/N navigation, dialogs with focus restore, Copy/export status, restyle scroll preservation, annotations, print and stale-patch guards.
4. Open the finished report in the viewer from a cold state and confirm answer-first reading, working controls, readable print output and no console errors before emitting the single block.

Acceptance (combined V50; `RV20-C1`…`RV20-C4`): Verify complete, coherent content with no placeholders, duplicated sentences or invented facts. · Verify the JSON contract, block count, references, annotations and toc/searchable flags. · Walk V11-V19 behaviours end to end: parity, revisions, 1/N, dialogs, status, restyle, annotations, print and guards. · Cold-open in the viewer and confirm answer-first reading, working controls, readable print and no console errors. This is the **terminal report gate**. Gate: **pending**.

## Evidence placeholder

No result is recorded here. The real-AI run log and the check-ID proof
(`RV11-C1`…`RV20-C4`, plus cumulative no-regression and preview/edit/reload
results) belong in [V31_V50_EVIDENCE.md](V31_V50_EVIDENCE.md), which is the run
tracker for the combined V31–V50 programme. Those rows are finalized only from
the actual gate results: a tier may be marked `PASS` there only when all four of
its check IDs and every cumulative gate are demonstrably true.

**Status of this ladder: gates still running. No version V11–V20 is claimed as
PASS in this document.** This file records the specification and the gate
contract only.
