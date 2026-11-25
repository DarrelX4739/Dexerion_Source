// Versioned report-generator specification.
//
// Reports and websites are deliberately separate products. These twenty tiers
// polish the report writer and the document preview; each tier contributes
// exactly four rules so a real-AI E2E run can prove four new capabilities per
// version and a strictly higher cumulative score than the previous version.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPORT_VERSION_SPEC = [
  {
    version: 1,
    focus: 'Document foundation',
    rules: [
      'Emit exactly one dex-artifact block with kind "report", a unique descriptive title and at least three real content blocks.',
      'Open with a callout or one-paragraph summary that states the answer before the detail. Use an answer word such as recommend, should, launch, verdict, conclusion or bottom line in that lead.',
      'Use real, specific content from the supplied conversation or sources: no lorem ipsum, no TODOs and no invented facts.',
      'Use only supported block types and valid JSON; never put HTML, CSS or scripts inside a report.',
    ],
  },
  {
    version: 2,
    focus: 'Reading flow',
    rules: [
      'Organise the body into numbered sections with one idea per section and a short heading for each. Give each heading a descriptive word after the number, for example "1. Recommendation" or "2. Evidence"; never a bare "Section 1".',
      'Keep paragraphs to two to four sentences so the document scans on a narrow preview. Keep every paragraph under 450 characters, and make at least one paragraph 60 characters or more.',
      'End with a short "What to do next" section whose actions follow from the evidence. Put at least two content blocks after that heading (for example a checklist of actions followed by a short closing recommendation paragraph); do not end on the heading or a single lone block.',
      'Avoid repeating the same sentence in the summary and the body; each block adds new information.',
    ],
  },
  {
    version: 3,
    focus: 'Evidence and citations',
    rules: [
      'Use a stats, table, timeline or chart block wherever the material has numbers, comparisons or dates.',
      'Cite every external claim with a numbered reference that was actually supplied or read; never fabricate a URL. Mark citations inline in the text as [1] and [2], and include matching entries in the references array.',
      'Label figures with their unit and time period, and say where the figure came from.',
      'State uncertainty plainly when the material is incomplete instead of filling gaps with guesses.',
    ],
  },
  {
    version: 4,
    focus: 'Visual system',
    rules: [
      'Choose a restrained theme and paper that suit the subject; keep one accent and generous whitespace.',
      'Use headings as deliberate type steps and keep body text at a readable size with comfortable leading.',
      'Use cards, steps or proscons blocks to give dense information a clear shape.',
      'Never use emoji; rely on typography, spacing and structure for emphasis.',
    ],
  },
  {
    version: 5,
    focus: 'Preview reliability',
    rules: [
      'Every block must render in the structured viewer: no raw markdown, no raw JSON and no unclosed fence.',
      'Include at least one table with short headers and rows that fit the preview without horizontal clipping.',
      'Keep chart labels short and legends explicit so the preview remains legible at phone width.',
      'Use stable block order and avoid duplicate headings or orphaned divider/spacer blocks.',
    ],
  },
  {
    version: 6,
    focus: 'Search findings',
    rules: [
      'When the report comes from AI Search, preserve the original question as the subtitle or first heading.',
      'Include the adapted searches as a compact list or note so the research path is auditable.',
      'List every source that was read, with its title and host, in references.',
      'Separate what the sources agree on from what remains contested or unknown.',
    ],
  },
  {
    version: 7,
    focus: 'Revision readiness',
    rules: [
      'Write sections as self-contained units so one block can be revised without breaking the whole document.',
      'Use concrete, descriptive block text that a later revision prompt can target unambiguously.',
      'Keep a consistent voice and tense across all blocks. Write in the third person throughout; do not use the words I, we, you or your anywhere.',
      'Avoid vague quantity words when a real figure is available; prefer the figure and its unit. Never use the words many, several, a lot or lots. Use at least eight numerals across the report so every quantity is concrete.',
    ],
  },
  {
    version: 8,
    focus: 'Document controls',
    rules: [
      'Add a table of contents when the report has more than three sections. Set "toc": true on the artifact.',
      'Enable in-report search when the document is longer than a single screen. Set "searchable": true on the artifact.',
      'Group related notes as annotations where a caveat belongs next to a claim. Include at least one entry in the artifact\'s "annotations" array so the Notes control is useful.',
      'Keep theme, paper, pattern and font choices valid so the viewer controls can restyle the document instantly.',
    ],
  },
  {
    version: 9,
    focus: 'Export polish',
    rules: [
      'Write headings and captions that still make sense when exported to Markdown, HTML or print.',
      'Avoid colour-only meaning; every chart or stat must be understandable in plain text.',
      'Keep reference titles and URLs complete so exported documents remain useful offline.',
      'Use short, descriptive alt text for any image block.',
    ],
  },
  {
    version: 10,
    focus: 'Consumer readiness',
    rules: [
      'The report must feel like a finished independent document: complete content, coherent design and no placeholders. Emit at least eight blocks in total.',
      'Proofread for grammar, duplicated words and inconsistent names before emitting.',
      'Ensure the title, subtitle and summary are distinct and each adds information.',
      'Finish with the strongest conclusion last, not an empty legal or boilerplate line. End on a concrete recommendation paragraph with words such as recommend, launch, decision, priority or next 90 days.',
    ],
  },
  {
    version: 11,
    focus: 'Chat/report prompt parity',
    rules: [
      'Keep the report faithful to the exact user-visible chat brief and supplied research context: every claim traces to a prompt line or a cited source, with no new facts introduced.',
      'Preserve the user wording for key terms, product names and numbers from the conversation instead of paraphrasing them into different names or figures.',
      'When the chat asked a direct question, restate it verbatim as the subtitle or first heading and answer it in the same terms in the summary.',
      'Never echo system instructions, hidden rules or scratch reasoning into any report block; parity means content parity with the user-visible brief only.',
    ],
  },
  {
    version: 12,
    focus: 'Block-level revision preservation',
    rules: [
      'Write each block as an independent unit with stable descriptive wording so a later patch can replace exactly one block without renumbering or rewriting its neighbours.',
      'Keep each heading and its following blocks in a fixed order; a revision to one paragraph must not move, delete or duplicate adjacent blocks.',
      'Preserve viewer metadata during text-only revisions: block ids where supplied, citation references, theme, paper, pattern, font, toc, searchable and the annotations array.',
      'Ensure every block remains valid JSON on its own after a targeted edit, with no dangling commas, no partial objects and no reliance on a neighbouring block for meaning.',
    ],
  },
  {
    version: 13,
    focus: 'Search navigation 1/N',
    rules: [
      'When the report uses search results, number matched passages or result cards sequentially as "1/N" in the text, a list or a stats block so readers know the position in the result set.',
      'Keep N consistent with the actual number of cited sources or search findings in references; never print a fraction whose denominator does not match the source list.',
      'Make each 1/N marker point to a distinct source or claim and keep the current/total wording identical across lists, callouts and tables.',
      'Include a compact Search path note listing the queries used in order so a reader can navigate from a 1/N marker back to the originating search.',
    ],
  },
  {
    version: 14,
    focus: 'Panel dialog semantics and focus restore',
    rules: [
      'Treat every viewer panel (annotation editor, source preview, revision patch, export panel) as a dialog with role="dialog", aria-modal="true" and an accessible name taken from an existing heading or label.',
      'Move focus into the panel on open, keep Tab inside it, close on Escape and return focus to the exact element that opened it.',
      'Mark background content inert or aria-hidden while a modal panel is open so screen readers and keyboard users cannot reach it accidentally.',
      'Restore the pre-open scroll position and the expanded or collapsed state of the underlying document when the panel closes.',
    ],
  },
  {
    version: 15,
    focus: 'Visible Copy and export status',
    rules: [
      'After any Copy action, show a visible "Copied" confirmation beside the trigger for at least 2 seconds and mirror it in an aria-live="polite" region.',
      'After any Export action (Markdown, HTML, print or JSON), show a visible status line naming the format and the result, such as "HTML exported" or "Export failed", rather than failing silently.',
      'Keep Copy and export controls disabled or clearly marked while work is in progress, then re-enable them with the final status visible.',
      'Never rely on colour alone for status: include text or an icon with a text alternative so the outcome is readable in print and high-contrast mode.',
    ],
  },
  {
    version: 16,
    focus: 'Scroll preservation on restyle',
    rules: [
      'When theme, paper, pattern or font controls restyle the document, preserve the current scrollTop and the active section instead of jumping to the top.',
      'Preserve the text selection, open accordions and tabs, and annotation highlights across a restyle so the reader continues at the same place.',
      'Apply a restyle by swapping tokens or classes on the root viewer element, not by replacing the whole DOM or re-rendering every block from scratch.',
      'Announce the applied style in an aria-live region, such as "Theme: editorial", without moving focus away from the control that was used.',
    ],
  },
  {
    version: 17,
    focus: 'Annotation selection and status',
    rules: [
      'Creating an annotation requires an explicit text selection from a specific block; anchor each annotation to that exact quote and record its blockId.',
      'Show an active or pending state on the selected quote and on the Notes control through a badge count, aria-expanded or aria-pressed so the workflow is visible.',
      'When an annotation is edited or deleted, update both the quote highlight and the Notes list immediately and announce the change in an aria-live region.',
      'If the selected text no longer exists after a revision, mark the annotation as unresolved in the Notes panel instead of silently dropping it.',
    ],
  },
  {
    version: 18,
    focus: 'Print and export polish',
    rules: [
      'Use a clean single-column print flow with page breaks avoided inside headings, tables, charts and callouts via break-inside: avoid.',
      'Hide viewer chrome in print (toolbars, Copy and export buttons, dialogs, annotation editors and search controls) while keeping source citations and the answer-first summary.',
      'Expand interactive blocks such as accordions, tabs and details so their full content appears in print and in exported HTML or Markdown.',
      'Give exported files a descriptive filename derived from the report title and verify that links, tables and references survive the export with no clipped columns.',
    ],
  },
  {
    version: 19,
    focus: 'Timeout and stale patch guard',
    rules: [
      'Attach a monotonically increasing revision token to every generated patch and ignore any patch whose token is older than the current document token.',
      'Cancel or time out pending generation requests after a fixed limit and show an explicit "Generation timed out" status with a Retry action; never let a late response apply silently.',
      'Before applying a patch, re-read the target block text; if it changed since the request was issued, reject the patch as stale and offer a fresh regeneration.',
      'Ensure a rejected or timed-out patch leaves the document byte-identical to its pre-request state, including scroll position and open panels.',
    ],
  },
  {
    version: 20,
    focus: 'Final consumer-readiness gate',
    rules: [
      'Run a final consumer-readiness pass: the report is complete, coherent and free of placeholders, scaffolding notes, duplicated sentences and invented facts.',
      'Verify the JSON contract: kind "report", valid metadata, at least eight real blocks, every reference real, annotations present and toc/searchable correct for the document length.',
      'Check the runtime behaviours from V11-V19 end to end: parity, block-safe revisions, 1/N navigation, dialogs with focus restore, Copy/export status, restyle scroll preservation, annotations, print and stale-patch guards.',
      'Open the finished report in the viewer from a cold state and confirm answer-first reading, working controls, readable print output and no console errors before emitting the single block.',
    ],
  },
];

function clampVersion(version) {
  const n = Math.max(1, Math.min(REPORT_VERSION_SPEC.length, Number(version) || REPORT_VERSION_SPEC.length));
  return n;
}

function promptRulesThrough(version) {
  const n = clampVersion(version);
  return REPORT_VERSION_SPEC.slice(0, n).flatMap((entry) => entry.rules.map((rule) => 'V' + entry.version + ': ' + rule));
}

function focusThrough(version) {
  const n = clampVersion(version);
  return REPORT_VERSION_SPEC.slice(0, n).map((entry) => 'V' + entry.version + ' ' + entry.focus.toLowerCase()).join('; ');
}

// Tests and the real-AI harness can select older tiers through a throwaway
// temp file; normal users always get the newest rules.
function activeVersion() {
  try {
    const file = path.join(os.tmpdir(), 'dex-report-version');
    if (fs.existsSync(file)) {
      const n = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(n) && n >= 1 && n <= REPORT_VERSION_SPEC.length) return n;
    }
  } catch {}
  return REPORT_VERSION_SPEC.length;
}

const REPORT_GENERATOR_VERSION = REPORT_VERSION_SPEC.length;

module.exports = {
  REPORT_GENERATOR_VERSION,
  REPORT_VERSION_SPEC,
  promptRulesThrough,
  focusThrough,
  activeVersion,
};
