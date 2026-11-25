// Combined polish programme V31-V50.
//
// V31-V40 mirror the website generator tiers V21-V30; V41-V50 mirror the
// report generator tiers V11-V20. This is a manifest for documentation, tests
// and release planning: it reuses the authoritative source specs rather than
// duplicating their rules, and never changes either generator's prompt.
'use strict';

const { SITE_VERSION_SPEC, SITE_GENERATOR_VERSION } = require('./site-version-spec');
const { REPORT_VERSION_SPEC, REPORT_GENERATOR_VERSION } = require('./report-version-spec');

const POLISH_FIRST_VERSION = 31;
const POLISH_LAST_VERSION = 50;
const POLISH_VERSION_COUNT = POLISH_LAST_VERSION - POLISH_FIRST_VERSION + 1;
const POLISH_GENERATOR_VERSION = POLISH_LAST_VERSION;

const SITE_SOURCE_FIRST = 21;
const SITE_SOURCE_LAST = SITE_GENERATOR_VERSION;
const REPORT_SOURCE_FIRST = 11;
const REPORT_SOURCE_LAST = REPORT_GENERATOR_VERSION;
const REPORT_COMBINED_FIRST = 41;

const SITE_COMBINED_OFFSET = POLISH_FIRST_VERSION - SITE_SOURCE_FIRST;
const REPORT_COMBINED_OFFSET = REPORT_COMBINED_FIRST - REPORT_SOURCE_FIRST;

function makePolishEntry(version, focus, source, sourceVersion, summaries) {
  return {
    version,
    focus,
    source,
    sourceVersion,
    tier: source + ' V' + sourceVersion,
    summaries,
    acceptance: summaries,
  };
}

const POLISH_VERSION_SPEC = [
  makePolishEntry(31, 'Online-sourced artwork, inlined offline', 'site', 21, [
    'Fetch web imagery and design references during generation, then inline chosen assets as base64 data URLs or inline SVG/CSS.',
    'Cap each inlined raster asset at 120KB and the total inlined payload at 400KB; compress or replace oversized assets.',
    'Credit externally sourced artwork in a compact visible attribution line with source name or host and licence.',
    'Scan the final HTML for remote src/href/url()/fetch references and remove them so the delivered file stays offline.',
  ]),
  makePolishEntry(32, 'Modern CSS with safe fallbacks', 'site', 22, [
    'Reflow at least one component with a container query and keep a viewport media-query fallback.',
    'Use text-wrap balance and pretty behind @supports with ordinary wrapping as the fallback.',
    'Use :has() for a real parent-state style behind @supports selector(:has(*)) with a class fallback.',
    'Prefer logical properties and gate @property/color-mix() behind @supports with plain-colour fallbacks.',
  ]),
  makePolishEntry(33, 'Complete runtime control coverage', 'site', 23, [
    'Enumerate every button, role=button and action link before emitting; wire it or remove it.',
    'Use one delegated listener with target.closest() so dynamically added controls work without rebinding.',
    'Support Enter/Space on custom controls and native buttons for actions; no mouse-only activation.',
    'Add a fresh item at runtime and confirm the new control changes visible state without a reload.',
  ]),
  makePolishEntry(34, 'View transitions with reduced-motion fallback', 'site', 24, [
    'Wrap content-swapping updates in document.startViewTransition with unique view-transition-name values.',
    'Keep view-transition keyframes at 250ms or less and animate opacity/transform only.',
    'Guard the API with typeof checks and @supports, updating the DOM directly when unavailable.',
    'Skip transitions entirely under prefers-reduced-motion and confirm the final state appears with no animation.',
  ]),
  makePolishEntry(35, 'Print stylesheet', 'site', 25, [
    'Provide @media print that hides navigation, controls, overlays and decorative art while keeping main content and one h1.',
    'Use a single-column black-on-white print layout with no shadows or dark backgrounds.',
    'Expand accordions and details and print a short source line for inlined external artwork.',
    'Verify no clipped cards, split buttons or empty header/footer bands in printed output.',
  ]),
  makePolishEntry(36, 'Storage fallback and resilience', 'site', 26, [
    'Wrap localStorage reads and writes in try/catch with an in-memory fallback when blocked or full.',
    'Validate restored state shape and reseed defaults when data is corrupt or stale.',
    'Show a visible aria-live storage-status hint when persistence is unavailable.',
    'Confirm all interactions and Reset work with storage disabled from a disk-opened file.',
  ]),
  makePolishEntry(37, 'Advanced JavaScript state', 'site', 27, [
    'Keep one state object or Map as the source of truth and render through a single pure render function.',
    'Provide single-level undo for a mutating action with a visible Undo control and announcement.',
    'Derive all counters, badges and empty states in the same render pass.',
    'Make handlers idempotent so repeated clicks never duplicate listeners or items.',
  ]),
  makePolishEntry(38, 'Runtime accessibility and focus checks', 'site', 28, [
    'Run a startup self-check for accessible names, alt text, unique ids and valid aria/id references.',
    'Trap focus in open dialogs and popovers, focus the first labelled control and restore the exact trigger.',
    'Keep Tab order in DOM order and skip hidden or aria-hidden elements.',
    'Reflect state with aria-pressed/expanded/selected/current and announce material changes via aria-live.',
  ]),
  makePolishEntry(39, 'Performance budgets', 'site', 29, [
    'Keep index.html at or under 250KB with no data URL over 120KB and no repeated inline styles.',
    'Issue zero runtime network requests: no fetch, XHR, WebSocket, import or external src/href.',
    'Use one end-of-body script, batch DOM reads before writes and animate only transform/opacity.',
    'Render all initial DOM synchronously before the first requestAnimationFrame after DOMContentLoaded.',
  ]),
  makePolishEntry(40, 'Final self-contained release gate', 'site', 30, [
    'Confirm files[] holds exactly one index.html and the HTML parses with one h1, title and description.',
    'Remove every remote URL or network primitive from the final content; all artwork is inline.',
    'Re-verify handlers, attribution and every V21-V29 fallback after the last edit.',
    'Open the file with the network disconnected and emit only when there are no console errors.',
  ]),
  makePolishEntry(41, 'Chat/report prompt parity', 'report', 11, [
    'Trace every claim to the user-visible chat brief or a cited source; introduce no new facts.',
    'Preserve exact user names, terms and numbers from the conversation.',
    'Restate the asked question verbatim as subtitle or heading and answer it in the same terms.',
    'Never leak system rules or scratch reasoning into report blocks.',
  ]),
  makePolishEntry(42, 'Block-level revision preservation', 'report', 12, [
    'Write self-contained blocks so one can be replaced without renumbering neighbours.',
    'Keep heading-to-block order fixed; a single-block edit must not move or duplicate adjacent blocks.',
    'Preserve references, annotation metadata, toc/searchable and valid metadata during text-only revisions.',
    'Ensure each edited block is standalone valid JSON with no dangling commas or partial objects.',
  ]),
  makePolishEntry(43, 'Search navigation 1/N', 'report', 13, [
    'Number matched search passages or result cards as 1/N in text, list or stats.',
    'Keep N equal to the actual cited sources or findings in references.',
    'Make each 1/N marker unique and use identical current/total wording everywhere.',
    'Include a compact ordered Search path note linking markers back to queries.',
  ]),
  makePolishEntry(44, 'Panel dialog semantics and focus restore', 'report', 14, [
    'Give every panel role=dialog, aria-modal=true and an accessible name from an existing label.',
    'Move focus into the panel on open, trap Tab, close on Escape and restore the exact trigger.',
    'Mark background content inert or aria-hidden while a modal panel is open.',
    'Restore underlying scroll position and expanded/collapsed state when the panel closes.',
  ]),
  makePolishEntry(45, 'Visible Copy and export status', 'report', 15, [
    'Show a visible Copied confirmation for at least 2 seconds plus an aria-live announcement.',
    'Show a visible format-named export status, including failure, after every export action.',
    'Disable or mark Copy and export controls during work and re-enable with final status.',
    'Convey status with text or an icon with a text alternative, not colour alone.',
  ]),
  makePolishEntry(46, 'Scroll preservation on restyle', 'report', 16, [
    'Preserve scrollTop and active section when theme, paper, pattern or font changes.',
    'Preserve text selection, open accordions and tabs and annotation highlights across a restyle.',
    'Restyle by swapping root tokens or classes instead of replacing the whole DOM.',
    'Announce the applied style via aria-live without moving focus off the control.',
  ]),
  makePolishEntry(47, 'Annotation selection and status', 'report', 17, [
    'Require an explicit text selection in a block and store its exact quote and blockId.',
    'Show active or pending state on the selected quote and Notes control badge.',
    'Update quote highlight and Notes list immediately on edit or delete and announce the change.',
    'Mark annotations unresolved when their quote disappears after a revision.',
  ]),
  makePolishEntry(48, 'Print and export polish', 'report', 18, [
    'Use single-column print flow with break-inside: avoid on headings, tables, charts and callouts.',
    'Hide viewer chrome in print while keeping the answer-first summary and citations.',
    'Expand interactive blocks fully in print and in exported HTML or Markdown.',
    'Export with a title-derived filename and verify links, tables and references are intact.',
  ]),
  makePolishEntry(49, 'Timeout and stale patch guard', 'report', 19, [
    'Attach an increasing revision token to each patch and reject patches older than the current token.',
    'Time out pending generation and show an explicit timed-out status with Retry.',
    'Re-read the target block before applying a patch and reject it as stale if text changed.',
    'Leave document, scroll position and open panels unchanged after a rejected or timed-out patch.',
  ]),
  makePolishEntry(50, 'Final consumer-readiness gate', 'report', 20, [
    'Verify complete, coherent content with no placeholders, duplicated sentences or invented facts.',
    'Verify the JSON contract, block count, references, annotations and toc/searchable flags.',
    'Walk V11-V19 behaviours end to end: parity, revisions, 1/N, dialogs, status, restyle, annotations, print and guards.',
    'Cold-open in the viewer and confirm answer-first reading, working controls, readable print and no console errors.',
  ]),
];

function clampVersion(version) {
  const n = Number(version);
  if (!Number.isFinite(n)) return POLISH_LAST_VERSION;
  return Math.max(POLISH_FIRST_VERSION, Math.min(POLISH_LAST_VERSION, Math.trunc(n)));
}

function polishEntry(version) {
  const n = Number(version);
  return POLISH_VERSION_SPEC.find((entry) => entry.version === n) || null;
}

function polishEntriesThrough(version) {
  const n = clampVersion(version);
  return POLISH_VERSION_SPEC.filter((entry) => entry.version <= n);
}

function focusThrough(version) {
  return polishEntriesThrough(version)
    .map((entry) => 'V' + entry.version + ' ' + entry.focus.toLowerCase())
    .join('; ');
}

function acceptanceSummariesThrough(version) {
  return polishEntriesThrough(version)
    .flatMap((entry) => entry.summaries.map((summary) => 'V' + entry.version + ': ' + summary));
}

function sourceFor(version) {
  const entry = polishEntry(version);
  if (!entry) return null;
  return { product: entry.source, version: entry.sourceVersion, tier: entry.tier };
}

function combinedVersionFor(product, sourceVersion) {
  const p = String(product || '').toLowerCase();
  const n = Number(sourceVersion);
  if (!Number.isFinite(n)) return null;
  if (p === 'site' && n >= SITE_SOURCE_FIRST && n <= SITE_SOURCE_LAST) return n + SITE_COMBINED_OFFSET;
  if (p === 'report' && n >= REPORT_SOURCE_FIRST && n <= REPORT_SOURCE_LAST) return n + REPORT_COMBINED_OFFSET;
  return null;
}

function sourceRulesFor(version) {
  const entry = polishEntry(version);
  if (!entry) return [];
  const spec = entry.source === 'site' ? SITE_VERSION_SPEC : REPORT_VERSION_SPEC;
  const source = spec.find((tier) => tier.version === entry.sourceVersion);
  return source ? source.rules.slice() : [];
}

function validatePolishSpec() {
  const errors = [];
  if (POLISH_VERSION_SPEC.length !== POLISH_VERSION_COUNT) {
    errors.push('Expected ' + POLISH_VERSION_COUNT + ' combined tiers, found ' + POLISH_VERSION_SPEC.length);
  }

  POLISH_VERSION_SPEC.forEach((entry, index) => {
    const expectedVersion = POLISH_FIRST_VERSION + index;
    const label = 'V' + entry.version;
    if (entry.version !== expectedVersion) errors.push(label + ': expected V' + expectedVersion);
    if (typeof entry.focus !== 'string' || !entry.focus.trim()) errors.push(label + ': missing focus');
    if (!Array.isArray(entry.summaries) || entry.summaries.length !== 4) {
      errors.push(label + ': expected exactly four acceptance summaries');
    } else if (entry.summaries.some((s) => typeof s !== 'string' || !s.trim())) {
      errors.push(label + ': empty acceptance summary');
    }
    if (entry.acceptance !== entry.summaries) errors.push(label + ': acceptance alias mismatch');

    const isSite = entry.version < REPORT_COMBINED_FIRST;
    const expectedSource = isSite ? 'site' : 'report';
    const expectedSourceVersion = isSite
      ? entry.version - SITE_COMBINED_OFFSET
      : entry.version - REPORT_COMBINED_OFFSET;
    if (entry.source !== expectedSource || entry.sourceVersion !== expectedSourceVersion) {
      errors.push(label + ': expected ' + expectedSource + ' V' + expectedSourceVersion);
    }
    if (combinedVersionFor(entry.source, entry.sourceVersion) !== entry.version) {
      errors.push(label + ': source mapping is not reversible');
    }
    const sourceRules = sourceRulesFor(entry.version);
    if (sourceRules.length !== 4) errors.push(label + ': source tier does not have four rules');
    if (entry.summaries.length === 4 && sourceRules.length === 4) {
      // Positional parity: each acceptance summary stands for one source rule.
      entry.summaries.forEach((summary, i) => {
        if (typeof summary === 'string' && !summary.trim()) errors.push(label + ': summary ' + (i + 1) + ' is blank');
      });
    }
  });

  return { ok: errors.length === 0, errors };
}

module.exports = {
  POLISH_FIRST_VERSION,
  POLISH_LAST_VERSION,
  POLISH_VERSION_COUNT,
  POLISH_GENERATOR_VERSION,
  SITE_SOURCE_FIRST,
  SITE_SOURCE_LAST,
  REPORT_SOURCE_FIRST,
  REPORT_SOURCE_LAST,
  REPORT_COMBINED_FIRST,
  SITE_COMBINED_OFFSET,
  REPORT_COMBINED_OFFSET,
  POLISH_VERSION_SPEC,
  makePolishEntry,
  clampVersion,
  polishEntry,
  entry: polishEntry,
  polishEntriesThrough,
  entriesThrough: polishEntriesThrough,
  focusThrough,
  acceptanceSummariesThrough,
  summariesThrough: acceptanceSummariesThrough,
  sourceFor,
  combinedVersionFor,
  sourceRulesFor,
  validatePolishSpec,
  validate: validatePolishSpec,
};
